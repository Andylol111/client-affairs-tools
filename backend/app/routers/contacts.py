"""
Contacts API - Contact Scraper & Discovery Engine
"""
import asyncio
import csv
import io
import os
import json
import uuid
from typing import Awaitable, Callable, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from app.database import get_db
from app.models import ContactCreate, ScrapeRequest, SearchPersonRequest
from app.auth_deps import get_current_user_optional, get_current_user, get_current_admin
from app.services.audit_service import log_audit
from app.services.usage_service import log_event
from app.services.contact_merge import merge_contacts
from app.services.contact_scraper import (
    scrape_contacts_from_domain,
    extract_domain_from_company,
    guess_linkedin_company_url,
    infer_email_from_name,
    normalize_domain,
    sanitize_email,
    is_employee_outreach_email,
    is_valid_person_contact,
    is_heuristic_junk_contact,
    looks_like_person_name,
    confidence_for_contact_dict,
)
from app.services.linkedin_scraper import scrape_linkedin_company
from app.services.web_contact_discovery import discover_contacts_from_web
from app.services.contact_verify_pipeline import run_contact_verify_pipeline
from app.services.contact_identity import reconcile_contacts
from app.services.company_email_cache import get_domain_patterns
from app.services.contact_ai_review import (
    persist_discovery_log,
    get_discovery_log,
    check_review_backend,
    AI_REVIEW_ENABLED,
    _log_row,
)
from app.services.discovery_policy import should_run_linkedin

router = APIRouter()

ProgressCallback = Optional[Callable[[dict], Awaitable[None]]]


class ScrapeCancelled(Exception):
    """Client disconnected or user aborted; optional partial DB snapshot."""

    def __init__(self, snapshot: dict | None = None):
        self.snapshot = snapshot or {"contacts": [], "count": 0, "duplicates_skipped": 0}


