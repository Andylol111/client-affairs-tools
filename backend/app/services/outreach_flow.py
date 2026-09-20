"""One-click outreach: company -> ready-to-review campaign.

A flow chains four doors that already exist as separate manual steps -
Find people (durable discovery run), Import to Contacts, draft generation,
and campaign assembly - into one durable record a member starts with a
single action and finishes with one more: Review & release on the campaign.

Invariants preserved from the pieces it composes:
- Discovery, drafting, and campaign ownership all belong to the member who
  started the flow; the flow never sends. Release stays a separate,
  confirmed action on the campaign so the send boundary is unchanged.
- Drafts respect the member's hourly generation quota. When the quota runs
  out mid-flow, the remaining contacts are still added to the campaign with
  empty drafts and the flow says so, rather than failing or blocking.
- One scheduler tick advances one flow, claimed with a lease like discovery
  runs, so two processes cannot double-import or double-draft.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.database import get_db, row_to_dict

logger = logging.getLogger(__name__)

TERMINAL = frozenset({"ready", "failed"})


def _lease_minutes() -> int:
    return max(5, min(int(os.getenv("OUTREACH_FLOW_LEASE_MINUTES", "20") or 20), 120))


def _campaign_name(company: str) -> str:
    return f"{company.strip()} — {datetime.utcnow():%b %d}"[:200]


async def _recorded_target_role(company: str) -> str | None:
    """The role the club already decided to aim at for this company, if any.

    Curated register rows carry target_role_title - "Head of Acquisitions",
    "VP Strategic Partnerships" - which is exactly the hint discovery needs
    and exactly what a member would otherwise retype from memory.
    """
    db = await get_db()
    try:
        row = await (await db.execute(
            """SELECT metadata_json FROM company_register
               WHERE lower(company_name) = lower(?) AND metadata_json IS NOT NULL
               ORDER BY CASE tier WHEN 'club_targets' THEN 0 ELSE 1 END LIMIT 1""",
            (company,),
        )).fetchone()
    finally:
        await db.close()
    if not row:
        return None
    try:
        meta = json.loads(row["metadata_json"] or "{}")
    except (TypeError, ValueError):
        return None
    role = (meta.get("target_role_title") or "").strip()
    return role[:500] or None


async def _drop_board_only(contact_ids: list[int]) -> tuple[list[int], list[str]]:
    """Keep the people who would read the email; report the board seats.

    Returns (keepers, board names). A contact with no title is kept: discovery
    found them by searching for a role, so an unlabelled row is far more
    likely to be a working person than a trustee, and dropping it would throw
    away real contacts to avoid a rare one.
    """
    if not contact_ids:
        return [], []
    from app.services.company_register import classify_person_level

    placeholders = ",".join("?" * len(contact_ids))
    db = await get_db()
    try:
        rows = await (await db.execute(
            f"SELECT id, name, title FROM contacts WHERE id IN ({placeholders})",
            [int(i) for i in contact_ids],
        )).fetchall()
    finally:
        await db.close()
    level_by_id = {
        int(row["id"]): classify_person_level(row["title"]) for row in rows
    }
    names = {int(row["id"]): (row["name"] or row["title"] or "someone") for row in rows}
    keepers = [cid for cid in contact_ids if level_by_id.get(int(cid), "unknown") != "board"]
    board = [names.get(int(cid), "someone") for cid in contact_ids
             if level_by_id.get(int(cid)) == "board"]
    return keepers, board


async def start_outreach_flow(
    *,
    user_id: int,
    company_name: str,
    company_domain: str | None,
    title_hints: str | None,
    angle: str | None,
    max_contacts: int,
) -> dict[str, Any]:
    """Queue the discovery run and record the flow that will carry it through
    to a campaign. Raises the same 409/429 as Find people when the member or
    club queue is busy."""
    from app.services.dispatch_service import begin_write
    from app.services.yucgoutreach_import import enqueue_discovery_run

    company = (company_name or "").strip()
    if not company:
        raise HTTPException(400, "Company name is required")
    max_contacts = max(1, min(int(max_contacts or 25), 200))
    # Discovery is only as good as the titles it is told to look for, and the
    # register often already knows: the club wrote down who to aim at, and the
    # filings say whether anyone at working level has ever been named here.
    # Using that when the member typed nothing is the difference between
    # finding a VP and finding the board.
    title_hints = (title_hints or "").strip() or await _recorded_target_role(company)
    db = await get_db()
    try:
        await begin_write(db)
        open_flow = await (await db.execute(
            "SELECT id FROM outreach_flows WHERE user_id=? AND status NOT IN ('ready','failed') LIMIT 1",
            (user_id,),
        )).fetchone()
        if open_flow:
            raise HTTPException(409, "You already have an outreach flow in progress; let it finish first")
        run_id = await enqueue_discovery_run(
            db,
            user_id=user_id,
            company_name=company,
            company_domain=company_domain,
            title_hints=title_hints,
            # Ask discovery for more than we will keep so import/junk filtering
            # still leaves enough good people for the campaign.
            max_prospects=min(800, max_contacts * 3),
        )
        cur = await db.execute(
            """INSERT INTO outreach_flows (
                user_id, company_name, company_domain, title_hints, angle, max_contacts,
                run_id, status, progress_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'discovering', 'Finding people at the company…')""",
            (
                user_id,
                company,
                (company_domain or "").strip() or None,
                (title_hints or "").strip()[:500] or None,
                (angle or "").strip()[:64] or None,
                max_contacts,
                run_id,
            ),
        )
        await db.commit()
        flow_id = int(cur.lastrowid)
    finally:
        await db.close()
    # Starting work on a company is the moment worth recording, and the moment
    # the member should learn a colleague is already on it - not after a week.
    from app.services.company_claims import claim_company

    claim = await claim_company(user_id, company, company_domain)
    result = await get_flow(flow_id, user_id)
    if result is not None and claim.get("held_by_other"):
        result["claimed_by"] = claim["member"]
    return result


async def get_flow(flow_id: int, user_id: int) -> dict[str, Any] | None:
    db = await get_db()
    try:
        row = await (await db.execute(
            """SELECT f.*, r.status AS run_status, r.progress_pct AS run_progress_pct,
                      r.progress_message AS run_progress_message, r.prospects_count,
                      c.status AS campaign_status, c.name AS campaign_name
               FROM outreach_flows f
               LEFT JOIN yucgoutreach_discovery_runs r ON r.id = f.run_id
               LEFT JOIN campaigns c ON c.id = f.campaign_id
               WHERE f.id = ? AND f.user_id = ?""",
            (flow_id, user_id),
        )).fetchone()
        return _public(row_to_dict(row)) if row else None
    finally:
        await db.close()


async def list_flows(user_id: int, limit: int = 20) -> list[dict[str, Any]]:
    db = await get_db()
    try:
        rows = await (await db.execute(
            """SELECT f.*, r.status AS run_status, r.progress_pct AS run_progress_pct,
                      r.progress_message AS run_progress_message, r.prospects_count,
                      c.status AS campaign_status, c.name AS campaign_name
               FROM outreach_flows f
               LEFT JOIN yucgoutreach_discovery_runs r ON r.id = f.run_id
               LEFT JOIN campaigns c ON c.id = f.campaign_id
               WHERE f.user_id = ? ORDER BY f.id DESC LIMIT ?""",
            (user_id, max(1, min(limit, 100))),
        )).fetchall()
        return [_public(row_to_dict(r)) for r in rows]
    finally:
        await db.close()


def _public(row: dict[str, Any]) -> dict[str, Any]:
    stage_pct = {"discovering": 0.0, "importing": 60.0, "drafting": 70.0, "ready": 100.0, "failed": 100.0}
    status = row.get("status") or "discovering"
    pct = stage_pct.get(status, 0.0)
    if status == "discovering":
        pct = min(55.0, float(row.get("run_progress_pct") or 0) * 0.55)
    elif status == "drafting":
        target = max(1, int(row.get("imported_count") or 1))
        pct = 70.0 + 28.0 * min(1.0, int(row.get("drafted_count") or 0) / target)
    return {
        "id": row["id"],
        "company_name": row.get("company_name"),
        "company_domain": row.get("company_domain"),
        "title_hints": row.get("title_hints"),
        "angle": row.get("angle"),
        "max_contacts": row.get("max_contacts"),
        "status": status,
        "progress_pct": round(pct, 1),
        "progress_message": row.get("progress_message") if status != "discovering" else (row.get("run_progress_message") or row.get("progress_message")),
        "run_id": row.get("run_id"),
        "prospects_count": row.get("prospects_count"),
        "imported_count": row.get("imported_count"),
        "drafted_count": row.get("drafted_count"),
        "campaign_id": row.get("campaign_id"),
        "campaign_name": row.get("campaign_name"),
        "campaign_status": row.get("campaign_status"),
        "error_message": row.get("error_message"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "completed_at": row.get("completed_at"),
    }


async def _update(flow_id: int, lease_token: str, **fields: Any) -> bool:
    sets = ["updated_at=CURRENT_TIMESTAMP", f"lease_expires_at=datetime('now', '+{_lease_minutes()} minutes')"]
    args: list[Any] = []
    for key, value in fields.items():
        sets.append(f"{key}=?")
        args.append(value)
    args.extend([flow_id, lease_token])
    db = await get_db()
    try:
        cur = await db.execute(
            f"UPDATE outreach_flows SET {', '.join(sets)} WHERE id=? AND lease_token=?", tuple(args)
        )
        await db.commit()
        return cur.rowcount == 1
    finally:
        await db.close()


async def _fail(flow_id: int, lease_token: str, message: str) -> None:
    await _update(flow_id, lease_token, status="failed", error_message=message[:1000],
                  progress_message="Stopped", completed_at=datetime.utcnow().isoformat())


async def drain_outreach_flows() -> dict[str, Any]:
    """Advance one flow whose discovery run has finished. Called on an
    interval alongside the discovery drain; claims with a lease so a second
    scheduler cannot take the same flow mid-import."""
    lease_token = uuid.uuid4().hex
    db = await get_db()
    try:
        # A run that failed fails its flow with the run's own reason.
        await db.execute(
            """UPDATE outreach_flows SET status='failed', progress_message='Stopped',
                   error_message=COALESCE((SELECT error_message FROM yucgoutreach_discovery_runs r WHERE r.id=outreach_flows.run_id),
                                          'Company search failed'),
                   completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
               WHERE status='discovering' AND run_id IN (SELECT id FROM yucgoutreach_discovery_runs WHERE status='failed')"""
        )
        # Requeue a flow whose worker died mid-stage.
        await db.execute(
            """UPDATE outreach_flows SET lease_token=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
               WHERE status IN ('importing','drafting') AND lease_token IS NOT NULL
                 AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now'))"""
        )
        await db.commit()
        claimed = await (await db.execute(
            f"""UPDATE outreach_flows
                SET lease_token=?, lease_expires_at=datetime('now', '+{_lease_minutes()} minutes'),
                    status=CASE WHEN status='discovering' THEN 'importing' ELSE status END,
                    progress_message=CASE WHEN status='discovering' THEN 'Saving people to your contacts…' ELSE progress_message END,
                    updated_at=CURRENT_TIMESTAMP
                WHERE id = (
                    SELECT f.id FROM outreach_flows f
                    JOIN yucgoutreach_discovery_runs r ON r.id = f.run_id
                    JOIN users u ON u.id = f.user_id AND u.is_active = 1
                    WHERE f.lease_token IS NULL
                      AND ((f.status='discovering' AND r.status='completed') OR f.status IN ('importing','drafting'))
                    ORDER BY f.id LIMIT 1
                ) RETURNING id""",
            (lease_token,),
        )).fetchone()
        await db.commit()
    finally:
        await db.close()
    if not claimed:
        return {"ok": True, "claimed": 0}
    flow_id = int(claimed["id"])
    try:
        await _advance(flow_id, lease_token)
    except Exception as exc:  # the flow record is the error surface; never crash the scheduler
        logger.exception("outreach flow %s failed", flow_id)
        await _fail(flow_id, lease_token, f"{type(exc).__name__}: {exc}")
    return {"ok": True, "claimed": 1, "flow_id": flow_id}


