"""Shared entry points for the Find people run lifecycle that both the manual
UI (yucgoutreach router) and the one-click outreach flow use, so a company
search enqueued or imported either way follows one set of rules."""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import HTTPException

from app.database import row_to_dict
from app.services.contact_intelligence import assess_address, ingest_contact
from app.services.contact_scraper import is_valid_person_contact, normalize_domain, sanitize_email
from app.services.yucgoutreach_discovery import YUCG_MAX_PROSPECTS


async def enqueue_discovery_run(
    db,
    *,
    user_id: int,
    company_name: str,
    company_domain: str | None,
    title_hints: str | None,
    max_prospects: int,
    worker_concurrency: int = 4,
) -> int:
    """Queue one durable company search for a member, enforcing the same
    per-member (one at a time) and club-wide queue limits as the UI. The
    caller owns the write transaction and commit."""
    cap = max(1, min(int(max_prospects), YUCG_MAX_PROSPECTS))
    active = await (await db.execute(
        "SELECT COUNT(*) AS n FROM yucgoutreach_discovery_runs WHERE user_id = ? AND status IN ('queued','running')",
        (user_id,),
    )).fetchone()
    if int(active["n"] or 0):
        raise HTTPException(409, "You already have a company search queued or running")
    club_limit = max(1, int(os.getenv("DISCOVERY_QUEUE_LIMIT", "20") or 20))
    club = await (await db.execute(
        "SELECT COUNT(*) AS n FROM yucgoutreach_discovery_runs WHERE status IN ('queued','running')"
    )).fetchone()
    if int(club["n"] or 0) >= club_limit:
        raise HTTPException(429, "The club search queue is full; try again after a current search finishes")
    hints = (title_hints or "").strip()[:500]
    research = json.dumps({"title_hints": hints}) if hints else None
    cur = await db.execute(
        """INSERT INTO yucgoutreach_discovery_runs (
            user_id, company_name, company_domain,
            max_prospects, worker_concurrency, status, progress_message, research_json
        ) VALUES (?, ?, ?, ?, ?, 'queued', 'Queued', ?)""",
        (
            user_id,
            company_name.strip(),
            (company_domain or "").strip() or None,
            cap,
            worker_concurrency,
            research,
        ),
    )
    return int(cur.lastrowid)


async def import_run_prospects(db, *, run: dict[str, Any], user_id: int) -> dict[str, Any]:
    """Copy a completed run's non-junk prospects into the shared contacts
    table for this member. Returns counts plus the ids of every contact this
    member can now use (created or updated), so a caller can attach them to
    a campaign without a second lookup. The caller commits."""
    run_id = int(run["id"])
    cur = await db.execute(
        """SELECT * FROM yucgoutreach_prospects
           WHERE run_id = ? AND email IS NOT NULL AND email != ''
           AND (ai_verdict IS NULL OR ai_verdict != 'junk')
           ORDER BY score DESC""",
        (run_id,),
    )
    rows = [row_to_dict(r) for r in await cur.fetchall()]
    created = updated = skipped = 0
    contact_ids: list[int] = []
    for pr in rows:
        pr["mailbox_assessment"] = await assess_address(pr.get("email") or "", actor_id=user_id)
    company = run.get("company_name") or ""
    domain = normalize_domain(run.get("company_domain") or "")

    def _row(pr: dict[str, Any]) -> dict[str, Any]:
        return {
            "name": " ".join(p for p in [pr.get("first_name"), pr.get("last_name")] if p).strip(),
            "email": sanitize_email(pr.get("email") or ""),
            "title": pr.get("title"),
            "company": pr.get("company") or company,
            "company_domain": domain,
            "linkedin_url": pr.get("linkedin_url"),
            "contact_source": pr.get("contact_source") or "yucgoutreach",
            "mailbox_assessment": pr.get("mailbox_assessment"),
        }

    def _sources(pr: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
        sources: list[dict[str, Any]] = []
        source_url = (pr.get("contact_profile_url") or pr.get("contact_url") or "").strip()
        if source_url:
            sources.append({
                "url": source_url,
                "excerpt": (pr.get("qualification_notes") or "")[:500] or None,
                "observed_at": None,
            })
        if pr.get("linkedin_url"):
            sources.append({"url": pr["linkedin_url"], "excerpt": None, "observed_at": None})
        return sources, source_url

    for pr in rows:
        row = _row(pr)
        email = row["email"]
        name = row["name"]
        if not email or not is_valid_person_contact(row, company_name=company, domain=domain):
            skipped += 1
            continue
        ex = await (await db.execute("SELECT id, owner_id FROM contacts WHERE email = ?", (email,))).fetchone()
        if ex:
            if ex["owner_id"] is not None and int(ex["owner_id"]) != user_id:
                skipped += 1
                continue
            await db.execute(
                """UPDATE contacts SET name = COALESCE(NULLIF(name, ''), ?),
                   title = COALESCE(NULLIF(title, ''), ?),
                   company = COALESCE(NULLIF(company, ''), ?),
                   company_domain = COALESCE(NULLIF(company_domain, ''), ?),
                   linkedin_url = COALESCE(NULLIF(linkedin_url, ''), ?),
                   contact_source = COALESCE(NULLIF(contact_source, ''), ?),
                   email_verification_status = COALESCE(NULLIF(email_verification_status, ''), ?),
                   ai_verdict = COALESCE(NULLIF(ai_verdict, ''), ?),
                   ai_reason = COALESCE(NULLIF(ai_reason, ''), ?)
                   WHERE id = ?""",
                (
                    name or None,
                    pr.get("title"),
                    pr.get("company") or company or None,
                    domain or None,
                    pr.get("linkedin_url"),
                    pr.get("contact_source") or "yucgoutreach",
                    pr.get("email_verification_status"),
                    pr.get("ai_verdict"),
                    pr.get("ai_reason"),
                    ex["id"],
                ),
            )
            updated += 1
            contact_ids.append(int(ex["id"]))
        else:
            cursor = await db.execute(
                """INSERT INTO contacts (name, email, title, company, company_domain, linkedin_url,
                   contact_source, email_verification_status, ai_verdict, ai_reason, confidence, owner_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    name,
                    email,
                    pr.get("title"),
                    pr.get("company") or company,
                    domain or None,
                    pr.get("linkedin_url"),
                    pr.get("contact_source") or "yucgoutreach",
                    pr.get("email_verification_status"),
                    pr.get("ai_verdict"),
                    pr.get("ai_reason"),
                    "medium",
                    user_id,
                ),
            )
            created += 1
            contact_ids.append(int(cursor.lastrowid))

    evidence_rows = []
    for pr in rows:
        row = _row(pr)
        if not row["email"]:
            continue
        sources, source_url = _sources(pr)
        existing = await (await db.execute("SELECT id, owner_id FROM contacts WHERE email = ?", (row["email"],))).fetchone()
        if existing and (existing["owner_id"] is None or int(existing["owner_id"]) == user_id):
            evidence_rows.append(await ingest_contact(
                db, contact={**row, "id": existing["id"]}, actor_id=user_id,
                origin="published_by_independent_source" if source_url else None,
                sources=sources,
            ))
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "contact_ids": contact_ids,
        "evidence": evidence_rows,
    }