async def _execute_scrape(
    req: ScrapeRequest,
    on_progress: ProgressCallback = None,
    cancel_event: asyncio.Event | None = None,
) -> dict:
    """
    Core scrape pipeline. Optional on_progress receives {"type":"progress", "phase", "pct", "message", "detail?"}.
    cancel_event: when set, stops work and raises ScrapeCancelled (stream disconnect / user abort).
    """
    async def emit(phase: str, pct: float, message: str, detail: str | None = None) -> None:
        if on_progress:
            await on_progress(
                {
                    "type": "progress",
                    "phase": phase,
                    "pct": round(min(100.0, max(0.0, pct)), 1),
                    "message": message,
                    "detail": detail,
                }
            )

    async def _check_cancel() -> None:
        if cancel_event and cancel_event.is_set():
            raise ScrapeCancelled()

    scrape_run_id = str(uuid.uuid4())
    domain = req.domain
    if not domain and req.company_name:
        domain = extract_domain_from_company(req.company_name)
    if not domain and not req.linkedin_url:
        raise HTTPException(400, "Provide domain, company_name, or linkedin_url")

    scrape_domain = bool(domain and normalize_domain(domain))
    company_name = req.company_name
    user_linkedin = (req.linkedin_url or "").strip()
    has_apify = bool((os.getenv("APIFY_API_TOKEN") or "").strip())
    linkedin_url = user_linkedin
    has_li = False
    web_on = req.enable_web_discovery is not False and bool((os.getenv("TAVILY_API_KEY") or "").strip())
    web_max = min(req.linkedin_max_employees or 50, int(os.getenv("SCRAPE_WEB_MAX_PEOPLE", "80")))
    par_lo, par_hi = 5.0, 82.0

    await emit(
        "init",
        2.0,
        "Starting scrape",
        "Website and web search first; LinkedIn only if you pasted a URL or the crawl is thin",
    )
    await _check_cancel()

    async def _fetch_domain() -> list[dict]:
        if not scrape_domain:
            return []
        norm_dom = normalize_domain(domain or "")

        async def on_domain_page(i: int, n: int, url: str) -> None:
            await _check_cancel()
            if url == "queued":
                await emit(
                    "domain",
                    par_lo,
                    "Waiting for website crawl slot",
                    "HTML crawl is serialized on this box; Tavily/Apify/Bedrock keep running",
                )
                return
            frac = (i - 1) / max(n, 1)
            await emit("domain", par_lo + (par_hi - par_lo) * 0.35 * frac, "Crawling company website", f"Page {i}/{n}")

        return await scrape_contacts_from_domain(
            domain=norm_dom,
            company_name=company_name,
            on_page=on_domain_page,
            cancel_event=cancel_event,
        )

    async def _fetch_linkedin() -> tuple[list[dict], str | None]:
        if not has_li:
            return [], company_name
        await emit("linkedin", par_lo + 8, "LinkedIn employee fetch", linkedin_url)
        li_data = await scrape_linkedin_company(
            linkedin_url,
            max_employees=min(req.linkedin_max_employees or 50, 100),
            cancel_event=cancel_event,
        )
        if li_data.get("aborted") or (li_data.get("error") or "") == "Cancelled":
            raise ScrapeCancelled()
        cn = company_name or li_data.get("company_name")
        return li_data.get("contacts") or [], cn

    async def _fetch_web() -> list[dict]:
        cn = (company_name or "").strip() or (
            (domain or "").split(".")[0].replace("-", " ").title() if domain else ""
        )
        if not web_on or not cn:
            return []
        await emit("web", par_lo + 12, "Web + LinkedIn name search", "Parallel Tavily queries")

        async def on_web(msg: str, _pct: float) -> None:
            await emit("web", par_lo + 12 + _pct * 0.2, msg, None)

        return await discover_contacts_from_web(
            cn,
            domain or None,
            max_people=web_max,
            cancel_event=cancel_event,
            on_progress=on_web,
        )

    domain_contacts, web_contacts = await asyncio.gather(_fetch_domain(), _fetch_web())
    run_li = should_run_linkedin(
        user_url=user_linkedin,
        has_token=has_apify,
        domain_hits=len(domain_contacts),
    )
    if run_li:
        if not linkedin_url and has_apify:
            linkedin_url = guess_linkedin_company_url(company_name, domain) or ""
        has_li = bool(linkedin_url)
    if has_li:
        linkedin_contacts, li_company = await _fetch_linkedin()
    else:
        linkedin_contacts, li_company = [], company_name
        if has_apify and not user_linkedin:
            await emit(
                "linkedin",
                par_lo + 8,
                "Skipping guessed LinkedIn — website already has enough people",
                None,
            )
    company_name = li_company or company_name
    await emit(
        "domain",
        par_hi,
        "Source fetch complete",
        f"Website {len(domain_contacts)} · LinkedIn {len(linkedin_contacts)} · Web {len(web_contacts)}",
    )
    await _check_cancel()

    if not domain and company_name:
        domain = extract_domain_from_company(company_name)
    domain = normalize_domain(domain or "")

    await emit("prepare", 85.0, "Merging contacts and loading email patterns", None)
    await _check_cancel()

    if AI_REVIEW_ENABLED:
        ok, detail = await check_review_backend()
        if not ok:
            await emit("prepare", 86.0, "Warning: review backend unavailable — AI will show Unreviewed", detail)
        else:
            await emit("prepare", 86.0, f"Review ready ({detail})", "Heuristic junk filter + AI review")

    custom_patterns = []
    db_prep = await get_db()
    try:
        cursor = await db_prep.execute("SELECT pattern FROM custom_email_formats ORDER BY priority DESC")
        rows = await cursor.fetchall()
        custom_patterns = [r["pattern"] for r in rows if r.get("pattern")]
    except Exception:
        pass
    finally:
        await db_prep.close()

    contacts_data = merge_contacts(
        domain_contacts,
        linkedin_contacts,
        company_name or "",
        domain or "",
        custom_patterns,
        web_contacts=web_contacts,
    )

    await emit(
        "prepare",
        87.0,
        f"Verifying {len(contacts_data)} merged contact(s)",
        "Inbox MX check + AI review (junk removed from results)",
    )
    heuristic_junk: list[dict] = []
    to_verify: list[dict] = []
    for c in contacts_data:
        junk, reason = is_heuristic_junk_contact(c, company_name)
        if junk:
            row = dict(c)
            row["ai_verdict"] = "junk"
            row["ai_reason"] = reason
            row["ai_source_note"] = "heuristic pre-filter"
            heuristic_junk.append(row)
        else:
            to_verify.append(c)

    total_in = len(to_verify)

    async def _pipe_progress(phase: str, done: int, total: int, detail: str = "") -> None:
        base = {"identity": 87.0, "verify": 87.5, "ai": 88.5, "done": 89.5}.get(phase, 87.0)
        span = {"identity": 0.4, "verify": 1.0, "ai": 1.0, "done": 0.1}.get(phase, 1.0)
        pct = base + (done / max(total, 1)) * span
        label = {
            "identity": "Identity gate",
            "verify": "Inbox agents",
            "ai": "AI agents",
            "done": "Agents finished",
        }.get(phase, "Verifying")
        await emit("prepare", pct, label, detail or f"{done}/{total}")

    verified, discovery_log = await run_contact_verify_pipeline(
        to_verify,
        company_name=company_name,
        domain=domain,
        on_progress=_pipe_progress if total_in > 0 else None,
    )
    for c in heuristic_junk:
        discovery_log.append(
            _log_row(c, verdict="junk", reason=c.get("ai_reason") or "", model=None, source_note="heuristic pre-filter")
        )
    contacts_data = verified + heuristic_junk
    save_candidates = [c for c in contacts_data if c.get("ai_verdict") != "junk"]
    junk_count = len(contacts_data) - len(save_candidates)

    await emit(
        "prepare",
        89.8,
        f"Ready to save {len(save_candidates)} contact(s)",
        f"{junk_count} flagged as junk by AI" if junk_count else "Saving to database…",
    )

    db = await get_db()
    created = []
    returned: list[dict] = []
    duplicates_skipped = 0
    total_save = max(len(save_candidates), 1)
    try:
        # Build result rows for saveable contacts only (junk excluded from UI)
        result_by_email: dict[str, dict] = {}
        for c in save_candidates:
            em = sanitize_email(c.get("email") or "").lower()
            if not em:
                continue
            result_by_email[em] = {
                **c,
                "email": em,
                "already_exists": False,
                "ai_rejected": False,
            }

        for idx, c in enumerate(save_candidates):
            save_pct = 90.0 + (idx / total_save) * 9.5
            if on_progress and idx % max(1, len(save_candidates) // 20) == 0:
                await emit(
                    "save",
                    save_pct,
                    "Saving contacts",
                    f"Row {idx + 1} of {len(save_candidates)}",
                )
            try:
                email_clean = sanitize_email(c.get("email") or "")
                domain_clean = normalize_domain(c.get("company_domain") or domain or "")
                if not email_clean or not is_valid_person_contact(
                    {**c, "email": email_clean},
                    company_name=company_name,
                    domain=domain_clean or domain,
                ):
                    continue
                cursor = await db.execute("SELECT * FROM contacts WHERE email = ?", (email_clean,))
                existing = await cursor.fetchone()
                if existing:
                    duplicates_skipped += 1
                    row = dict(existing)
                    if row.get("email"):
                        row["email"] = sanitize_email(row["email"])
                    result_by_email[email_clean] = {
                        **row,
                        "name": c.get("name") or row.get("name"),
                        "title": c.get("title") or row.get("title"),
                        "linkedin_url": c.get("linkedin_url") or row.get("linkedin_url"),
                        "already_exists": True,
                        "scrape_source": c.get("contact_source"),
                        "scrape_source_url": c.get("source_url"),
                        "discovery_context": c.get("discovery_context"),
                        "ai_verdict": c.get("ai_verdict"),
                        "ai_reason": c.get("ai_reason"),
                        "ai_source_note": c.get("ai_source_note"),
                        "email_verification_status": c.get("email_verification_status") or row.get("email_verification_status"),
                        "email_pattern": c.get("email_pattern") or row.get("email_pattern"),
                        "contact_source": c.get("contact_source") or row.get("contact_source"),
                    }
                    await db.execute(
                        """UPDATE contacts SET ai_verdict = ?, ai_reason = ?, ai_source_note = ?,
                           email_verification_status = COALESCE(?, email_verification_status),
                           email_pattern = COALESCE(?, email_pattern)
                           WHERE id = ?""",
                        (
                            c.get("ai_verdict"),
                            c.get("ai_reason"),
                            c.get("ai_source_note"),
                            c.get("email_verification_status"),
                            c.get("email_pattern"),
                            row["id"],
                        ),
                    )
                    await db.commit()
                    continue
                cursor = await db.execute(
                    """INSERT INTO contacts (name, email, title, company, company_domain, linkedin_url, confidence, department, contact_source, email_verification_status, email_pattern, ai_verdict, ai_reason, ai_source_note)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        c.get("name"),
                        email_clean,
                        c.get("title"),
                        c.get("company"),
                        domain_clean,
                        c.get("linkedin_url"),
                        c.get("confidence", "medium"),
                        c.get("department"),
                        c.get("contact_source"),
                        c.get("email_verification_status"),
                        c.get("email_pattern"),
                        c.get("ai_verdict"),
                        c.get("ai_reason"),
                        c.get("ai_source_note"),
                    ),
                )
                row_id = cursor.lastrowid
                await db.commit()
                created.append({"id": row_id, **c, "email": email_clean, "company_domain": domain_clean, "already_exists": False})
                result_by_email[email_clean] = {**created[-1], "ai_rejected": False}
            except Exception:
                await db.rollback()
                pass

        returned = list(result_by_email.values())

        for entry in discovery_log:
            entry["scrape_run_id"] = scrape_run_id
            entry["saved_to_db"] = any(
                r.get("email", "").lower() == (entry.get("email") or "").lower()
                and not r.get("already_exists")
                and not r.get("ai_rejected")
                for r in returned
            )
        await persist_discovery_log(scrape_run_id, discovery_log)

        await emit("save", 100.0, "Done", None)
    finally:
        await db.close()
    return {
        "contacts": returned,
        "count": len(created),
        "found_total": len(save_candidates),
        "raw_found": len(contacts_data),
        "duplicates_skipped": duplicates_skipped,
        "ai_junk_skipped": junk_count,
        "scrape_run_id": scrape_run_id,
        "discovery_log": discovery_log,
    }


def _parse_csv(content: bytes) -> list[dict]:
    """Parse CSV, auto-detect delimiter. Expects columns: name, email, title, company (email required)."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        row = {k.strip().lower().replace(" ", "_"): v.strip() if v else "" for k, v in r.items()}
        email = row.get("email") or row.get("e-mail") or row.get("email_address")
        if not email or "@" not in email:
            continue
        if not is_employee_outreach_email(str(email).strip()):
            continue
        rows.append({
            "name": row.get("name") or row.get("full_name") or "",
            "email": email,
            "title": row.get("title") or row.get("job_title") or row.get("position") or "",
            "company": row.get("company") or row.get("organization") or "",
            "company_domain": row.get("domain") or row.get("company_domain") or "",
            "linkedin_url": row.get("linkedin") or row.get("linkedin_url") or "",
        })
    return rows


def _parse_excel(content: bytes) -> list[dict]:
    """Parse Excel (.xlsx). Uses first sheet, expects header row with name, email, title, company."""
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise HTTPException(500, "openpyxl not installed")
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    if not ws:
        return []
    rows_iter = ws.iter_rows(values_only=True)
    headers = [str(h).strip().lower().replace(" ", "_") if h else "" for h in next(rows_iter, [])]
    col_map = {h: i for i, h in enumerate(headers) if h}
    email_col = col_map.get("email") or col_map.get("e-mail") or col_map.get("email_address")
    if email_col is None:
        email_col = next((i for i, h in enumerate(headers) if h and "email" in h), None)
    if email_col is None:
        return []
    rows = []
    name_col = col_map.get("name") or col_map.get("full_name")
    title_col = col_map.get("title") or col_map.get("job_title") or col_map.get("position")
    company_col = col_map.get("company") or col_map.get("organization")
    domain_col = col_map.get("domain") or col_map.get("company_domain")
    linkedin_col = col_map.get("linkedin") or col_map.get("linkedin_url")
    for row in rows_iter:
        vals = list(row) if row else []
        email = (vals[email_col] if email_col is not None and email_col < len(vals) else "") or ""
        if not email or "@" not in str(email):
            continue
        if not is_employee_outreach_email(str(email).strip()):
            continue
        rows.append({
            "name": str(vals[name_col] or "") if name_col is not None and name_col < len(vals) else "",
            "email": str(email).strip(),
            "title": str(vals[title_col] or "") if title_col is not None and title_col < len(vals) else "",
            "company": str(vals[company_col] or "") if company_col is not None and company_col < len(vals) else "",
            "company_domain": str(vals[domain_col] or "") if domain_col is not None and domain_col < len(vals) else "",
            "linkedin_url": str(vals[linkedin_col] or "") if linkedin_col is not None and linkedin_col < len(vals) else "",
        })
    return rows


@router.post("/import")
async def import_contacts(
    file: UploadFile = File(...),
    skip_duplicates: bool = True,
    user: dict | None = Depends(get_current_user_optional),
):
    """Import contacts from CSV or Excel. Duplicates (by email) are skipped by default; set skip_duplicates=false to get errors on duplicate."""
    content = await file.read()
    filename = (file.filename or "").lower()
    if filename.endswith(".csv"):
        rows = _parse_csv(content)
    elif filename.endswith(".xlsx"):
        rows = _parse_excel(content)
    else:
        raise HTTPException(400, "Upload CSV or Excel (.xlsx)")
    if not rows:
        raise HTTPException(400, "No valid contacts found. Ensure file has 'email' column and at least one row.")
    db = await get_db()
    created = []
    duplicates_skipped = 0
    try:
        for c in rows:
            try:
                email_clean = sanitize_email(c.get("email") or "")
                if not email_clean or not is_employee_outreach_email(email_clean):
                    duplicates_skipped += 1
                    continue
                domain_clean = normalize_domain(c.get("company_domain") or "")
                if skip_duplicates:
                    cursor = await db.execute("SELECT id FROM contacts WHERE email = ?", (email_clean,))
                    if await cursor.fetchone():
                        duplicates_skipped += 1
                        continue
                cursor = await db.execute(
                    """INSERT INTO contacts (name, email, title, company, company_domain, linkedin_url, confidence, department)
                       VALUES (?, ?, ?, ?, ?, ?, 'medium', ?)""",
                    (
                        c.get("name") or "Unknown",
                        email_clean,
                        c.get("title"),
                        c.get("company"),
                        domain_clean,
                        c.get("linkedin_url"),
                        None,
                    ),
                )
                row_id = cursor.lastrowid
                await db.commit()
                created.append({"id": row_id, **c})
            except Exception:
                await db.rollback()
                if not skip_duplicates:
                    raise
                pass
    finally:
        await db.close()
    if user:
        await log_event(
            user["id"], "scrape_completed", "scraper",
            {"source": "import", "count": len(created), "duplicates_skipped": duplicates_skipped},
        )
    return {"contacts": created, "count": len(created), "duplicates_skipped": duplicates_skipped}


@router.post("/search-person")
async def search_person(req: SearchPersonRequest):
    """Search the web for information about a person (name + optional company). Uses Tavily if TAVILY_API_KEY is set; optional LLM summary via Ollama."""
    query = req.name.strip()
    if req.company and req.company.strip():
        query = f"{query} {req.company.strip()}"
    if not query:
        raise HTTPException(400, "Name is required")

    api_key = (os.getenv("TAVILY_API_KEY") or "").strip()
    if not api_key:
        return {
            "query": query,
            "results": [],
            "summary": None,
            "message": "Web search is not configured. Set TAVILY_API_KEY in the backend .env to enable finding contact information from the internet.",
        }

    import httpx
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": f"{req.name} contact email professional {req.company or ''}".strip(),
                    "search_depth": "basic",
                    "max_results": 10,
                },
            )
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPStatusError as e:
            return {
                "query": query,
                "results": [],
                "summary": None,
                "message": f"Search API error: {e.response.status_code}",
            }
        except Exception as e:
            return {
                "query": query,
                "results": [],
                "summary": None,
                "message": str(e),
            }

    results = [
        {"title": x.get("title"), "url": x.get("url"), "content": (x.get("content") or "")[:500]}
        for x in data.get("results") or []
    ]

    # Optional: LLM summary via Ollama
    summary = None
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    if results:
        snippets = "\n\n".join(
            f"[{i+1}] {r.get('title', '')}\n{r.get('content', '')}" for i, r in enumerate(results[:6])
        )
        prompt = f"""Based on the following web search results about "{req.name}"{f' at {req.company}' if req.company else ''}, extract and list:
- Possible job title and company
- Email or contact info if mentioned
- LinkedIn or social profile URLs if mentioned
- One short paragraph summarizing who they are and relevance for outreach

Search results:
{snippets}

Respond in clear bullet points and one short paragraph. If no contact info is found, say so."""

        try:
            async with httpx.AsyncClient(timeout=60.0) as client_ollama:
                resp = await client_ollama.post(
                    f"{ollama_url.rstrip('/')}/api/generate",
                    json={"model": "llama3.2", "prompt": prompt, "stream": False},
                )
                if resp.status_code == 200:
                    body = resp.json()
                    summary = (body.get("response") or "").strip()
        except Exception:
            pass

    return {
        "query": query,
        "results": results,
        "summary": summary,
        "message": None,
    }


