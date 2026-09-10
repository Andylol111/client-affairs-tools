"""
Campaigns API - Campaign Manager & Mass Sender
"""
import asyncio
import os

from fastapi import APIRouter, HTTPException, Depends
from app.database import get_db
from app.auth_deps import get_current_user, get_current_user_optional
from app.services.audit_service import log_audit
from app.services.usage_service import log_event
from pydantic import BaseModel
from app.models import CampaignCreate, CampaignContactAdd


class CampaignUpdate(BaseModel):
    sequence_id: int | None = None


class OwnershipConfirmation(BaseModel):
    sender_user_id: int
    confirmed: bool = False
    reason: str


class DispatchRecoveryRequest(BaseModel):
    dispatch_key: str

router = APIRouter()


@router.get("/{campaign_id}/dispatches")
async def list_dispatches(campaign_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        await require_campaign_owner(db,campaign_id,user['id'])
        rows = await (await db.execute('''SELECT d.dispatch_key,d.campaign_contact_id,d.sender_user_id,
            d.recipient,d.state,d.claimed_at,d.completed_at,
            CASE WHEN d.state IN ('claimed','ambiguous') THEN 'Delivery requires reconciliation' ELSE NULL END AS last_error
            FROM outreach_dispatches d
            JOIN campaign_contacts cc ON cc.id=d.campaign_contact_id WHERE cc.campaign_id=?
            ORDER BY d.campaign_contact_id,d.dispatch_key''',(campaign_id,))).fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


@router.post("/{campaign_id}/dispatches/reconcile")
async def reconcile_dispatch(campaign_id: int, payload: DispatchRecoveryRequest, user: dict = Depends(get_current_user)):
    from app.services.dispatch_recovery import recover_dispatch
    return await recover_dispatch(campaign_id,payload.dispatch_key,user['id'])


@router.get("/{campaign_id}/ownership-evidence")
async def ownership_evidence(campaign_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        admin = await (await db.execute("SELECT role FROM users WHERE id=? AND is_active=1", (user["id"],))).fetchone()
        if not admin or admin["role"] != "admin":
            raise HTTPException(403, "Administrator required")
        campaign = await (await db.execute("SELECT id,owner_user_id,sender_user_id FROM campaigns WHERE id=?", (campaign_id,))).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        rows = await (await db.execute(
            """SELECT DISTINCT sender_id FROM outreach_messages WHERE sent_at IS NOT NULL
            AND campaign_contact_id IN (SELECT id FROM campaign_contacts WHERE campaign_id=?)
            UNION SELECT DISTINCT sent_by_user_id FROM campaign_contacts WHERE campaign_id=? AND sent_by_user_id IS NOT NULL""",
            (campaign_id, campaign_id),
        )).fetchall()
        return {"campaign": dict(campaign), "historical_sender_ids": [r[0] for r in rows], "requires_explicit_confirmation": True}
    finally:
        await db.close()


@router.post("/{campaign_id}/reconcile-owner")
async def reconcile_owner(campaign_id: int, payload: OwnershipConfirmation, user: dict = Depends(get_current_user)):
    """Assign only unowned legacy campaigns, never rewrite historical message facts."""
    if not payload.confirmed or len(payload.reason.strip()) < 10:
        raise HTTPException(422, "Explicit confirmation and a meaningful evidence reason are required")
    from app.services.dispatch_service import begin_write
    db = await get_db()
    try:
        await begin_write(db)
        admin = await (await db.execute("SELECT role FROM users WHERE id=? AND is_active=1", (user["id"],))).fetchone()
        if not admin or admin["role"] != "admin":
            raise HTTPException(403, "Administrator required")
        campaign = await (await db.execute("SELECT * FROM campaigns WHERE id=?", (campaign_id,))).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        if campaign["owner_user_id"] or campaign["sender_user_id"]:
            raise HTTPException(409, "Existing ownership cannot be reassigned through reconciliation")
        active = await (await db.execute("SELECT id FROM users WHERE id=? AND is_active=1", (payload.sender_user_id,))).fetchone()
        if not active:
            raise HTTPException(409, "Selected sender is inactive or missing")
        conflict = await (await db.execute(
            """SELECT 1 FROM campaign_contacts cc WHERE cc.campaign_id=? AND
            (cc.status='sending' OR (cc.sent_by_user_id IS NOT NULL AND cc.sent_by_user_id<>?) OR EXISTS
            (SELECT 1 FROM outreach_messages m WHERE m.campaign_contact_id=cc.id AND m.sender_id<>? AND m.sent_at IS NOT NULL)) LIMIT 1""",
            (campaign_id, payload.sender_user_id, payload.sender_user_id),
        )).fetchone()
        if conflict:
            raise HTTPException(409, "Conflicting sender evidence or in-flight work requires manual review")
        await db.execute("UPDATE campaigns SET owner_user_id=?,sender_user_id=?,status=CASE WHEN status='releasing' THEN 'paused' ELSE status END WHERE id=?", (payload.sender_user_id,payload.sender_user_id,campaign_id))
        # Audit in the same transaction; failure must prevent reassignment.
        await db.execute("INSERT INTO audit_log(user_id,action,resource_type,resource_id,details) VALUES (?,?,?,?,?)", (user["id"],"campaign_owner_reconcile","campaign",str(campaign_id),payload.reason.strip()))
        await db.commit()
        return {"ok": True, "sender_user_id": payload.sender_user_id}
    finally:
        await db.close()

async def require_campaign_owner(db, campaign_id: int, user_id: int):
    row = await (await db.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))).fetchone()
    if not row:
        raise HTTPException(404, "Campaign not found")
    if row["owner_user_id"] != user_id or row["sender_user_id"] != user_id:
        raise HTTPException(403, "Campaign sender ownership is required; legacy campaigns need reconciliation")
    active = await (await db.execute("SELECT is_active FROM users WHERE id = ?", (user_id,))).fetchone()
    if not active or not active["is_active"]:
        raise HTTPException(403, "Sender account is inactive")
    return row


