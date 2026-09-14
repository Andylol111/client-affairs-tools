"""Recurring public-company roster: SEC officers/directors, optional IR snippets, weekly still-there.

This is not Apollo. Weekly verify is Form 3/4/5 XML for companies we can map to a CIK.
Private / unmatched names are enrolled and retried monthly, not hammered.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import quote

import httpx

from app.database import get_db
from app.services.contact_scraper import infer_email_from_name, normalize_domain, person_name_key

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"
OWNERSHIP_FORMS = frozenset({"3", "3/A", "4", "4/A", "5", "5/A"})
LEGAL_DROP = frozenset(
    {
        "inc", "corp", "ltd", "llc", "co", "company", "companies", "plc", "sa", "nv", "se",
        "lp", "llp", "limited", "incorporated", "corporation", "holdings", "holding",
        "group", "the", "of", "and",
    }
)
_TICKERS: dict[str, Any] | None = None
_TICKERS_AT: datetime | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).isoformat()


def sec_user_agent() -> str:
    configured = (os.getenv("SEC_USER_AGENT") or "").strip()
    if configured:
        return configured
    contact = (os.getenv("SEC_CONTACT_EMAIL") or "outreach@localhost").strip()
    return f"YUCGOutreach roster-watch {contact}"


def verify_days() -> int:
    return max(1, min(int(os.getenv("ROSTER_VERIFY_DAYS", "7") or 7), 90))


def drain_limit() -> int:
    return max(1, min(int(os.getenv("ROSTER_DRAIN_LIMIT", "8") or 8), 40))


def left_after_misses() -> int:
    return max(1, min(int(os.getenv("ROSTER_LEFT_AFTER_MISSES", "2") or 2), 8))


def _company_tokens(name: str) -> list[str]:
    cleaned = re.sub(r"\([^)]*\)", " ", name or "")
    parts = re.findall(r"[a-z0-9]+", cleaned.lower())
    return [p for p in parts if p not in LEGAL_DROP and len(p) > 1]


def company_key(name: str) -> str:
    tokens = _company_tokens(name)
    return " ".join(tokens[:8])[:80] or (name or "").strip().lower()[:80]


def _form4_display_name(raw: str) -> str:
    text = re.sub(r"\s+", " ", (raw or "").replace(",", " ")).strip()
    if not text:
        return ""
    parts = text.split()
    if len(parts) == 1:
        return parts[0].title()
    last, rest = parts[0], parts[1:]
    ordered = rest + [last]
    out = []
    for part in ordered:
        if re.fullmatch(r"[A-Z]\.?", part):
            out.append(part[0].upper() + ".")
        elif part.isupper() or part.islower():
            out.append(part.title())
        else:
            out.append(part)
    return " ".join(out)


def parse_form4_xml(xml_text: str) -> dict[str, Any] | None:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    def local(tag: str) -> str:
        return tag.split("}")[-1]

    name = title = ""
    officer = director = False
    for el in root.iter():
        tag = local(el.tag)
        text = (el.text or "").strip()
        if tag == "rptOwnerName" and text:
            name = _form4_display_name(text)
        elif tag == "officerTitle" and text:
            title = re.sub(r"\s+", " ", text)[:160]
        elif tag == "isOfficer" and text.lower() in {"true", "1"}:
            officer = True
        elif tag == "isDirector" and text.lower() in {"true", "1"}:
            director = True
    if not name:
        return None
    role = "director" if director and not officer else "officer"
    return {
        "full_name": name,
        "normalized_name": person_name_key(name),
        "title": title,
        "role_type": role,
        "source": "sec_form4",
    }


_OFFICER_TITLE = re.compile(
    r"\b(President|Chief|Vice President|Executive Vice|Managing Director|"
    r"General Counsel|General Manager|Co-Chief|Treasurer|Secretary|Director)\b",
    re.I,
)


def parse_10k_officers(html: str) -> list[dict[str, Any]]:
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"&nbsp;", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text)
    low = text.lower()
    idx = low.find("information about our executive officers")
    if idx < 0:
        idx = low.find("our executive officers")
    if idx < 0:
        return []
    window = text[idx : idx + 6000]
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    pattern = re.compile(
        r"([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+)+)\s+"
        r"((?:Executive Chairman|President|Chief|Co-Chief|Vice President|"
        r"Executive Vice President|Managing Director|General Counsel|"
        r"General Manager|Treasurer)[^0-9,]{6,90}?)\s+\d{2}"
    )
    for match in pattern.finditer(window):
        name = re.sub(r"\s+", " ", match.group(1)).strip()
        title = re.sub(r"\s+", " ", match.group(2)).strip(" ,")
        key = person_name_key(name)
        if not key or key in seen or not _OFFICER_TITLE.search(title):
            continue
        seen.add(key)
        found.append(
            {
                "full_name": name,
                "normalized_name": key,
                "title": title[:160],
                "role_type": "officer",
                "source": "sec_10k",
            }
        )
    return found


def match_public_company(company_name: str, tickers: dict[str, Any]) -> dict[str, str] | None:
    tokens = _company_tokens(company_name)
    if not tokens:
        return None
    query_key = " ".join(tokens)
    token_hit: dict[str, str] | None = None
    prefix: dict[str, str] | None = None
    for row in tickers.values() if isinstance(tickers, dict) else []:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "")
        title_tokens = _company_tokens(title)
        if not title_tokens:
            continue
        title_key = " ".join(title_tokens)
        cik = str(row.get("cik_str") or "").zfill(10)
        ticker = str(row.get("ticker") or "").upper()
        hit = {"ticker": ticker, "cik": cik, "title": title}
        if query_key == title_key:
            return hit
        if tokens[0] == title_tokens[0] and len(tokens[0]) >= 6:
            prefix = prefix or hit
        if len(tokens) >= 2 and all(t in title_tokens for t in tokens[:3]):
            token_hit = token_hit or hit
        elif len(title_tokens) >= 2 and all(t in tokens for t in title_tokens[:2]) and len(title_tokens[0]) >= 5:
            token_hit = token_hit or hit
    return token_hit or prefix


async def _http_get(url: str) -> bytes:
    pause = float(os.getenv("ROSTER_SEC_PAUSE_SEC", "0.12") or 0)
    if pause > 0:
        await asyncio.sleep(pause)
    headers = {"User-Agent": sec_user_agent(), "Accept-Encoding": "gzip, deflate"}
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response.content


async def load_tickers(*, force: bool = False) -> dict[str, Any]:
    global _TICKERS, _TICKERS_AT
    if _TICKERS is not None and not force and _TICKERS_AT and utcnow() - _TICKERS_AT < timedelta(hours=24):
        return _TICKERS
    raw = await _http_get(SEC_TICKERS_URL)
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        return _TICKERS or {}
    _TICKERS = data
    _TICKERS_AT = utcnow()
    return data


def _archive_url(cik: str, accession: str, document: str) -> str:
    acc = (accession or "").replace("-", "")
    doc = (document or "").split("/")[-1]
    return SEC_ARCHIVE.format(cik=int(cik), acc=acc, doc=quote(doc))


def _xml_candidates(primary: str) -> list[str]:
    name = (primary or "").split("/")[-1]
    out: list[str] = []
    for item in ("ownership.xml", name, "primary_doc.xml"):
        base = item.split("/")[-1]
        if base.lower().endswith(".xml") and base not in out:
            out.append(base)
    if "ownership.xml" not in out:
        out.insert(0, "ownership.xml")
    return out


async def fetch_form4_people(cik: str, *, max_filings: int = 18) -> list[dict[str, Any]]:
    raw = await _http_get(SEC_SUBMISSIONS_URL.format(cik=cik))
    payload = json.loads(raw.decode("utf-8"))
    recent = (payload.get("filings") or {}).get("recent") or {}
    forms = list(
        zip(
            recent.get("form") or [],
            recent.get("accessionNumber") or [],
            recent.get("primaryDocument") or [],
        )
    )
    people: list[dict[str, Any]] = []
    seen: set[str] = set()
    checked = 0
    for form, accession, document in forms:
        if form not in OWNERSHIP_FORMS:
            continue
        checked += 1
        if checked > max_filings:
            break
        parsed = None
        for fname in _xml_candidates(document):
            url = _archive_url(cik, accession, fname)
            try:
                xml = (await _http_get(url)).decode("utf-8", "ignore")
            except Exception:
                continue
            parsed = parse_form4_xml(xml)
            if parsed:
                parsed["source_url"] = url
                parsed["accession"] = accession
                break
        if not parsed:
            continue
        key = parsed["normalized_name"]
        if not key or key in seen:
            continue
        seen.add(key)
        people.append(parsed)
        if len(people) >= 40:
            break
    return people


async def fetch_10k_people(cik: str) -> list[dict[str, Any]]:
    raw = await _http_get(SEC_SUBMISSIONS_URL.format(cik=cik))
    payload = json.loads(raw.decode("utf-8"))
    recent = (payload.get("filings") or {}).get("recent") or {}
    for form, accession, document in zip(
        recent.get("form") or [],
        recent.get("accessionNumber") or [],
        recent.get("primaryDocument") or [],
    ):
        if form != "10-K":
            continue
        url = _archive_url(cik, accession, document)
        html = (await _http_get(url)).decode("utf-8", "ignore")
        people = parse_10k_officers(html)
        for row in people:
            row["source_url"] = url
            row["accession"] = accession
        return people
    return []


async def enroll_prospect_companies() -> int:
    db = await get_db()
    added = 0
    try:
        rows = await (await db.execute("SELECT company FROM yucg_prospect_targets ORDER BY id")).fetchall()
        now = iso()
        for row in rows:
            name = (row["company"] if not isinstance(row, tuple) else row[0]) or ""
            key = company_key(name)
            if not key:
                continue
            existing = await (await db.execute("SELECT id FROM company_rosters WHERE company_key=?", (key,))).fetchone()
            if existing:
                continue
            await db.execute(
                """INSERT INTO company_rosters
                   (company_key, company_name, next_verify_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (key, name.strip(), now, now, now),
            )
            added += 1
        await db.commit()
        return added
    finally:
        await db.close()