@router.get("/discovery-log")
async def list_discovery_log(scrape_run_id: str, limit: int = 500):
    """Review AI + source audit trail for a scrape run."""
    if not scrape_run_id.strip():
        raise HTTPException(400, "scrape_run_id is required")
    rows = await get_discovery_log(scrape_run_id.strip(), limit=min(limit, 2000))
    return {"scrape_run_id": scrape_run_id, "entries": rows, "count": len(rows)}


@router.get("/email-patterns")
async def list_company_email_patterns(domain: str):
    """Explore verified / inferred email layout patterns learned per company domain."""
    dom = normalize_domain(domain or "")
    if not dom:
        raise HTTPException(400, "domain is required")
    patterns = await get_domain_patterns(dom)
    return {"domain": dom, "patterns": patterns, "count": len(patterns)}


@router.post("/scrape")
async def scrape_contacts(req: ScrapeRequest):
    """Scrape contacts from domain, company name, and/or LinkedIn company URL."""
    return await _execute_scrape(req, None)


@router.post("/scrape-stream")
async def scrape_contacts_stream(req: ScrapeRequest, request: Request):
    """Same pipeline as /scrape but streams NDJSON progress events for live UI feedback."""

    async def event_generator():
        cancel = asyncio.Event()
        queue: asyncio.Queue = asyncio.Queue()
        outcome: dict = {}

        async def watch_disconnect() -> None:
            try:
                while True:
                    if await request.is_disconnected():
                        cancel.set()
                        return
                    await asyncio.sleep(0.35)
            except asyncio.CancelledError:
                raise

        disconnect_watcher = asyncio.create_task(watch_disconnect())

        async def push(ev: dict) -> None:
            await queue.put(ev)

        async def run() -> None:
            try:
                outcome["result"] = await _execute_scrape(req, push, cancel_event=cancel)
            except ScrapeCancelled as sc:
                outcome["cancelled"] = True
                outcome["partial"] = sc.snapshot
            except HTTPException as e:
                d = e.detail
                outcome["error"] = d if isinstance(d, str) else str(d)
            except Exception as e:
                outcome["error"] = str(e)
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield json.dumps(item, default=str) + "\n"
            if outcome.get("cancelled"):
                partial = outcome.get("partial") or {}
                yield json.dumps(
                    {
                        "type": "cancelled",
                        "message": "Scrape stopped.",
                        "contacts": partial.get("contacts", []),
                        "count": partial.get("count", 0),
                        "duplicates_skipped": partial.get("duplicates_skipped", 0),
                    },
                    default=str,
                ) + "\n"
            elif outcome.get("error"):
                yield json.dumps({"type": "error", "message": outcome["error"]}, default=str) + "\n"
            elif outcome.get("result") is not None:
                r = outcome["result"]
                yield json.dumps(
                    {
                        "type": "complete",
                        "contacts": r["contacts"],
                        "count": r["count"],
                        "found_total": r.get("found_total", r["count"]),
                        "duplicates_skipped": r.get("duplicates_skipped", 0),
                        "ai_junk_skipped": r.get("ai_junk_skipped", 0),
                        "scrape_run_id": r.get("scrape_run_id"),
                        "discovery_log": r.get("discovery_log", []),
                    },
                    default=str,
                ) + "\n"
        finally:
            disconnect_watcher.cancel()
            try:
                await disconnect_watcher
            except asyncio.CancelledError:
                pass
            await task

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.get("/companies/summary")
async def companies_summary(user: dict | None = Depends(get_current_user_optional)):
    """Distinct companies in the DB with contact counts (for campaign / studio targeting)."""
    db = await get_db()
    try:
        conditions, params = [], []
        if user and user.get("role") != "admin":
            conditions.append("(c.owner_id = ? OR c.owner_id IS NULL)")
            params.append(user["id"])
        vis = (" AND ".join(conditions)) if conditions else "1=1"
        cursor = await db.execute(
            f"""SELECT TRIM(c.company) AS company, c.company_domain,
                       COUNT(DISTINCT c.id) AS contact_count,
                       MAX(cc.sent_at) AS last_sent_at,
                       COUNT(DISTINCT CASE WHEN cc.sent_at IS NOT NULL THEN cc.campaign_id END) AS campaign_count
                FROM contacts c
                LEFT JOIN campaign_contacts cc ON cc.contact_id = c.id
                WHERE ({vis})
                  AND c.company IS NOT NULL AND TRIM(c.company) != ''
                GROUP BY LOWER(TRIM(c.company)), IFNULL(c.company_domain, '')
                ORDER BY company ASC""",
            params,
        )
        rows = await cursor.fetchall()
        return [
            {
                "company": r["company"],
                "company_domain": r["company_domain"],
                "contact_count": r["contact_count"],
                "last_sent_at": r["last_sent_at"],
                "campaign_count": r["campaign_count"],
            }
            for r in rows
        ]
    finally:
        await db.close()