async def _campaign_readiness(db, campaign_id: int) -> dict:
    campaign = await (await db.execute(
        "SELECT id, status FROM campaigns WHERE id = ?", (campaign_id,)
    )).fetchone()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    counts = {
        row["status"]: int(row["count"])
        for row in await (await db.execute(
            """SELECT status, COUNT(*) AS count FROM campaign_contacts
               WHERE campaign_id = ? GROUP BY status""",
            (campaign_id,),
        )).fetchall()
    }
    total = sum(counts.values())
    incomplete = int((await (await db.execute(
        """SELECT COUNT(*) AS count
           FROM campaign_contacts cc JOIN contacts c ON c.id = cc.contact_id
           LEFT JOIN outreach_dispatches d ON d.dispatch_key = 'initial:' || cc.id
           WHERE cc.campaign_id = ? AND cc.status IN ('pending', 'sending', 'failed')
             AND (trim(COALESCE(d.recipient, c.email, '')) = ''
                  OR instr(COALESCE(d.recipient,c.email), '@') = 0
                  OR trim(COALESCE(d.subject,cc.email_subject, '')) = ''
                  OR trim(COALESCE(d.body,cc.email_body, '')) = '')""",
        (campaign_id,),
    )).fetchone())["count"])
    from app.services.mail_address import validate_recipient
    recipient_rows = await (await db.execute(
        """SELECT COALESCE(d.recipient,c.email) AS email FROM campaign_contacts cc
        JOIN contacts c ON c.id=cc.contact_id
        LEFT JOIN outreach_dispatches d ON d.dispatch_key='initial:' || cc.id
        WHERE cc.campaign_id=? AND cc.status IN ('pending','sending','failed')""",(campaign_id,),
    )).fetchall()
    invalid_recipients = 0
    for row in recipient_rows:
        try:
            validate_recipient(row['email'])
        except ValueError:
            invalid_recipients += 1
    issues = []
    if invalid_recipients:
        issues.append(f"Use one valid bare email address for each of {invalid_recipients} recipient(s).")
    if total == 0:
        issues.append("Add at least one recipient.")
    if incomplete:
        issues.append(f"Complete the email address, subject, and body for {incomplete} recipient(s).")
    if counts.get("failed", 0):
        issues.append(f"Retry or remove {counts['failed']} failed recipient(s).")
    return {
        "ready": not issues,
        "issues": issues,
        "counts": counts,
        "total": total,
        "status": campaign["status"],
    }




