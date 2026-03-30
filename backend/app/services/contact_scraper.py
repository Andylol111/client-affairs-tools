"""
Contact Scraper & Discovery Engine
Domain crawling, email inference, validation
"""
import re
import httpx
from bs4 import BeautifulSoup
from typing import Optional
from urllib.parse import urljoin, urlparse
import dns.resolver
import asyncio

def _is_valid_email_format(email: str) -> bool:
    try:
        from validators import email as v
        return v(email) is True
    except Exception:
        return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", email or ""))

# Role / generic inboxes — excluded from employee outreach (domain scrape & list filters)
ROLE_EMAIL_PREFIXES = frozenset(
    {
        "info",
        "contact",
        "hello",
        "hi",
        "sales",
        "support",
        "help",
        "admin",
        "hr",
        "careers",
        "jobs",
        "media",
        "press",
        "office",
        "team",
        "enquiries",
        "inquiries",
        "billing",
        "legal",
        "privacy",
        "marketing",
        "newsletter",
        "noreply",
        "no-reply",
        "donotreply",
        "mailer",
        "postmaster",
        "webmaster",
    }
)

# Pages that usually only list generic emails — skip blind regex harvest there
CONTACT_PAGE_PATH_HINTS = ("contact", "contact-us", "contactus", "get-in-touch", "reach-us")
TEAM_PAGE_PATH_HINTS = ("team", "about", "people", "leadership", "staff", "our-team", "management", "who-we-are", "bios", "executive")


def is_role_based_local_part(local: str) -> bool:
    """True if local part looks like a shared inbox, not an employee."""
    if not local:
        return True
    low = local.lower().strip()
    if low in ROLE_EMAIL_PREFIXES:
        return True
    return any(low == p or low.startswith(f"{p}+") or low.startswith(f"{p}.") for p in ROLE_EMAIL_PREFIXES)


def is_employee_outreach_email(email: str) -> bool:
    """Viable person outreach: real domain mailbox, not role-based or synthetic placeholder."""
    if not email or "@" not in email:
        return False
    low = email.lower()
    if "placeholder" in low or ".local" in low.split("@")[-1]:
        return False
    local = email.split("@")[0].lower()
    return not is_role_based_local_part(local)


def _url_is_contact_only_page(url: str) -> bool:
    """True if URL is likely a /contact page without team roster (stricter extraction)."""
    u = url.lower()
    if not any(h in u for h in CONTACT_PAGE_PATH_HINTS):
        return False
    return not any(h in u for h in TEAM_PAGE_PATH_HINTS)


def normalize_domain(domain_or_url: str) -> str:
    """
    Extract clean hostname for email (e.g. lockheedmartin.com) from URL or domain.
    Prevents malformed emails like name@https://example.com/path
    """
    if not domain_or_url or not isinstance(domain_or_url, str):
        return ""
    s = domain_or_url.strip().lower()
    s = s.replace("www.", "")
    if "://" in s:
        s = s.split("://", 1)[1]
    if "/" in s:
        s = s.split("/")[0]
    if "?" in s:
        s = s.split("?")[0]
    if ":" in s and not s.startswith("["):
        s = s.split(":")[0]
    return s


def sanitize_email(email: str) -> str:
    """Fix malformed emails like name@https://domain.com/path -> name@domain.com"""
    if not email or "@" not in email:
        return email or ""
    local, _, domain_part = email.partition("@")
    if "://" in domain_part or "/" in domain_part:
        domain_part = normalize_domain(domain_part)
        if domain_part:
            return f"{local}@{domain_part}"
    return email


def extract_domain_from_company(company_name: str) -> Optional[str]:
    """Infer domain from company name (e.g., 'Acme Corp' -> acme.com)."""
    if not company_name:
        return None
    # Simple: lowercase, remove common suffixes, replace spaces with nothing
    clean = re.sub(r"\b(inc|corp|llc|ltd|co|company)\b", "", company_name, flags=re.I)
    clean = re.sub(r"[^a-zA-Z0-9\s]", "", clean).strip()
    words = clean.split()
    if not words:
        return None
    base = "".join(w[:3] for w in words[:2]) if len(words) > 1 else words[0][:6]
    return f"{base.lower()}.com"


