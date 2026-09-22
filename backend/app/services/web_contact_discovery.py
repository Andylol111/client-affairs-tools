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

from app.services.company_email_cache import build_email_for_person_sync, text_names_brand
from app.services.contact_scraper import (
    extract_employee_emails_from_text,
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
# The title stops at the end of its sentence. Running on past it made one
# match swallow the next person: "Copilot Extensibility - Patrick Rodgers. John
# Nguyen - Principal Engineering Manager" yielded the product and hid the two
# real people behind it.
NAME_TITLE_RE = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s+(?:[-–—|]\s*|[,]\s*)"
    r"([A-Za-z][^|\n]{3,60}?)(?=\.\s|\.$|[|\n]|$)",
)
NAME_AT_COMPANY_RE = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s+(?:at|@)\s+",
    re.I,
)
TAVILY_SEARCH_DEPTH = os.getenv("TAVILY_SEARCH_DEPTH", "basic").strip() or "basic"
# The wave is network-bound: each query is one HTTP round trip, so the
# worker count is what turns a list of queries into one wait.
WEB_DISCOVERY_WORKERS = int(os.getenv("WEB_DISCOVERY_WORKERS", "12"))


async def _tavily_search(query: str, max_results: int = 8) -> list[dict[str, Any]]:
    from app.services.web_fetch import web_search_configured, web_search

    if web_search_configured():
        return await web_search(query, max_results=max_results)
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


_LINKEDIN_DEDUP_SUFFIX_RE = re.compile(r"(?=[0-9a-f]*\d)[0-9a-f]{5,10}$", re.I)


def _slug_to_name(slug: str) -> str | None:
    """LinkedIn appends a short auto-generated suffix to a profile slug when
    the readable one is already taken - either as its own hyphenated segment
    (e.g. don-gross-25b76b8) or fused onto the last word with no separator
    (e.g. rachel-hutter60). Both are hex-digit strings containing at least
    one digit, so real names (which never mix digits into a surname) are
    never mistaken for one."""
    slug = (slug or "").strip().strip("/")
    if not slug or len(slug) < 4:
        return None
    parts = [p for p in re.split(r"[-_]+", slug) if p]
    while parts and _LINKEDIN_DEDUP_SUFFIX_RE.fullmatch(parts[-1]):
        parts.pop()
    if parts:
        parts[-1] = re.sub(r"\d+$", "", parts[-1]) or parts[-1]
    parts = [p for p in parts if p and not p.isdigit()]
    if len(parts) < 2:
        return None
    name = " ".join(p.capitalize() for p in parts[:3])
    return name if looks_like_person_name(name) else None


# A found name is only a lead if the page says it belongs to this company.
# Searching "Chewy" returns pet-industry politics, and a Denver Post story that
# links a congresswoman's LinkedIn profile used to become
# brittany.pettersen@chewy.com: the slug produced a name, the company was
# stamped on because the search was about the company, and the address was
# invented from the house pattern. Three guesses, no evidence, one plausible
# person who has never worked there.

#: Titles that are public office or press framing, never a job at a company.
PUBLIC_OFFICE_TITLE = re.compile(
    r"\b(congress(?:wo)?m[ae]n|u\.?s\.? representative|state representative|"
    r"senator|sen\.|rep\.|governor|gov\.|mayor|council ?member|assembly ?member|"
    r"attorney general|secretary of state|ambassador|lawmaker|candidate|"
    r"judge|justice|sheriff|commissioner of)\b",
    re.I,
)
#: Words that make a phrase read as a job rather than a sentence about one.
COMPANY_ROLE_HINT = re.compile(
    r"\b(ceo|cfo|coo|cto|cio|cmo|chief|president|founder|owner|partner|"
    r"vp|svp|evp|vice president|head of|director|manager|lead|principal|officer|"
    r"engineer|analyst|scientist|designer|buyer|merchandis\w*|recruiter|"
    r"marketing|operations|supply chain|people|talent|product|sales)\b",
    re.I,
)
#: Words that a page uses about itself, never a person's name. Each of these
#: was a live contact in this club's own list: "Choose People" (from the title
#: of a Microsoft Support article), "Activity Image" (alt text beside a profile
#: link), "Transformation Leader" and "Copilot Extensibility" (a role blurb and
#: a product, each parsed as the person in "X - Y").
NON_PERSON_NAME_WORD = re.compile(
    r"\b(choose|find|learn|explore|discover|get|see|read|watch|download|manage|"
    r"create|view|browse|start|join|sign|contact|support|overview|solutions|"
    r"services|platform|careers|activity|image|video|photo|session|webinar|blog|"
    r"docs|documentation|copilot|extensibility|leader|leadership|team|people|"
    r"staff|management|department|division|office|headquarters|about|home|"
    r"privacy|cookies|terms|news|press|events|resources|pricing|products)\b",
    re.I,
)


