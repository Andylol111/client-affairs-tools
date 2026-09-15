"""Roster work-email derivation + cache-first reads for Find people.

Contract: a person exists only from name+role evidence; mailboxes here are DERIVED
from learned domain patterns and must pass strict name alignment. A harvested or
role inbox never enters this path. Bounced addresses are tombstoned (email_status=
'bounced'), never silently rebuilt.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app.database import get_db
from app.services.company_email_cache import build_email_for_person, get_domain_patterns
from app.services.contact_scraper import (
    is_employee_outreach_email,
    normalize_domain,
    sanitize_email,
    strict_email_name_alignment,
)
from app.services.email_verifier import get_mx_cached
from app.services.roster_watch import company_key, roster_detail


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _recheck_days() -> int:
    return max(7, min(int(os.getenv("ROSTER_EMAIL_RECHECK_DAYS", "30") or 30), 180))


def _drain_limit() -> int:
    return max(1, min(int(os.getenv("ROSTER_EMAIL_DRAIN_LIMIT", "10") or 10), 50))


async def derive_roster_email(full_name: str, domain: str | None) -> str | None:
    """Work email for a known person, or None. Never a role inbox; must align to the name."""
    dom = normalize_domain(domain or "")
    parts = re.findall(r"[A-Za-z][a-z'.-]+", full_name or "")
    if not dom or len(parts) < 2:
        return None
    return _row_email(full_name, dom, await _build_email(full_name, dom))


async def _build_email(full_name: str, dom: str) -> str | None:
    try:
        return sanitize_email(await build_email_for_person(full_name, dom) or "")
    except Exception:
        return None


def _row_email(full_name: str, dom: str, built: str | None) -> str | None:
    if built and is_employee_outreach_email(built) and strict_email_name_alignment(full_name, built):
        return built
    return None


async def cached_roster_contacts(company_name: str, domain: str | None, limit: int = 100) -> list[dict[str, Any]]:
    """Current roster people as contact dicts for the Find people merge stage.

    Rows carry NO email unless a derived+aligned work email already exists; the
    verify pipeline rebuilds missing emails through the same learned-pattern path,
    so cache rows go through identical gates as live sources.
    """
    name = (company_name or "").strip()
    if not name:
        return []
    key = company_key(name)
    dom = normalize_domain(domain or "")
    like = f"%{name}%"
    db = await get_db()
    try:
        rows = await (
            await db.execute(
                """SELECT id FROM company_rosters
                   WHERE company_key=? OR company_name=? OR company_name LIKE ?
                      OR (? != '' AND IFNULL(company_domain,'') = ?)
                   ORDER BY (company_key=?) DESC, current_count DESC
                   LIMIT 4""",
                (key, name, like, dom, dom, key),
            )
        ).fetchall()
        people: dict[str, dict[str, Any]] = {}
        for r in rows:
            detail = await roster_detail(int(r["id"]))
            if not detail:
                continue
            roster_dom = normalize_domain(detail.get("company_domain") or dom or "")
            for person in detail.get("people") or []:
                if person.get("employment") != "current":
                    continue
                if person.get("email_status") == "bounced":
                    continue
                full = (person.get("full_name") or "").strip()
                norm = (person.get("normalized_name") or "").strip() or norm_key(full)
                if not full or not norm:
                    continue
                derived = _row_email(full, roster_dom, person.get("inferred_email"))
                candidate = {
                    "name": full,
                    "email": derived or "",
                    "title": person.get("title") or "",
                    "company": detail.get("company_name") or name,
                    "company_domain": roster_dom or dom,
                    "contact_source": "roster_sec" if str(person.get("source") or "").startswith("sec") else "roster_cache",
                    "source_url": person.get("source_url"),
                    "discovery_context": f"club roster · {person.get('source')}",
                    "_roster_norm": norm,
                }
                prev = people.get(norm)
                sec_rank = lambda row: 0 if row["contact_source"] == "roster_sec" else 1  # noqa: E731
                if prev is None or sec_rank(candidate) < sec_rank(prev):
                    people[norm] = candidate
        return list(people.values())[: max(1, min(int(limit), 200))]
    finally:
        await db.close()


def norm_key(name: str) -> str:
    from app.services.contact_scraper import person_name_key

    return person_name_key(name)


async def _ensure_emails(roster: dict[str, Any], *, mx_cache: dict[str, tuple[bool | None, list[str]]] | None = None) -> int:
    """Derive/repair work emails for one roster; MX-check the domain once. Returns touched count."""
    dom = normalize_domain(roster.get("company_domain") or "")
    roster_id = int(roster["id"])
    if not dom or not roster_id:
        return 0
    mx_cache = mx_cache if mx_cache is not None else {}

    if dom not in mx_cache:
        mx_cache[dom] = await get_mx_cached(dom, None)
    mx_ok, _ = mx_cache[dom]
    if mx_ok is False:
        # Domain takes no mail at all — do not mint addresses for it.
        db = await get_db()
        try:
            cur = await db.execute(
                """UPDATE company_roster_people SET email_status='invalid_domain', email_checked_at=?
                   WHERE roster_id=? AND IFNULL(email_status,'') NOT IN ('bounced','invalid_domain','mx_valid','previously_delivered')""",
                (_iso(), roster_id),
            )
            # Domain dead today does not mean dead forever — but retry weekly, not per lease.
            await db.execute(
                "UPDATE company_rosters SET next_email_check_at=? WHERE id=?",
                (_iso(_now() + timedelta(days=7)), roster_id),
            )
            await db.commit()
            return cur.rowcount or 0
        finally:
            await db.close()

    db = await get_db()
    touched = 0
    try:
        rows = await (
            await db.execute(
                """SELECT id, full_name, inferred_email, email_status FROM company_roster_people
                   WHERE roster_id=? AND employment='current'
                     AND (
                         inferred_email IS NULL OR inferred_email=''
                         OR IFNULL(email_status,'') IN ('', 'inconclusive', 'invalid_domain')
                     )""",
                (roster_id,),
            )
        ).fetchall()
        status = "mx_valid" if mx_ok is True else "inconclusive"
        for row in rows:
            email = await _build_email(row["full_name"], dom)
            await db.execute(
                "UPDATE company_roster_people SET inferred_email=?, email_status=?, email_checked_at=? WHERE id=?",
                (email, status, _iso(), row["id"]),
            )
            touched += 1
        await db.execute(
            "UPDATE company_rosters SET next_email_check_at=? WHERE id=?",
            (_iso(_now() + timedelta(days=_recheck_days())), roster_id),
        )
        await db.commit()
        return touched
    finally:
        await db.close()

async def refresh_roster_on_demand(company_name: str, domain: str | None = None) -> list[dict[str, Any]]:
    """SEC-refresh a single company now (Find people cold path), then return cache rows."""
    from app.services.roster_watch import (
        _ensure_roster,
        load_tickers,
        refresh_roster,
    )

    roster = await _ensure_roster(company_name, domain)
    dom = normalize_domain(domain or "")
    if dom and not roster.get("company_domain"):
        db = await get_db()
        try:
            await db.execute(
                "UPDATE company_rosters SET company_domain=?, updated_at=? WHERE id=?",
                (dom, _iso(), int(roster["id"])),
            )
            await db.commit()
        finally:
            await db.close()
        roster["company_domain"] = dom
    if int(roster.get("id") or 0):
        try:
            tickers = await load_tickers()
        except Exception:
            tickers = {}
        await refresh_roster(roster, tickers)
        await _ensure_emails(roster)
    return await cached_roster_contacts(company_name, domain)


async def drain_roster_emails() -> dict[str, Any]:
    """Background MX/pattern maintenance over due rosters (free: DNS + learned patterns only)."""
    db = await get_db()
    claimed: list[dict[str, Any]] = []
    try:
        now_s = _iso()
        lease = _iso(_now() + timedelta(seconds=200))
        await db.execute("BEGIN IMMEDIATE")
        rows = await (
            await db.execute(
                """SELECT * FROM company_rosters
                   WHERE IFNULL(company_domain,'') != ''
                     AND people_count > 0
                     AND IFNULL(next_email_check_at,'') <= ?
                   ORDER BY next_email_check_at, id
                   LIMIT ?""",
                (now_s, _drain_limit()),
            )
        ).fetchall()
        for row in rows:
            record = dict(row)
            await db.execute(
                "UPDATE company_rosters SET next_email_check_at=? WHERE id=?",
                (lease, record["id"]),
            )
            claimed.append(record)
        await db.commit()
    finally:
        await db.close()
    mx_cache: dict[str, tuple[bool | None, list[str]]] = {}
    touched = 0
    for record in claimed:
        try:
            touched += await _ensure_emails(record, mx_cache=mx_cache)
        except Exception:
            continue
    return {"ok": True, "claimed": len(claimed), "touched": touched}


async def apply_provider_verdict(db, email: str, verdict: str) -> None:
    """A Verifalia hard Failure decays the learned pattern and tombstones the
    address even before it is ever mailed. 'Success' deliberately does NOT
    boost — only human replies move confidence up, so the loop stays honest."""
    if verdict != "rejected" or not email:
        return
    cand = await (
        await db.execute("SELECT id FROM email_candidates WHERE email=? COLLATE NOCASE", (email,))
    ).fetchone()
    if cand:
        await apply_mailbox_proof(db, int(cand["id"]), "permanent_failure_observed")
    else:
        row = await (
            await db.execute(
                "SELECT id, full_name, inferred_email, email_status FROM company_roster_people WHERE inferred_email=? COLLATE NOCASE LIMIT 1",
                (email,),
            )
        ).fetchone()
        if row and row["email_status"] != "bounced":
            from app.services.company_email_cache import pattern_for_email

            key = pattern_for_email(email, row["full_name"])
            dom = email.split("@")[-1].lower() if "@" in email else ""
            if key and dom:
                await db.execute(
                    """UPDATE company_email_patterns
                       SET confidence = MAX(0.05, confidence - 0.12),
                           verified_samples = MAX(0, verified_samples - 1),
                           updated_at = CURRENT_TIMESTAMP
                       WHERE company_domain = ? AND pattern_key = ?""",
                    (dom, key),
                )
            await db.execute(
                "UPDATE company_roster_people SET email_status='bounced', email_checked_at=? WHERE id=?",
                (_iso(), row["id"]),
            )
    # A provider-confirmed deadbox never gets mailed, wherever it lives.
    await db.execute(
        """INSERT INTO candidate_suppressions(email,state,observed_at)
           VALUES(?, 'permanent_failure', ?) ON CONFLICT(email) DO NOTHING""",
        (email, _iso()),
    )



async def apply_mailbox_proof(db, candidate_id: int, state: str) -> None:
    """Send-time truth loop: replies up-weight the learned pattern, permanent
    failures down-weight it and tombstone the roster person's email.

    Called INSIDE record_mailbox_event before its check row is inserted, so a
    prior identical check means the event already moved the pattern. Permanent
    failures dedupe on the suppression row that records right after this call.
    """
    if state not in ("permanent_failure_observed", "human_reply_observed", "previously_delivered"):
        return
    cand = await (
        await db.execute(
            "SELECT email, company_domain, pattern_key FROM email_candidates WHERE id=?",
            (candidate_id,),
        )
    ).fetchone()
    if not cand or not cand["pattern_key"] or not cand["company_domain"]:
        return
    if state == "permanent_failure_observed":
        if await (
            await db.execute(
                "SELECT 1 FROM candidate_suppressions WHERE email=? COLLATE NOCASE", (cand["email"],)
            )
        ).fetchone():
            return
    elif await (
        await db.execute(
            "SELECT 1 FROM email_checks WHERE candidate_id=? AND result=? LIMIT 1", (candidate_id, state)
        )
    ).fetchone():
        return
    if state == "permanent_failure_observed":
        delta, sample_delta, floor = -0.12, -1, 0.05
    elif state == "human_reply_observed":
        delta, sample_delta, floor = 0.12, 1, 0.05
    else:
        delta, sample_delta, floor = 0.04, 0, 0.05
    await db.execute(
        """UPDATE company_email_patterns
           SET confidence = MIN(0.98, MAX(?, confidence + ?)),
               verified_samples = MAX(0, verified_samples + ?),
               updated_at = CURRENT_TIMESTAMP
           WHERE company_domain = ? AND pattern_key = ?""",
        (floor, delta, sample_delta, cand["company_domain"], cand["pattern_key"]),
    )
    if state == "permanent_failure_observed":
        await db.execute(
            """UPDATE company_roster_people
               SET email_status='bounced', email_checked_at=?
               WHERE inferred_email = ? COLLATE NOCASE""",
            (_iso(), cand["email"]),
        )
