"""AI classification of companies into a fixed segment list, then member-managed.

Batches unclassified companies (grouped from contacts.company/company_domain,
since companies are not a first-class table) through the cheap rank model,
mirroring app.services.contact_ai_review's batching/quota shape. A member can
always override the AI's assignment afterward - the AI call is a starting
point, not a final say.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app.database import get_db

SEGMENTS: list[str] = [
    "Technology & Software",
    "Financial Services",
    "Healthcare & Life Sciences",
    "Consumer & Retail",
    "Manufacturing & Industrial",
    "Media & Entertainment",
    "Education",
    "Energy & Sustainability",
    "Nonprofit & Government",
    "Professional Services",
    "Other",
]

_CLASSIFY_BATCH = 15


def company_key(company_name: str | None, company_domain: str | None) -> str | None:
    """Stable identity for a company that only ever exists as free-text fields
    on contacts. Domain is the more reliable identifier when present since a
    company name can vary in casing/punctuation across contacts of the same
    employer; fall back to the lowercased name otherwise."""
    domain = (company_domain or "").strip().lower()
    if domain:
        return f"domain:{domain}"
    name = (company_name or "").strip().lower()
    return f"name:{name}" if name else None


async def unclassified_companies(db) -> list[dict[str, Any]]:
    rows = await (await db.execute(
        """SELECT DISTINCT company, company_domain
           FROM contacts
           WHERE company IS NOT NULL AND trim(company) != ''"""
    )).fetchall()
    classified = {r["company_key"] for r in await (await db.execute(
        "SELECT company_key FROM company_segments"
    )).fetchall()}
    out = []
    seen: set[str] = set()
    for r in rows:
        key = company_key(r["company"], r["company_domain"])
        if not key or key in classified or key in seen:
            continue
        seen.add(key)
        out.append({"company": r["company"], "company_domain": r["company_domain"], "key": key})
    return out


def _prompt(batch: list[dict[str, Any]]) -> str:
    rows = [{"company": c["company"], "domain": c.get("company_domain") or ""} for c in batch]
    segment_list = "\n".join(f"- {s}" for s in SEGMENTS)
    return f"""Classify each company into exactly one segment from this fixed list - do not invent a new one:
{segment_list}

Use the company name and domain (if given) plus general knowledge of the company.
If genuinely unsure, use "Other" rather than guessing wildly.

Companies:
{json.dumps(rows)}

Respond as JSON only: {{"classifications": [{{"company": "<name>", "segment": "<one of the list above>", "rationale": "<one short sentence>"}}]}}"""


def _parse(data: dict[str, Any] | None, batch: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Returns company name -> {segment, rationale}, defaulting to Other on any
    missing/invalid/off-list response rather than dropping the company silently."""
    by_name = {c["company"]: c for c in batch}
    out: dict[str, dict[str, str]] = {}
    items = data.get("classifications") if isinstance(data, dict) else None
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("company") or "").strip()
            if name not in by_name or name in out:
                continue
            segment = str(item.get("segment") or "").strip()
            if segment not in SEGMENTS:
                segment = "Other"
            out[name] = {
                "segment": segment,
                "rationale": str(item.get("rationale") or "").strip()[:500],
            }
    for name in by_name:
        if name not in out:
            out[name] = {"segment": "Other", "rationale": "No AI response for this company; defaulted."}
    return out


async def classify_companies(companies: list[dict[str, Any]], user_id: int) -> int:
    """Classifies and persists the given companies (each a dict with
    company/company_domain/key). Returns the number newly classified."""
    if not companies:
        return 0
    from app.services.llm import complete_json, rank_model_id

    written = 0
    db = await get_db()
    try:
        for start in range(0, len(companies), _CLASSIFY_BATCH):
            batch = companies[start:start + _CLASSIFY_BATCH]
            try:
                data = await asyncio.to_thread(complete_json, _prompt(batch), rank_model_id())
            except Exception:
                data = None
            results = _parse(data, batch)
            for c in batch:
                result = results.get(c["company"])
                if not result:
                    continue
                await db.execute(
                    """INSERT INTO company_segments (company_key, company_name, company_domain, segment, source, rationale, classified_by, updated_at)
                       VALUES (?,?,?,?,'ai',?,?,CURRENT_TIMESTAMP)
                       ON CONFLICT(company_key) DO UPDATE SET
                         segment=excluded.segment, rationale=excluded.rationale, updated_at=CURRENT_TIMESTAMP""",
                    (c["key"], c["company"], c.get("company_domain"), result["segment"], result["rationale"], user_id),
                )
                written += 1
            await db.commit()
    finally:
        await db.close()
    return written