@router.get("")
async def list_campaigns():
    """List all campaigns."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT c.*,
               (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id) AS contact_count,
               (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND status = 'sent') AS sent_count,
               (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND status = 'pending') AS pending_count,
               (SELECT COUNT(*) FROM outreach_dispatches d JOIN campaign_contacts cc ON cc.id=d.campaign_contact_id
                  WHERE cc.campaign_id=c.id AND d.dispatch_key='initial:' || cc.id AND d.state='ready') AS queued_count,
               (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND status = 'sending') AS sending_count,
               (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND status = 'failed') AS failed_count
               FROM campaigns c ORDER BY created_at DESC"""
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("")
async def create_campaign(campaign: CampaignCreate, user: dict = Depends(get_current_user)):
    """Create a new campaign."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO campaigns (name, status, owner_user_id, sender_user_id) VALUES (?, 'draft', ?, ?)",
            (campaign.name, user["id"], user["id"]),
        )
        await db.commit()
        row_id = cursor.lastrowid
        if user:
            await log_event(user["id"], "campaign_created", "campaign", {"campaign_id": row_id, "name": campaign.name})
        cursor = await db.execute("SELECT * FROM campaigns WHERE id = ?", (row_id,))
        row = await cursor.fetchone()
        return dict(row)
    finally:
        await db.close()


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Get campaign with contacts."""
    db = await get_db()
    try:
        await require_campaign_owner(db, campaign_id, user["id"])
        cursor = await db.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))
        campaign = await cursor.fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        cursor = await db.execute(
            """SELECT cc.*, c.name, COALESCE(d.recipient,c.email) AS email, c.title, c.company
               FROM campaign_contacts cc 
               JOIN contacts c ON cc.contact_id = c.id
               LEFT JOIN outreach_dispatches d ON d.dispatch_key = 'initial:' || cc.id
               WHERE cc.campaign_id = ?""",
            (campaign_id,),
        )
        contacts = await cursor.fetchall()
        messages = await (await db.execute(
            """SELECT m.id, m.campaign_contact_id, m.sent_at FROM outreach_messages m
               JOIN campaign_contacts cc ON cc.id = m.campaign_contact_id
               WHERE cc.campaign_id = ? ORDER BY m.id""", (campaign_id,),
        )).fetchall()
        events = await (await db.execute(
            """SELECT e.message_id, e.kind, e.occurred_at, e.detail FROM outreach_events e
               JOIN outreach_messages m ON m.id = e.message_id
               JOIN campaign_contacts cc ON cc.id = m.campaign_contact_id
               WHERE cc.campaign_id = ? ORDER BY e.occurred_at""", (campaign_id,),
        )).fetchall()
        readiness = await _campaign_readiness(db, campaign_id)
        return {
            **dict(campaign),
            "counts": readiness["counts"],
            "readiness": {"ready": readiness["ready"], "issues": readiness["issues"]},
            "contacts": [{**dict(r), "messages": [
                {**dict(m), "events": [dict(e) for e in events if e["message_id"] == m["id"]]}
                for m in messages if m["campaign_contact_id"] == r["id"]
            ]} for r in contacts],
        }
    finally:
        await db.close()


