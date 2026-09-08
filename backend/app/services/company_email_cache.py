"""
Per-company verified email pattern cache — learn from corroborated name+email pairs.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.database import get_db
from app.services.contact_scraper import (
    _apply_custom_pattern,
    infer_email_from_name,
    normalize_domain,
    strict_email_name_alignment,
)


@dataclass
class ReconcileContext:
    """Preloaded DB + MX state for a batch reconcile (avoids per-contact DB round-trips)."""

    custom_patterns: list[str] = field(default_factory=list)
    domain_patterns: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    mx_cache: dict[str, tuple[bool, list[str]]] = field(default_factory=dict)


async def load_reconcile_context(domains: set[str]) -> ReconcileContext:
    ctx = ReconcileContext()
    db = await get_db()
    try:
        cur = await db.execute("SELECT pattern FROM custom_email_formats ORDER BY priority DESC")
        ctx.custom_patterns = [r["pattern"] for r in await cur.fetchall() if r.get("pattern")]
        for raw in domains:
            dom = normalize_domain(raw)
            if not dom or dom in ctx.domain_patterns:
                continue
            cur = await db.execute(
                """SELECT company_domain, company_name, pattern_key, pattern_template, confidence,
                          sample_count, verified_samples, sources_json, updated_at
                   FROM company_email_patterns WHERE company_domain = ? ORDER BY confidence DESC, verified_samples DESC""",
                (dom,),
            )
            rows = await cur.fetchall()
            out: list[dict[str, Any]] = []
            for r in rows:
                d = dict(r)
                try:
                    d["sources"] = json.loads(d.pop("sources_json") or "[]")
                except Exception:
                    d["sources"] = []
                out.append(d)
            ctx.domain_patterns[dom] = out
    finally:
        await db.close()
    return ctx


def build_email_for_person_sync(
    full_name: str,
    domain: str,
    ctx: ReconcileContext | None = None,
) -> str | None:
    """Build email using cached company patterns (no I/O when ctx is provided)."""
    dom = normalize_domain(domain)
    if not dom or not full_name:
        return None
    first, last = _split_name(full_name)
    if not last:
        return None

    patterns = (ctx.domain_patterns.get(dom) if ctx else None) or []
    custom = ctx.custom_patterns if ctx else []

    for p in patterns:
        tpl = p.get("pattern_template") or ""
        if tpl:
            local = _apply_custom_pattern(tpl, first.lower(), last.lower())
            candidate = f"{local}@{dom}"
            if strict_email_name_alignment(full_name, candidate):
                return candidate

    return infer_email_from_name(full_name, dom, custom or None)


async def build_email_for_person(
    full_name: str,
    domain: str,
    ctx: ReconcileContext | None = None,
) -> str | None:
    """Build email using cached company patterns, then global defaults."""
    if ctx is not None:
        return build_email_for_person_sync(full_name, domain, ctx)
    dom = normalize_domain(domain)
    if not dom:
        return None
    loaded = await load_reconcile_context({dom})
    return build_email_for_person_sync(full_name, domain, loaded)


def _split_name(full_name: str) -> tuple[str, str]:
    parts = [p for p in re.split(r"[\s,]+", (full_name or "").strip()) if p]
    if len(parts) >= 2:
        return parts[0], parts[-1]
    return (parts[0], "") if parts else ("", "")


def infer_pattern_from_pair(email: str, first: str, last: str) -> tuple[str, str] | None:
    """Return (pattern_key, template) e.g. ('first.last', '{first}.{last}')."""
    if not email or "@" not in email or not last:
        return None
    local = email.split("@")[0].lower()
    f = first.lower()
    l = last.lower()
    fi = f[0] if f else ""
    candidates = [
        ("first.last", f"{f}.{l}"),
        ("firstlast", f"{f}{l}"),
        ("flast", f"{fi}{l}"),
        ("first_last", f"{f}_{l}"),
        ("last.first", f"{l}.{f}"),
        ("first", f),
    ]
    for key, expected in candidates:
        if local == expected:
            tpl = {
                "first.last": "{first}.{last}",
                "firstlast": "{first}{last}",
                "flast": "{first_initial}{last}",
                "first_last": "{first}_{last}",
                "last.first": "{last}.{first}",
                "first": "{first}",
            }[key]
            return key, tpl
    return None


async def record_verified_sample(
    domain: str,
    email: str,
    full_name: str,
    *,
    source: str = "scrape",
    company_name: str | None = None,
    inferred: bool = False,
) -> None:
    dom = normalize_domain(domain)
    if not dom or not email or not full_name:
        return
    first, last = _split_name(full_name)
    if not last or not strict_email_name_alignment(full_name, email):
        return
    pair = infer_pattern_from_pair(email, first, last)
    if not pair:
        return
    pattern_key, template = pair
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, sample_count, verified_samples, sources_json FROM company_email_patterns WHERE company_domain = ? AND pattern_key = ?",
            (dom, pattern_key),
        )
        row = await cur.fetchone()
        sources: list[str] = []
        if row:
            try:
                sources = json.loads(row["sources_json"] or "[]")
            except Exception:
                sources = []
            if source not in sources:
                sources.append(source)
            sample_count = int(row["sample_count"] or 0) + 1
            verified_samples = int(row["verified_samples"] or 0) + (0 if inferred else 1)
            confidence = min(0.98, 0.35 + verified_samples * 0.12 + sample_count * 0.03)
            await db.execute(
                """UPDATE company_email_patterns SET
                   pattern_template = ?, sample_count = ?, verified_samples = ?,
                   confidence = ?, sources_json = ?, company_name = COALESCE(?, company_name),
                   updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (template, sample_count, verified_samples, confidence, json.dumps(sources[-20:]), company_name, row["id"]),
            )
        else:
            sources = [source]
            confidence = 0.45 if inferred else 0.62
            await db.execute(
                """INSERT INTO company_email_patterns
                   (company_domain, company_name, pattern_key, pattern_template, confidence, sample_count, verified_samples, sources_json)
                   VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                (dom, company_name, pattern_key, template, confidence, 0 if inferred else 1, json.dumps(sources)),
            )
        await db.commit()
    finally:
        await db.close()


async def batch_record_verified_samples(samples: list[dict[str, Any]]) -> None:
    """Persist learned patterns from a reconcile batch in one DB connection."""
    if not samples:
        return
    db = await get_db()
    try:
        for sample in samples:
            domain = sample.get("domain") or ""
            email = sample.get("email") or ""
            full_name = sample.get("full_name") or ""
            source = sample.get("source") or "scrape"
            company_name = sample.get("company_name")
            inferred = bool(sample.get("inferred"))
            dom = normalize_domain(domain)
            if not dom or not email or not full_name:
                continue
            first, last = _split_name(full_name)
            if not last or not strict_email_name_alignment(full_name, email):
                continue
            pair = infer_pattern_from_pair(email, first, last)
            if not pair:
                continue
            pattern_key, template = pair
            cur = await db.execute(
                "SELECT id, sample_count, verified_samples, sources_json FROM company_email_patterns WHERE company_domain = ? AND pattern_key = ?",
                (dom, pattern_key),
            )
            row = await cur.fetchone()
            sources: list[str] = []
            if row:
                try:
                    sources = json.loads(row["sources_json"] or "[]")
                except Exception:
                    sources = []
                if source not in sources:
                    sources.append(source)
                sample_count = int(row["sample_count"] or 0) + 1
                verified_samples = int(row["verified_samples"] or 0) + (0 if inferred else 1)
                confidence = min(0.98, 0.35 + verified_samples * 0.12 + sample_count * 0.03)
                await db.execute(
                    """UPDATE company_email_patterns SET
                       pattern_template = ?, sample_count = ?, verified_samples = ?,
                       confidence = ?, sources_json = ?, company_name = COALESCE(?, company_name),
                       updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?""",
                    (template, sample_count, verified_samples, confidence, json.dumps(sources[-20:]), company_name, row["id"]),
                )
            else:
                sources = [source]
                confidence = 0.45 if inferred else 0.62
                await db.execute(
                    """INSERT INTO company_email_patterns
                       (company_domain, company_name, pattern_key, pattern_template, confidence, sample_count, verified_samples, sources_json)
                       VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                    (dom, company_name, pattern_key, template, confidence, 0 if inferred else 1, json.dumps(sources)),
                )
        await db.commit()
    finally:
        await db.close()


async def get_domain_patterns(domain: str) -> list[dict[str, Any]]:
    dom = normalize_domain(domain)
    if not dom:
        return []
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT company_domain, company_name, pattern_key, pattern_template, confidence,
                      sample_count, verified_samples, sources_json, updated_at
               FROM company_email_patterns WHERE company_domain = ? ORDER BY confidence DESC, verified_samples DESC""",
            (dom,),
        )
        rows = await cur.fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["sources"] = json.loads(d.pop("sources_json") or "[]")
            except Exception:
                d["sources"] = []
            out.append(d)
        return out
    finally:
        await db.close()


def pattern_for_email(email: str, full_name: str) -> str | None:
    first, last = _split_name(full_name)
    pair = infer_pattern_from_pair(email, first, last)
    return pair[0] if pair else None