async def _advance(flow_id: int, lease_token: str) -> None:
    from app.services.yucgoutreach_import import import_run_prospects

    db = await get_db()
    try:
        flow = await (await db.execute(
            "SELECT * FROM outreach_flows WHERE id=? AND lease_token=?", (flow_id, lease_token)
        )).fetchone()
        if not flow:
            return
        flow = row_to_dict(flow)
        run = await (await db.execute(
            "SELECT * FROM yucgoutreach_discovery_runs WHERE id=?", (flow["run_id"],)
        )).fetchone()
        run = row_to_dict(run) if run else None
    finally:
        await db.close()
    if not run:
        await _fail(flow_id, lease_token, "Company search record is missing")
        return
    user_id = int(flow["user_id"])

    # --- importing -------------------------------------------------------
    if flow["status"] == "importing":
        db = await get_db()
        try:
            from app.services.dispatch_service import begin_write
            await begin_write(db)
            result = await import_run_prospects(db, run=run, user_id=user_id)
            await db.commit()
        finally:
            await db.close()
        contact_ids = result["contact_ids"][: int(flow["max_contacts"] or 25)]
        if not contact_ids:
            await _fail(flow_id, lease_token,
                        f"No usable people found. {run.get('progress_message') or ''}".strip())
            return
        # A board seat is not a reader. Statutory filings name the board first
        # - on the live register 58.7% of named people are directors or
        # trustees and only 26.2% of companies have anyone at working level -
        # so a run that surfaced nothing but a board is a search that has not
        # finished, not a campaign that is ready. Executives count: at a
        # 50-person nonprofit the executive director is the right target.
        contact_ids, board_only = await _drop_board_only(contact_ids)
        if not contact_ids:
            await _fail(flow_id, lease_token,
                        f"Everyone found at {flow['company_name']} sits on the board "
                        f"({', '.join(board_only[:3])}{'…' if len(board_only) > 3 else ''}). "
                        "They are a way in, not a recipient. Search again with the role you "
                        "want - the person who would run the project.")
            return
        campaign_id = await _create_campaign(user_id, flow["company_name"])
        # A smaller number than expected has a reason, and the reason is a
        # person the member can go and ask.
        held_note = result.get("held_by_note") or ""
        progress = f"Drafting {len(contact_ids)} email(s)…"
        if held_note:
            progress = f"{progress} ({held_note})"
        ok = await _update(flow_id, lease_token, status="drafting", campaign_id=campaign_id,
                           imported_count=len(contact_ids), drafted_count=0,
                           progress_message=progress)
        if not ok:
            return
        flow.update(status="drafting", campaign_id=campaign_id, imported_count=len(contact_ids), drafted_count=0)
        flow["_contact_ids"] = contact_ids

    # --- drafting ----------------------------------------------------------
    if flow["status"] == "drafting":
        contact_ids = flow.get("_contact_ids") or await _flow_contact_ids(flow, run, user_id)
        drafted, rejected, quota_hit = await _draft_all(flow, contact_ids, user_id, lease_token)
        await _attach_to_campaign(int(flow["campaign_id"]), contact_ids, user_id)
        note = f"{drafted} draft(s) ready for {len(contact_ids)} people."
        if rejected:
            note += f" {rejected} draft(s) did not pass the draft rules; write those in the campaign."
        if quota_hit:
            note += " Your hourly draft limit was reached; draft the rest from the campaign."
        await _update(flow_id, lease_token, status="ready", drafted_count=drafted,
                      progress_message=note, completed_at=datetime.utcnow().isoformat())