def infer_email(name: str, domain: str) -> list[str]:
    """Infer possible email addresses from name and domain."""
    domain = normalize_domain(domain or "")
    if not name or not domain:
        return []
    parts = name.strip().split()
    emails = []
    if len(parts) >= 2:
        first, last = parts[0].lower(), parts[-1].lower()
        emails.extend([
            f"{first}.{last}@{domain}",
            f"{first}{last}@{domain}",
            f"{first[0]}{last}@{domain}",
            f"{first}@{domain}",
        ])
    elif len(parts) == 1:
        emails.append(f"{parts[0].lower()}@{domain}")
    return list(set(emails))


async def validate_email_mx(email: str) -> bool:
    """Check if domain has MX records (basic deliverability check)."""
    try:
        domain = email.split("@")[-1]
        await asyncio.to_thread(dns.resolver.resolve, domain, "MX")
        return True
    except Exception:
        return False


def _confidence_rank(c: str) -> int:
    return {"high": 3, "medium": 2, "low": 1}.get(c, 0)


def _compute_confidence(
    email: str,
    name: Optional[str],
    title: Optional[str],
    mx_valid: bool,
    source_url: str,
    found_with_name: bool,
) -> str:
    """
    Compute confidence (high/medium/low) from multiple signals.
    Higher confidence = more likely to be a real, deliverable contact.
    """
    score = 0
    local = email.split("@")[0].lower() if "@" in email else ""
    is_role_based = is_role_based_local_part(local)

    if mx_valid:
        score += 2  # Domain accepts mail
    if _is_valid_email_format(email):
        score += 1
    if not is_role_based:
        score += 2  # Personal email (first.last, etc.) much more valuable
    if name and name not in ("Unknown", "Contact", ""):
        score += 2  # Real name associated
    if title:
        score += 1  # Job title adds credibility
    if found_with_name:
        score += 1  # Name and email found together in same block
    if any(p in source_url.lower() for p in ("team", "about", "people", "leadership", "staff", "our-team")):
        score += 1  # Found on team/people page

    if score >= 7:
        return "high"
    if score >= 4:
        return "medium"
    return "low"


