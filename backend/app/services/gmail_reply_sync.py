"""
Detect replies in Gmail threads for mass-send / follow-up campaign contacts
and update replied_at + outreach pipeline. Requires gmail.readonly scope.
"""
from __future__ import annotations

import email.utils
from datetime import datetime, timezone
from typing import Any

import httpx

from app.database import get_db
from app.services.gmail_api import get_valid_access_token


def _parseaddr_email(header_val: str) -> str:
    if not header_val:
        return ""
    _, addr = email.utils.parseaddr(header_val)
    return (addr or "").strip().lower()


def _sent_at_to_ms(sent_at: Any) -> int:
    if sent_at is None:
        return 0
    if isinstance(sent_at, (int, float)):
        v = float(sent_at)
        return int(v * 1000) if v < 1e12 else int(v)
    try:
        s = str(sent_at).replace("Z", "+00:00")
        if " " in s and "+" not in s and "T" not in s:
            dt = datetime.strptime(s.split(".")[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def _headers_dict(msg: dict) -> dict[str, str]:
    headers: dict[str, str] = {}
    payload = msg.get("payload") or {}
    for h in payload.get("headers") or []:
        name = (h.get("name") or "").lower()
        if name:
            headers[name] = h.get("value") or ""
    return headers


async def _fetch_thread(access_token: str, thread_id: str) -> dict | None:
    params = [
        ("format", "metadata"),
        ("metadataHeaders", "From"),
        ("metadataHeaders", "To"),
        ("metadataHeaders", "Subject"),
        ("metadataHeaders", "Date"),
    ]
    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}",
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if r.status_code == 404:
            return None
        if r.status_code == 403:
            raise PermissionError(
                "Gmail denied thread access. Sign out and sign in again to grant inbox read (gmail.readonly)."
            )
        if r.status_code == 401:
            raise PermissionError("Gmail access expired. Sign out and sign in again.")
        if r.status_code >= 400:
            raise RuntimeError(f"Gmail thread error: {r.status_code} - {r.text}")
        return r.json()


def _thread_has_inbound_reply_from_contact(
    thread: dict,
    contact_email: str,
    owner_email: str,
    _stored_message_id: str | None,
    sent_at_ms: int,
) -> bool:
    contact_email = (contact_email or "").strip().lower()
    owner_email = (owner_email or "").strip().lower()
    if not contact_email or not thread:
        return False

    messages = list(thread.get("messages") or [])
    if not messages:
        return False

    def msg_time(m: dict) -> int:
        try:
            return int(m.get("internalDate") or 0)
        except (TypeError, ValueError):
            return 0

    messages.sort(key=msg_time)
    last_our_ms = -1
    for m in messages:
        hdr = _headers_dict(m)
        from_e = _parseaddr_email(hdr.get("from", ""))
        t = msg_time(m)
        if from_e == owner_email:
            last_our_ms = max(last_our_ms, t)

    if last_our_ms < 0:
        last_our_ms = max(0, sent_at_ms - 1)

    for m in messages:
        hdr = _headers_dict(m)
        from_e = _parseaddr_email(hdr.get("from", ""))
        if from_e != contact_email:
            continue
        if msg_time(m) > last_our_ms:
            return True
    return False


async def _mark_campaign_contact_replied(db, cc_id: int, contact_id: int) -> None:
    await db.execute(
        """UPDATE campaign_contacts SET replied_at = CURRENT_TIMESTAMP, status = 'replied' WHERE id = ?""",
        (cc_id,),
    )
    await db.execute(
        """UPDATE contacts SET pipeline_status = 'replied' WHERE id = ?
           AND (pipeline_status IS NULL OR pipeline_status NOT IN ('meeting', 'closed'))""",
        (contact_id,),
    )


async def apply_contacted_auto_sort(db, sent_by_user_id: int) -> int:
    """Move contacts from cold → contacted when this user sent mail but there's no reply yet."""
    cursor = await db.execute(
        """
        UPDATE contacts SET pipeline_status = 'contacted'
        WHERE (pipeline_status IS NULL OR pipeline_status = 'cold')
          AND id IN (
            SELECT DISTINCT cc.contact_id FROM campaign_contacts cc
            WHERE cc.status = 'sent' AND cc.replied_at IS NULL AND cc.sent_by_user_id = ?
          )
        """,
        (sent_by_user_id,),
    )
    await db.commit()
    return cursor.rowcount if cursor.rowcount is not None else 0


async def sync_replies_for_user(user_id: int, *, auto_sort_contacted: bool = True) -> dict[str, Any]:
    """
    Scan gmail threads for this user's sent campaign rows; mark replies and pipeline.
    """
    result = get_valid_access_token(user_id)
    if not result:
        return {
            "ok": False,
            "error": "no_gmail_token",
            "message": "No Gmail OAuth token. Sign in with Google.",
            "marked_replied": 0,
            "skipped": 0,
            "errors": [],
        }
    access_token, owner_email = result

    db = await get_db()
    marked = 0
    skipped = 0
    errors: list[dict] = []
    try:
        cursor = await db.execute(
            """
            SELECT cc.id, cc.contact_id, cc.gmail_thread_id, cc.gmail_message_id, cc.sent_at, c.email
            FROM campaign_contacts cc
            JOIN contacts c ON c.id = cc.contact_id
            WHERE cc.sent_by_user_id = ?
              AND cc.status = 'sent'
              AND cc.replied_at IS NULL
              AND cc.gmail_thread_id IS NOT NULL
            """,
            (user_id,),
        )
        rows = await cursor.fetchall()

        for row in rows:
            tid = row["gmail_thread_id"]
            if not tid:
                skipped += 1
                continue
            try:
                thread = await _fetch_thread(access_token, tid)
                if not thread:
                    skipped += 1
                    continue
                sent_ms = _sent_at_to_ms(row["sent_at"])
                if _thread_has_inbound_reply_from_contact(
                    thread,
                    row["email"] or "",
                    owner_email,
                    row["gmail_message_id"],
                    sent_ms,
                ):
                    await _mark_campaign_contact_replied(db, row["id"], row["contact_id"])
                    await db.commit()
                    marked += 1
                else:
                    skipped += 1
            except PermissionError as e:
                errors.append({"campaign_contact_id": row["id"], "error": str(e)})
                break
            except Exception as e:
                errors.append({"campaign_contact_id": row["id"], "error": str(e)})

        promoted = 0
        if auto_sort_contacted:
            promoted = await apply_contacted_auto_sort(db, user_id)

        return {
            "ok": True,
            "marked_replied": marked,
            "skipped_no_reply": skipped,
            "pipeline_promoted_contacted": promoted,
            "errors": errors,
        }
    finally:
        await db.close()


async def sync_replies_all_senders() -> dict[str, Any]:
    """Scheduled job: every user who has pending threads."""
    db = await get_db()
    total_marked = 0
    total_promoted = 0
    all_errors: list[dict] = []
    try:
        cursor = await db.execute(
            """
            SELECT DISTINCT sent_by_user_id FROM campaign_contacts
            WHERE sent_by_user_id IS NOT NULL
              AND status = 'sent'
              AND replied_at IS NULL
            """
        )
        user_ids = [r["sent_by_user_id"] for r in await cursor.fetchall()]
    finally:
        await db.close()

    for uid in user_ids:
        if not uid:
            continue
        res = await sync_replies_for_user(int(uid), auto_sort_contacted=True)
        total_marked += int(res.get("marked_replied") or 0)
        total_promoted += int(res.get("pipeline_promoted_contacted") or 0)
        all_errors.extend(res.get("errors") or [])

    return {
        "ok": True,
        "users_processed": len(user_ids),
        "marked_replied": total_marked,
        "pipeline_promoted_contacted": total_promoted,
        "errors": all_errors,
    }
