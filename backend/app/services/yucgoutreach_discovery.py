"""
YUCGoutreach company discovery — same multi-source pipeline as the Scraper:
domain crawl + LinkedIn (Apify) + Tavily web discovery → merge → verify (MX + AI).
Stores verified prospects in yucgoutreach_prospects for SQL queries and Excel export.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import httpx

from app.database import get_db, row_to_dict
from app.services.contact_ai_review import _log_row
from app.services.contact_merge import merge_contacts
from app.services.contact_scraper import (
    extract_domain_from_company,
    guess_linkedin_company_url,
    infer_email_from_name,
    is_employee_outreach_email,
    is_heuristic_junk_contact,
    is_valid_person_contact,
    looks_like_person_name,
    normalize_domain,
    sanitize_email,
    scrape_contacts_from_domain,
)
from app.services.contact_verify_pipeline import run_contact_verify_pipeline
from app.services.web_contact_discovery import discover_contacts_from_web
from app.services.linkedin_scraper import scrape_linkedin_company
from app.services.discovery_policy import should_run_linkedin

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
YUCG_MAX_PROSPECTS = int(os.getenv("YUCG_MAX_PROSPECTS", "500"))


async def _llm_json(prompt: str) -> dict[str, Any]:
    from app.services.llm import complete_json, llm_provider, rank_model_id

    if llm_provider() == "bedrock":
        return await asyncio.to_thread(complete_json, prompt, rank_model_id()) or {}
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(
            f"{OLLAMA_URL.rstrip('/')}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "format": "json",
            },
        )
        if r.status_code != 200:
            return {}
        content = (r.json().get("message") or {}).get("content") or "{}"
        data = json.loads(content)
        return data if isinstance(data, dict) else {}


async def _tavily_search(query: str, max_results: int = 8) -> list[dict[str, Any]]:
    key = (os.getenv("TAVILY_API_KEY") or "").strip()
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=28.0) as client:
            r = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": key,
                    "query": query,
                    "search_depth": "basic",
                    "max_results": max_results,
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return []
    return [
        {
            "title": x.get("title") or "",
            "url": x.get("url") or "",
            "content": (x.get("content") or "")[:1200],
        }
        for x in data.get("results") or []
    ]


def _split_first_last(full_name: str) -> tuple[str, str]:
    name = (full_name or "").strip()
    if not name:
        return "", ""
    parts = [p for p in re.split(r"[\s,]+", name) if p]
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[-1]


async def _infer_domain(company_name: str) -> str:
    results = await _tavily_search(f"{company_name} official company website homepage", max_results=5)
    if not results:
        return ""
    url = results[0].get("url") or ""
    return normalize_domain(url)


async def _company_meta(company_name: str, domain: str) -> dict[str, str]:
    results = await _tavily_search(
        f"{company_name} company industry headquarters employee count {domain}".strip(),
        max_results=5,
    )
    if not results:
        return {"country": "", "employees": "", "industry": "", "keywords": "", "keywords_2": ""}
    snippet = "\n".join(f"{r.get('title')} — {r.get('content', '')[:300]}" for r in results[:4])
    try:
        data = await _llm_json(
            f"""From text about "{company_name}", return ONLY JSON:
{{"country":"","employees":"","industry":"","keywords_1":"","keywords_2":""}}

Text:
{snippet[:2500]}"""
        )
        if not data:
            raise RuntimeError("company meta empty")
    except Exception:
        return {"country": "", "employees": "", "industry": "", "keywords": "", "keywords_2": ""}
    return {
        "country": str(data.get("country") or ""),
        "employees": str(data.get("employees") or ""),
        "industry": str(data.get("industry") or ""),
        "keywords": str(data.get("keywords_1") or data.get("keywords") or ""),
        "keywords_2": str(data.get("keywords_2") or ""),
    }


async def _load_custom_patterns() -> list[str]:
    db = await get_db()
    try:
        cur = await db.execute("SELECT pattern FROM custom_email_formats ORDER BY priority DESC")
        rows = await cur.fetchall()
        return [r["pattern"] for r in rows if r.get("pattern")]
    except Exception:
        return []
    finally:
        await db.close()


async def _tavily_name_seeds(company_name: str, domain: str, max_n: int, custom_patterns: list[str]) -> list[dict]:
    """Supplement merged list with Tavily+LLM name extraction when Apify/web yield few rows."""
    if max_n <= 0 or not (os.getenv("TAVILY_API_KEY") or "").strip():
        return []
    results = await _tavily_search(
        f'{company_name} employees OR leadership site:linkedin.com/in',
        max_results=12,
    )
    if not results:
        return []
    snippet = "\n".join(
        f"{r.get('title')}\n{r.get('url')}\n{r.get('content', '')[:400]}" for r in results[:8]
    )
    try:
        data = await _llm_json(
            f"""Extract up to {max_n} people at "{company_name}". JSON only:
{{"people":[{{"full_name":"","title":"","linkedin_url":""}}]}}

