"""Web fetch/search adapter, layered: TinyFish first, self-hosted Firecrawl
second, a real Tavily key (if one is ever configured) as a last resort at
call sites.

TinyFish (https://www.tinyfish.ai) is a hosted, free-at-this-scale service
whose Search and Fetch APIs are explicitly engineered around the exact
failure mode Firecrawl hit in production here: residential proxies and
anti-bot handling "at the infrastructure layer" (their own pricing page),
versus this app's self-hosted Firecrawl on an OCI VM with no proxy
configured (docs/FIRECRAWL-SEARCH-EXPANSION-PLAN.md section 1.6). Free tier
ceiling, from TinyFish's own pricing page: 30 search requests/min (500/hour)
and 150 fetch urls/min (1,000/day), per API key, no card required.

Firecrawl (per docs/FIRECRAWL-SEARCH-EXPANSION-PLAN.md) runs on an OCI VM,
reachable from this app once the EC2 host joined the same Tailscale mesh
(plan section 1.3, completed). It stays wired as the second layer: if
TinyFish is ever unconfigured, rate-limited, or has an outage, Firecrawl is
a working fallback rather than an immediate drop to nothing.

The club does not pay for Tavily/Apify/Verifalia. A caller checks
TAVILY_API_KEY only as an optional bonus path if one is ever configured
later - it is never required.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.services.discovery_gate import discovery_job
from app.services.generation_policy import reserve_firecrawl_call, reserve_tinyfish_call

logger = logging.getLogger("yucg.firecrawl")
_TIMEOUT_S = 30.0
_TINYFISH_TIMEOUT_S = 20.0


@dataclass(frozen=True)
class FetchedPage:
    url: str
    content: str
    links: list[str]
    screenshot: str | None = None


def firecrawl_configured() -> bool:
    return bool((os.getenv("FIRECRAWL_URL") or "").strip())


def tinyfish_configured() -> bool:
    return bool((os.getenv("TINYFISH_API_KEY") or "").strip())


def web_search_configured() -> bool:
    """True when any hosted/self-hosted search backend is wired - the check
    every discovery-pipeline gate should use instead of naming one provider,
    so a gate does not need editing again the next time the backend layer
    order changes."""
    return tinyfish_configured() or firecrawl_configured()


# --- TinyFish ---------------------------------------------------------


async def _tinyfish_fetch_page(url: str, *, user_id: int | None = None) -> FetchedPage | None:
    """Returns None on any failure (auth, rate limit, network, no content) -
    the caller falls back to Firecrawl. Never raises except the member
    quota HTTPException, matching every other paid/metered-call gate."""
    api_key = (os.getenv("TINYFISH_API_KEY") or "").strip()
    if not api_key or not url:
        return None
    if user_id is not None:
        await reserve_tinyfish_call(user_id)

    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=_TINYFISH_TIMEOUT_S) as client:
            resp = await client.post(
                "https://api.fetch.tinyfish.ai",
                json={"urls": [url], "format": "markdown"},
                headers={"X-API-Key": api_key, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("tinyfish fetch_page HTTP %s for %s in %.2fs: %s",
                        exc.response.status_code, url, time.monotonic() - started, exc.response.text[:300])
        return None
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("tinyfish fetch_page failed for %s in %.2fs: %s: %s",
                        url, time.monotonic() - started, type(exc).__name__, exc)
        return None

    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list) or not results:
        errors = data.get("errors") if isinstance(data, dict) else None
        logger.info("tinyfish fetch_page no result for %s in %.2fs (errors=%r)",
                     url, time.monotonic() - started, errors)
        return None
    doc = results[0]
    if not isinstance(doc, dict):
        return None
    content = str(doc.get("text") or "")
    if not content:
        logger.info("tinyfish fetch_page empty content for %s in %.2fs", url, time.monotonic() - started)
        return None
    logger.info("tinyfish fetch_page ok for %s in %.2fs: %d chars", url, time.monotonic() - started, len(content))
    # Fetch API returns page text/metadata, not an outbound link list -
    # callers that need links (crawling subpages) get [] from TinyFish and
    # should treat that as "no further links found", same as any page with
    # none.
    return FetchedPage(url=str(doc.get("url") or url), content=content, links=[])


async def _tinyfish_web_search(query: str, max_results: int, *, user_id: int | None = None) -> list[dict[str, Any]] | None:
    """Returns None on failure (caller falls back to Firecrawl) and a list
    (possibly empty) on success - a real empty result is trusted, not
    treated as a failure to fall back from."""
    api_key = (os.getenv("TINYFISH_API_KEY") or "").strip()
    if not api_key or not query:
        return None
    if user_id is not None:
        await reserve_tinyfish_call(user_id)

    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=_TINYFISH_TIMEOUT_S) as client:
            resp = await client.get(
                "https://api.search.tinyfish.ai",
                params={"query": query, "num_results": max(1, min(20, max_results))},
                headers={"X-API-Key": api_key},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("tinyfish web_search HTTP %s for %r in %.2fs: %s",
                        exc.response.status_code, query, time.monotonic() - started, exc.response.text[:300])
        return None
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("tinyfish web_search failed for %r in %.2fs: %s: %s",
                        query, time.monotonic() - started, type(exc).__name__, exc)
        return None

    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        logger.warning("tinyfish web_search malformed response for %r: %r", query, data)
        return None
    out: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        out.append({
            "title": str(item.get("title") or ""),
            "url": str(item.get("url") or ""),
            "content": str(item.get("snippet") or "")[:1500],
        })
    logger.info("tinyfish web_search %d results for %r in %.2fs", len(out), query, time.monotonic() - started)
    return out


# --- Firecrawl ---------------------------------------------------------


async def _firecrawl_fetch_page(url: str, *, user_id: int | None = None) -> FetchedPage | None:
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


async def _firecrawl_web_search(query: str, max_results: int, *, user_id: int | None = None) -> list[dict[str, Any]]:
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


# --- Public waterfall: TinyFish -> Firecrawl ---------------------------


async def fetch_page(url: str, *, user_id: int | None = None) -> FetchedPage | None:
    """Fetch one URL. Tries TinyFish first, then Firecrawl. Returns None
    when neither is configured or both fail - callers fall back to their
    existing fetch, they never block on this."""
    if tinyfish_configured():
        page = await _tinyfish_fetch_page(url, user_id=user_id)
        if page is not None:
            return page
    if firecrawl_configured():
        return await _firecrawl_fetch_page(url, user_id=user_id)
    return None


async def web_search(query: str, max_results: int = 8, *, user_id: int | None = None) -> list[dict[str, Any]]:
    """Web search. Tries TinyFish first, then Firecrawl. Returns [] when
    neither is configured. A genuine empty result from TinyFish is trusted
    and returned as-is, not treated as a reason to fall back to Firecrawl."""
    if tinyfish_configured():
        results = await _tinyfish_web_search(query, max_results, user_id=user_id)
        if results is not None:
            return results
    if firecrawl_configured():
        return await _firecrawl_web_search(query, max_results, user_id=user_id)
    return []
