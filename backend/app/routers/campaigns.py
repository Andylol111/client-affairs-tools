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

router = APIRouter()


@router.get("")
async def list_campaigns():
    """List all campaigns."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT c.*, c.sequence_id,
               (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id) as contact_count,
               (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND status = 'sent') as sent_count
               FROM campaigns c ORDER BY created_at DESC"""
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("")
async def create_campaign(campaign: CampaignCreate, user: dict | None = Depends(get_current_user_optional)):
    """Create a new campaign."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO campaigns (name, status) VALUES (?, 'draft')",
            (campaign.name,),
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
async def get_campaign(campaign_id: int):
    """Get campaign with contacts."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))
        campaign = await cursor.fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        cursor = await db.execute(
            """SELECT cc.*, c.name, c.email, c.title, c.company 
               FROM campaign_contacts cc 
               JOIN contacts c ON cc.contact_id = c.id 
               WHERE cc.campaign_id = ?""",
            (campaign_id,),
        )
        contacts = await cursor.fetchall()
        return {
            **dict(campaign),
            "contacts": [dict(r) for r in contacts],
        }
    finally:
        await db.close()


@router.post("/{campaign_id}/contacts")
async def add_contacts_to_campaign(
    campaign_id: int,
    payload: CampaignContactAdd,
    user: dict | None = Depends(get_current_user_optional),
):
    """Add contacts to a mail campaign. Latest unattached Studio draft fills empty subject/body."""
    db = await get_db()
    try:
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


async def _claim_pending_rows(db, campaign_id: int, limit: int) -> list:
    """Mark up to `limit` pending rows sending under one write lock so two ticks cannot Gmail the same row."""
    from app.database import is_postgres, row_to_dict

    if is_postgres():
        cur = await db.execute(
            """UPDATE campaign_contacts SET status = 'sending'
               WHERE id IN (
                   SELECT id FROM campaign_contacts
                   WHERE campaign_id = ? AND status = 'pending'
                   ORDER BY id LIMIT ?
               )
               RETURNING id""",
            (campaign_id, limit),
        )
        ids = [int(row_to_dict(r)["id"]) for r in await cur.fetchall()]
    else:
        await db.execute("BEGIN IMMEDIATE")
        cur = await db.execute(
            """SELECT id FROM campaign_contacts
               WHERE campaign_id = ? AND status = 'pending'
               ORDER BY id LIMIT ?""",
            (campaign_id, limit),
        )
        ids = [int(row_to_dict(r)["id"]) for r in await cur.fetchall()]
        if ids:
            marks = ",".join("?" * len(ids))
            await db.execute(
                f"UPDATE campaign_contacts SET status = 'sending' WHERE id IN ({marks}) AND status = 'pending'",
                tuple(ids),
            )
        await db.commit()
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    cur = await db.execute(
        f"""SELECT cc.*, c.email FROM campaign_contacts cc
            JOIN contacts c ON cc.contact_id = c.id
            WHERE cc.id IN ({marks}) AND cc.status = 'sending'""",
        tuple(ids),
    )
    return await cur.fetchall()


async def drain_campaign(campaign_id: int, user_id: int, limit: int = 5) -> dict:
    """Send up to `limit` pending rows. EventBridge/local ticks call this; the HTTP request must not send the whole list."""
    from app.services.gmail_api import send_via_gmail_api_with_tracking
    from app.services.settings_service import get_setting

    db = await get_db()
    try:
        pending = await _claim_pending_rows(db, campaign_id, limit)
        signature = await get_setting("signature")
        signature_image_url = await get_setting("signature_image_url") or None
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
                    signature=signature,
                    signature_image_url=signature_image_url,
                )
                tid = send_meta.get("thread_id")
                mid = send_meta.get("message_id")
                await db.execute(
                    """UPDATE campaign_contacts SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
                       last_sequence_sent_at = CURRENT_TIMESTAMP,
                       sent_by_user_id = ?,
                       gmail_thread_id = COALESCE(?, gmail_thread_id),
                       gmail_message_id = COALESCE(?, gmail_message_id)
                       WHERE id = ?""",
                    (user_id, tid, mid, row["id"]),
                )
                sent += 1
                if send_delay > 0:
                    await asyncio.sleep(send_delay)
            except Exception as e:
                await db.execute(
                    "UPDATE campaign_contacts SET status = 'pending' WHERE id = ? AND status = 'sending'",
                    (row["id"],),
                )
                errors.append({"contact_id": row["contact_id"], "error": str(e)})

        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM campaign_contacts WHERE campaign_id = ? AND status = 'pending'",
            (campaign_id,),
        )
        left = int((await cur.fetchone())["n"] or 0)
        status = "releasing" if left else "sent"
        await db.execute(
            "UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, campaign_id),
        )
        await db.commit()
        return {"ok": True, "sent": sent, "errors": errors, "pending_left": left, "status": status}
    finally:
        await db.close()


@router.post("/{campaign_id}/release")
async def release_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Flip ready → releasing. Returns immediately. Drain ticks send the mail."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE campaigns SET status = 'releasing', released_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (user["id"], campaign_id),
        )
        await db.commit()
        return {"ok": True, "status": "releasing"}
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
            "SELECT id, released_by FROM campaigns WHERE status = 'releasing'"
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
    campaign_id: int, cc_id: int, subject: str | None = None, body: str | None = None
):
    """Update email subject/body for a campaign contact."""
    db = await get_db()
    try:
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