def _clean_person_name(name: str) -> str:
    """Drop the auto-generated suffix LinkedIn adds to a taken profile slug.

    Names lifted from page text carry it too - "Steve Mathias B1a579" is a real
    person with his slug printed after his name - and only the slug parser used
    to strip it."""
    parts = [p for p in (name or "").split() if p]
    while parts and _LINKEDIN_DEDUP_SUFFIX_RE.fullmatch(parts[-1]):
        parts.pop()
    return " ".join(parts)


def _name_agrees_with_profile(name: str, linkedin_url: str) -> bool:
    """A profile link attached to a name has to be that person's.

    "Copilot Extensibility" carrying linkedin.com/in/msjonguy, and "Activity
    Image" carrying linkedin.com/in/judsonalthoff, are pages pairing whatever
    text sat nearest the link - not people."""
    slug = extract_linkedin_profile_slug(linkedin_url or "")
    if not slug:
        return True
    slug_words = {w for w in re.split(r"[-_0-9]+", slug.lower()) if len(w) > 2}
    compact = re.sub(r"[^a-z]", "", slug.lower())
    for word in re.findall(r"[A-Za-z]{3,}", name.lower()):
        if word in slug_words or word in compact:
            return True
    return False


#: A page saying the company took this person on, rather than merely printing
#: their name in the same paragraph as its own.
EMPLOYMENT_PHRASE = re.compile(
    r"\b(joins?|joined|joining|hire[sd]?|hiring|names?|named|appoint(?:s|ed|ment)?|"
    r"promote[sd]?|elevated|welcomes?|welcomed|has brought on|steps into)\b",
    re.I,
)
#: How close the company has to be named for a mention to count as evidence.
MENTION_WINDOW = 220


def _names_the_company(text: str, company_name: str, domain: str | None) -> bool:
    """Whether the text names the company by its brand, or by its domain's name.

    Brand, not legal name: "Engineering Manager at Meta" is Meta Platforms, Inc.
    evidence, and requiring "platforms" too threw it away. Whole words, both
    ways: "meta" inside "Metadata Engineer" is not the company. The brand rule
    and its one known over-match live in text_names_brand."""
    if text_names_brand(text, company_name):
        return True
    base = (normalize_domain(domain or "") or "").split(".")[0]
    return len(base) > 2 and text_names_brand(text, base)


#: "CEO & Founding Trainer @ Warner Digital", "Senior Buyer at Amazon" - the
#: title itself says who they work for.
EMPLOYER_IN_TITLE = re.compile(r"(?:\bat\b|@)\s+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,3})")


def _title_names_another_employer(role: str, company_name: str, domain: str | None) -> bool:
    """A stored Microsoft contact reading "David Warner II - CEO & Founding
    Trainer @ Warner Digital" is how a LinkedIn snippet for somebody else's
    employee ends up in this company's list. The title names the employer;
    believe it over the search that surfaced the page."""
    for match in EMPLOYER_IN_TITLE.finditer(role or ""):
        named = match.group(1).strip().rstrip(".,")
        if not named or named.lower() in {"work", "large", "scale", "home"}:
            continue
        if not _names_the_company(named, company_name, domain):
            return True
    return False


def _host_is_company(url: str, domain: str | None) -> bool:
    dom = normalize_domain(domain or "")
    if not dom:
        return False
    host = re.sub(r"^https?://", "", (url or "").strip().lower()).split("/")[0].split("@")[-1]
    host = host.split(":")[0]
    return host == dom or host.endswith("." + dom)


def _mention_affiliation(near: str, role: str, company_name: str, domain: str | None) -> str:
    """What a page that is not the company's, and not a profile, can prove.

    ``press_appointment`` - it names the company, a job, and says the company
    took this person on ("Chewy has hired Priya Raman - Director of Supply
    Chain"). Good enough to work out their address from the house pattern.
    ``press_mention``     - the company and a plausible job title merely appear
    near the name. Shown as a lead, never given an invented mailbox.
    ``""``                - no tie at all; not a lead.
    """
    if not (_names_the_company(near, company_name, domain) and COMPANY_ROLE_HINT.search(role)):
        return ""
    return "press_appointment" if EMPLOYMENT_PHRASE.search(near) else "press_mention"


