"""
AI review of scraped contacts via Ollama — flag real vs junk names, assess provenance.
Uses multi-agent thread pool (ollama_agent_pool) + batch_agents for parallel review.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

from app.database import get_db
from app.services.batch_agents import run_batch_agents
from app.services.ollama_agent_pool import (
    AI_REVIEW_WORKERS,
    OLLAMA_MODEL,
    OLLAMA_URL,
    agent_pool_size,
    ollama_json_async,
)
from app.services.contact_scraper import is_heuristic_junk_contact

AI_REVIEW_BATCH = int(os.getenv("AI_REVIEW_BATCH", "5"))
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "90.0"))
AI_REVIEW_ENABLED = os.getenv("AI_REVIEW_ENABLED", "true").lower() not in ("0", "false", "no")


def _contact_for_prompt(c: dict) -> dict[str, Any]:
    return {
        "email": (c.get("email") or "").strip().lower(),
        "name": c.get("name"),
        "title": c.get("title"),
        "contact_source": c.get("contact_source"),
        "source_url": c.get("source_url"),
        "linkedin_url": c.get("linkedin_url"),
        "discovery_context": (c.get("discovery_context") or "")[:400],
    }


def _build_review_prompt(batch: list[dict], company_name: str | None) -> str:
    company = company_name or "unknown company"
    payload = json.dumps([_contact_for_prompt(c) for c in batch], indent=2)
    return f"""You validate B2B outreach contacts scraped for {company}.

For EVERY contact below, output exactly one review with the same email field (lowercase).

Rules:
- verdict: "real" | "suspicious" | "junk"
- junk = nav labels (Gift Cards, Mac Studio), prose fragments, company names, not a person
- real = plausible human name with reasonable source
- suspicious = unclear or weak evidence

Return JSON only:
{{"reviews":[{{"email":"x@y.com","verdict":"real|suspicious|junk","name_plausible":true,"reason":"...","source_note":"..."}}]}}

Must include {len(batch)} review(s), one per input email.

