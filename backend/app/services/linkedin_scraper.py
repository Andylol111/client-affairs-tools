"""
LinkedIn Scraper & Enrichment
- Public scrape: company name from meta tags / JSON-LD
- Apify (optional): employee names, titles, profile URLs via APIFY_API_TOKEN
"""
import json
import os
import re
import asyncio
import threading
import time
import httpx
from bs4 import BeautifulSoup
from typing import Optional

# Browser-like headers to reduce bot detection
LINKEDIN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Apify actor for LinkedIn employees (artificially/linkedin-employees-scraper)
APIFY_ACTOR_ID = "artificially/linkedin-employees-scraper"


def extract_linkedin_company_slug(url: str) -> Optional[str]:
    """Extract company slug from LinkedIn URL (e.g. linkedin.com/company/acme -> acme)."""
    if not url or "linkedin.com" not in url:
        return None
    u = url.strip().split("?")[0].split("#")[0].rstrip("/")
    match = re.search(r"linkedin\.com/company/([^/?#]+)", u, re.I)
    if not match:
        return None
    return match.group(1).strip().rstrip("/") or None


def extract_linkedin_profile_slug(url: str) -> Optional[str]:
    """Extract profile slug from linkedin.com/in/username."""
    if not url or "linkedin.com" not in url:
        return None
    match = re.search(r"linkedin\.com/in/([a-zA-Z0-9_-]+)", url)
    return match.group(1) if match else None


def _apify_poll_run_sync(
    api_token: str,
    canonical_url: str,
    max_employees: int,
    cancel_thread: Optional[threading.Event],
) -> dict:
    """
    Start Apify actor run, poll status (so we can abort), then read dataset.
    cancel_thread: when set, calls Apify run abort() from this thread.
    """
    from apify_client import ApifyClient

    result: dict = {"company_name": None, "contacts": [], "source": "apify"}
    client = ApifyClient(api_token)
    try:
        run = client.actor(APIFY_ACTOR_ID).start(
            run_input={
                "companyUrls": [canonical_url],
                "maxEmployees": min(max_employees, 100),
                "scrapeFullProfiles": False,
            }
        )
    except Exception as e:
        return {**result, "error": f"Apify start failed: {e}"}

    run_id = run.get("id")
    if not run_id:
        return {**result, "error": "Apify did not return a run id"}

    failed = frozenset({"FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT", "STOPPED"})
    info: Optional[dict] = None
    deadline = time.monotonic() + 3600.0
    none_streak = 0
    while time.monotonic() < deadline:
        if cancel_thread is not None and cancel_thread.is_set():
            try:
                client.run(run_id).abort()
            except Exception:
                pass
            return {**result, "aborted": True, "error": None}
        info = client.run(run_id).get()
        if info is None:
            none_streak += 1
            if none_streak > 40:
                return {
                    **result,
                    "error": "Apify run status could not be read (check API token and run id).",
                }
            time.sleep(0.35)
            continue
        none_streak = 0
        status = (info.get("status") or "").upper().replace("_", "-")
        if status == "SUCCEEDED":
            break
        if status in failed:
            msg = info.get("statusMessage") or info.get("status") or status
            return {**result, "error": str(msg)}
        time.sleep(0.65)
    else:
        return {**result, "error": "Apify run timed out locally"}

    if not info:
        return {**result, "error": "Apify run finished but status was not available."}

    dataset_id = info.get("defaultDatasetId") or info.get("default_dataset_id")
    if not dataset_id:
        return result

    items = list(client.dataset(dataset_id).iterate_items())
    for item in items:
        name = item.get("fullName") or item.get("name")
        if not name:
            continue
        result["contacts"].append({
            "name": name,
            "title": item.get("title")
            or item.get("headline")
            or item.get("jobTitle"),
            "linkedin_url": item.get("profileUrl") or item.get("profile_url"),
            "email": None,
        })
        if not result["company_name"] and item.get("companyName"):
            result["company_name"] = item.get("companyName")
    return result


