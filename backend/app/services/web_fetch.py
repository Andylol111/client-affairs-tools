"""Single fetch/search adapter for the self-hosted Firecrawl instance.

Firecrawl (per docs/FIRECRAWL-SEARCH-EXPANSION-PLAN.md) runs on an OCI VM,
reachable from this app once the EC2 host joins the same Tailscale mesh
(plan section 1.3, completed). Until FIRECRAWL_URL is set every call here
degrades to telling the caller to keep using its existing fetch/search, so
importing this module is safe even when the network path is down.

Firecrawl is the primary search AND fetch backend - not Tavily. The club
does not pay for Tavily/Apify/Verifalia; this self-hosted instance replaces
both the *search* step (web_search, backed by /v1/search) and the *fetch*
step (fetch_page, backed by /v1/scrape) that Tavily and raw BeautifulSoup/
httpx previously covered. A caller checks TAVILY_API_KEY only as an optional
bonus path if one is ever configured later - it is never required.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.services.discovery_gate import discovery_job
from app.services.generation_policy import reserve_firecrawl_call

logger = logging.getLogger("yucg.firecrawl")
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
    started = time.monotonic()
    async with discovery_job():
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                resp = await client.post(f"{base}/v1/scrape", json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("firecrawl fetch_page HTTP %s for %s in %.2fs: %s",
                            exc.response.status_code, url, time.monotonic() - started, exc.response.text[:300])
            return None
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("firecrawl fetch_page failed for %s in %.2fs: %s: %s",
                            url, time.monotonic() - started, type(exc).__name__, exc)
            return None

    doc = data.get("data") if isinstance(data, dict) else None
    if not isinstance(doc, dict):
        logger.warning("firecrawl fetch_page malformed response for %s: %r", url, data)
        return None
    content = str(doc.get("markdown") or doc.get("content") or "")
    if not content:
        warning = data.get("warning") if isinstance(data, dict) else None
        logger.info("firecrawl fetch_page empty content for %s in %.2fs (warning=%r)",
                     url, time.monotonic() - started, warning)
        return None
    links = [str(link) for link in (doc.get("links") or []) if link]
    screenshot = doc.get("screenshot")
    logger.info("firecrawl fetch_page ok for %s in %.2fs: %d chars, %d links",
                 url, time.monotonic() - started, len(content), len(links))
    return FetchedPage(url=url, content=content, links=links, screenshot=screenshot)


async def web_search(query: str, max_results: int = 8, *, user_id: int | None = None) -> list[dict[str, Any]]:
    """Web search through Firecrawl. Returns [] when unconfigured or on any
    failure — matches the existing Tavily helpers' shape exactly
    ([{"title", "url", "content"}]) so callers need no changes beyond
    swapping which function they call.
    """
    base = (os.getenv("FIRECRAWL_URL") or "").strip().rstrip("/")
    if not base or not query:
        return []

    if user_id is not None:
        await reserve_firecrawl_call(user_id)

    api_key = (os.getenv("FIRECRAWL_API_KEY") or "").strip()
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload: dict[str, Any] = {"query": query, "limit": max(1, min(20, max_results))}

    started = time.monotonic()
    async with discovery_job():
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                resp = await client.post(f"{base}/v1/search", json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("firecrawl web_search HTTP %s for %r in %.2fs: %s",
                            exc.response.status_code, query, time.monotonic() - started, exc.response.text[:300])
            return []
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("firecrawl web_search failed for %r in %.2fs: %s: %s",
                            query, time.monotonic() - started, type(exc).__name__, exc)
            return []

    results = data.get("data") if isinstance(data, dict) else None
    if not isinstance(results, list):
        logger.warning("firecrawl web_search malformed response for %r: %r", query, data)
        return []
    out: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        out.append({
            "title": str(item.get("title") or ""),
            "url": str(item.get("url") or ""),
            "content": str(item.get("description") or item.get("content") or "")[:1500],
        })
    # Firecrawl returns 200/success even with zero hits, with a "warning"
    # field explaining why (typically its underlying search provider is
    # rate-limited or genuinely has nothing for the query) - log it, since
    # this is otherwise indistinguishable from "the code is broken" without
    # this exact detail.
    if not out:
        warning = data.get("warning") if isinstance(data, dict) else None
        logger.info("firecrawl web_search 0 results for %r in %.2fs (warning=%r)",
                     query, time.monotonic() - started, warning)
    else:
        logger.info("firecrawl web_search %d results for %r in %.2fs",
                     len(out), query, time.monotonic() - started)
    return out