async def scrape_contacts_from_domain(
    domain: str,
    company_name: Optional[str] = None,
    max_pages: int = 10,
) -> list[dict]:
    """
    Scrape a company domain for contact information.
    Returns list of contact dicts with name, email, title, confidence.
    """
    if not domain:
        domain = extract_domain_from_company(company_name or "")
    if not domain:
        return []

    domain = normalize_domain(domain)
    if not domain.startswith("http"):
        base_url = f"https://{domain}"
    else:
        base_url = domain
        domain = normalize_domain(domain)

    contacts = []
    seen_emails = set()
    names_from_pages: list[dict] = []  # {name, title} for email generator fallback
    personal_emails_for_format: list[str] = []  # Non-role emails to detect format

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # More pages = better coverage; team/people pages have higher-quality contacts
            urls_to_check = [
                base_url,
                f"{base_url.rstrip('/')}/about",
                f"{base_url.rstrip('/')}/about-us",
                f"{base_url.rstrip('/')}/team",
                f"{base_url.rstrip('/')}/our-team",
                f"{base_url.rstrip('/')}/people",
                f"{base_url.rstrip('/')}/leadership",
                f"{base_url.rstrip('/')}/staff",
                f"{base_url.rstrip('/')}/contact",
                f"{base_url.rstrip('/')}/contact-us",
            ]

            for url in urls_to_check[:max_pages]:
                try:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue
                    soup = BeautifulSoup(resp.text, "html.parser")

                    email_regex = re.compile(
                        r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
                    )

                    # Find "name - title - email" blocks first (highest confidence)
                    for elem in soup.find_all(["p", "div", "li", "span", "td"]):
                        text = elem.get_text(separator=" ", strip=True)
                        if "@" in text and domain in text:
                            for match in email_regex.finditer(text):
                                email = match.group().lower()
                                if domain not in email or email in seen_emails:
                                    continue
                                local = email.split("@")[0].lower()
                                if is_role_based_local_part(local):
                                    continue
                                seen_emails.add(email)
                                personal_emails_for_format.append(email)
                                name = _extract_name_from_text(text, email) or _extract_name_near_email(resp.text, email)
                                title = _extract_title_from_text(text) or _infer_title_from_context(resp.text, email)
                                mx_valid = await validate_email_mx(email)
                                confidence = _compute_confidence(
                                    email, name, title, mx_valid, url,
                                    found_with_name=bool(name and name not in ("Unknown", "Contact")),
                                )
                                contacts.append({
                                    "name": name or "Unknown",
                                    "email": email,
                                    "title": title,
                                    "company": company_name or domain,
                                    "company_domain": domain,
                                    "confidence": confidence,
                                    "contact_source": "domain_scrape",
                                })

                    # Full-page scan: skip generic /contact pages (only structured blocks above count)
                    if not _url_is_contact_only_page(url):
                        for match in email_regex.finditer(resp.text):
                            email = match.group().lower()
                            if domain not in email or email in seen_emails:
                                continue
                            local = email.split("@")[0].lower()
                            if is_role_based_local_part(local):
                                continue
                            seen_emails.add(email)
                            personal_emails_for_format.append(email)
                            name = _extract_name_near_email(resp.text, email)
                            title = _infer_title_from_context(resp.text, email)
                            mx_valid = await validate_email_mx(email)
                            confidence = _compute_confidence(
                                email, name, title, mx_valid, url,
                                found_with_name=bool(name and name not in ("Unknown", "Contact")),
                            )
                            contacts.append({
                                "name": name or "Unknown",
                                "email": email,
                                "title": title,
                                "company": company_name or domain,
                                "company_domain": domain,
                                "confidence": confidence,
                                "contact_source": "domain_scrape",
                            })

                    # Extract names from team pages for email generator fallback
                    for nd in _extract_names_from_page(soup, url):
                        if not any(n["name"].lower() == nd["name"].lower() for n in names_from_pages):
                            names_from_pages.append(nd)

                except Exception:
                    continue

            # Deduplicate by email (keep highest confidence)
            by_email: dict[str, dict] = {}
            for c in contacts:
                e = c["email"]
                if e not in by_email or _confidence_rank(c["confidence"]) > _confidence_rank(by_email[e]["confidence"]):
                    by_email[e] = c
            contacts = list(by_email.values())

            # Email generator fallback: use names from pages + inferred format
            names_with_emails = {c["name"].lower() for c in contacts if c.get("name") not in ("Unknown", "Contact")}
            format_order = _detect_email_format(personal_emails_for_format, domain)

            for nd in names_from_pages:
                name = nd.get("name")
                if not name or name.lower() in names_with_emails:
                    continue
                if len(name.split()) < 2:
                    continue  # Need first + last for format-based generation
                title = nd.get("title")

                generated_email = None
                for fmt_name, fmt_fn in format_order:
                    gen = _generate_email_for_name(name, domain, fmt_fn)
                    if gen and gen not in seen_emails:
                        generated_email = gen
                        break

                if generated_email:
                    seen_emails.add(generated_email)
                    contacts.append({
                        "name": name,
                        "email": generated_email,
                        "title": title,
                        "company": company_name or domain,
                        "company_domain": domain,
                        "confidence": "low",  # Always low - inferred, not found
                        "contact_source": "inferred",
                    })
                    names_with_emails.add(name.lower())

            # No placeholder role emails — employee outreach only; use LinkedIn/Apify + team pages for people.

    except Exception:
        pass

    return contacts