@router.post("/{campaign_id}/contacts")
async def add_contacts_to_campaign(
    campaign_id: int,
    payload: CampaignContactAdd,
    user: dict = Depends(get_current_user),
):
    """Add contacts to a mail campaign. Latest unattached Studio draft fills empty subject/body."""
    db = await get_db()
    try:
        from app.services.dispatch_service import begin_write
        await begin_write(db)
        campaign_state = await require_campaign_owner(db, campaign_id, user["id"])
        frozen = await (await db.execute(
            """SELECT 1 FROM outreach_dispatches d JOIN campaign_contacts cc ON cc.id=d.campaign_contact_id
            WHERE cc.campaign_id=? LIMIT 1""", (campaign_id,),
        )).fetchone()
        if frozen:
            raise HTTPException(409, "Released content is immutable; create a new campaign for changes")
        if campaign_state["status"] not in {"draft", "paused", "needs_attention"}:
            raise HTTPException(409, "Pause the campaign before changing its contents")
        in_flight = await (await db.execute("SELECT 1 FROM campaign_contacts WHERE campaign_id=? AND status='sending' LIMIT 1", (campaign_id,))).fetchone()
        if in_flight:
            raise HTTPException(409, "Wait for in-flight sends to finish")
        cursor = await db.execute("SELECT id FROM campaigns WHERE id = ?", (campaign_id,))
        if not await cursor.fetchone():
            raise HTTPException(404, "Campaign not found")

        subjects = payload.email_subjects or {}
        bodies = payload.email_bodies or {}
        attached = 0

        for cid in payload.contact_ids:
            subj = subjects.get(str(cid), "")
            body = bodies.get(str(cid), "")
            draft_id = None
            if user and (not subj or not body):
                cur = await db.execute(
                    """SELECT id, subject, body FROM generated_emails
                       WHERE contact_id = ? AND user_id = ? AND campaign_id IS NULL
                       ORDER BY id DESC LIMIT 1""",
                    (cid, user["id"]),
                )
                draft = await cur.fetchone()
                if draft:
                    draft_id = draft["id"]
                    subj = subj or (draft["subject"] or "")
                    body = body or (draft["body"] or "")
            await db.execute(
                """INSERT OR IGNORE INTO campaign_contacts
                   (campaign_id, contact_id, email_subject, email_body, status)
                   VALUES (?, ?, ?, ?, 'pending')""",
                (campaign_id, cid, subj, body),
            )
            if draft_id:
                await db.execute(
                    "UPDATE generated_emails SET campaign_id = ? WHERE id = ?",
                    (campaign_id, draft_id),
                )
                attached += 1
        await db.commit()
        return {"ok": True, "added": len(payload.contact_ids), "drafts_attached": attached}
    finally:
        await db.close()


async def _claim_pending_rows(db, campaign_id: int, limit: int, user_id=None) -> list:
    """Atomically recheck sender and campaign state, then claim immutable intent."""
    from app.services.dispatch_service import begin_write, claim
    await begin_write(db)
    try:
        campaign = await (await db.execute("SELECT * FROM campaigns WHERE id=?", (campaign_id,))).fetchone()
        sender = user_id if user_id is not None else campaign["sender_user_id"]
        await require_campaign_owner(db, campaign_id, sender)
        if campaign["status"] != "releasing":
            await db.commit()
            return []
        rows = await (await db.execute(
            "SELECT * FROM campaign_contacts WHERE campaign_id=? AND status='pending' ORDER BY id LIMIT ?",
            (campaign_id, limit),
        )).fetchall()
        claimed = []
        for row in rows:
            intent = await claim(db, f"initial:{row['id']}", sender)
            if not intent:
                # Legacy unsnapshotted queues must be explicitly released again.
                await db.execute("UPDATE campaign_contacts SET status='failed',last_error=? WHERE id=?",
                                 ("Missing or already claimed dispatch; reconciliation required", row["id"]))
                continue
            await db.execute("UPDATE campaign_contacts SET status='sending' WHERE id=?", (row["id"],))
            item = dict(row)
            item.update(email=intent["recipient"], email_subject=intent["subject"], email_body=intent["body"],
                        signature=intent["signature"], signature_image_url=intent["signature_image_url"])
            claimed.append(item)
        await db.commit()
        return claimed
    except Exception:
        await db.rollback()
        raise