async def _ensure_roster(company_name: str, domain: str | None = None) -> dict[str, Any]:
    key = company_key(company_name)
    now = iso()
    dom = normalize_domain(domain or "") or None
    db = await get_db()
    try:
        row = await (await db.execute("SELECT * FROM company_rosters WHERE company_key=?", (key,))).fetchone()
        if not row:
            await db.execute(
                """INSERT INTO company_rosters
                   (company_key, company_name, company_domain, next_verify_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (key, company_name.strip(), dom, now, now, now),
            )
            await db.commit()
            row = await (await db.execute("SELECT * FROM company_rosters WHERE company_key=?", (key,))).fetchone()
        elif dom and not (row["company_domain"] if not isinstance(row, tuple) else None):
            await db.execute(
                "UPDATE company_rosters SET company_domain=?, updated_at=? WHERE company_key=?",
                (dom, now, key),
            )
            await db.commit()
            row = await (await db.execute("SELECT * FROM company_rosters WHERE company_key=?", (key,))).fetchone()
        return dict(row)
    finally:
        await db.close()


def _infer_email(name: str, domain: str | None) -> str | None:
    if not domain:
        return None
    try:
        return infer_email_from_name(name, domain)
    except Exception:
        return None


def _sticky_source(source: str) -> bool:
    return source.startswith("discovery") or source in {"web_ir", "web_press"}


async def _upsert_people(
    roster_id: int,
    people: Iterable[dict[str, Any]],
    *,
    domain: str | None,
    mark_missing: bool,
) -> dict[str, int]:
    now = iso()
    threshold = left_after_misses()
    incoming = [p for p in people if p.get("normalized_name")]
    seen = {p["normalized_name"] for p in incoming}
    db = await get_db()
    try:
        for person in incoming:
            email = person.get("inferred_email") or _infer_email(person["full_name"], domain)
            existing = await (
                await db.execute(
                    "SELECT id FROM company_roster_people WHERE roster_id=? AND normalized_name=?",
                    (roster_id, person["normalized_name"]),
                )
            ).fetchone()
            if existing:
                await db.execute(
                    """UPDATE company_roster_people SET
                           full_name=?,
                           title=CASE WHEN ? != '' THEN ? ELSE title END,
                           role_type=?, source=?,
                           source_url=COALESCE(?, source_url),
                           accession=COALESCE(?, accession),
                           inferred_email=COALESCE(?, inferred_email),
                           employment='current', last_seen_at=?, missed_checks=0
                       WHERE id=?""",
                    (
                        person["full_name"],
                        person.get("title") or "",
                        person.get("title") or "",
                        person.get("role_type") or "officer",
                        person.get("source") or "sec_form4",
                        person.get("source_url"),
                        person.get("accession"),
                        email,
                        now,
                        existing["id"],
                    ),
                )
            else:
                await db.execute(
                    """INSERT INTO company_roster_people (
                           roster_id, normalized_name, full_name, title, role_type, source,
                           source_url, accession, inferred_email, employment,
                           first_seen_at, last_seen_at, missed_checks
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, 0)""",
                    (
                        roster_id,
                        person["normalized_name"],
                        person["full_name"],
                        person.get("title") or "",
                        person.get("role_type") or "officer",
                        person.get("source") or "sec_form4",
                        person.get("source_url"),
                        person.get("accession"),
                        email,
                        now,
                        now,
                    ),
                )
        if mark_missing and seen:
            rows = await (
                await db.execute(
                    """SELECT id, normalized_name, missed_checks, source FROM company_roster_people
                       WHERE roster_id=? AND employment IN ('current', 'unverified')""",
                    (roster_id,),
                )
            ).fetchall()
            for row in rows:
                record = dict(row)
                if record["normalized_name"] in seen or _sticky_source(str(record.get("source") or "")):
                    continue
                missed = int(record.get("missed_checks") or 0) + 1
                employment = "left" if missed >= threshold else "current"
                await db.execute(
                    "UPDATE company_roster_people SET missed_checks=?, employment=? WHERE id=?",
                    (missed, employment, record["id"]),
                )
        counts = await (
            await db.execute(
                """SELECT COUNT(*) AS n,
                          SUM(CASE WHEN employment='current' THEN 1 ELSE 0 END) AS current_n
                   FROM company_roster_people WHERE roster_id=?""",
                (roster_id,),
            )
        ).fetchone()
        people_count = int(counts["n"] if counts else 0)
        current_count = int((counts["current_n"] if counts else 0) or 0)
        await db.execute(
            "UPDATE company_rosters SET people_count=?, current_count=?, updated_at=? WHERE id=?",
            (people_count, current_count, now, roster_id),
        )
        await db.commit()
        return {"people": people_count, "current": current_count}
    finally:
        await db.close()


async def remember_discovery_people(company: str, domain: str | None, contacts: list[dict[str, Any]]) -> None:
    if not company or not contacts:
        return
    roster = await _ensure_roster(company, domain)
    people = []
    for contact in contacts:
        name = (contact.get("name") or "").strip()
        if not name:
            name = f"{(contact.get('first_name') or '').strip()} {(contact.get('last_name') or '').strip()}".strip()
        key = person_name_key(name)
        if not key:
            continue
        people.append(
            {
                "full_name": name,
                "normalized_name": key,
                "title": (contact.get("title") or "")[:160],
                "role_type": "named",
                "source": "discovery",
                "source_url": contact.get("source_url") or contact.get("linkedin_url"),
                "inferred_email": contact.get("email"),
            }
        )
    if people:
        await _upsert_people(int(roster["id"]), people, domain=domain, mark_missing=False)


async def _web_people(company: str, domain: str | None) -> list[dict[str, Any]]:
    if not (os.getenv("TAVILY_API_KEY") or "").strip():
        return []
    if (os.getenv("ROSTER_WEB_ON_ENROLL") or "0").strip().lower() not in {"1", "true", "yes"}:
        return []
    from app.services.web_contact_discovery import _extract_people_from_results, _tavily_search

    results = await _tavily_search(f"{company} executive officers OR leadership team", max_results=6)
    extracted = _extract_people_from_results(results, company, domain)
    out = []
    for person in extracted[:20]:
        name = person.get("name") or ""
        key = person_name_key(name)
        if not key:
            continue
        out.append(
            {
                "full_name": name,
                "normalized_name": key,
                "title": (person.get("title") or "")[:160],
                "role_type": "named",
                "source": "web_ir",
                "source_url": person.get("source_url"),
            }
        )
    return out


async def _claim_due(limit: int) -> list[dict[str, Any]]:
    now = utcnow()
    now_s = iso(now)
    lease = iso(now + timedelta(minutes=20))
    db = await get_db()
    claimed: list[dict[str, Any]] = []
    try:
        await db.execute("BEGIN IMMEDIATE")
        rows = await (
            await db.execute(
                """SELECT * FROM company_rosters
                   WHERE next_verify_at <= ?
                   ORDER BY next_verify_at, id
                   LIMIT ?""",
                (now_s, limit),
            )
        ).fetchall()
        for row in rows:
            record = dict(row)
            await db.execute(
                """UPDATE company_rosters SET next_verify_at=?, updated_at=?
                   WHERE id=? AND next_verify_at <= ?""",
                (lease, now_s, record["id"], now_s),
            )
            claimed.append(record)
        await db.commit()
        return claimed
    finally:
        await db.close()


async def refresh_roster(roster: dict[str, Any], tickers: dict[str, Any]) -> dict[str, Any]:
    roster_id = int(roster["id"])
    name = roster["company_name"]
    domain = roster.get("company_domain")
    now = iso()
    if roster.get("cik"):
        match = {"cik": roster["cik"], "ticker": roster.get("ticker") or "", "title": name}
    else:
        match = match_public_company(name, tickers)

    people: list[dict[str, Any]] = []
    status = "unmatched"
    error = None
    mark_missing = False
    try:
        if match and match.get("cik"):
            status = "public"
            people = await fetch_form4_people(match["cik"])
            if len(people) < 3:
                extra = await fetch_10k_people(match["cik"])
                have = {p["normalized_name"] for p in people}
                for row in extra:
                    if row["normalized_name"] not in have:
                        people.append(row)
            mark_missing = bool(people)
        else:
            people = await _web_people(name, domain)
            status = "web" if people else "unmatched"
    except Exception as exc:
        error = str(exc)[:500]
        status = roster.get("source_status") or "pending"

    nxt = utcnow() + timedelta(days=verify_days() if status == "public" else 30)
    counts = await _upsert_people(roster_id, people, domain=domain, mark_missing=mark_missing)
    db = await get_db()
    try:
        await db.execute(
            """UPDATE company_rosters
               SET ticker=?, cik=?, source_status=?, last_crawled_at=?, last_verified_at=?,
                   next_verify_at=?, last_error=?, updated_at=?,
                   people_count=?, current_count=?
               WHERE id=?""",
            (
                (match or {}).get("ticker"),
                (match or {}).get("cik"),
                status,
                now,
                now if not error else roster.get("last_verified_at"),
                iso(nxt),
                error,
                now,
                counts["people"],
                counts["current"],
                roster_id,
            ),
        )
        await db.commit()
    finally:
        await db.close()
    return {"id": roster_id, "status": status, "people": counts["people"], "error": error}


async def drain_roster_queue() -> dict[str, Any]:
    """Enroll spreadsheet companies, then refresh a bounded due batch."""
    enrolled = await enroll_prospect_companies()
    due = await _claim_due(drain_limit())
    if not due:
        return {"ok": True, "enrolled": enrolled, "claimed": 0, "refreshed": []}
    tickers: dict[str, Any] = _TICKERS or {}
    if any(not row.get("cik") for row in due):
        try:
            tickers = await load_tickers()
        except Exception:
            tickers = _TICKERS or {}
    refreshed = [await refresh_roster(row, tickers) for row in due]
    return {"ok": True, "enrolled": enrolled, "claimed": len(due), "refreshed": refreshed}


async def list_rosters(q: str = "", limit: int = 50) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 200))
    db = await get_db()
    try:
        if q.strip():
            like = f"%{q.strip()}%"
            rows = await (
                await db.execute(
                    """SELECT * FROM company_rosters
                       WHERE company_name LIKE ? OR IFNULL(ticker,'') LIKE ? OR IFNULL(cik,'') LIKE ?
                       ORDER BY current_count DESC, company_name
                       LIMIT ?""",
                    (like, like, like, limit),
                )
            ).fetchall()
        else:
            rows = await (
                await db.execute(
                    """SELECT * FROM company_rosters
                       ORDER BY current_count DESC, company_name
                       LIMIT ?""",
                    (limit,),
                )
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def roster_detail(roster_id: int) -> dict[str, Any] | None:
    db = await get_db()
    try:
        row = await (await db.execute("SELECT * FROM company_rosters WHERE id=?", (roster_id,))).fetchone()
        if not row:
            return None
        people = await (
            await db.execute(
                """SELECT full_name, title, role_type, source, inferred_email, employment,
                          last_seen_at, missed_checks, source_url, email_status, email_checked_at
                   FROM company_roster_people WHERE roster_id=?
                   ORDER BY employment, title, full_name""",
                (roster_id,),
            )
        ).fetchall()
        out = dict(row)
        out["people"] = [dict(p) for p in people]
        return out
    finally:
        await db.close()
