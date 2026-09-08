"""
Web-wide employee discovery for the main scraper (Tavily + LinkedIn snippets).
Complements domain crawl — searches the open web, not just company subpages.
"""
from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Awaitable, Callable, Optional

import httpx

from app.services.contact_scraper import (
    extract_employee_emails_from_text,
    infer_email_from_name,
    is_valid_person_contact,
    looks_like_person_name,
    normalize_domain,
    person_name_key,
    sanitize_email,
    confidence_for_contact_dict,
)
from app.services.linkedin_scraper import extract_linkedin_profile_slug

ProgressHook = Optional[Callable[[str, float], Awaitable[None]]]

LINKEDIN_IN_URL = re.compile(r"https?://(?:[\w.]+)?linkedin\.com/in/([a-zA-Z0-9_-]+)/?", re.I)
NAME_TITLE_RE = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s+(?:[-–—|]\s*|[,]\s*)([A-Za-z][^|\n]{3,60})",
)
NAME_AT_COMPANY_RE = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s+(?:at|@)\s+",
    re.I,
)
TAVILY_SEARCH_DEPTH = os.getenv("TAVILY_SEARCH_DEPTH", "basic").strip() or "basic"
WEB_DISCOVERY_WORKERS = int(os.getenv("WEB_DISCOVERY_WORKERS", "6"))


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
                    "search_depth": TAVILY_SEARCH_DEPTH,
                    "max_results": max_results,
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for x in data.get("results") or []:
        out.append(
            {
                "title": x.get("title") or "",
                "url": x.get("url") or "",
                "content": (x.get("content") or "")[:1500],
            }
        )
    return out


async def _tavily_parallel(queries: list[str], max_results: int = 8) -> list[dict[str, Any]]:
    if not queries:
        return []
    sem = asyncio.Semaphore(max(1, WEB_DISCOVERY_WORKERS))

    async def _one(q: str) -> list[dict[str, Any]]:
        async with sem:
            return await _tavily_search(q, max_results=max_results)

    batches = await asyncio.gather(*[_one(q) for q in queries])
    seen_urls: set[str] = set()
    merged: list[dict[str, Any]] = []
    for batch in batches:
        for row in batch:
            url = row.get("url") or ""
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            merged.append(row)
    return merged


def _slug_to_name(slug: str) -> str | None:
    slug = (slug or "").strip().strip("/")
    if not slug or len(slug) < 4:
        return None
    parts = [p for p in re.split(r"[-_]+", slug) if p and not p.isdigit()]
    if len(parts) < 2:
        return None
    name = " ".join(p.capitalize() for p in parts[:3])
    return name if looks_like_person_name(name) else None


def _extract_people_from_results(
    results: list[dict[str, Any]],
    company_name: str,
    domain: str | None,
) -> list[dict[str, Any]]:
    """Regex extraction from Tavily titles/snippets — builds a name corpus for cross-matching."""
    seen_keys: set[str] = set()
    people: list[dict[str, Any]] = []

    def add_person(
        name: str,
        title: str = "",
        linkedin_url: str = "",
        email: str = "",
        source_url: str = "",
        discovery_context: str = "",
    ) -> None:
        name = name.strip()
        if not looks_like_person_name(name, company_name):
            return
        key = person_name_key(name)
        if not key or key in seen_keys:
            return
        seen_keys.add(key)
        people.append(
            {
                "name": name,
                "title": title.strip()[:120],
                "linkedin_url": linkedin_url.strip(),
                "email": sanitize_email(email.strip()) if email else "",
                "source_url": source_url.strip(),
                "discovery_context": discovery_context.strip()[:400],
            }
        )

    for r in results:
        title = r.get("title") or ""
        content = r.get("content") or ""
        url = r.get("url") or ""
        blob = f"{title}\n{content}\n{url}"
        ctx = f"{title} — {content[:200]}".strip()

        li_match = LINKEDIN_IN_URL.search(url) or LINKEDIN_IN_URL.search(content)
        li_url = ""
        if li_match:
            li_url = f"https://www.linkedin.com/in/{li_match.group(1)}/"
            slug_name = _slug_to_name(li_match.group(1))
            if slug_name:
                add_person(slug_name, title=title, linkedin_url=li_url, source_url=url or li_url, discovery_context=ctx)

        for m in NAME_TITLE_RE.finditer(blob):
            add_person(m.group(1), title=m.group(2), linkedin_url=li_url, source_url=url, discovery_context=ctx)

        for m in NAME_AT_COMPANY_RE.finditer(blob):
            add_person(m.group(1), title=title, linkedin_url=li_url, source_url=url, discovery_context=ctx)

        for email in extract_employee_emails_from_text(blob, domain):
            for person in people:
                first, *rest = person["name"].split()
                last = rest[-1] if rest else ""
                if email.split("@")[0].lower().find(last.lower()[:3]) >= 0:
                    if not person.get("email"):
                        person["email"] = email
                    break

    return people