async def drain_campaign(campaign_id: int, user_id: int, limit: int = 5) -> dict:
    """Send up to `limit` pending rows. EventBridge/local ticks call this; the HTTP request must not send the whole list."""
    from app.services.gmail_api import send_via_gmail_api_with_tracking
    from app.services.settings_service import get_member_setting

    db = await get_db()
    try:
        await require_campaign_owner(db, campaign_id, user_id)
        campaign = await (await db.execute(
            "SELECT status FROM campaigns WHERE id = ?", (campaign_id,)
        )).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        if campaign["status"] != "releasing":
            raise HTTPException(409, "Campaign must be released before it can send")
        pending = await _claim_pending_rows(db, campaign_id, limit, user_id)
        signature = await get_member_setting(user_id, "signature")
        signature_image_url = await get_member_setting(user_id, "signature_image_url") or None
        send_delay = float(os.getenv("CAMPAIGN_SEND_DELAY_SEC", "2.0") or 0)
        sent = 0
        errors = []
        for row in pending:
            try:
                send_meta = await send_via_gmail_api_with_tracking(
                    user_id=user_id,
                    to_email=row["email"],
                    subject=row["email_subject"] or "Quick question",
                    body=row["email_body"] or "",
                    campaign_contact_id=row["id"],
                    signature=row["signature"],
                    signature_image_url=row["signature_image_url"],
                    dispatch_key=f"initial:{row['id']}",
                )
                tid = send_meta.get("thread_id")
                mid = send_meta.get("message_id")
                await db.execute(
                    """UPDATE campaign_contacts SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
                       last_sequence_sent_at = CURRENT_TIMESTAMP,
                       sent_by_user_id = ?,
                       gmail_thread_id = COALESCE(?, gmail_thread_id),
                       gmail_message_id = COALESCE(?, gmail_message_id),
                       last_error = NULL
                       WHERE id = ?""",
                    (user_id, tid, mid, row["id"]),
                )
                from app.services.dispatch_service import finish
                await finish(db, f"initial:{row['id']}", send_meta)
                sent += 1
                await db.commit()
                if send_delay > 0:
                    await asyncio.sleep(send_delay)
            except Exception as e:
                from app.services.dispatch_service import finish
                await finish(db, f"initial:{row['id']}", error=e)
                await db.execute(
                    """UPDATE campaign_contacts SET status = 'failed', last_error = ?
                       WHERE id = ? AND status = 'sending'""",
                    (str(e)[:1000], row["id"]),
                )
                errors.append({"contact_id": row["contact_id"], "error": str(e)})
                await db.commit()

        state_rows = await (await db.execute(
            """SELECT status, COUNT(*) AS count FROM campaign_contacts
               WHERE campaign_id = ? GROUP BY status""",
            (campaign_id,),
        )).fetchall()
        counts = {row["status"]: int(row["count"]) for row in state_rows}
        left = counts.get("pending", 0)
        sending = counts.get("sending", 0)
        failed = counts.get("failed", 0)
        status = "releasing" if left or sending else "needs_attention" if failed else "sent"
        await db.execute(
            "UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'releasing'",
            (status, campaign_id),
        )
        await db.commit()
        return {
            "ok": True,
            "sent": sent,
            "errors": errors,
            "pending_left": left,
            "failed": failed,
            "status": status,
        }
    finally:
        await db.close()


@router.post("/{campaign_id}/release")
async def release_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Validate and release a draft or paused campaign for scheduled draining."""
    from app.services.dispatch_service import begin_write, snapshot
    from app.services.settings_service import get_member_setting
    signature = await get_member_setting(user["id"], "signature") or ""
    image = await get_member_setting(user["id"], "signature_image_url") or None
    db = await get_db()
    try:
        await begin_write(db)
        await require_campaign_owner(db, campaign_id, user["id"])
        readiness = await _campaign_readiness(db, campaign_id)
        if readiness["status"] == "sent":
            raise HTTPException(409, "Campaign is already complete")
        if not readiness["ready"]:
            raise HTTPException(409, {"message": "Campaign is not ready", "issues": readiness["issues"]})
        rows = await (await db.execute(
            """SELECT cc.*,c.email FROM campaign_contacts cc JOIN contacts c ON c.id=cc.contact_id
            WHERE cc.campaign_id=? AND cc.status='pending'""", (campaign_id,),
        )).fetchall()
        newly_snapshotted = set()
        for row in rows:
            if await snapshot(db, f"initial:{row['id']}", row["id"], user["id"], row["email"],
                              row["email_subject"], row["email_body"], signature, image):
                newly_snapshotted.add(row['id'])
        sequence = await (await db.execute("SELECT sequence_id FROM campaigns WHERE id=?", (campaign_id,))).fetchone()
        steps = await (await db.execute(
            "SELECT * FROM follow_up_steps WHERE sequence_id=? ORDER BY step_order,days_after",
            (sequence["sequence_id"],),
        )).fetchall() if sequence["sequence_id"] and newly_snapshotted else []
        from app.services.mail_address import validate_header
        try:
            for row in rows:
                if row['id'] in newly_snapshotted:
                    validate_header(row['email_subject'] or '')
            for step in steps:
                validate_header(step['subject'] or '')
        except ValueError as exc:
            raise HTTPException(409,'Email subjects cannot contain control characters') from exc
        for row in rows:
            if row['id'] not in newly_snapshotted:
                continue
            for index, step in enumerate(steps):
                key = f"followup:{row['id']}:{index}"
                await snapshot(db, key, row["id"], user["id"], row["email"], step["subject"] or "Following up", step["body"] or "", signature, image, step["days_after"])
        await db.execute(
            "UPDATE campaigns SET status = 'releasing', released_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (user["id"], campaign_id),
        )
        await db.commit()
        return {"ok": True, "status": "releasing", "counts": readiness["counts"]}
    finally:
        await db.close()

@router.post("/{campaign_id}/pause")
async def pause_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Pause future claims; in-flight dispatches retain their durable state."""
    db = await get_db()
    try:
        from app.services.dispatch_service import begin_write
        await begin_write(db)
        await require_campaign_owner(db, campaign_id, user["id"])
        campaign = await (await db.execute(
            "SELECT status FROM campaigns WHERE id = ?", (campaign_id,)
        )).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        if campaign["status"] not in {"releasing", "needs_attention"}:
            raise HTTPException(409, "Only an active campaign can be paused")
        await db.execute(
            "UPDATE campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (campaign_id,),
        )
        await db.commit()
        await log_audit(user["id"], "campaign_pause", "campaign", str(campaign_id), "Paused campaign")
        return {"ok": True, "status": "paused"}
    finally:
        await db.close()


