"""
Campaigns API - Campaign Manager & Mass Sender
"""
from fastapi import APIRouter, HTTPException, Depends
from app.database import get_db
from app.auth_deps import get_current_user, get_current_user_optional
from app.services.audit_service import log_audit
from app.services.usage_service import log_event
from app.models import CampaignCreate, CampaignContactAdd

router = APIRouter()


@router.get("")
async def list_campaigns():
    """List all campaigns."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT c.*, 
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
async def add_contacts_to_campaign(campaign_id: int, payload: CampaignContactAdd):
    """Add contacts to campaign with optional email content."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id FROM campaigns WHERE id = ?", (campaign_id,))
        if not await cursor.fetchone():
            raise HTTPException(404, "Campaign not found")

        subjects = payload.email_subjects or {}
        bodies = payload.email_bodies or {}

        for cid in payload.contact_ids:
            await db.execute(
                """INSERT OR IGNORE INTO campaign_contacts 
                   (campaign_id, contact_id, email_subject, email_body, status) 
                   VALUES (?, ?, ?, ?, 'pending')""",
                (
                    campaign_id,
                    cid,
                    subjects.get(str(cid), ""),
                    bodies.get(str(cid), ""),
                ),
            )
        await db.commit()
        return {"ok": True, "added": len(payload.contact_ids)}
    finally:
        await db.close()


@router.post("/{campaign_id}/send")
async def send_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Send campaign emails via Gmail API (OAuth). Uses logged-in user's account."""
    from app.services.gmail_api import send_via_gmail_api_with_tracking
    from app.services.settings_service import get_setting

    db = await get_db()
    try:
        await db.execute(
            "UPDATE campaigns SET status = 'sending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (campaign_id,),
        )
        await db.commit()

        cursor = await db.execute(
            """SELECT cc.*, c.email FROM campaign_contacts cc
               JOIN contacts c ON cc.contact_id = c.id
               WHERE cc.campaign_id = ? AND cc.status = 'pending'""",
            (campaign_id,),
        )
        pending = await cursor.fetchall()
        signature = await get_setting("signature")
        signature_image_url = await get_setting("signature_image_url") or None
        sent = 0
        errors = []
        for row in pending:
            try:
                await send_via_gmail_api_with_tracking(
                    user_id=user["id"],
                    to_email=row["email"],
                    subject=row["email_subject"] or "Quick question",
                    body=row["email_body"] or "",
                    campaign_contact_id=row["id"],
                    signature=signature,
                    signature_image_url=signature_image_url,
                )
                await db.execute(
                    "UPDATE campaign_contacts SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (row["id"],),
                )
                sent += 1
            except Exception as e:
                errors.append({"contact_id": row["contact_id"], "error": str(e)})

        await db.execute(
            "UPDATE campaigns SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (campaign_id,),
        )
        await db.commit()
        await log_audit(user["id"], "campaign_send", "campaign", str(campaign_id), f"Sent {sent} emails")
        await log_event(user["id"], "campaign_sent", "campaign", {"campaign_id": campaign_id, "sent": sent, "errors": len(errors)})
        return {"ok": True, "sent": sent, "errors": errors}
    finally:
        await db.close()


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
