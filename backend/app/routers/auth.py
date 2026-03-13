"""
Auth API - Google OAuth 2.0 + JWT
"""
import logging
import os
import secrets

logger = logging.getLogger(__name__)
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import httpx
from datetime import datetime, timedelta
from app.database import get_db, row_to_dict
from app.auth_deps import get_current_user
from app.jwt_utils import create_token, decode_token

router = APIRouter()

GOOGLE_CLIENT_ID = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
GOOGLE_CLIENT_SECRET = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
GOOGLE_REDIRECT_URI = (os.getenv("GOOGLE_REDIRECT_URI") or "http://localhost:8000/api/auth/google/callback").strip()
FRONTEND_URL = (os.getenv("FRONTEND_URL") or "http://localhost:5173").strip()

# In-memory state for CSRF (use Redis in production)
_oauth_states: dict[str, str] = {}


@router.get("/google")
async def google_login():
    """Redirect to Google OAuth consent screen."""
    if not GOOGLE_CLIENT_ID:
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=oauth_not_configured")
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = "pending"
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile https://www.googleapis.com/auth/gmail.send",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return RedirectResponse(url=url)


@router.get("/google/callback")
async def google_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    """Handle Google OAuth callback, create/find user, return JWT."""
    if error:
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error={error}")
    if not code or not state or state not in _oauth_states:
        logger.warning("Invalid callback: missing code/state or state not in _oauth_states (reload?)")
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=invalid_callback")
    del _oauth_states[state]

    try:
        return await _do_google_callback(code)
    except Exception as e:
        logger.exception("Google callback failed")
        err_msg = str(e).replace(" ", "%20")[:80]
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=callback_failed&detail={err_msg}")


async def _do_google_callback(code: str):
    async with httpx.AsyncClient(timeout=15.0) as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_res.status_code != 200:
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=token_exchange_failed")

        tokens = token_res.json()
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in", 3600)
        if not access_token:
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=no_access_token")

        user_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_res.status_code != 200:
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=userinfo_failed")

        user_info = user_res.json()
        email = user_info.get("email") or ""
        name = user_info.get("name")
        picture = user_info.get("picture")
        google_id = user_info.get("id")

        if not email:
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=no_email")

        if not email.lower().endswith("@yale.edu"):
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=domain_not_allowed")

    from datetime import datetime as dt
    token_expires_at = (dt.utcnow().timestamp() + expires_in) if expires_in else None

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, email, name, picture, role, is_active FROM users WHERE google_id = ? OR email = ?",
            (google_id, email),
        )
        row = await cursor.fetchone()
        if row:
            row = row_to_dict(row)
            if row.get("is_active") == 0:
                return RedirectResponse(url=f"{FRONTEND_URL}/login?error=account_deactivated")
            user_id = row["id"]
            role = row.get("role") or "standard"
            if refresh_token:
                await db.execute(
                    """UPDATE users SET name = ?, picture = ?, google_id = ?, access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?""",
                    (name, picture, google_id, access_token, refresh_token, token_expires_at, user_id),
                )
            else:
                await db.execute(
                    "UPDATE users SET name = ?, picture = ?, google_id = ?, access_token = ?, token_expires_at = ? WHERE id = ?",
                    (name, picture, google_id, access_token, token_expires_at, user_id),
                )
        else:
            cursor = await db.execute(
                """INSERT INTO users (email, name, picture, google_id, access_token, refresh_token, token_expires_at, role) VALUES (?, ?, ?, ?, ?, ?, ?, 'standard')""",
                (email, name, picture, google_id, access_token, refresh_token, token_expires_at),
            )
            user_id = cursor.lastrowid
            role = "standard"
        await db.execute(
            "INSERT INTO login_log (user_id, email, name) VALUES (?, ?, ?)",
            (user_id, email, name),
        )
        await db.commit()
    finally:
        await db.close()

    token = create_token(user_id, email, name, picture, role)
    return RedirectResponse(url=f"{FRONTEND_URL}/login?token={token}")


@router.get("/me")
async def get_me(authorization: str | None = None):
    """Get current user from JWT. Pass Authorization: Bearer <token>."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token:
        return {"authenticated": False, "user": None}
    payload = decode_token(token)
    if not payload:
        return {"authenticated": False, "user": None}
    return {
        "authenticated": True,
        "user": {
            "id": int(payload["sub"]),
            "email": payload.get("email"),
            "name": payload.get("name"),
            "picture": payload.get("picture"),
            "role": payload.get("role") or "standard",
        },
        "token": token,
    }


@router.post("/logout")
async def logout():
    """Client-side logout (clear token). No server action needed."""
    return {"ok": True}


@router.get("/notification-preferences")
async def get_my_notification_prefs(user: dict = Depends(get_current_user)):
    """Get current user's notification preferences."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT admin_digest, campaign_summary FROM notification_preferences WHERE user_id = ?",
            (user["id"],),
        )
        row = await cursor.fetchone()
        if row:
            return {"admin_digest": bool(row["admin_digest"]), "campaign_summary": bool(row["campaign_summary"])}
        return {"admin_digest": True, "campaign_summary": False}
    finally:
        await db.close()


class NotificationPrefsBody(BaseModel):
    admin_digest: bool | None = None
    campaign_summary: bool | None = None


@router.put("/notification-preferences")
async def update_my_notification_prefs(
    payload: NotificationPrefsBody,
    user: dict = Depends(get_current_user),
):
    """Update current user's notification preferences."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT admin_digest, campaign_summary FROM notification_preferences WHERE user_id = ?",
            (user["id"],),
        )
        row = await cursor.fetchone()
        ad = payload.admin_digest if payload.admin_digest is not None else (bool(row["admin_digest"]) if row else True)
        cs = payload.campaign_summary if payload.campaign_summary is not None else (bool(row["campaign_summary"]) if row else False)
        await db.execute(
            "INSERT OR REPLACE INTO notification_preferences (user_id, admin_digest, campaign_summary) VALUES (?, ?, ?)",
            (user["id"], 1 if ad else 0, 1 if cs else 0),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()