@router.post("/{campaign_id}/resume")
async def resume_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Revalidate and resume a paused campaign."""
    return await release_campaign(campaign_id, user)


@router.post("/{campaign_id}/retry-failed")
async def retry_failed_campaign_contacts(
    campaign_id: int,
    user: dict = Depends(get_current_user),
):
    """Move failed recipients back to pending without sending them in this request."""
    db = await get_db()
    try:
        from app.services.dispatch_service import begin_write
        await begin_write(db)
        await require_campaign_owner(db, campaign_id, user["id"])
        if not await (await db.execute(
            "SELECT id FROM campaigns WHERE id = ?", (campaign_id,)
        )).fetchone():
            raise HTTPException(404, "Campaign not found")
        cursor = await db.execute(
            """UPDATE campaign_contacts SET status = 'pending', last_error = NULL
               WHERE campaign_id = ? AND status = 'failed' AND NOT EXISTS (
                   SELECT 1 FROM outreach_dispatches d WHERE d.campaign_contact_id=campaign_contacts.id
                   AND d.state IN ('claimed','ambiguous','sent'))""",
            (campaign_id,),
        )
        retried = cursor.rowcount
        await db.execute(
            "UPDATE campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (campaign_id,),
        )
        await db.commit()
        await log_audit(user["id"], "campaign_retry_failed", "campaign", str(campaign_id), f"Retried {retried} recipients")
        return {"ok": True, "retried": retried, "status": "paused"}
    finally:
        await db.close()



@router.post("/{campaign_id}/send")
async def send_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """One drain tick (default 5). Does not send the entire campaign in this request."""
    limit = int(os.getenv("CAMPAIGN_DRAIN_LIMIT", "5") or 5)
    result = await drain_campaign(campaign_id, user["id"], limit=limit)
    await log_audit(user["id"], "campaign_send", "campaign", str(campaign_id), f"Drained {result['sent']} emails")
    await log_event(user["id"], "campaign_sent", "campaign", {"campaign_id": campaign_id, **result})
    return result


async def drain_releasing_campaigns(limit: int | None = None) -> dict:
    """Scheduled tick: drain every campaign left in releasing."""
    n = limit if limit is not None else int(os.getenv("CAMPAIGN_DRAIN_LIMIT", "5") or 5)
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, sender_user_id AS released_by FROM campaigns WHERE status = 'releasing'"
        )
        rows = await cur.fetchall()
    finally:
        await db.close()
    out = []
    for row in rows:
        uid = row["released_by"]
        if not uid:
            continue
        out.append(await drain_campaign(row["id"], int(uid), limit=n))
    return {"ok": True, "campaigns": len(out), "results": out}


@router.delete("/{campaign_id}")
async def delete_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Delete a campaign and its campaign_contacts."""
    db = await get_db()
    try:
        from app.services.dispatch_service import begin_write
        await begin_write(db)
        campaign_state = await require_campaign_owner(db, campaign_id, user["id"])
        frozen = await (await db.execute(
            """SELECT 1 FROM outreach_dispatches d JOIN campaign_contacts cc ON cc.id=d.campaign_contact_id
            WHERE cc.campaign_id=? LIMIT 1""", (campaign_id,),
        )).fetchone()
        if frozen:
            raise HTTPException(409, "Released content is immutable; create a new campaign for changes")
        if campaign_state["status"] not in {"draft", "paused", "needs_attention"}:
            raise HTTPException(409, "Pause the campaign before changing its contents")
        in_flight = await (await db.execute("SELECT 1 FROM campaign_contacts WHERE campaign_id=? AND status='sending' LIMIT 1", (campaign_id,))).fetchone()
        if in_flight:
            raise HTTPException(409, "Wait for in-flight sends to finish")
        cursor = await db.execute("SELECT id, status FROM campaigns WHERE id = ?", (campaign_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Campaign not found")
        await db.execute(
            "DELETE FROM email_events WHERE campaign_contact_id IN (SELECT id FROM campaign_contacts WHERE campaign_id = ?)",
            (campaign_id,),
        )
        await db.execute("DELETE FROM campaign_contacts WHERE campaign_id = ?", (campaign_id,))
        await db.execute("DELETE FROM campaigns WHERE id = ?", (campaign_id,))
        await db.commit()
        await log_audit(user["id"], "campaign_delete", "campaign", str(campaign_id), f"Deleted campaign {campaign_id}")
        return {"ok": True}
    finally:
        await db.close()


@router.patch("/{campaign_id}")
async def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    user: dict = Depends(get_current_user),
):
    """Update campaign (e.g. attach or clear a follow-up sequence)."""
    db = await get_db()
    try:
        from app.services.dispatch_service import begin_write
        await begin_write(db)
        campaign_state = await require_campaign_owner(db, campaign_id, user["id"])
        frozen = await (await db.execute(
            """SELECT 1 FROM outreach_dispatches d JOIN campaign_contacts cc ON cc.id=d.campaign_contact_id
            WHERE cc.campaign_id=? LIMIT 1""", (campaign_id,),
        )).fetchone()
        if frozen:
            raise HTTPException(409, "Released content is immutable; create a new campaign for changes")
        if campaign_state["status"] not in {"draft", "paused", "needs_attention"}:
            raise HTTPException(409, "Pause the campaign before changing its contents")
        in_flight = await (await db.execute("SELECT 1 FROM campaign_contacts WHERE campaign_id=? AND status='sending' LIMIT 1", (campaign_id,))).fetchone()
        if in_flight:
            raise HTTPException(409, "Wait for in-flight sends to finish")
        data = payload.model_dump(exclude_unset=True)
        if "sequence_id" in data:
            await db.execute(
                "UPDATE campaigns SET sequence_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (data["sequence_id"], campaign_id),
            )
            await db.commit()
        cursor = await db.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Campaign not found")
        return dict(row)
    finally:
        await db.close()


@router.patch("/{campaign_id}/contact/{cc_id}")
async def update_campaign_contact_email(
    campaign_id: int, cc_id: int, subject: str | None = None, body: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Update email subject/body for a campaign contact."""
    db = await get_db()
    try:
        from app.services.dispatch_service import begin_write
        await begin_write(db)
        campaign_state = await require_campaign_owner(db, campaign_id, user["id"])
        frozen = await (await db.execute(
            """SELECT 1 FROM outreach_dispatches d JOIN campaign_contacts cc ON cc.id=d.campaign_contact_id
            WHERE cc.campaign_id=? LIMIT 1""", (campaign_id,),
        )).fetchone()
        if frozen:
            raise HTTPException(409, "Released content is immutable; create a new campaign for changes")
        if campaign_state["status"] not in {"draft", "paused", "needs_attention"}:
            raise HTTPException(409, "Pause the campaign before changing its contents")
        in_flight = await (await db.execute("SELECT 1 FROM campaign_contacts WHERE campaign_id=? AND status='sending' LIMIT 1", (campaign_id,))).fetchone()
        if in_flight:
            raise HTTPException(409, "Wait for in-flight sends to finish")
        updates = []
        params = []
        if subject is not None:
            updates.append("email_subject = ?")
            params.append(subject)
        if body is not None:
            updates.append("email_body = ?")
            params.append(body)
        if not updates:
            raise HTTPException(400, "Provide subject or body")
        params.extend([campaign_id, cc_id])
        await db.execute(
            f"UPDATE campaign_contacts SET {', '.join(updates)} WHERE campaign_id = ? AND id = ?",
            params,
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()
