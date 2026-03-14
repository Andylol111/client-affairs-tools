"""
Gmail API - Send emails using OAuth tokens from Google sign-in.
No App Password required; uses the logged-in user's Google account.
"""
import os
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from typing import Optional
import httpx

GOOGLE_CLIENT_ID = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
GOOGLE_CLIENT_SECRET = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()


async def get_valid_access_token(user_id: int) -> tuple[str, str] | None:
    """
    Get a valid access token for the user. Refreshes if expired.
    Returns (access_token, user_email) or None if no tokens.
    """
    from app.database import get_db
    import time

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT email, access_token, refresh_token, token_expires_at FROM users WHERE id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        email = row["email"]
        access_token = row["access_token"]
        refresh_token = row["refresh_token"]
        expires_at = row["token_expires_at"]

        # If we have a valid access token (with 5 min buffer), use it
        now = time.time()
        try:
            still_valid = expires_at is None or float(expires_at) > now + 300
        except (TypeError, ValueError):
            still_valid = False
        if access_token and still_valid:
            return access_token, email

        # Refresh if we have refresh_token
        if not refresh_token or not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
            return None

        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if r.status_code != 200:
                return None
            data = r.json()
            new_access = data.get("access_token")
            new_expires = data.get("expires_in", 3600)
            if not new_access:
                return None

        expires_at = now + new_expires
        await db.execute(
            "UPDATE users SET access_token = ?, token_expires_at = ? WHERE id = ?",
            (new_access, expires_at, user_id),
        )
        await db.commit()
        return new_access, email
    finally:
        await db.close()


def append_signature(body: str, signature: Optional[str]) -> str:
    """Append signature to email body (plain text part). If signature is HTML, strip tags for plain."""
    if not signature or not signature.strip():
        return body
    sig = signature.strip()
    # For plain-text part, use plain version of signature (strip HTML if present)
    if "<" in sig and ">" in sig:
        sig_plain = _strip_html_to_plain(sig)
    else:
        sig_plain = sig.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    if not sig_plain:
        return body.rstrip()
    if body.rstrip().endswith("--") or body.rstrip().endswith("---"):
        return body.rstrip() + "\n\n" + sig_plain
    return body.rstrip() + "\n\n--\n\n" + sig_plain


def _attach_files(msg: MIMEMultipart, attachments: list[tuple[bytes, str, str]]) -> None:
    """Attach files to MIME message. Each tuple is (content, filename, mime_type)."""
    import email.encoders
    for content, filename, mime_type in attachments:
        main_type, sub_type = (mime_type.split("/") + ["octet-stream", "stream"])[:2]
        part = MIMEBase(main_type, sub_type)
        part.set_payload(content)
        email.encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)


async def send_via_gmail_api(
    user_id: int,
    to_email: str,
    subject: str,
    body: str,
    from_name: Optional[str] = None,
    signature: Optional[str] = None,
    attachments: Optional[list[tuple[bytes, str, str]]] = None,
) -> bool:
    """
    Send email via Gmail API using the user's OAuth tokens.
    Returns True on success, raises on failure.
    """
    result = await get_valid_access_token(user_id)
    if not result:
        raise ValueError(
            "No Gmail access. Sign out and sign in again with Google to grant email-sending permission."
        )
    access_token, from_email = result

    full_body = append_signature(body, signature)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name or 'YUCG Outreach'} <{from_email}>"
    msg["To"] = to_email
    msg.attach(MIMEText(full_body, "plain", "utf-8"))
    if attachments:
        _attach_files(msg, attachments)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii").rstrip("=")

    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            json={"raw": raw},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
        )
        if r.status_code == 401:
            raise ValueError(
                "Gmail access expired. Sign out and sign in again to re-authorize."
            )
        if r.status_code >= 400:
            err = r.text
            raise RuntimeError(f"Gmail API error: {r.status_code} - {err}")

    return True


def _strip_html_to_plain(html_fragment: str) -> str:
    """Convert HTML to plain text for the plain-part of the email."""
    import re
    text = re.sub(r"<br\s*/?>", "\n", html_fragment, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return (text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').strip())


def _signature_html(signature: Optional[str], image_url: Optional[str]) -> str:
    """Build HTML fragment for signature. Signature may be plain text or HTML (e.g. with embedded images)."""
    import html
    import re
    parts = []
    if signature and signature.strip():
        sig = signature.strip()
        # If it looks like HTML (e.g. contains tags or data URLs), use as-is but sanitize (remove script/style)
        if "<" in sig and ">" in sig:
            sanitized = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", sig, flags=re.I)
            sanitized = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", sanitized, flags=re.I)
            sanitized = re.sub(r"on\w+\s*=", "", sanitized, flags=re.I)  # strip event handlers
            parts.append(sanitized)
        else:
            parts.append(html.escape(sig).replace(chr(10), "<br>"))
    if image_url and image_url.strip():
        url = image_url.strip()
        parts.append(f'<img src="{html.escape(url)}" alt="" style="max-width:200px;height:auto;" />')
    if not parts:
        return ""
    return "<br><br>--<br><br>" + "".join(parts)


async def send_via_gmail_api_with_tracking(
    user_id: int,
    to_email: str,
    subject: str,
    body: str,
    campaign_contact_id: int,
    from_name: Optional[str] = None,
    signature: Optional[str] = None,
    signature_image_url: Optional[str] = None,
) -> bool:
    """Send HTML email with open-tracking pixel for campaigns."""
    from app.routers.track import get_tracking_pixel_url

    result = await get_valid_access_token(user_id)
    if not result:
        raise ValueError(
            "No Gmail access. Sign out and sign in again with Google to grant email-sending permission."
        )
    access_token, from_email = result

    full_body = append_signature(body, signature)
    sig_html = _signature_html(signature, signature_image_url)
    tracking_url = get_tracking_pixel_url(campaign_contact_id)
    # HTML: body only (no duplicate signature) + signature HTML + tracking pixel
    html_body = f"""<html><body style="font-family: sans-serif; white-space: pre-wrap;">{body.replace(chr(10), '<br>')}{sig_html}
<img src="{tracking_url}" width="1" height="1" alt="" style="display:none" /></body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name or 'YUCG Outreach'} <{from_email}>"
    msg["To"] = to_email
    msg.attach(MIMEText(full_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii").rstrip("=")

    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            json={"raw": raw},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
        )
        if r.status_code == 401:
            raise ValueError(
                "Gmail access expired. Sign out and sign in again to re-authorize."
            )
        if r.status_code >= 400:
            raise RuntimeError(f"Gmail API error: {r.status_code} - {r.text}")

    return True