async def discover_contacts_from_web(
    company_name: str,
    domain: str | None = None,
    *,
    max_people: int = 30,
    custom_patterns: list[str] | None = None,
    cancel_event: asyncio.Event | None = None,
    on_progress: ProgressHook = None,
) -> list[dict]:
    """
    Search the web for named employees (LinkedIn, press, directories).
    Returns contact dicts compatible with the scrape merge pipeline.
    """
    company = (company_name or "").strip()
    if not company:
        return []

    dom = normalize_domain(domain or "") if domain else ""
    if not (os.getenv("TAVILY_API_KEY") or "").strip():
        return []

    async def emit(msg: str, pct: float) -> None:
        if on_progress:
            await on_progress(msg, pct)

    queries = [
        f'{company} leadership OR executives site:linkedin.com/in',
        f'{company} employees VP OR Director OR Manager site:linkedin.com/in',
        f'"{company}" team member site:linkedin.com/in',
        f'{company} CEO OR CFO OR CTO OR "head of" site:linkedin.com/in',
        f'"{company}" senior manager OR director biography',
        f'"{company}" press release appointed OR joins OR named',
    ]
    if dom:
        queries.extend(
            [
                f'"{company}" "@{dom}" email employee',
                f'site:linkedin.com/in "{company}" {dom.split(".")[0]}',
            ]
        )

    await emit(f"Running {len(queries)} web searches in parallel…", 15)
    all_results = await _tavily_parallel(queries, max_results=10)
    if cancel_event and cancel_event.is_set():
        return []

    people = _extract_people_from_results(all_results, company, dom or None)[: max_people * 3]

    contacts: list[dict] = []
    for p in people[: max_people * 2]:
        if cancel_event and cancel_event.is_set():
            break
        name = p.get("name") or ""
        email = p.get("email") or ""
        email_verified = bool(email)
        if not email and dom:
            email = infer_email_from_name(name, dom, custom_patterns) or ""
        if not email:
            continue
        row = {
            "name": name,
            "email": sanitize_email(email),
            "title": p.get("title"),
            "company": company,
            "company_domain": dom,
            "linkedin_url": p.get("linkedin_url") or None,
            "contact_source": "web_discovery",
            "source_url": p.get("source_url"),
            "discovery_context": p.get("discovery_context"),
            "_email_verified": email_verified,
        }
        row["confidence"] = confidence_for_contact_dict(
            row,
            company_name=company,
            domain=dom,
            email_verified=email_verified,
        )
        row.pop("_email_verified", None)
        if is_valid_person_contact(row, company_name=company, domain=dom):
            contacts.append(row)

    await emit(f"Web discovery found {len(contacts)} person(s)", 85)
    return contacts


def linkedin_profile_key(url: str | None) -> str | None:
    slug = extract_linkedin_profile_slug(url or "")
    return slug.lower() if slug else None
