"""LinkedIn URL shape helpers (profile/company slugs). Employee scraping is gone —
no Apify: web discovery still yields /in/ profile URLs, which is all this reads now.
"""
from __future__ import annotations

import re
from typing import Optional


def extract_linkedin_company_slug(url: str) -> Optional[str]:
    """Extract company slug from LinkedIn URL (e.g. linkedin.com/company/acme -> acme)."""
    if not url or "linkedin.com" not in url:
        return None
    u = url.strip().split("?")[0].split("#")[0].rstrip("/")
    match = re.search(r"linkedin\.com/company/([^/?#]+)", u, re.I)
    return match.group(1).strip().rstrip("/") or None if match else None


def extract_linkedin_profile_slug(url: str) -> Optional[str]:
    """Extract profile slug from linkedin.com/in/username."""
    if not url or "linkedin.com" not in url:
        return None
    m = re.search(r"linkedin\.com/in/([a-zA-Z0-9_-]+)", url)
    return m.group(1) if m else None
