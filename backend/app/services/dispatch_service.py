"""Durable outbound intent. A claimed send is never automatically retried.

Gmail has no idempotent send key: a timeout or process death can follow acceptance.
Such work stays claimed/ambiguous for reconciliation, avoiding duplicate delivery.
"""
from fastapi import HTTPException
from app.database import is_postgres


async def begin_write(db):
    if is_postgres():
        raise HTTPException(503, "Outbound dispatch requires a verified transactional database adapter")
    await db.execute("BEGIN IMMEDIATE")


async def snapshot(db, key, cc_id, sender, recipient, subject, body, signature="", image=None, delay_days=0):
    cursor = await db.execute(
        """INSERT INTO outreach_dispatches
        (dispatch_key,campaign_contact_id,sender_user_id,recipient,subject,body,signature,signature_image_url,delay_days)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dispatch_key) DO NOTHING""",
        (key, cc_id, sender, recipient, subject, body, signature or "", image, delay_days),
    )
    return cursor.rowcount == 1


async def claim(db, key, sender):
    """Caller holds write transaction; conditional update is durable before send."""
    cursor = await db.execute(
        """UPDATE outreach_dispatches SET state='claimed', claimed_at=CURRENT_TIMESTAMP
        WHERE dispatch_key=? AND sender_user_id=? AND state='ready' RETURNING *""",
        (key, sender),
    )
    return await cursor.fetchone()


async def finish(db, key, meta=None, error=None):
    await db.execute(
        """UPDATE outreach_dispatches SET state=?,completed_at=CURRENT_TIMESTAMP,
        gmail_message_id=?,last_error=? WHERE dispatch_key=? AND state='claimed'""",
        ("ambiguous" if error else "sent", (meta or {}).get("message_id"),
         str(error)[:1000] if error else None, key),
    )