async def _flow_contact_ids(flow: dict[str, Any], run: dict[str, Any], user_id: int) -> list[int]:
    """Recover the contact set for a flow resumed after a worker restart:
    the member's contacts at this company, best-scored first, capped."""
    db = await get_db()
    try:
        rows = await (await db.execute(
            """SELECT c.id FROM contacts c
               JOIN yucgoutreach_prospects p ON lower(p.email) = lower(c.email) AND p.run_id = ?
               WHERE (c.owner_id IS NULL OR c.owner_id = ?)
               ORDER BY p.score DESC LIMIT ?""",
            (run["id"], user_id, int(flow["max_contacts"] or 25)),
        )).fetchall()
        return [int(r["id"]) for r in rows]
    finally:
        await db.close()


async def _create_campaign(user_id: int, company: str) -> int:
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO campaigns (name, status, owner_user_id, sender_user_id) VALUES (?, 'draft', ?, ?)",
            (_campaign_name(company), user_id, user_id),
        )
        await db.commit()
        return int(cur.lastrowid)
    finally:
        await db.close()


_ONE_ASK_INSTRUCTION = (
    "Ask exactly one thing in the whole email: a single closing request for a short call next week. "
    "Do not open with a question and do not include any other question marks."
)


async def _generate_with_retry(generate_email, *, contact: dict[str, Any], angle: str, evidence: dict[str, Any],
                               user_id: int, reserve_generation, normalize_domain) -> tuple[str, str] | None:
    """Studio's validator accepts exactly one ask sentence, and rejects a
    draft outright rather than repairing it - an unsupported figure or a
    second question is enough. A rejected draft therefore gets one more
    attempt, with an instruction that states the rule the first draft broke.
    Each attempt spends one quota unit, the same as a member clicking
    Generate twice. Returns None when both attempts are rejected; raises 429
    up to the caller when quota runs out."""
    attempts = [(angle, None), ("pain_point", _ONE_ASK_INSTRUCTION)]
    if angle == "pain_point":
        attempts = [("pain_point", None), ("pain_point", _ONE_ASK_INSTRUCTION)]
    for attempt_angle, instruction in attempts:
        await reserve_generation(user_id, None)
        try:
            return await run_in_threadpool(
                generate_email,
                contact_name=contact.get("name"),
                contact_title=contact.get("title"),
                company_name=contact.get("company"),
                company_domain=normalize_domain(contact.get("company_domain") or ""),
                tone="professional",
                length="short",
                angle=attempt_angle,
                custom_instructions=instruction,
                value_proposition=None,
                model=None,
                evidence=evidence,
            )
        except HTTPException as exc:
            if exc.status_code != 502:
                raise
    return None


