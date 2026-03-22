"""
Auth API - Google OAuth 2.0 + JWT
"""
import hashlib
import hmac
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
from app.jwt_utils import JWT_SECRET, create_token, decode_token

router = APIRouter()

GOOGLE_CLIENT_ID = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
GOOGLE_CLIENT_SECRET = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
BACKEND_URL = (os.getenv("BACKEND_URL") or "http://localhost:8000").strip().rstrip("/")
GOOGLE_REDIRECT_URI = (
    os.getenv("GOOGLE_REDIRECT_URI") or f"{BACKEND_URL}/api/auth/google/callback"
).strip()
FRONTEND_URL = (os.getenv("FRONTEND_URL") or "http://localhost:5173").strip()


def _oauth_state_signing_key() -> bytes:
    """HMAC key for OAuth `state` — must be stable across workers/restarts (unlike in-memory state)."""
    raw = (os.getenv("OAUTH_STATE_SECRET") or JWT_SECRET or GOOGLE_CLIENT_SECRET or "").strip()
    if not raw:
        raw = "dev-oauth-state-not-for-production"
        logger.warning(
            "OAUTH_STATE_SECRET, JWT_SECRET, and GOOGLE_CLIENT_SECRET are unset; using insecure OAuth state signing. "
            "Set JWT_SECRET (or OAUTH_STATE_SECRET) in backend/.env."
        )
    return raw.encode("utf-8")