async def scrape_linkedin_via_apify(
    linkedin_url: str,
    max_employees: int = 50,
    cancel_event: Optional[asyncio.Event] = None,
) -> dict:
    """
    Use Apify LinkedIn Employees Scraper for employee data.
    Requires APIFY_API_TOKEN env var. Set at https://console.apify.com
    cancel_event: when set, aborts the Apify actor run (best effort).
    """
    api_token = (os.environ.get("APIFY_API_TOKEN") or "").strip()
    if not api_token:
        return {"company_name": None, "contacts": [], "error": "APIFY_API_TOKEN not set"}

    slug = extract_linkedin_company_slug(linkedin_url)
    if not slug:
        return {"company_name": None, "contacts": [], "error": "Invalid LinkedIn company URL"}

    canonical_url = f"https://www.linkedin.com/company/{slug}"
    thread_cancel: Optional[threading.Event] = None
    forward_task: Optional[asyncio.Task] = None
    if cancel_event is not None:
        thread_cancel = threading.Event()

        async def _forward_cancel() -> None:
            await cancel_event.wait()
            if thread_cancel is not None:
                thread_cancel.set()

        forward_task = asyncio.create_task(_forward_cancel())

    try:
        result = await asyncio.to_thread(
            _apify_poll_run_sync,
            api_token,
            canonical_url,
            max_employees,
            thread_cancel,
        )
    except Exception as e:
        return {"company_name": None, "contacts": [], "error": str(e), "source": "apify"}
    finally:
        if forward_task is not None:
            forward_task.cancel()
            try:
                await forward_task
            except asyncio.CancelledError:
                pass

    if result.get("aborted"):
        return {
            "company_name": result.get("company_name"),
            "contacts": [],
            "source": "apify",
            "error": None,
            "aborted": True,
        }

    return result


async def scrape_linkedin_company_public(url: str, cancel_event: Optional[asyncio.Event] = None) -> dict:
    """
    Scrape public LinkedIn company page (no API).
    Extracts company name only; employee data requires Apify.
    """
    slug = extract_linkedin_company_slug(url)
    if not slug:
        return {"company_name": None, "contacts": [], "error": "Invalid LinkedIn company URL"}

    canonical_url = f"https://www.linkedin.com/company/{slug}"
    result = {"company_name": None, "company_url": canonical_url, "contacts": [], "source": "linkedin_public"}

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(canonical_url, headers=LINKEDIN_HEADERS)
            if resp.status_code != 200:
                return {**result, "error": f"HTTP {resp.status_code}"}

            soup = BeautifulSoup(resp.text, "html.parser")
            og_title = soup.find("meta", property="og:title")
            if og_title and og_title.get("content"):
                result["company_name"] = og_title["content"].split(" | ")[0].strip()

            for script in soup.find_all("script", type="application/ld+json"):
                try:
                    data = json.loads(script.string or "{}")
                    if isinstance(data, dict) and data.get("@type") == "Organization":
                        result["company_name"] = result["company_name"] or data.get("name")
                        break
                    elif isinstance(data, list):
                        for item in data:
                            if isinstance(item, dict) and item.get("@type") == "Organization":
                                result["company_name"] = result["company_name"] or item.get("name")
                                break
                except Exception:
                    pass

            if not result["company_name"]:
                result["company_name"] = slug.replace("-", " ").title()

    except Exception as e:
        result["error"] = str(e)

    return result


async def scrape_linkedin_company(
    linkedin_url: str,
    max_employees: int = 50,
    cancel_event: Optional[asyncio.Event] = None,
) -> dict:
    """
    Scrape LinkedIn company: uses Apify for employee data if APIFY_API_TOKEN is set,
    otherwise falls back to public scrape (company name only).
    """
    token = (os.environ.get("APIFY_API_TOKEN") or "").strip()
    if token:
        data = await scrape_linkedin_via_apify(linkedin_url, max_employees, cancel_event)
        if data.get("aborted"):
            return data
        if data.get("contacts"):
            return data
        if data.get("error"):
            # Do not mask Apify failures with the public page scrape — surface the real error in the UI.
            return data
        return data
    return await scrape_linkedin_company_public(linkedin_url, cancel_event)