async def _draft_all(flow: dict[str, Any], contact_ids: list[int], user_id: int, lease_token: str) -> tuple[int, int, bool]:
    """Generate one grounded draft per contact through the same path as
    Studio (evidence, quota, generated_emails row). Stops at the member's
    hourly quota and reports it instead of failing the flow. Returns
    (drafted, rejected, quota_hit)."""
    from app.services.contact_scraper import normalize_domain
    from app.services.generation_policy import draft_evidence, reserve_generation
    from app.services.ollama_email_service import generate_email
    from app.services.settings_service import get_member_setting

    angle = flow.get("angle") or "pain_point"
    drafted = 0
    rejected = 0
    quota_hit = False
    signature = await get_member_setting(user_id, "signature") or ""
    for idx, cid in enumerate(contact_ids):
        db = await get_db()
        try:
            already = await (await db.execute(
                "SELECT 1 FROM generated_emails WHERE contact_id=? AND user_id=? AND campaign_id IS NULL LIMIT 1",
                (cid, user_id),
            )).fetchone()
            if already:
                drafted += 1
                continue
            contact = await (await db.execute("SELECT * FROM contacts WHERE id=?", (cid,))).fetchone()
            if not contact:
                continue
            contact = dict(contact)
            evidence = await draft_evidence(db, contact, user_id)
            try:
                result = await _generate_with_retry(
                    generate_email, contact=contact, angle=angle, evidence=evidence,
                    user_id=user_id, reserve_generation=reserve_generation, normalize_domain=normalize_domain,
                )
            except HTTPException as exc:
                if exc.status_code == 429:
                    quota_hit = True
                    break
                raise
            if result is None:
                rejected += 1
                logger.info("flow %s: draft for contact %s rejected twice by the draft validator", flow["id"], cid)
                continue
            subject, body = result
            await db.execute(
                """INSERT INTO generated_emails (user_id, contact_id, subject, body, signature, evidence_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (user_id, cid, subject, body, signature, json.dumps(evidence)),
            )
            await db.commit()
            drafted += 1
        except HTTPException as exc:
            # A recipient this member may not draft for (delivery policy) is
            # skipped, not fatal.
            logger.info("flow %s skipped contact %s: %s", flow["id"], cid, exc.detail)
        finally:
            await db.close()
        if idx % 3 == 0:
            if not await _update(int(flow["id"]), lease_token, drafted_count=drafted,
                                 progress_message=f"Drafting {drafted}/{len(contact_ids)}…"):
                return drafted, rejected, quota_hit
        await asyncio.sleep(0)
    return drafted, rejected, quota_hit


async def _attach_to_campaign(campaign_id: int, contact_ids: list[int], user_id: int) -> None:
    """Same rule as POST /campaigns/{id}/contacts: the member's latest
    unattached draft fills subject/body and is bound to the campaign."""
    db = await get_db()
    try:
        from app.services.dispatch_service import begin_write
        await begin_write(db)
        for cid in contact_ids:
            exists = await (await db.execute(
                "SELECT 1 FROM campaign_contacts WHERE campaign_id=? AND contact_id=? LIMIT 1",
                (campaign_id, cid),
            )).fetchone()
            if exists:
                continue
            draft = await (await db.execute(
                """SELECT id, subject, body FROM generated_emails
                   WHERE contact_id=? AND user_id=? AND campaign_id IS NULL ORDER BY id DESC LIMIT 1""",
                (cid, user_id),
            )).fetchone()
            subj = (draft["subject"] or "") if draft else ""
            body = (draft["body"] or "") if draft else ""
            await db.execute(
                """INSERT INTO campaign_contacts (campaign_id, contact_id, email_subject, email_body, status)
                   VALUES (?, ?, ?, ?, 'pending')""",
                (campaign_id, cid, subj, body),
            )
            if draft:
                await db.execute("UPDATE generated_emails SET campaign_id=? WHERE id=?", (campaign_id, draft["id"]))
        await db.commit()
    finally:
        await db.close()