Results:
{snippet[:5000]}"""
        )
        if not data:
            return []
    except Exception:
        return []
    people = data.get("people") if isinstance(data, dict) else None
    if not isinstance(people, list):
        return []
    dom = normalize_domain(domain) if domain else ""
    out: list[dict] = []
    for p in people:
        if not isinstance(p, dict):
            continue
        name = str(p.get("full_name") or p.get("name") or "").strip()
        if not looks_like_person_name(name, company_name):
            continue
        email = ""
        if dom:
            email = infer_email_from_name(name, dom, custom_patterns) or ""
        if not email:
            continue
        out.append(
            {
                "name": name,
                "email": sanitize_email(email),
                "title": str(p.get("title") or "")[:300],
                "company": company_name,
                "company_domain": dom,
                "linkedin_url": str(p.get("linkedin_url") or "").strip() or None,
                "contact_source": "web_discovery",
                "discovery_context": "Tavily name seed supplement",
            }
        )
        if len(out) >= max_n:
            break
    return out


def _quality_score(contact: dict) -> float:
    score = 40.0
    ev = contact.get("email_verification_status") or ""
    if ev == "valid":
        score += 28
    elif ev == "likely_valid":
        score += 18
    elif ev == "invalid":
        score -= 25
    ai = contact.get("ai_verdict") or ""
    if ai == "real":
        score += 22
    elif ai == "suspicious":
        score += 6
    elif ai == "junk":
        score -= 40
    src = contact.get("contact_source") or ""
    if src in ("domain_scrape", "linkedin_apify"):
        score += 12
    elif src == "web_discovery":
        score += 8
    if contact.get("linkedin_url"):
        score += 10
    if contact.get("confidence") == "high":
        score += 8
    return max(0.0, min(100.0, score))


def _fit_status(score: float, contact: dict) -> str:
    if contact.get("ai_verdict") == "junk" or contact.get("email_verification_status") == "invalid":
        return "weak"
    if score >= 78:
        return "strong"
    if score >= 55:
        return "medium"
    return "weak"


def _is_verified(contact: dict) -> int:
    ev = contact.get("email_verification_status") or ""
    ai = contact.get("ai_verdict") or ""
    if ai == "junk" or ev == "invalid":
        return 0
    if ev in ("valid", "likely_valid") and ai in ("real", "suspicious", ""):
        return 1
    if ev in ("valid", "likely_valid") and ai == "real":
        return 1
    return 0


async def _run_update(
    run_id: int,
    *,
    status: str | None = None,
    progress_pct: float | None = None,
    progress_message: str | None = None,
    prospects_count: int | None = None,
    research_json: str | None = None,
    error_message: str | None = None,
    completed: bool = False,
) -> None:
    db = await get_db()
    try:
        sets = ["updated_at = CURRENT_TIMESTAMP"]
        args: list[Any] = []
        if status is not None:
            sets.append("status = ?")
            args.append(status)
        if progress_pct is not None:
            sets.append("progress_pct = ?")
            args.append(progress_pct)
        if progress_message is not None:
            sets.append("progress_message = ?")
            args.append(progress_message[:2000])
        if prospects_count is not None:
            sets.append("prospects_count = ?")
            args.append(prospects_count)
        if research_json is not None:
            sets.append("research_json = ?")
            args.append(research_json)
        if error_message is not None:
            sets.append("error_message = ?")
            args.append(error_message[:2000])
        if completed:
            sets.append("completed_at = CURRENT_TIMESTAMP")
        args.append(run_id)
        await db.execute(
            f"UPDATE yucgoutreach_discovery_runs SET {', '.join(sets)} WHERE id = ?",
            tuple(args),
        )
        await db.commit()
    finally:
        await db.close()


async def execute_yucgoutreach_run(run_id: int) -> None:
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM yucgoutreach_discovery_runs WHERE id = ?", (run_id,))
        row = await cur.fetchone()
        if not row:
            return
        spec = row_to_dict(row)
    finally:
        await db.close()

    company = (spec.get("company_name") or "").strip()
    domain_in = (spec.get("company_domain") or "").strip()
    user_linkedin = (spec.get("linkedin_company_url") or "").strip()
    linkedin_url = user_linkedin
    has_apify = bool((os.getenv("APIFY_API_TOKEN") or "").strip())
    max_prospects = max(1, min(int(spec.get("max_prospects") or 100), YUCG_MAX_PROSPECTS))
    domain = normalize_domain(domain_in) if domain_in else ""

    await _run_update(
        run_id,
        status="running",
        progress_pct=3.0,
        progress_message="Website + web search first; LinkedIn only if URL given or crawl is thin…",
    )

    if not domain:
        domain = await _infer_domain(company)

    custom_patterns = await _load_custom_patterns()
    web_max = min(max_prospects * 2, int(os.getenv("SCRAPE_WEB_MAX_PEOPLE", "80")))

    async def _domain() -> list[dict]:
        if not domain:
            return []

        async def on_page(_i: int, _n: int, url: str) -> None:
            if url == "queued":
                await _run_update(
                    run_id,
                    progress_message="Waiting for website crawl slot (LinkedIn/web search keep going)",
                )

        return await scrape_contacts_from_domain(
            domain=domain, company_name=company, on_page=on_page
        )

    async def _linkedin() -> tuple[list[dict], str | None]:
        if not linkedin_url:
            return [], company
        li = await scrape_linkedin_company(linkedin_url, max_employees=min(max_prospects, 100))
        return li.get("contacts") or [], company or li.get("company_name")

    async def _web() -> list[dict]:
        cn = company or (domain.split(".")[0].title() if domain else "")
        if not cn or not (os.getenv("TAVILY_API_KEY") or "").strip():
            return []
        return await discover_contacts_from_web(cn, domain or None, max_people=web_max)

    domain_contacts, web_contacts, meta = await asyncio.gather(
        _domain(),
        _web(),
        _company_meta(company, domain),
    )
    run_li = should_run_linkedin(
        user_url=user_linkedin,
        has_token=has_apify,
        domain_hits=len(domain_contacts),
    )
    if run_li:
        if not linkedin_url and has_apify:
            linkedin_url = guess_linkedin_company_url(company, domain) or ""
        linkedin_contacts, company_from_li = await _linkedin()
    else:
        linkedin_contacts, company_from_li = [], company
    company = company_from_li or company
    kw1 = meta.get("keywords") or ""
    kw2 = meta.get("keywords_2") or ""

    await _run_update(
        run_id,
        progress_pct=22.0,
        progress_message=(
            f"Sources: website {len(domain_contacts)} · LinkedIn {len(linkedin_contacts)} · "
            f"web {len(web_contacts)} — merging…"
        ),
        research_json=json.dumps(
            {
                "domain_contacts": len(domain_contacts),
                "linkedin_contacts": len(linkedin_contacts),
                "web_contacts": len(web_contacts),
                "linkedin_url": linkedin_url or None,
            }
        ),
    )

    merged = merge_contacts(
        domain_contacts,
        linkedin_contacts,
        company,
        domain,
        custom_patterns,
        web_contacts=web_contacts,
    )

    if len(merged) < max_prospects:
        extra = await _tavily_name_seeds(company, domain, max_prospects - len(merged), custom_patterns)
        seen = {sanitize_email(c.get("email") or "").lower() for c in merged if c.get("email")}
        for row in extra:
            em = sanitize_email(row.get("email") or "").lower()
            if em and em not in seen and is_valid_person_contact(row, company_name=company, domain=domain):
                seen.add(em)
                merged.append(row)

    to_verify: list[dict] = []
    junk_log: list[dict] = []
    for c in merged:
        junk, reason = is_heuristic_junk_contact(c, company)
        if junk:
            row = dict(c)
            row["ai_verdict"] = "junk"
            row["ai_reason"] = reason
            junk_log.append(row)
        else:
            to_verify.append(c)

    if not to_verify and not junk_log:
        await _run_update(
            run_id,
            status="completed",
            progress_pct=100.0,
            progress_message="No contacts found. Add domain, LinkedIn URL, APIFY_API_TOKEN, or TAVILY_API_KEY.",
            prospects_count=0,
            completed=True,
        )
        return

    await _run_update(
        run_id,
        progress_pct=32.0,
        progress_message=f"Verifying {len(to_verify)} contact(s) — MX inbox check + AI review…",
    )

    async def _pipe_progress(phase: str, done: int, total: int, detail: str = "") -> None:
        base = {"identity": 32.0, "verify": 38.0, "ai": 52.0, "done": 82.0}.get(phase, 35.0)
        span = {"identity": 4.0, "verify": 12.0, "ai": 28.0, "done": 4.0}.get(phase, 10.0)
        pct = base + (done / max(total, 1)) * span
        label = {
            "identity": "Identity gate",
            "verify": "Inbox agents",
            "ai": "AI agents",
            "done": "Verification done",
        }.get(phase, phase)
        await _run_update(
            run_id,
            progress_pct=min(90.0, pct),
            progress_message=f"{label} {done}/{total}" + (f" — {detail}" if detail else ""),
        )

    verified, discovery_log = await run_contact_verify_pipeline(
        to_verify,
        company_name=company,
        domain=domain,
        on_progress=_pipe_progress if to_verify else None,
    )
    for c in junk_log:
        discovery_log.append(
            _log_row(c, verdict="junk", reason=c.get("ai_reason") or "", model=None, source_note="heuristic")
        )

    candidates = [c for c in verified if c.get("ai_verdict") != "junk"]
    candidates.sort(key=_quality_score, reverse=True)
    candidates = candidates[:max_prospects]

    inserted = 0
    db = await get_db()
    try:
        for idx, c in enumerate(candidates):
            name = (c.get("name") or "").strip()
            first, last = _split_first_last(name)
            email = sanitize_email(c.get("email") or "")
            if not email or not is_employee_outreach_email(email):
                continue
            score = _quality_score(c)
            secondary = score - 3 if c.get("contact_source") == "linkedin_inferred" else score
            linkedin = c.get("linkedin_url") or ""
            evidence_obj = {
                "contact_source": c.get("contact_source"),
                "email_verification_status": c.get("email_verification_status"),
                "ai_verdict": c.get("ai_verdict"),
                "ai_reason": c.get("ai_reason"),
                "email_pattern": c.get("email_pattern"),
                "discovery_context": (c.get("discovery_context") or "")[:500],
            }
            await db.execute(
                """INSERT INTO yucgoutreach_prospects (
                    run_id, first_name, last_name, email, company, contact_url, title,
                    account_url, photo_url, account_link, phone, phone_code, verified,
                    qualification_notes, contact_profile_url, linkedin_url, fit_status,
                    score, country, employees, industry, keywords_1, keywords_2,
                    yucgoutreach_score, evidence_json,
                    email_verification_status, ai_verdict, ai_reason, contact_source
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id,
                    first,
                    last,
                    email,
                    company,
                    linkedin or c.get("source_url"),
                    c.get("title"),
                    None,
                    None,
                    None,
                    None,
                    None,
                    _is_verified(c),
                    (c.get("ai_reason") or c.get("discovery_context") or "")[:2000],
                    linkedin or None,
                    linkedin or None,
                    _fit_status(score, c),
                    score,
                    meta.get("country") or None,
                    meta.get("employees") or None,
                    meta.get("industry") or None,
                    kw1 or None,
                    kw2 or None,
                    secondary,
                    json.dumps(evidence_obj)[:8000],
                    c.get("email_verification_status"),
                    c.get("ai_verdict"),
                    c.get("ai_reason"),
                    c.get("contact_source"),
                ),
            )
            inserted += 1
            if idx % 10 == 0:
                await _run_update(
                    run_id,
                    progress_pct=90.0 + (idx / max(len(candidates), 1)) * 8.0,
                    progress_message=f"Saving prospects {idx + 1}/{len(candidates)}…",
                    prospects_count=inserted,
                )
        await db.commit()
    finally:
        await db.close()

    junk_total = len(junk_log) + sum(1 for c in verified if c.get("ai_verdict") == "junk")
    await _run_update(
        run_id,
        status="completed",
        progress_pct=100.0,
        progress_message=(
            f"Done — {inserted} verified prospects saved"
            + (f" ({junk_total} junk filtered)" if junk_total else "")
        ),
        prospects_count=inserted,
        research_json=json.dumps(
            {
                "merged": len(merged),
                "verified": len(verified),
                "saved": inserted,
                "junk_filtered": junk_total,
                "discovery_log_count": len(discovery_log),
            }
        ),
        completed=True,
    )