def _generate_oauth_state() -> str:
    nonce = secrets.token_urlsafe(24)
    sig = hmac.new(_oauth_state_signing_key(), nonce.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{nonce}.{sig}"


def _verify_oauth_state(state: str | None) -> bool:
    if not state or "." not in state:
        return False
    nonce, sig = state.split(".", 1)
    if len(nonce) < 8 or len(sig) < 32:
        return False
    expected = hmac.new(_oauth_state_signing_key(), nonce.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


@router.get("/google")
async def google_login():
    """Redirect to Google OAuth consent screen."""
    if not GOOGLE_CLIENT_ID:
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=oauth_not_configured")
    state = _generate_oauth_state()
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
    if not code or not _verify_oauth_state(state):
        logger.warning(
            "Invalid Google OAuth callback: bad or missing state (wrong secret, tampered URL, or very old link)."
        )
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=invalid_callback")

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
            try:
                err_body = token_res.text[:500]
            except Exception:
                err_body = ""
            logger.warning(
                "Google token exchange failed: status=%s body=%s",
                token_res.status_code,
                err_body,
            )
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
        row = row_to_dict(row) if row else None
        ad = payload.admin_digest if payload.admin_digest is not None else (bool(row.get("admin_digest")) if row else True)
        cs = payload.campaign_summary if payload.campaign_summary is not None else (bool(row.get("campaign_summary")) if row else False)
        await db.execute(
            "INSERT OR REPLACE INTO notification_preferences (user_id, admin_digest, campaign_summary) VALUES (?, ?, ?)",
            (user["id"], 1 if ad else 0, 1 if cs else 0),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- User profile ---
class ProfileUpdate(BaseModel):
    projects: str | None = None
    experience: str | None = None
    role_title: str | None = None
    linkedin_url: str | None = None
    slack_handle: str | None = None
    other_handles: str | None = None


@router.get("/profile")
async def get_my_profile(user: dict = Depends(get_current_user)):
    """Get current user's profile (projects, experience, role, handles)."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM user_profiles WHERE user_id = ?",
            (user["id"],),
        )
        row = await cursor.fetchone()
        if row:
            return row_to_dict(row)
        return {"user_id": user["id"], "projects": None, "experience": None, "role_title": None, "linkedin_url": None, "slack_handle": None, "other_handles": None}
    finally:
        await db.close()


@router.put("/profile")
async def update_my_profile(payload: ProfileUpdate, user: dict = Depends(get_current_user)):
    """Update current user's profile."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user["id"],))
        existing = await cursor.fetchone()
        existing = row_to_dict(existing) if existing else {}
        proj = payload.projects if payload.projects is not None else (existing.get("projects") or "")
        exp = payload.experience if payload.experience is not None else (existing.get("experience") or "")
        role = payload.role_title if payload.role_title is not None else (existing.get("role_title") or "")
        li = payload.linkedin_url if payload.linkedin_url is not None else (existing.get("linkedin_url") or "")
        slack = payload.slack_handle if payload.slack_handle is not None else (existing.get("slack_handle") or "")
        other = payload.other_handles if payload.other_handles is not None else (existing.get("other_handles") or "")
        await db.execute(
            """INSERT OR REPLACE INTO user_profiles (user_id, projects, experience, role_title, linkedin_url, slack_handle, other_handles, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
            (user["id"], proj, exp, role, li, slack, other),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- Slack OAuth ---
SLACK_SCOPES = "users:read,users:read.email,team:read"
_slack_oauth_states: dict[str, int] = {}  # state -> user_id


def _get_slack_credentials() -> tuple[str, str]:
    """Read Slack credentials at request time so they always reflect loaded .env."""
    cid = (os.getenv("SLACK_CLIENT_ID") or "").strip()
    secret = (os.getenv("SLACK_CLIENT_SECRET") or "").strip()
    return cid, secret


@router.get("/slack/connect")
async def slack_connect(user: dict = Depends(get_current_user)):
    """Return Slack OAuth URL for the frontend to redirect to. Requires auth."""
    SLACK_CLIENT_ID, SLACK_CLIENT_SECRET = _get_slack_credentials()
    if not SLACK_CLIENT_ID or not SLACK_CLIENT_SECRET:
        raise HTTPException(
            400,
            "Slack integration not configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to backend/.env. "
            f"(Debug: client_id present={bool(SLACK_CLIENT_ID)}, client_secret present={bool(SLACK_CLIENT_SECRET)})"
        )
    state = secrets.token_urlsafe(32)
    _slack_oauth_states[state] = user["id"]
    redirect_uri = f"{os.getenv('BACKEND_URL', 'http://localhost:8000')}/api/auth/slack/callback"
    params = {
        "client_id": SLACK_CLIENT_ID,
        "scope": SLACK_SCOPES,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    url = "https://slack.com/oauth/v2/authorize?" + urlencode(params)
    return {"redirect_url": url}


@router.get("/slack/callback")
async def slack_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    """Exchange Slack OAuth code for token, store, redirect to frontend."""
    if error:
        return RedirectResponse(url=f"{FRONTEND_URL}/profile?slack=denied")
    if not code or not state or state not in _slack_oauth_states:
        return RedirectResponse(url=f"{FRONTEND_URL}/profile?slack=error")
    user_id = _slack_oauth_states.pop(state, None)
    if not user_id:
        return RedirectResponse(url=f"{FRONTEND_URL}/profile?slack=error")

    redirect_uri = f"{os.getenv('BACKEND_URL', 'http://localhost:8000')}/api/auth/slack/callback"
    slack_client_id, slack_client_secret = _get_slack_credentials()
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            "https://slack.com/api/oauth.v2.access",
            data={
                "client_id": slack_client_id,
                "client_secret": slack_client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if res.status_code != 200:
        return RedirectResponse(url=f"{FRONTEND_URL}/profile?slack=error")
    data = res.json()
    if not data.get("ok"):
        return RedirectResponse(url=f"{FRONTEND_URL}/profile?slack=error")
    access_token = data.get("access_token")
    team = data.get("team") or {}
    team_id = team.get("id")
    team_name = team.get("name")
    authed_user = data.get("authed_user") or {}
    user_slack_id = authed_user.get("id")
    scope = data.get("scope")

    db = await get_db()
    try:
        await db.execute(
            """INSERT OR REPLACE INTO user_slack_tokens (user_id, access_token, team_id, team_name, user_slack_id, scope, created_at)
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
            (user_id, access_token, team_id, team_name, user_slack_id, scope),
        )
        await db.commit()
    finally:
        await db.close()
    return RedirectResponse(url=f"{FRONTEND_URL}/profile?slack=connected")


@router.get("/slack/status")
async def slack_status(user: dict = Depends(get_current_user)):
    """Check if current user has Slack connected."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT team_name FROM user_slack_tokens WHERE user_id = ?",
            (user["id"],),
        )
        row = await cursor.fetchone()
        if row:
            return {"connected": True, "team_name": row_to_dict(row).get("team_name")}
        return {"connected": False}
    finally:
        await db.close()


@router.delete("/slack/disconnect")
async def slack_disconnect(user: dict = Depends(get_current_user)):
    """Disconnect Slack for current user."""
    db = await get_db()
    try:
        await db.execute("DELETE FROM user_slack_tokens WHERE user_id = ?", (user["id"],))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- My project assignments (for profile) ---
@router.get("/my-projects")
async def get_my_projects(user: dict = Depends(get_current_user)):
    """List current user's project assignments (e.g. Spring 2026 - Project Lego)."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT p.id, p.name, p.semester, upa.role_in_project
               FROM user_project_assignments upa
               JOIN projects p ON p.id = upa.project_id
               WHERE upa.user_id = ?
               ORDER BY p.semester DESC, p.name""",
            (user["id"],),
        )
        rows = await cursor.fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        await db.close()


# --- Team / community (who's online, roles) ---
@router.get("/team")
async def get_team(user: dict = Depends(get_current_user)):
    """List team members with roles, last seen, and project assignments. For community sidebar."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT u.id, u.email, u.name, u.picture, u.role,
               (SELECT ll.created_at FROM login_log ll WHERE ll.user_id = u.id ORDER BY ll.created_at DESC LIMIT 1) as last_seen
               FROM users u WHERE COALESCE(u.is_active, 1) = 1 ORDER BY u.name, u.email"""
        )
        rows = await cursor.fetchall()
        users = [row_to_dict(r) for r in rows]
    except Exception:
        cursor = await db.execute(
            "SELECT id, email, name, picture, role FROM users ORDER BY name, email"
        )
        rows = await cursor.fetchall()
        users = [row_to_dict(r) for r in rows]

    # Add project assignments for each user
    try:
        for u in users:
            cursor = await db.execute(
                """SELECT p.name, p.semester, upa.role_in_project
                   FROM user_project_assignments upa
                   JOIN projects p ON p.id = upa.project_id
                   WHERE upa.user_id = ?
                   ORDER BY p.semester DESC, p.name""",
                (u["id"],),
            )
            proj_rows = await cursor.fetchall()
            u["project_assignments"] = [row_to_dict(r) for r in proj_rows]
    except Exception:
        for u in users:
            u["project_assignments"] = []
    finally:
        await db.close()
    return users
