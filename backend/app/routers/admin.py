"""
Admin API - User management, audit log, API keys, notification prefs, 2FA.
Admin-only access.
"""
import secrets
import hashlib
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.auth_deps import get_current_admin
from app.services.audit_service import log_audit

router = APIRouter()


# --- Login log (admin only) ---
@router.get("/login-log")
async def get_login_log(limit: int = 50, _admin: dict = Depends(get_current_admin)):
    """List recent logins. Admin only."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT ll.id, ll.email, ll.name, ll.created_at, u.id as user_id
               FROM login_log ll JOIN users u ON ll.user_id = u.id
               ORDER BY ll.created_at DESC LIMIT ?""",
            (limit,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# --- User management ---
class UserRoleUpdate(BaseModel):
    role: str  # admin | standard


class UserStatusUpdate(BaseModel):
    is_active: bool


class UserInvite(BaseModel):
    email: str


@router.get("/users")
async def list_users(admin: dict = Depends(get_current_admin)):
    """List all users. Admin only."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, email, name, picture, role, is_active, created_at FROM users ORDER BY created_at"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/users/invite")
async def invite_user(payload: UserInvite, admin: dict = Depends(get_current_admin)):
    """Create a placeholder user by email. They get role=standard when they first log in. Admin only."""
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "Invalid email")
    if not email.endswith("@yale.edu"):
        raise HTTPException(400, "Only @yale.edu emails allowed")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id FROM users WHERE email = ?", (email,))
        if await cursor.fetchone():
            raise HTTPException(400, "User already exists")
        await db.execute(
            "INSERT INTO users (email, name, role) VALUES (?, '', 'standard')",
            (email,),
        )
        await db.commit()
        await log_audit(admin["id"], "user_invite", "user", email, f"Invited {email}")
        return {"ok": True, "email": email}
    finally:
        await db.close()


@router.patch("/users/{user_id}/role")
async def update_user_role(user_id: int, payload: UserRoleUpdate, admin: dict = Depends(get_current_admin)):
    """Update user role. Admin only."""
    if payload.role not in ("admin", "standard"):
        raise HTTPException(400, "Role must be admin or standard")
    if admin["id"] == user_id and payload.role != "admin":
        raise HTTPException(400, "Cannot demote yourself")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT email FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        await db.execute("UPDATE users SET role = ? WHERE id = ?", (payload.role, user_id))
        await db.commit()
        await log_audit(admin["id"], "role_update", "user", str(user_id), f"Set {row['email']} to {payload.role}")
        return {"ok": True, "role": payload.role}
    finally:
        await db.close()


@router.patch("/users/{user_id}/status")
async def update_user_status(user_id: int, payload: UserStatusUpdate, admin: dict = Depends(get_current_admin)):
    """Activate or deactivate user. Admin only."""
    if admin["id"] == user_id and not payload.is_active:
        raise HTTPException(400, "Cannot deactivate yourself")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT email FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        await db.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if payload.is_active else 0, user_id))
        await db.commit()
        await log_audit(admin["id"], "status_update", "user", str(user_id), f"{'Activated' if payload.is_active else 'Deactivated'} {row['email']}")
        return {"ok": True, "is_active": payload.is_active}
    finally:
        await db.close()


# --- Audit log ---
@router.get("/audit-log")
async def get_audit_log(limit: int = 100, admin: dict = Depends(get_current_admin)):
    """List audit log entries. Admin only."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT al.*, u.email as user_email FROM audit_log al
               LEFT JOIN users u ON al.user_id = u.id
               ORDER BY al.created_at DESC LIMIT ?""",
            (limit,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# --- API keys ---
class ApiKeyCreate(BaseModel):
    name: str
    scopes: Optional[str] = None  # e.g. "contacts:read"


@router.get("/api-keys")
async def list_api_keys(admin: dict = Depends(get_current_admin)):
    """List API keys for current user. Admin only."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, key_prefix, name, scopes, created_at, last_used_at FROM api_keys WHERE user_id = ?",
            (admin["id"],),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/api-keys")
async def create_api_key(payload: ApiKeyCreate, admin: dict = Depends(get_current_admin)):
    """Create a new API key. Returns the raw key once (store it securely). Admin only."""
    raw_key = "yucg_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:16] + "..."
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO api_keys (user_id, key_hash, key_prefix, name, scopes) VALUES (?, ?, ?, ?, ?)",
            (admin["id"], key_hash, key_prefix, payload.name, payload.scopes or "contacts:read"),
        )
        await db.commit()
        await log_audit(admin["id"], "api_key_create", "api_key", payload.name, "Created new API key")
        return {"key": raw_key, "key_prefix": key_prefix, "name": payload.name, "warning": "Store this key securely. It will not be shown again."}
    finally:
        await db.close()


