"""
Follow-up sequence job: send due follow-up emails for campaigns that have a sequence attached.
Run daily (e.g. via APScheduler or cron). Uses the sequence owner's Gmail to send.
"""
from datetime import datetime, timezone
from app.database import get_db


async def run_follow_up_sequences() -> dict:
    """
    Find campaign_contacts where the next sequence step is due and send it.
    Returns {"sent": count, "errors": [...]}.
    """
    from app.services.gmail_api import send_via_gmail_api_with_tracking
    from app.services.settings_service import get_setting

    db = await get_db()
    try:
        # Campaigns with a sequence attached
        cursor = await db.execute(
            "SELECT id, sequence_id FROM campaigns WHERE sequence_id IS NOT NULL AND status = 'sent'"
        )
        campaigns = await cursor.fetchall()
        if not campaigns:
            return {"sent": 0, "errors": []}

        today = datetime.now(timezone.utc).date()
        sent = 0
        errors = []

        for camp in campaigns:
            cid = camp["id"]
            seq_id = camp["sequence_id"]
            # Load steps ordered by step_order, days_after
            cursor = await db.execute(
                "SELECT id, days_after, subject, body FROM follow_up_steps WHERE sequence_id = ? ORDER BY step_order, days_after",
                (seq_id,),
            )
            steps = await cursor.fetchall()
            if not steps:
                continue

            # Sequence owner (for Gmail)
            cursor = await db.execute(
                "SELECT user_id FROM follow_up_sequences WHERE id = ?", (seq_id,)
            )
            seq_row = await cursor.fetchone()
            if not seq_row:
                continue
            sender_user_id = seq_row["user_id"]
            if not sender_user_id:
                continue

            signature = await get_setting("signature") or ""
            signature_image_url = await get_setting("signature_image_url") or None

            # Campaign contacts that are sent and have a next step due
            cursor = await db.execute(
                """SELECT cc.id, cc.contact_id, cc.sequence_step_sent, cc.last_sequence_sent_at
                   FROM campaign_contacts cc
                   JOIN contacts c ON c.id = cc.contact_id
                   WHERE cc.campaign_id = ? AND cc.status = 'sent'
                     AND cc.sequence_step_sent < ?
                     AND cc.last_sequence_sent_at IS NOT NULL""",
                (cid, len(steps)),
            )
            contacts = await cursor.fetchall()

            for cc in contacts:
                step_idx = cc["sequence_step_sent"]
                step = steps[step_idx]
                days_after = step["days_after"] or 0
                last_sent = cc["last_sequence_sent_at"]
                if last_sent is None:
                    continue
                # Parse last_sequence_sent_at (e.g. "2025-03-10 12:00:00")
                try:
                    if hasattr(last_sent, "date"):
                        last_date = last_sent.date() if hasattr(last_sent, "date") else last_sent
                    else:
                        last_date = datetime.fromisoformat(str(last_sent).replace("Z", "+00:00")).date()
                except Exception:
                    continue
                from datetime import timedelta
                due_date = last_date + timedelta(days=days_after)
                if due_date > today:
                    continue

                # Get contact email
                cursor = await db.execute(
                    "SELECT email FROM contacts WHERE id = ?", (cc["contact_id"],)
                )
                contact_row = await cursor.fetchone()
                if not contact_row:
                    continue
                to_email = contact_row["email"]
                subject = step["subject"] or "Following up"
                body = step["body"] or ""

                try:
                    await send_via_gmail_api_with_tracking(
                        user_id=sender_user_id,
                        to_email=to_email,
                        subject=subject,
                        body=body,
                        campaign_contact_id=cc["id"],
                        signature=signature,
                        signature_image_url=signature_image_url,
                    )
                    await db.execute(
                        """UPDATE campaign_contacts SET sequence_step_sent = ?, last_sequence_sent_at = CURRENT_TIMESTAMP
                           WHERE id = ?""",
                        (step_idx + 1, cc["id"]),
                    )
                    await db.commit()
                    sent += 1
                except Exception as e:
                    errors.append({"campaign_contact_id": cc["id"], "error": str(e)})

        return {"sent": sent, "errors": errors}
    finally:
        await db.close()