async def _yucgoutreach_run_guard(run_id: int) -> None:
    try:
        await execute_yucgoutreach_run(run_id)
    except Exception as e:
        await _run_update(
            run_id,
            status="failed",
            progress_pct=100.0,
            error_message=str(e),
            completed=True,
        )


async def build_yucgoutreach_excel_bytes(run_id: int) -> bytes:
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    headers = [
        "First Name",
        "Last Name",
        "Email",
        "Company",
        "Title",
        "LinkedIn URL",
        "Source",
        "Inbox Status",
        "AI Verdict",
        "Verified",
        "Fit Status",
        "Score",
        "YUCGoutreach Score",
        "Country",
        "Employees",
        "Industry",
        "Qualification Notes",
    ]

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT company_name FROM yucgoutreach_discovery_runs WHERE id = ?",
            (run_id,),
        )
        r0 = await cur.fetchone()
        if not r0:
            raise ValueError("Run not found")
        company_name = r0["company_name"]
        cur = await db.execute(
            """SELECT first_name, last_name, email, company, title, linkedin_url,
               contact_source, email_verification_status, ai_verdict, verified,
               fit_status, score, yucgoutreach_score, country, employees, industry,
               qualification_notes
               FROM yucgoutreach_prospects WHERE run_id = ? ORDER BY score DESC, id""",
            (run_id,),
        )
        prospect_rows = [row_to_dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    wb = Workbook()
    ws = wb.active
    ws.title = "Prospects"
    hdr_fill = PatternFill("solid", fgColor="1F4E79")
    hdr_font = Font(color="FFFFFF", bold=True)
    for col, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=col, value=h)
        c.fill = hdr_fill
        c.font = hdr_font

    for ri, pr in enumerate(prospect_rows, 2):
        ws.cell(row=ri, column=1, value=pr.get("first_name"))
        ws.cell(row=ri, column=2, value=pr.get("last_name"))
        ws.cell(row=ri, column=3, value=pr.get("email"))
        ws.cell(row=ri, column=4, value=pr.get("company") or company_name)
        ws.cell(row=ri, column=5, value=pr.get("title"))
        ws.cell(row=ri, column=6, value=pr.get("linkedin_url"))
        ws.cell(row=ri, column=7, value=pr.get("contact_source"))
        ws.cell(row=ri, column=8, value=pr.get("email_verification_status"))
        ws.cell(row=ri, column=9, value=pr.get("ai_verdict"))
        ws.cell(row=ri, column=10, value="Yes" if pr.get("verified") else "No")
        ws.cell(row=ri, column=11, value=pr.get("fit_status"))
        ws.cell(row=ri, column=12, value=pr.get("score"))
        ws.cell(row=ri, column=13, value=pr.get("yucgoutreach_score"))
        ws.cell(row=ri, column=14, value=pr.get("country"))
        ws.cell(row=ri, column=15, value=pr.get("employees"))
        ws.cell(row=ri, column=16, value=pr.get("industry"))
        ws.cell(row=ri, column=17, value=pr.get("qualification_notes"))

    bio = BytesIO()
    wb.save(bio)
    return bio.getvalue()