def _extract_name_near_email(text: str, email: str) -> Optional[str]:
    """Extract name that appears near an email in text."""
    idx = text.find(email)
    if idx == -1:
        return None
    # Look both before and after
    before = text[max(0, idx - 200) : idx]
    after = text[idx + len(email) : idx + len(email) + 100]
    for snippet in (before, after):
        # Pattern: "Name Lastname" or "Name Middle Lastname"
        words = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+\b", snippet)
        if words:
            return words[0].strip()
        words = re.findall(r"\b[A-Z][a-z]+\b", snippet)
        if len(words) >= 2 and len(words[-1]) > 1:
            return f"{words[-2]} {words[-1]}"
    return None


def _extract_name_from_text(text: str, email: str) -> Optional[str]:
    parts = text.split(email)[0].strip().split()
    if len(parts) >= 2:
        return f"{parts[-2]} {parts[-1]}"
    return parts[-1] if parts else None


def _extract_title_from_text(text: str) -> Optional[str]:
    # Common title patterns (order matters for compound titles)
    patterns = [
        "Chief Executive Officer", "CEO",
        "Chief Technology Officer", "CTO",
        "Chief Financial Officer", "CFO",
        "Chief Marketing Officer", "CMO",
        "Chief Operating Officer", "COO",
        "VP of", "Vice President",
        "Director of", "Director",
        "Manager", "Lead", "Head of",
        "Founder", "Co-Founder", "Partner",
        "President", "Owner",
    ]
    text_upper = text.upper()
    for p in patterns:
        if p.upper() in text_upper:
            return p
    return None


def _infer_title_from_context(text: str, email: str) -> Optional[str]:
    local = email.split("@")[0].lower()
    if "info" in local or "contact" in local:
        return "General Contact"
    if "sales" in local:
        return "Sales"
    if "hr" in local or "careers" in local:
        return "HR"
    return None


def _apply_custom_pattern(pattern: str, first: str, last: str) -> str:
    """Apply custom format pattern. Placeholders: {first}, {last}, {first_initial}."""
    first_initial = first[0] if first else ""
    return pattern.replace("{first}", first).replace("{last}", last).replace("{first_initial}", first_initial)


def infer_email_from_name(
    name: str,
    domain: str,
    custom_patterns: Optional[list[str]] = None,
) -> Optional[str]:
    """Infer likely email from name and domain. Tries custom patterns first if provided."""
    domain = normalize_domain(domain or "")
    if not name or not domain or "Unknown" in name or "Contact" in name:
        return None
    parts = name.strip().split()
    if len(parts) >= 2:
        first, last = parts[0].lower(), parts[-1].lower()
        if custom_patterns:
            for p in custom_patterns:
                try:
                    local = _apply_custom_pattern(p, first, last)
                    if local and "@" not in local:
                        return f"{local}@{domain}"
                except Exception:
                    pass
        return f"{first}.{last}@{domain}"
    elif len(parts) == 1:
        return f"{parts[0].lower()}@{domain}"
    return None


# Email format generators: (name_parts) -> local_part
def _fmt_first_dot_last(first: str, last: str) -> str:
    return f"{first}.{last}"


def _fmt_first_last(first: str, last: str) -> str:
    return f"{first}{last}"


def _fmt_flast(first: str, last: str) -> str:
    return f"{first[0]}{last}" if first and last else ""


def _fmt_first_underscore_last(first: str, last: str) -> str:
    return f"{first}_{last}"


def _fmt_last_first(first: str, last: str) -> str:
    return f"{last}.{first}" if first and last else ""


def _fmt_first_only(first: str, last: str) -> str:
    return first


EMAIL_FORMATS = [
    ("first.last", _fmt_first_dot_last),
    ("firstlast", _fmt_first_last),
    ("flast", _fmt_flast),
    ("first_last", _fmt_first_underscore_last),
    ("last.first", _fmt_last_first),
    ("first", _fmt_first_only),
]


