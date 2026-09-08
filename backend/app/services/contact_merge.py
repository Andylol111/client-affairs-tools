"""Merge contacts from domain crawl, LinkedIn, and web discovery (shared by Scraper + YUCG)."""
from __future__ import annotations

from app.services.contact_scraper import (
    _best_confidence,
    confidence_for_contact_dict,
    infer_email_from_name,
    is_valid_person_contact,
    looks_like_person_name,
    normalize_domain,
    person_name_key,
)
from app.services.web_contact_discovery import linkedin_profile_key


def merge_contacts(
    domain_contacts: list[dict],
    linkedin_contacts: list[dict],
    company: str,
    domain: str,
    custom_patterns: list[str] | None = None,
    web_contacts: list[dict] | None = None,
) -> list[dict]:
    """Merge domain, LinkedIn, and web-discovery contacts."""
    seen_emails: set[str] = set()
    merged: list[dict] = []
    by_name: dict[str, dict] = {}
    by_linkedin: dict[str, dict] = {}

    def _index(row: dict) -> None:
        if row.get("name"):
            by_name[person_name_key(row["name"])] = row
        li_key = linkedin_profile_key(row.get("linkedin_url"))
        if li_key:
            by_linkedin[li_key] = row

    def _find_match(name: str | None, linkedin_url: str | None) -> dict | None:
        if name:
            hit = by_name.get(person_name_key(name))
            if hit:
                return hit
        li_key = linkedin_profile_key(linkedin_url)
        if li_key:
            return by_linkedin.get(li_key)
        return None

    for c in domain_contacts:
        if not is_valid_person_contact(c, company_name=company, domain=domain):
            continue
        email = c.get("email")
        if not email or email in seen_emails:
            continue
        seen_emails.add(email)
        dc = dict(c)
        dc.setdefault("contact_source", "domain_scrape")
        dc["confidence"] = _best_confidence(
            dc.get("confidence"),
            confidence_for_contact_dict(dc, company_name=company, domain=domain),
        )
        merged.append(dc)
        _index(merged[-1])

    for c in web_contacts or []:
        if not is_valid_person_contact(c, company_name=company, domain=domain):
            continue
        email = c.get("email")
        if not email or email in seen_emails:
            continue
        matched = _find_match(c.get("name"), c.get("linkedin_url"))
        if matched:
            matched["linkedin_url"] = c.get("linkedin_url") or matched.get("linkedin_url")
            matched["title"] = matched.get("title") or c.get("title")
            matched["source_url"] = matched.get("source_url") or c.get("source_url")
            matched["discovery_context"] = matched.get("discovery_context") or c.get("discovery_context")
            matched["contact_source"] = matched.get("contact_source") or "web_discovery"
            matched["confidence"] = _best_confidence(
                matched.get("confidence"),
                confidence_for_contact_dict(matched, company_name=company, domain=domain),
            )
            continue
        seen_emails.add(email)
        wc = dict(c)
        wc.setdefault("contact_source", "web_discovery")
        wc["confidence"] = confidence_for_contact_dict(wc, company_name=company, domain=domain)
        merged.append(wc)
        _index(merged[-1])

    dom = normalize_domain(domain or "") if domain else ""
    for li in linkedin_contacts:
        name = li.get("name")
        if not name or not looks_like_person_name(name, company):
            continue
        matched = _find_match(name, li.get("linkedin_url"))
        if matched:
            matched["linkedin_url"] = li.get("linkedin_url") or matched.get("linkedin_url")
            matched["title"] = matched.get("title") or li.get("title")
            matched["source_url"] = matched.get("source_url") or li.get("linkedin_url")
            matched["contact_source"] = matched.get("contact_source") or "domain_scrape"
            matched["confidence"] = _best_confidence(
                matched.get("confidence"),
                confidence_for_contact_dict(matched, company_name=company, domain=dom),
            )
            continue
        email = (li.get("email") or "").strip() or None
        has_verified_email = bool(email)
        if not email and dom:
            email = infer_email_from_name(name, dom, custom_patterns)
        if not email:
            continue
        row = {
            "name": name,
            "email": email,
            "title": li.get("title"),
            "company": company or li.get("company"),
            "company_domain": dom,
            "linkedin_url": li.get("linkedin_url"),
            "contact_source": "linkedin_apify" if has_verified_email else "linkedin_inferred",
            "source_url": li.get("linkedin_url"),
            "discovery_context": (li.get("title") or "")[:300],
        }
        row["confidence"] = confidence_for_contact_dict(
            row,
            company_name=company,
            domain=dom,
            email_verified=has_verified_email,
        )
        if not is_valid_person_contact(row, company_name=company, domain=dom):
            continue
        if email in seen_emails:
            continue
        seen_emails.add(email)
        merged.append(row)
        _index(row)
    return merged