async def _delete_contacts_cascade(db, contact_ids: list[int]) -> None:
    if not contact_ids:
        return
    from app.services.dispatch_service import begin_write
    await begin_write(db)
    ph = ",".join(["?" for _ in contact_ids])
    dispatched = await (await db.execute(
        f"""SELECT 1 FROM campaign_contacts cc WHERE cc.contact_id IN ({ph})
        AND (cc.sent_at IS NOT NULL OR cc.status='sending' OR EXISTS
        (SELECT 1 FROM outreach_dispatches d WHERE d.campaign_contact_id=cc.id)) LIMIT 1""",
        contact_ids,
    )).fetchone()
    if dispatched:
        raise HTTPException(409, "Outreach history cannot be cascade-deleted; archive these contacts instead")
    await db.execute(
        f"""DELETE FROM email_events WHERE campaign_contact_id IN (
               SELECT id FROM campaign_contacts WHERE contact_id IN ({ph}))""",
        contact_ids,
    )
    for table in (
        "campaign_contacts",
        "generated_emails",
        "contact_notes",
        "contact_activities",
        "contact_profiles",
        "email_sentiment_analyses",
        "outreach_campaign_contacts",
    ):
        await db.execute(f"DELETE FROM {table} WHERE contact_id IN ({ph})", contact_ids)
    await db.execute(f"DELETE FROM contacts WHERE id IN ({ph})", contact_ids)


