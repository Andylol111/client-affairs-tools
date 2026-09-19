"""Company-specific role suggestions for Find people.

Title vocabulary differs by company - one firm's "Product Manager" is
another's "Product Lead" or "Member of Technical Staff" - so a member's
title hints only find people when they match how that company actually
labels roles. This module answers two questions for a typed company:

1. Which roles are *observed* there? Grounded, in priority order, in what
   the system has already seen: prospects from earlier Find people runs,
   SEC officers in the club roster, and the shared contacts catalog. When
   those are thin, one free LinkedIn-restricted web search fills in.
2. If the member typed hints, what are the *equivalents* at this company?
   The rank model maps each asked role to the closest observed titles and
   says when the company simply does not use that label. It only ever
   chooses among titles that were actually observed - it cannot invent one.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import Counter
from typing import Any

from app.database import get_db

logger = logging.getLogger(__name__)

MAX_CHIPS = 12
_SEARCH_FILL_THRESHOLD = 6
_TITLE_MAX = 80
# "Jane Doe - VP, Product at Acme | LinkedIn" / "Jane Doe – Head of X – Acme".
# Segment separators are dashes with whitespace on both sides; an intra-word
# hyphen ("Go-To-Market") is part of the title.
_SEP = r"\s+[-–—]\s+"
_LINKEDIN_TITLE_RE = re.compile(
    rf"^(?P<name>.+?){_SEP}(?P<title>.+?)(?:{_SEP}.*|\s+(?:at|@)\s+.*|\s*\|.*)?$",
    re.I,
)
_NOISE = re.compile(r"\b(linkedin|profile|professional|the walt disney company|inc\.?|llc|ltd\.?)\b", re.I)


_JUNK_TITLES = frozenset({"youtube", "linkedin", "twitter", "x", "facebook", "instagram", "wikipedia", "news", "home"})
_ROLE_WORD = re.compile(
    r"\b(chief|officer|president|vice|vp|svp|evp|avp|head|director|manager|lead|leader|partner|principal|"
    r"founder|co-founder|owner|analyst|associate|engineer|scientist|researcher|staff|member|fellow|advisor|"
    r"adviser|consultant|counsel|attorney|controller|treasurer|secretary|chair|chairman|chairwoman|dean|"
    r"professor|specialist|coordinator|strategist|architect|designer|producer|editor|recruiter|executive|"
    r"intern|general|managing|senior|sr\.?|jr\.?|global|regional|national|team|operations|product|marketing|"
    r"sales|finance|legal|people|talent|growth|strategy|technology|technical|data|policy|communications|"
    r"partnerships|business|development|program|project|account|customer|success|supply|clinical|medical|"
    r"health|healthcare|cto|cfo|ceo|coo|cmo|cpo|cio|ciso|gm)\b",
    re.I,
)


def normalize_title(raw: str | None, company: str | None = None) -> str:
    """Reduce a stored or scraped string to a role title, or '' when it is
    not one. Stored prospect titles are often the raw search headline
    ('Jane Doe - VP Product at Acme | LinkedIn'), so headline shapes are
    parsed first; then company/site noise is stripped; then the result must
    look like a role (contain a role word, be short, not be truncated)."""
    text = (raw or "").strip()
    if not text:
        return ""
    if re.search(_SEP, text):
        match = _LINKEDIN_TITLE_RE.match(text)
        if match:
            text = match.group("title")
    text = re.split(r"\s+(?:at|@)\s+|\s*\|\s*", text, maxsplit=1)[0]
    text = _NOISE.sub("", text)
    text = re.sub(r"\s*[-–—,/]\s*$", "", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" -–—,")
    if len(text) < 3 or len(text) > _TITLE_MAX:
        return ""
    if text.endswith("...") or text.endswith("…"):
        return ""
    low = text.lower()
    if low in _JUNK_TITLES:
        return ""
    if company:
        c = company.strip().lower()
        if c and (low == c or low.replace(",", "") == c):
            return ""
    if not re.search(r"[a-z]", text, re.I) or not _ROLE_WORD.search(text):
        return ""
    # Sentences and article headlines are not titles.
    if len(text.split()) > 9 or re.search(r"\b(vs\.?|what|why|how|when)\b", text, re.I):
        return ""
    return text


def _key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def title_from_search_result(result_title: str | None, company: str | None = None) -> str:
    text = (result_title or "").strip()
    match = _LINKEDIN_TITLE_RE.match(text)
    if not match:
        return ""
    return normalize_title(match.group("title"), company)


async def observed_titles(company: str, domain: str | None) -> list[dict[str, Any]]:
    """Titles the system has already seen at this company, with counts and
    the strongest source each came from."""
    company_like = f"%{company.strip().lower()}%"
    dom = (domain or "").strip().lower()
    counts: Counter[str] = Counter()
    display: dict[str, str] = {}
    source: dict[str, str] = {}
    rank = {"roster": 0, "run": 1, "catalog": 2}

    def add(title_raw: str | None, src: str) -> None:
        title = normalize_title(title_raw, company)
        if not title:
            return
        key = _key(title)
        counts[key] += 1
        display.setdefault(key, title)
        if key not in source or rank[src] < rank[source[key]]:
            source[key] = src

    db = await get_db()
    try:
        rows = await (await db.execute(
            """SELECT p.title FROM yucgoutreach_prospects p
               JOIN yucgoutreach_discovery_runs r ON r.id = p.run_id
               WHERE p.title IS NOT NULL AND p.title != ''
                 AND (lower(r.company_name) LIKE ? OR (? != '' AND lower(COALESCE(r.company_domain,'')) = ?))
               ORDER BY p.id DESC LIMIT 400""",
            (company_like, dom, dom),
        )).fetchall()
        for row in rows:
            add(row["title"], "run")
        rows = await (await db.execute(
            """SELECT pe.title FROM company_roster_people pe
               JOIN company_rosters ro ON ro.id = pe.roster_id
               WHERE pe.title != '' AND pe.employment = 'current'
                 AND (lower(ro.company_name) LIKE ? OR (? != '' AND lower(COALESCE(ro.company_domain,'')) = ?))
               LIMIT 200""",
            (company_like, dom, dom),
        )).fetchall()
        for row in rows:
            add(row["title"], "roster")
        rows = await (await db.execute(
            """SELECT title FROM contacts
               WHERE title IS NOT NULL AND title != ''
                 AND (lower(COALESCE(company,'')) LIKE ? OR (? != '' AND lower(COALESCE(company_domain,'')) = ?))
               LIMIT 400""",
            (company_like, dom, dom),
        )).fetchall()
        for row in rows:
            add(row["title"], "catalog")
    finally:
        await db.close()

    return [
        {"title": display[key], "count": count, "source": source[key]}
        for key, count in counts.most_common()
    ]


_GENERIC_ROLE_QUERY = "leadership director manager lead"
_JOB_TITLE_RE = re.compile(r"^(?P<title>.+?)\s+at\s+(?P<company>.+?)(?:\s+[—–-]\s+.*)?(?:\s*[-|]\s*(?:Jobs\s*[-|]\s*)?LinkedIn)?\s*$", re.I)


def title_from_job_posting(result_title: str | None, company: str | None = None) -> str:
    """'Product Manager, Business Technology at Anthropic - LinkedIn' ->
    'Product Manager, Business Technology'. Postings are the company's own
    words for a role, so they are strong vocabulary evidence. A posting
    headline without an 'at Company' segment is the title itself - the URL
    already scoped it to this company."""
    text = re.sub(r"\s*[-|]\s*(?:Jobs\s*[-|]\s*)?LinkedIn\s*$", "", (result_title or "").strip(), flags=re.I)
    # "Anthropic hiring Product Management, Research in San Francisco, CA"
    hiring = re.match(r"^(?P<company>.+?)\s+hiring\s+(?P<title>.+?)(?:\s+in\s+[A-Z][^,]*(?:,\s*[A-Z]{2})?)?\s*$", text, re.I)
    if hiring:
        return normalize_title(hiring.group("title"), company)
    match = _JOB_TITLE_RE.match(text)
    if match:
        return normalize_title(match.group("title"), company)
    if re.search(_SEP, text) or ":" in text:
        return ""  # "Anthropic: Jobs", "Name - Title" shapes are not postings
    return normalize_title(text, company)


async def search_titles(company: str, hints: str | None, *, user_id: int | None = None) -> tuple[list[dict[str, Any]], str | None]:
    """LinkedIn-restricted search; titles parsed from profile headlines
    (/in/) and job postings (/jobs/view/). Plain words only - quoting the
    company or chaining OR terms made the engine return unrelated pages in
    live testing. A hinted query that finds nothing falls back once to a
    generic leadership query, since the hint may be vocabulary the company
    does not use - the very thing this feature exists to show."""
    from app.services.web_fetch import web_search, web_search_configured

    if not web_search_configured():
        return [], "Web search is not configured; showing only roles already on record."
    c = company.strip()
    note: str | None = None
    queries = []
    if (hints or "").strip():
        queries.append(f"{c} {hints.strip()} site:linkedin.com/in")
    queries.append(f"{c} {_GENERIC_ROLE_QUERY} site:linkedin.com/in")

    counts: Counter[str] = Counter()
    display: dict[str, str] = {}
    source: dict[str, str] = {}
    for query in queries:
        try:
            results = await web_search(query, max_results=25, user_id=user_id)
        except Exception as exc:  # quota or transport; suggestions are best-effort
            logger.info("role suggestion search skipped for %r: %s", company, exc)
            detail = getattr(exc, "detail", None)
            note = (str(detail) if detail else "Web search is unavailable right now") + "; showing only roles already on record."
            break
        for item in results:
            url = str(item.get("url") or "")
            if "/jobs/view/" in url:
                title, src = title_from_job_posting(item.get("title"), c), "jobs"
            elif "/in/" in url:
                title, src = title_from_search_result(item.get("title"), c), "search"
            else:
                continue  # company pages, posts, news: no role held by a person
            if not title:
                continue
            key = _key(title)
            counts[key] += 1
            display.setdefault(key, title)
            if src == "jobs" or key not in source:
                source[key] = src
        if counts:
            break
    return [{"title": display[k], "count": n, "source": source[k]} for k, n in counts.most_common()], note


def merge_titles(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    display: dict[str, str] = {}
    source: dict[str, str] = {}
    rank = {"roster": 0, "run": 1, "catalog": 2, "jobs": 3, "search": 4}
    for group in groups:
        for row in group:
            key = _key(row["title"])
            counts[key] += int(row.get("count") or 1)
            display.setdefault(key, row["title"])
            src = row.get("source") or "search"
            if key not in source or rank.get(src, 9) < rank.get(source[key], 9):
                source[key] = src
    return [{"title": display[k], "count": c, "source": source[k]} for k, c in counts.most_common(MAX_CHIPS)]


def _parse_hints(hints: str | None) -> list[str]:
    parts = re.split(r"[,;/]|\band\b|\bor\b", hints or "", flags=re.I)
    seen: list[str] = []
    for part in parts:
        p = re.sub(r"\s+", " ", part).strip(" .")
        if len(p) >= 2 and p.lower() not in {s.lower() for s in seen}:
            seen.append(p[:60])
    return seen[:6]


async def map_equivalents(company: str, hints: str | None, observed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ask the rank model which observed titles correspond to each asked
    role at this company. Constrained to observed titles; anything else in
    the reply is dropped so the model cannot introduce a title nobody holds."""
    asked = _parse_hints(hints)
    if not asked or not observed:
        return []
    from app.services.llm import complete_json, rank_model_id

    allowed = {_key(o["title"]): o["title"] for o in observed[:40]}
    prompt = (
        f"Company: {company}\n"
        f"Titles actually observed at this company (choose ONLY from these, verbatim):\n"
        + "\n".join(f"- {t}" for t in allowed.values())
        + "\n\nA member wants to reach these kinds of people:\n"
        + "\n".join(f"- {a}" for a in asked)
        + "\n\nFor each asked role, list the observed titles that are the closest equivalent at this company "
          "(empty list if none fit), and one short note when the company labels the role differently "
          "or does not appear to have it. JSON only:\n"
          '{"equivalents":[{"asked":"","at_company":[""],"note":""}]}'
    )
    try:
        data = await asyncio.to_thread(complete_json, prompt, rank_model_id(),
                                       "You map job-title vocabulary between companies. Never invent titles.")
    except Exception as exc:
        logger.info("role equivalence mapping unavailable: %s", exc)
        return []
    rows = (data or {}).get("equivalents") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        asked_role = str(row.get("asked") or "").strip()
        if not asked_role:
            continue
        matches = [allowed[_key(str(t))] for t in (row.get("at_company") or []) if _key(str(t)) in allowed]
        out.append({
            "asked": asked_role[:60],
            "at_company": list(dict.fromkeys(matches))[:5],
            "note": str(row.get("note") or "").strip()[:200],
        })
    return out


async def suggest_roles(*, user_id: int, company: str, domain: str | None, hints: str | None) -> dict[str, Any]:
    company = (company or "").strip()
    if len(company) < 2:
        return {"company": company, "roles": [], "equivalents": [], "sources": {}, "note": None}
    seen = await observed_titles(company, domain)
    searched: list[dict[str, Any]] = []
    note: str | None = None
    if len(seen) < _SEARCH_FILL_THRESHOLD or (hints or "").strip():
        searched, note = await search_titles(company, hints, user_id=user_id)
    roles = merge_titles(seen, searched)
    equivalents = await map_equivalents(company, hints, roles) if (hints or "").strip() else []
    return {
        "company": company,
        "roles": roles,
        "equivalents": equivalents,
        "note": note,
        "sources": {
            "run": sum(1 for r in seen if r["source"] == "run"),
            "roster": sum(1 for r in seen if r["source"] == "roster"),
            "catalog": sum(1 for r in seen if r["source"] == "catalog"),
            "search": sum(1 for r in searched if r["source"] == "search"),
            "jobs": sum(1 for r in searched if r["source"] == "jobs"),
        },
    }
