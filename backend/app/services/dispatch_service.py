"""Durable outbound intent. A claimed send is never automatically retried.

Gmail has no idempotent send key: a timeout or process death can follow acceptance.
Such work stays claimed/ambiguous for reconciliation, avoiding duplicate delivery.
"""
import os

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
    daily_limit = max(1, int(os.getenv("CAMPAIGN_DAILY_SEND_LIMIT", "100") or 100))
    used = await (await db.execute(
        """SELECT COUNT(*) AS n FROM outreach_dispatches
           WHERE sender_user_id=? AND claimed_at IS NOT NULL
             AND date(claimed_at)=date('now')""",
        (sender,),
    )).fetchone()
    if int(used["n"] or 0) >= daily_limit:
        return None
    cursor = await db.execute(
        """UPDATE outreach_dispatches SET state='claimed', claimed_at=CURRENT_TIMESTAMP
        WHERE dispatch_key=? AND sender_user_id=? AND state='ready' RETURNING *""",
        (key, sender),
    )
    return await cursor.fetchone()


async def finish(db, key, meta=None, error=None, *, safe_to_retry=False):
    await db.execute(
        """UPDATE outreach_dispatches SET state=?,
        completed_at=CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END,
        gmail_message_id=?,last_error=?,claimed_at=CASE WHEN ? THEN NULL ELSE claimed_at END
        WHERE dispatch_key=? AND state='claimed'""",
        ("ready" if safe_to_retry else "ambiguous" if error else "sent", bool(safe_to_retry), (meta or {}).get("message_id"),
         str(error)[:1000] if error else None, bool(safe_to_retry), key),
    )