class ClearContactsRequest(BaseModel):
    confirm: bool = False
    domain: str | None = None
    clear_pattern_cache: bool = False
    clear_discovery_logs: bool = False


@router.post("/clear-all")
async def clear_all_contacts(payload: ClearContactsRequest, user: dict | None = Depends(get_current_admin)):
    """
    Delete all contacts (optional domain filter) and optionally email-pattern / discovery caches.
    Requires confirm=true in JSON body.
    """
    if not payload.confirm:
        raise HTTPException(
            400,
            "Set confirm=true to delete contacts. This permanently removes all matching contacts and related rows.",
        )
    dom = normalize_domain(payload.domain or "") if payload.domain else ""
    db = await get_db()
    try:
        if dom:
            cur = await db.execute(
                "SELECT id FROM contacts WHERE company_domain = ? OR email LIKE ?",
                (dom, f"%@{dom}"),
            )
        else:
            cur = await db.execute("SELECT id FROM contacts")
        ids = [r["id"] for r in await cur.fetchall()]
        await _delete_contacts_cascade(db, ids)
        patterns_deleted = logs_deleted = 0
        if payload.clear_pattern_cache:
            if dom:
                cur = await db.execute("DELETE FROM company_email_patterns WHERE company_domain = ?", (dom,))
            else:
                cur = await db.execute("DELETE FROM company_email_patterns")
            patterns_deleted = cur.rowcount or 0
        if payload.clear_discovery_logs:
            cur = await db.execute("DELETE FROM contact_discovery_logs")
            logs_deleted = cur.rowcount or 0
        await db.commit()
        if user:
            await log_audit(
                user["id"],
                "contacts_clear_all",
                "contact",
                dom or "all",
                f"Deleted {len(ids)} contacts; patterns={patterns_deleted}; logs={logs_deleted}",
            )
        return {
            "contacts_deleted": len(ids),
            "patterns_deleted": patterns_deleted,
            "discovery_logs_deleted": logs_deleted,
            "domain": dom or None,
        }
    finally:
        await db.close()