Contacts:
{payload}"""


def _normalize_reviews(data: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not data or not isinstance(data.get("reviews"), list):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in data["reviews"]:
        if not isinstance(row, dict):
            continue
        email = (row.get("email") or "").strip().lower()
        if email:
            out[email] = row
    return out


async def _review_batch(batch: list[dict], company_name: str | None) -> dict[str, dict[str, Any]]:
    if not batch:
        return {}
    from app.services.llm import complete_json, llm_provider, rank_model_id

    prompt = _build_review_prompt(batch, company_name)
    if llm_provider() == "bedrock":
        data = await asyncio.to_thread(complete_json, prompt, rank_model_id())
    else:
        data = await ollama_json_async(prompt)
    result = _normalize_reviews(data)

    missing = [c for c in batch if (c.get("email") or "").strip().lower() not in result]
    if missing and len(missing) < len(batch):
        singles = await asyncio.gather(
            *[_review_batch([c], company_name) for c in missing],
        )
        for part in singles:
            result.update(part)
    elif missing and len(missing) == len(batch) and len(batch) > 1:
        mid = len(batch) // 2
        left, right = await asyncio.gather(
            _review_batch(batch[:mid], company_name),
            _review_batch(batch[mid:], company_name),
        )
        result = {**left, **right}

    return result


def _merge_review_maps(parts: list[dict[str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for part in parts:
        merged.update(part)
    return merged


async def run_ai_review_agents(
    contacts: list[dict],
    *,
    company_name: str | None = None,
    on_progress: Any = None,
) -> dict[str, dict[str, Any]]:
    """Multi-agent parallel review — returns email -> review map."""
    if not contacts:
        return {}

    reviews: dict[str, dict[str, Any]] = {}
    to_review: list[dict] = []
    for c in contacts:
        email = (c.get("email") or "").strip().lower()
        if not email:
            continue
        junk, reason = is_heuristic_junk_contact(c, company_name)
        if junk:
            reviews[email] = {
                "email": email,
                "verdict": "junk",
                "reason": reason,
                "source_note": "heuristic pre-filter",
                "name_plausible": False,
            }
        else:
            to_review.append(c)

    if not to_review or not AI_REVIEW_ENABLED:
        return reviews

    ollama_reviews = await run_batch_agents(
        to_review,
        batch_size=AI_REVIEW_BATCH,
        agents=AI_REVIEW_WORKERS,
        worker=lambda batch: _review_batch(batch, company_name),
        merge=_merge_review_maps,
        on_progress=on_progress,
    )
    reviews.update(ollama_reviews)
    return reviews


async def ai_review_contacts(
    contacts: list[dict],
    *,
    company_name: str | None = None,
    on_progress: Any = None,
) -> tuple[list[dict], list[dict]]:
    if not contacts:
        return [], []

    if not AI_REVIEW_ENABLED:
        log = [_log_row(c, verdict="unreviewed", reason="AI review disabled", model=None) for c in contacts]
        return [dict(c) for c in contacts], log

    reviews = await run_ai_review_agents(
        contacts,
        company_name=company_name,
        on_progress=on_progress,
    )

    reviewed: list[dict] = []
    log: list[dict] = []
    for c in contacts:
        row = dict(c)
        email = (row.get("email") or "").strip().lower()
        rev = reviews.get(email)
        if rev:
            verdict = str(rev.get("verdict") or "suspicious").lower()
            if verdict not in ("real", "suspicious", "junk"):
                verdict = "suspicious"
            row["ai_verdict"] = verdict
            row["ai_reason"] = str(rev.get("reason") or "")[:500]
            row["ai_source_note"] = str(rev.get("source_note") or "")[:500]
            row["ai_name_plausible"] = bool(rev.get("name_plausible"))
            log.append(
                _log_row(
                    row,
                    verdict=verdict,
                    reason=row["ai_reason"],
                    model=OLLAMA_MODEL,
                    source_note=row["ai_source_note"],
                )
            )
        else:
            row["ai_verdict"] = "unreviewed"
            row["ai_reason"] = "Ollama did not return a review for this email (timeout or parse error)"
            log.append(_log_row(row, verdict="unreviewed", reason=row["ai_reason"], model=OLLAMA_MODEL))
        reviewed.append(row)

    return reviewed, log


def _log_row(
    c: dict,
    *,
    verdict: str,
    reason: str,
    model: str | None,
    source_note: str = "",
) -> dict[str, Any]:
    return {
        "email": c.get("email"),
        "name": c.get("name"),
        "title": c.get("title"),
        "company": c.get("company"),
        "contact_source": c.get("contact_source"),
        "source_url": c.get("source_url"),
        "linkedin_url": c.get("linkedin_url"),
        "discovery_context": (c.get("discovery_context") or "")[:800],
        "ai_verdict": verdict,
        "ai_reason": reason,
        "ai_source_note": source_note,
        "ai_model": model,
        "email_verification_status": c.get("email_verification_status"),
        "confidence": c.get("confidence"),
    }


async def persist_discovery_log(scrape_run_id: str, entries: list[dict[str, Any]]) -> None:
    if not scrape_run_id or not entries:
        return
    db = await get_db()
    try:
        for e in entries:
            await db.execute(
                """INSERT INTO contact_discovery_logs
                   (scrape_run_id, email, name, title, company, contact_source, source_url,
                    linkedin_url, discovery_context, ai_verdict, ai_reason, ai_source_note, ai_model,
                    email_verification_status, confidence)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    scrape_run_id,
                    e.get("email"),
                    e.get("name"),
                    e.get("title"),
                    e.get("company"),
                    e.get("contact_source"),
                    e.get("source_url"),
                    e.get("linkedin_url"),
                    e.get("discovery_context"),
                    e.get("ai_verdict"),
                    e.get("ai_reason"),
                    e.get("ai_source_note"),
                    e.get("ai_model"),
                    e.get("email_verification_status"),
                    e.get("confidence"),
                ),
            )
        await db.commit()
    finally:
        await db.close()


async def get_discovery_log(scrape_run_id: str, limit: int = 500) -> list[dict[str, Any]]:
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT * FROM contact_discovery_logs
               WHERE scrape_run_id = ? ORDER BY id ASC LIMIT ?""",
            (scrape_run_id, limit),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def check_review_backend() -> tuple[bool, str]:
    from app.services.llm import default_model_id, llm_provider, rank_model_id

    if llm_provider() == "bedrock":
        return True, f"bedrock rank={rank_model_id()} draft={default_model_id()}"
    return await check_ollama_available()


async def check_ollama_available() -> tuple[bool, str]:
    """Quick health check for scrape startup (laptop Ollama only)."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_URL.rstrip('/')}/api/tags")
            if r.status_code != 200:
                return False, f"Ollama HTTP {r.status_code}"
            names = [m.get("name", "") for m in r.json().get("models", [])]
            if not any(OLLAMA_MODEL in n or n.startswith(OLLAMA_MODEL) for n in names):
                return False, f"Model {OLLAMA_MODEL} not pulled (have: {', '.join(names[:3])})"
            agents = agent_pool_size()
            return True, f"{OLLAMA_MODEL} · {agents} agent thread(s)"
    except Exception as e:
        return False, str(e)