def _detect_email_format(emails: list[str], domain: str) -> list[tuple[str, callable]]:
    """
    Analyze found emails to infer this site's format.
    Returns list of (format_name, formatter_func) ordered by likelihood.
    """
    domain = domain.lower()
    scored: list[tuple[float, tuple[str, callable]]] = []

    for email in emails:
        if domain not in email:
            continue
        local = email.split("@")[0].lower()
        if is_role_based_local_part(local):
            continue  # Skip role-based for format detection

        # Try to parse as first.last (e.g. john.doe)
        if "." in local and "_" not in local:
            parts = local.split(".")
            if len(parts) == 2 and len(parts[0]) <= 2 and len(parts[1]) > 2:
                scored.append((2.0, ("flast", _fmt_flast)))  # j.doe -> flast
            elif len(parts) >= 2:
                scored.append((3.0, ("first.last", _fmt_first_dot_last)))
        elif "_" in local:
            scored.append((2.5, ("first_last", _fmt_first_underscore_last)))
        elif len(local) > 3 and not "." in local:
            # Could be firstlast or flast
            scored.append((1.5, ("firstlast", _fmt_first_last)))
            scored.append((1.0, ("flast", _fmt_flast)))

    # Count format votes, return by frequency
    from collections import Counter
    fmt_by_name = {n: f for n, f in EMAIL_FORMATS}
    if not scored:
        return EMAIL_FORMATS

    format_counts: Counter = Counter()
    for _, (fmt_name, _) in scored:
        format_counts[fmt_name] += 1

    ordered = [(fmt_name, fmt_by_name[fmt_name]) for fmt_name, _ in format_counts.most_common() if fmt_name in fmt_by_name]
    for fmt_name, fmt_fn in EMAIL_FORMATS:
        if fmt_name not in format_counts:
            ordered.append((fmt_name, fmt_fn))
    return ordered


def _generate_email_for_name(name: str, domain: str, format_func) -> Optional[str]:
    """Generate email using the given format function."""
    domain = normalize_domain(domain or "")
    if not domain:
        return None
    parts = name.strip().split()
    if len(parts) >= 2:
        first, last = parts[0].lower(), parts[-1].lower()
        local = format_func(first, last)
        if local:
            return f"{local}@{domain}"
    elif len(parts) == 1:
        return f"{parts[0].lower()}@{domain}"
    return None


def _extract_names_from_page(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Extract person names (and titles) from team/people/about pages.
    Returns list of {name, title} for people mentioned without emails.
    """
    names_found: list[dict] = []
    seen_names: set[str] = set()

    # Only extract from team-like pages
    if not any(p in url.lower() for p in ("team", "about", "people", "leadership", "staff", "our-team")):
        return []

    # Common patterns: h2/h3 with name, then title in next element
    for tag in soup.find_all(["h2", "h3", "h4", "div", "span", "p", "li"]):
        text = tag.get_text(separator=" ", strip=True)
        if not text or len(text) > 80 or "@" in text:
            continue

        # "FirstName LastName" - two or more capitalized words
        name_match = re.findall(r"\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\b", text)
        for name in name_match:
            name = name.strip()
            if len(name) < 5 or name in seen_names:
                continue
            # Exclude common false positives
            if any(x in name.lower() for x in ["copyright", "reserved", "privacy", "terms", "click", "read more"]):
                continue
            seen_names.add(name)
            title = _extract_title_from_text(text) if text != name else None
            names_found.append({"name": name, "title": title})

        # Also: "Name, Title" or "Name - Title"
        for sep in [",", "–", "-", "|"]:
            if sep in text and len(text) < 60:
                parts = text.split(sep, 1)
                if len(parts) == 2:
                    name_part = parts[0].strip()
                    if re.match(r"^[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+$", name_part):
                        if name_part not in seen_names:
                            seen_names.add(name_part)
                            names_found.append({
                                "name": name_part,
                                "title": _extract_title_from_text(parts[1]) or parts[1].strip()[:50],
                            })

    return names_found