class BulkDeleteContactsRequest(BaseModel):
    contact_ids: list[int] = Field(default_factory=list)


@router.post("/bulk-delete")
async def bulk_delete_contacts(payload: BulkDeleteContactsRequest, user: dict | None = Depends(get_current_admin)):
    """
    Delete multiple contacts and dependent rows (campaign_contacts, notes, generated_emails cache, etc.).
    Administrators only; records with released or historical outreach are retained.
    """
    raw_ids = [i for i in payload.contact_ids if isinstance(i, int) and i > 0]
    ids = list(dict.fromkeys(raw_ids))
    if not ids:
        return {"deleted": 0, "skipped": 0}

    db = await get_db()
    try:
        ph = ",".join(["?" for _ in ids])
        params: list = list(ids)
        visibility = f"id IN ({ph})"
        if user and user.get("role") != "admin":
            visibility += " AND (owner_id = ? OR owner_id IS NULL)"
            params.append(user["id"])
        cursor = await db.execute(f"SELECT id FROM contacts WHERE {visibility}", params)
        allowed = [r["id"] for r in await cursor.fetchall()]
        if not allowed:
            return {"deleted": 0, "skipped": len(ids)}

        await _delete_contacts_cascade(db, allowed)
        await db.commit()
        if user:
            await log_audit(
                user["id"],
                "contacts_bulk_delete",
                "contact",
                ",".join(str(i) for i in allowed[:50]) + ("..." if len(allowed) > 50 else ""),
                f"Deleted {len(allowed)} contact(s)",
            )
        return {"deleted": len(allowed), "skipped": len(ids) - len(allowed)}
    finally:
        await db.close()


