"""Single fetch adapter for the self-hosted Firecrawl instance.

Firecrawl (per docs/FIRECRAWL-SEARCH-EXPANSION-PLAN.md) runs on an OCI VM,
reachable from this app only once the EC2 host joins the same Tailscale mesh
(plan section 1.3) — infrastructure this module does not perform. Until that
network path exists, FIRECRAWL_URL is unset and every call here degrades to
telling the caller to keep using its existing fetch, so importing this module
is safe today and callers do not need two code paths.

Firecrawl replaces the BeautifulSoup/httpx *fetch* step (contact_scraper.py,
research_providers.py) — it does not replace Tavily's *search* step. A caller
still asks Tavily "what is Acme's official site" and hands the resulting URL
here to fetch.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

from app.services.discovery_gate import discovery_job
from app.services.generation_policy import reserve_firecrawl_call

_TIMEOUT_S = 30.0


@dataclass(frozen=True)
class FetchedPage:
    url: str
    content: str
    links: list[str]
    screenshot: str | None = None


def firecrawl_configured() -> bool:
    return bool((os.getenv("FIRECRAWL_URL") or "").strip())


async def fetch_page(url: str, *, user_id: int | None = None) -> FetchedPage | None:
    """Fetch one URL through Firecrawl. Returns None when unconfigured or on
    any failure — callers fall back to their existing fetch, they never block
    on this. Never raises for a missing/unreachable Firecrawl; only a member
    quota HTTPException propagates, matching every other paid-call gate.
    """
    base = (os.getenv("FIRECRAWL_URL") or "").strip().rstrip("/")
    if not base or not url:
        return None

    if user_id is not None:
        await reserve_firecrawl_call(user_id)

    api_key = (os.getenv("FIRECRAWL_API_KEY") or "").strip()
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload: dict[str, Any] = {"url": url, "formats": ["markdown", "links"]}

    # Same slot budget as an HTML crawl job: Firecrawl's browser render is
    # comparable RAM/CPU cost to this box doing its own BeautifulSoup parse.
    async with discovery_job():
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                resp = await client.post(f"{base}/v1/scrape", json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError):
            return None

    doc = data.get("data") if isinstance(data, dict) else None
    if not isinstance(doc, dict):
        return None
    content = str(doc.get("markdown") or doc.get("content") or "")
    if not content:
        return None
    links = [str(link) for link in (doc.get("links") or []) if link]
    screenshot = doc.get("screenshot")
    return FetchedPage(url=url, content=content, links=links, screenshot=screenshot)
