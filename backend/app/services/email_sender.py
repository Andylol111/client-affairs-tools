"""
Email Sender - Gmail SMTP
Sends emails via Gmail using app password.
"""
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional


async def get_gmail_credentials():
    """Load Gmail credentials from settings."""
    from app.database import get_db
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT key, value FROM settings WHERE key IN ('gmail_email', 'gmail_app_password')"
        )
        rows = await cursor.fetchall()
        data = {r["key"]: r["value"] for r in rows}
        email = data.get("gmail_email")
        password = data.get("gmail_app_password")
        return email, password
    finally:
        await db.close()


def append_signature(body: str, signature: Optional[str]) -> str:
    """Append signature to email body if present."""
    if not signature or not signature.strip():
        return body
    sig = signature.strip()
    if body.rstrip().endswith("--") or body.rstrip().endswith("---"):
        return body.rstrip() + "\n\n" + sig
    return body.rstrip() + "\n\n--\n\n" + sig


async def send_email(
    to_email: str,
    subject: str,
    body: str,
    from_name: Optional[str] = None,
    signature: Optional[str] = None,
) -> bool:
    """
    Send email via Gmail SMTP.
    Returns True on success, raises on failure.
    """
    gmail_email, gmail_password = await get_gmail_credentials()
    if not gmail_email or not gmail_password:
        raise ValueError("Gmail not configured. Go to Settings to add your Gmail credentials.")

    gmail_email = gmail_email.strip()
    gmail_password = gmail_password.strip()

    full_body = append_signature(body, signature)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name or 'YUCG Outreach'} <{gmail_email}>"
    msg["To"] = to_email

    msg.attach(MIMEText(full_body, "plain", "utf-8"))

    await aiosmtplib.send(
        msg,
        hostname="smtp.gmail.com",
        port=587,
        username=gmail_email,
        password=gmail_password,
        start_tls=True,
    )
    return True