@router.delete("/api-keys/{key_id}")
async def revoke_api_key(key_id: int, admin: dict = Depends(get_current_admin)):
    """Revoke an API key. Admin only."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "DELETE FROM api_keys WHERE id = ? AND user_id = ?",
            (key_id, admin["id"]),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(404, "API key not found")
        await log_audit(admin["id"], "api_key_revoke", "api_key", str(key_id), "Revoked API key")
        return {"ok": True}
    finally:
        await db.close()


# --- 2FA for admins ---
@router.post("/2fa/setup")
async def setup_2fa(admin: dict = Depends(get_current_admin)):
    """Generate TOTP secret and return QR/provisioning URI. Admin only."""
    try:
        import pyotp
    except ImportError:
        raise HTTPException(500, "pyotp not installed")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT totp_secret FROM users WHERE id = ?", (admin["id"],))
        row = await cursor.fetchone()
        if row and row["totp_secret"]:
            raise HTTPException(400, "2FA already enabled. Disable first to re-setup.")
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        provisioning_uri = totp.provisioning_uri(
            name=admin.get("email", "admin"),
            issuer_name="YUCG Outreach",
        )
        # Store temporarily - we'll persist on verify
        # For simplicity, we'll store and require verification in same request
        await db.execute("UPDATE users SET totp_secret = ? WHERE id = ?", (secret, admin["id"]))
        await db.commit()
        await log_audit(admin["id"], "2fa_setup", "user", str(admin["id"]), "Initiated 2FA setup")
        return {"secret": secret, "provisioning_uri": provisioning_uri, "message": "Scan with authenticator app, then verify with /2fa/verify"}
    finally:
        await db.close()


class TwoFactorVerify(BaseModel):
    code: str


@router.post("/2fa/verify")
async def verify_2fa(payload: TwoFactorVerify, admin: dict = Depends(get_current_admin)):
    """Verify TOTP code to complete 2FA setup. Admin only."""
    try:
        import pyotp
    except ImportError:
        raise HTTPException(500, "pyotp not installed")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT totp_secret FROM users WHERE id = ?", (admin["id"],))
        row = await cursor.fetchone()
        if not row or not row["totp_secret"]:
            raise HTTPException(400, "2FA not set up. Call /2fa/setup first.")
        totp = pyotp.TOTP(row["totp_secret"])
        if not totp.verify(payload.code, valid_window=1):
            raise HTTPException(400, "Invalid code")
        await log_audit(admin["id"], "2fa_verified", "user", str(admin["id"]), "2FA enabled")
        return {"ok": True, "message": "2FA enabled"}
    finally:
        await db.close()


@router.post("/2fa/disable")
async def disable_2fa(payload: TwoFactorVerify, admin: dict = Depends(get_current_admin)):
    """Disable 2FA. Requires current TOTP code. Admin only."""
    try:
        import pyotp
    except ImportError:
        raise HTTPException(500, "pyotp not installed")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT totp_secret FROM users WHERE id = ?", (admin["id"],))
        row = await cursor.fetchone()
        if not row or not row["totp_secret"]:
            raise HTTPException(400, "2FA not enabled")
        totp = pyotp.TOTP(row["totp_secret"])
        if not totp.verify(payload.code, valid_window=1):
            raise HTTPException(400, "Invalid code")
        await db.execute("UPDATE users SET totp_secret = NULL WHERE id = ?", (admin["id"],))
        await db.commit()
        await log_audit(admin["id"], "2fa_disable", "user", str(admin["id"]), "2FA disabled")
        return {"ok": True}
    finally:
        await db.close()