@router.get("")
async def list_contacts(
    company: str | None = None,
    companies: str | None = None,
    q: str | None = None,
    pipeline_status: str | None = None,
    employee_only: bool = False,
    release_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
    mine_only: bool = False,
    user: dict | None = Depends(get_current_user_optional),
):
    """Paginated canonical contacts. Standard users see their contacts plus shared unassigned rows."""
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    db = await get_db()
    try:
        conditions, params = [], []
        if company:
            conditions.append("c.company LIKE ?")
            params.append(f"%{company}%")
        if companies and companies.strip():
            parts = [p.strip() for p in companies.split(",") if p.strip()]
            if parts:
                placeholders = ",".join(["?" for _ in parts])
                conditions.append(f"TRIM(c.company) IN ({placeholders})")
                params.extend(parts)
        if q and q.strip():
            q_term = f"%{q.strip()}%"
            conditions.append("(c.name LIKE ? OR c.email LIKE ? OR c.company LIKE ? OR c.title LIKE ?)")
            params.extend([q_term, q_term, q_term, q_term])
        if pipeline_status and pipeline_status.strip():
            conditions.append("(c.pipeline_status = ? OR (c.pipeline_status IS NULL AND ? = 'cold'))")
            params.extend([pipeline_status.strip().lower(), pipeline_status.strip().lower()])
        if user and user.get("role") != "admin":
            if mine_only:
                conditions.append("c.owner_id = ?")
                params.append(user["id"])
            else:
                conditions.append("(c.owner_id = ? OR c.owner_id IS NULL)")
                params.append(user["id"])
        if release_id is not None:
            conditions.append(
                "c.id IN (SELECT contact_id FROM outreach_release_people WHERE release_id = ? AND kept = 1 AND contact_id IS NOT NULL)"
            )
            params.append(release_id)
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        count_cursor = await db.execute(f"SELECT COUNT(*) AS n FROM contacts c {where}", params)
        total = int((await count_cursor.fetchone())["n"] or 0)
        query_params = [*params, limit, offset]
        cursor = await db.execute(
            f"""SELECT c.*,
                       ls.sent_at AS last_sent_at,
                       ls.status AS last_send_status,
                       ls.campaign_id AS last_campaign_id,
                       camp.name AS last_campaign_name,
                       ls.sent_by_user_id AS last_sent_by_user_id
                FROM contacts c
                LEFT JOIN (
                    SELECT cc.contact_id, cc.sent_at, cc.status, cc.campaign_id, cc.sent_by_user_id
                    FROM campaign_contacts cc
                    WHERE cc.id IN (
                        SELECT MAX(id) FROM campaign_contacts
                        WHERE sent_at IS NOT NULL
                        GROUP BY contact_id
                    )
                ) ls ON ls.contact_id = c.id
                LEFT JOIN campaigns camp ON camp.id = ls.campaign_id
                {where}
                ORDER BY c.created_at DESC LIMIT ? OFFSET ?""",
            query_params,
        )
        rows = await cursor.fetchall()
        result = [dict(r) for r in rows]
        for r in result:
            if r.get("email"):
                r["email"] = sanitize_email(r["email"])
            if r.get("company_domain"):
                r["company_domain"] = normalize_domain(r["company_domain"])
        if employee_only:
            result = [r for r in result if is_employee_outreach_email(r.get("email") or "")]
        return {"items": result, "total": total, "limit": limit, "offset": offset}
    finally:
        await db.close()


@router.post("")
async def create_contact(contact: ContactCreate, user: dict | None = Depends(get_current_user_optional)):
    """Manually add a contact."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO contacts (name, email, title, company, company_domain, linkedin_url, confidence, department)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                contact.name,
                contact.email,
                contact.title,
                contact.company,
                contact.company_domain,
                contact.linkedin_url,
                contact.confidence or "medium",
                contact.department,
            ),
        )
        await db.commit()
        row_id = cursor.lastrowid
        cursor = await db.execute("SELECT * FROM contacts WHERE id = ?", (row_id,))
        row = await cursor.fetchone()
        d = dict(row)
        if d.get("email"):
            d["email"] = sanitize_email(d["email"])
        if user:
            await log_audit(user["id"], "contact_create", "contact", str(row_id), contact.email)
        return d
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, str(e))
    finally:
        await db.close()


@router.get("/{contact_id}")
async def get_contact(contact_id: int):
    """Get a single contact."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Contact not found")
        d = dict(row)
        if d.get("email"):
            d["email"] = sanitize_email(d["email"])
        if d.get("company_domain"):
            d["company_domain"] = normalize_domain(d["company_domain"])
        return d
    finally:
        await db.close()