def _extract_people_from_results(
    results: list[dict[str, Any]],
    company_name: str,
    domain: str | None,
) -> list[dict[str, Any]]:
    """Names from search results, each carrying why it is believed to work here.

    ``affiliation`` is the evidence, and the caller uses it to decide whether an
    address may be guessed:

    * ``company_site``     - the page is on the company's own domain.
    * ``linkedin_profile`` - the person's own profile, naming the company.
    * ``press_mention``    - a page that names them, a job title, and the
      company close together. Enough to show to a member, not enough to invent
      a mailbox from.
    """
    seen_keys: set[str] = set()
    people: list[dict[str, Any]] = []

    def add_person(
        name: str,
        title: str = "",
        linkedin_url: str = "",
        email: str = "",
        source_url: str = "",
        discovery_context: str = "",
        affiliation: str = "",
    ) -> None:
        name = _clean_person_name(name.strip())
        if not affiliation:
            return
        if not looks_like_person_name(name, company_name):
            return
        # A page describing itself: "Choose People", "Activity Image",
        # "Transformation Leader". Each of these was a real stored contact with
        # an invented address at the company.
        if NON_PERSON_NAME_WORD.search(name):
            return
        # A profile link belongs to one person. When it disagrees with the name
        # beside it, the page paired them, not the person.
        if not _name_agrees_with_profile(name, linkedin_url):
            return
        # A lawmaker quoted in a story about the industry is not a lead, and is
        # the exact shape the open web keeps offering.
        if PUBLIC_OFFICE_TITLE.search(f"{title} {discovery_context}"):
            return
        # The title naming a different employer outranks the search that found
        # the page: it is the page saying where this person actually works.
        if _title_names_another_employer(title, company_name, domain):
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
                "affiliation": affiliation,
            }
        )

    for r in results:
        title = r.get("title") or ""
        content = r.get("content") or ""
        url = r.get("url") or ""
        blob = f"{title}\n{content}\n{url}"
        ctx = f"{title} — {content[:200]}".strip()
        on_company_site = _host_is_company(url, domain)

        # What the page itself proves about anyone it names. A profile result
        # that mentions the company is that person's own page; a page on the
        # company's domain is the company talking about its own staff. A
        # profile link merely quoted inside someone else's article proves only
        # what the text beside it says.
        li_url = ""
        url_match = LINKEDIN_IN_URL.search(url)
        body_match = None if url_match else LINKEDIN_IN_URL.search(content)
        li_match = url_match or body_match
        if li_match:
            li_url = f"https://www.linkedin.com/in/{li_match.group(1)}/"

        page_affiliation = ""
        if on_company_site:
            page_affiliation = "company_site"
        elif url_match and _names_the_company(f"{title}\n{content}", company_name, domain):
            page_affiliation = "linkedin_profile"

        slug_name = _slug_to_name(li_match.group(1)) if li_match else None
        if li_match:
            if body_match:
                start = max(0, li_match.start() - MENTION_WINDOW)
                near = content[start:li_match.end() + MENTION_WINDOW]
                link_affiliation = (
                    "linkedin_profile" if _names_the_company(near, company_name, domain) else ""
                )
            else:
                link_affiliation = page_affiliation
            if slug_name and link_affiliation:
                add_person(
                    slug_name, title=title, linkedin_url=li_url, source_url=url or li_url,
                    discovery_context=ctx, affiliation=link_affiliation,
                )

        def page_evidence_for(name: str, role: str) -> str:
            """What the page proves about *this* name, not about the page.

            A profile page is about one person: the slug's. A company page is
            about the company, and the rest of it is navigation, support copy
            and shipping notices - "Order Status - Track a shipment at
            Microsoft" parses exactly like a person and a job. So a name that
            is not the profile's owner has to carry a job title of its own
            before the page's own standing is lent to it."""
            if not page_affiliation:
                return ""
            if slug_name and person_name_key(name) == person_name_key(slug_name):
                return page_affiliation
            return page_affiliation if COMPANY_ROLE_HINT.search(role or "") else ""

        # A profile link belongs to the profile's owner. Attaching it to every
        # other name on the page is how three different names ended up carrying
        # one man's LinkedIn URL.
        def link_for(name: str) -> str:
            if not li_url:
                return ""
            if slug_name and person_name_key(name) == person_name_key(slug_name):
                return li_url
            # Some slugs are one run of letters (katygeorge1), so no name can be
            # read out of them; the link is still hers if her name is in it.
            return li_url if not slug_name and _name_agrees_with_profile(name, li_url) else ""

        for m in NAME_TITLE_RE.finditer(blob):
            role = m.group(2)
            near = blob[max(0, m.start() - MENTION_WINDOW):m.end() + MENTION_WINDOW]
            affiliation = (page_evidence_for(m.group(1), role)
                           or _mention_affiliation(near, role, company_name, domain))
            if not affiliation:
                continue
            add_person(
                m.group(1), title=role, linkedin_url=link_for(m.group(1)), source_url=url,
                discovery_context=ctx, affiliation=affiliation,
            )

        for m in NAME_AT_COMPANY_RE.finditer(blob):
            # "Name at <something>" only counts when the something is this
            # company, not whichever employer the sentence happens to name -
            # and the page still has to be saying what they do there.
            after = blob[m.end():m.end() + 60]
            affiliation = page_evidence_for(m.group(1), title)
            if not affiliation and _names_the_company(after, company_name, domain):
                affiliation = (
                    "press_appointment"
                    if EMPLOYMENT_PHRASE.search(blob[max(0, m.start() - MENTION_WINDOW):m.end() + MENTION_WINDOW])
                    else "press_mention"
                )
            if not affiliation:
                continue
            add_person(
                m.group(1), title=title, linkedin_url=link_for(m.group(1)), source_url=url,
                discovery_context=ctx, affiliation=affiliation,
            )

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
    title_hints: str | None = None,
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
    from app.services.web_fetch import web_search_configured
    if not web_search_configured() and not (os.getenv("TAVILY_API_KEY") or "").strip():
        return []

    async def emit(msg: str, pct: float) -> None:
        if on_progress:
            await on_progress(msg, pct)

    # Every query is one round trip, and they all run at once, so the cost of
    # the wave is its slowest query rather than their sum. What decides how
    # many reachable people come back is how many different places are asked:
    # profiles, the company's own pages, appointment notices, and the places
    # addresses are actually published.
    queries = [
        f'{company} leadership OR executives site:linkedin.com/in',
        f'{company} employees VP OR Director OR Manager site:linkedin.com/in',
        f'"{company}" team member site:linkedin.com/in',
        f'{company} CEO OR CFO OR CTO OR "head of" site:linkedin.com/in',
        f'"{company}" senior manager OR director biography',
        f'"{company}" press release appointed OR joins OR named',
        # People are reachable when a page prints their address or the company
        # publishes who does what, so ask for those pages directly.
        f'"{company}" "our team" OR "leadership team" OR "meet the team"',
        f'"{company}" spokesperson OR "media contact" OR "press contact" email',
        f'"{company}" conference speaker OR panelist OR webinar "{company}"',
    ]
    hints = (title_hints or "").strip()
    if hints:
        queries[0:0] = [
            f'{company} {hints} site:linkedin.com/in',
            f'"{company}" {hints} email OR contact OR LinkedIn',
            # The hint as the company would write it on its own pages.
            f'"{company}" "{hints.split(",")[0].strip()}" site:{dom}' if dom else f'"{company}" "{hints.split(",")[0].strip()}"',
        ]
    if dom:
        queries.extend(
            [
                f'"{company}" "@{dom}" email employee',
                f'site:linkedin.com/in "{company}" {dom.split(".")[0]}',
                f'site:{dom} team OR leadership OR people OR about',
                f'"@{dom}" contact OR email -jobs -careers',
            ]
        )

    await emit(f"Running {len(queries)} web searches at once…", 15)
    all_results = await _tavily_parallel(queries, max_results=25)
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
        affiliation = p.get("affiliation") or ""
        if not email and dom:
            # Inventing an address is only defensible where the page showed
            # the person works here: their own profile, the company's own site,
            # or a report that the company took them on. A name that merely
            # appeared near the company in an article keeps whatever address
            # the page published and is dropped without one - a guessed mailbox
            # for a guessed employee is how a stranger ends up in a campaign.
            if affiliation in ("company_site", "linkedin_profile", "press_appointment"):
                email = build_email_for_person_sync(name, dom, custom_patterns=custom_patterns) or ""
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
            "affiliation_evidence": affiliation,
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