@router.post("/purge-junk-contacts")
async def purge_junk_contacts(domain: str | None = None, user: dict = Depends(get_current_admin)):
    """
    Remove nav/product junk saved as contacts (gift.cards@…, Gift Cards, etc.).
    Optional domain= filter.
    """
    from app.services.contact_scraper import (
        is_boilerplate_email_local,
        is_valid_person_contact,
        looks_like_person_name,
        normalize_domain,
        sanitize_email,
    )

    dom = normalize_domain(domain or "") if domain else ""
    db = await get_db()
    removed = 0
    try:
        if dom:
            cur = await db.execute(
                "SELECT id, name, email, title, company, company_domain, linkedin_url, contact_source FROM contacts WHERE company_domain = ? OR email LIKE ?",
                (dom, f"%@{dom}"),
            )
        else:
            cur = await db.execute(
                "SELECT id, name, email, title, company, company_domain, linkedin_url, contact_source FROM contacts"
            )
        rows = await cur.fetchall()
        for r in rows:
            row = dict(r)
            email = sanitize_email(row.get("email") or "")
            row_dom = normalize_domain(row.get("company_domain") or "")
            if not email:
                continue
            local = email.split("@")[0]
            company = row.get("company")
            if is_boilerplate_email_local(local, company, row_dom):
                await db.execute("DELETE FROM contacts WHERE id = ?", (row["id"],))
                removed += 1
                continue
            if not is_valid_person_contact(row, company_name=company, domain=row_dom, require_person_name=True):
                await db.execute("DELETE FROM contacts WHERE id = ?", (row["id"],))
                removed += 1
                continue
            name = (row.get("name") or "").strip()
            if name and not looks_like_person_name(name, company):
                await db.execute("DELETE FROM contacts WHERE id = ?", (row["id"],))
                removed += 1
        await db.commit()
        return {"removed": removed}
    finally:
        await db.close()


@router.post("/reconcile-identity")
async def reconcile_stored_identities(domain: str | None = None, user: dict = Depends(get_current_admin)):
    """
    Re-run name/email reconciliation on saved contacts.
    Fixes mismatches (e.g. junk name from prose near email) and removes rows that cannot be verified.
    """
    dom = normalize_domain(domain or "") if domain else ""
    db = await get_db()
    fixed = removed = unchanged = 0
    try:
        if dom:
            cursor = await db.execute(
                "SELECT * FROM contacts WHERE company_domain = ? OR email LIKE ?",
                (dom, f"%@{dom}"),
            )
        else:
            cursor = await db.execute("SELECT * FROM contacts")
        rows = [dict(r) for r in await cursor.fetchall()]
        reconciled_rows = await reconcile_contacts(
            rows,
            domain=dom or None,
            verify_deliverability=False,
        )
        by_id = {r["id"]: r for r in reconciled_rows if r.get("id") is not None}

        for contact in rows:
            cid = contact["id"]
            rec = by_id.get(cid)
            if not rec:
                await db.execute("DELETE FROM contacts WHERE id = ?", (cid,))
                removed += 1
                continue

            new_email = sanitize_email(rec["email"])
            new_name = rec["name"]

            if new_email == sanitize_email(contact.get("email") or "") and new_name == contact.get("name"):
                unchanged += 1
                continue

            dup = await db.execute("SELECT id FROM contacts WHERE email = ? AND id != ?", (new_email, cid))
            if await dup.fetchone():
                await db.execute("DELETE FROM contacts WHERE id = ?", (cid,))
                removed += 1
                continue

            row_dom = normalize_domain(contact.get("company_domain") or "")
            if not row_dom and contact.get("email") and "@" in contact["email"]:
                row_dom = contact["email"].split("@", 1)[1].lower()

            await db.execute(
                """UPDATE contacts SET name = ?, email = ?, company_domain = ?,
                   contact_source = ?, confidence = ?, email_verification_status = ?, email_pattern = ?
                   WHERE id = ?""",
                (
                    new_name,
                    new_email,
                    rec.get("company_domain") or row_dom,
                    rec.get("contact_source"),
                    rec.get("confidence", contact.get("confidence")),
                    rec.get("email_verification_status"),
                    rec.get("email_pattern"),
                    cid,
                ),
            )
            fixed += 1
        await db.commit()
        return {"fixed": fixed, "removed": removed, "unchanged": unchanged}
    finally:
        await db.close()


@router.post("/fix-emails")
async def fix_malformed_emails(user: dict = Depends(get_current_admin)):
    """Fix contacts with malformed emails (e.g. name@https://domain.com/path -> name@domain.com)."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, email, company_domain FROM contacts")
        rows = await cursor.fetchall()
        fixed = 0
        for r in rows:
            email_new = sanitize_email(r["email"] or "")
            domain_new = normalize_domain(r["company_domain"] or "")
            if email_new != (r["email"] or "") or domain_new != (r["company_domain"] or ""):
                await db.execute(
                    "UPDATE contacts SET email = ?, company_domain = ? WHERE id = ?",
                    (email_new, domain_new, r["id"]),
                )
                fixed += 1
        await db.commit()
        return {"fixed": fixed, "message": f"Updated {fixed} contacts"}
    finally:
        await db.close()


@router.delete("/{contact_id}")
async def delete_contact(contact_id: int, user: dict | None = Depends(get_current_admin)):
    """Delete a contact."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT email FROM contacts WHERE id = ?", (contact_id,))
        row = await cursor.fetchone()
        await _delete_contacts_cascade(db,[contact_id])
        await db.commit()
        if user and row:
            await log_audit(user["id"], "contact_delete", "contact", str(contact_id), row["email"] or "")
        return {"ok": True}
    finally:
        await db.close()
