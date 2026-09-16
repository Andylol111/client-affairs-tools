"""
Settings API - Signature, custom formats. Admin-only for config changes.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.services.settings_service import get_setting, set_setting, get_all_settings, get_member_setting, set_member_setting
from app.auth_deps import get_current_user, get_current_admin
from app.services.audit_service import log_audit

router = APIRouter()


class SettingsUpdate(BaseModel):
    signature: Optional[str] = None
    signature_image_url: Optional[str] = None
    attachments_enabled: Optional[bool] = None
    daily_send_limit: Optional[int] = None
    daily_send_warn_at: Optional[int] = None


class CustomFormatCreate(BaseModel):
    name: str
    pattern: str  # e.g. "{first}.{last}" or "first.last"
    priority: int = 0


@router.get("")
async def get_settings(user: dict = Depends(get_current_user)):
    """Get all settings. Any authenticated user can read."""
    from app.services.settings_service import member_daily_send_limit

    result = await get_all_settings()
    for key in ("signature", "signature_image_url"):
        result[key] = await get_member_setting(user["id"], key) or ""
    result["daily_send_limit"] = await member_daily_send_limit(user["id"])
    result["daily_send_warn_at"] = await get_member_setting(user["id"], "daily_send_warn_at") or ""
    return result


@router.put("")
async def update_settings(payload: SettingsUpdate, admin: dict = Depends(get_current_user)):
    """Update settings. Admin only."""
    if payload.attachments_enabled is not None and admin.get("role") != "admin":
        raise HTTPException(403, "Only administrators can change club settings")
    if payload.signature is not None:
        await set_member_setting(admin["id"], "signature", payload.signature)
        await log_audit(admin["id"], "settings_update", "settings", "signature", "Updated signature")
    if payload.signature_image_url is not None:
        await set_member_setting(admin["id"], "signature_image_url", payload.signature_image_url or "")
        await log_audit(admin["id"], "settings_update", "settings", "signature_image_url", "Updated signature image URL")
    if payload.attachments_enabled is not None:
        await set_setting("attachments_enabled", "1" if payload.attachments_enabled else "0")
        await log_audit(admin["id"], "settings_update", "settings", "attachments_enabled", f"Set to {payload.attachments_enabled}")
    if payload.daily_send_limit is not None:
        if payload.daily_send_limit < 1:
            raise HTTPException(400, "Daily send limit must be at least 1")
        await set_member_setting(admin["id"], "daily_send_limit", str(payload.daily_send_limit))
        await log_audit(admin["id"], "settings_update", "settings", "daily_send_limit", f"Set to {payload.daily_send_limit}")
    if payload.daily_send_warn_at is not None:
        if payload.daily_send_warn_at < 0:
            raise HTTPException(400, "Warning threshold cannot be negative")
        await set_member_setting(admin["id"], "daily_send_warn_at", str(payload.daily_send_warn_at))
        await log_audit(admin["id"], "settings_update", "settings", "daily_send_warn_at", f"Set to {payload.daily_send_warn_at}")
    return {"ok": True}


@router.get("/custom-formats")
async def list_custom_formats(user: dict = Depends(get_current_user)):
    """List custom email formats."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM custom_email_formats ORDER BY priority DESC, name"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/custom-formats")
async def add_custom_format(payload: CustomFormatCreate, admin: dict = Depends(get_current_admin)):
    """Add a custom email format. Pattern uses {first}, {last}, {first_initial} placeholders."""
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO custom_email_formats (name, pattern, priority) VALUES (?, ?, ?)",
            (payload.name, payload.pattern, payload.priority),
        )
        await db.commit()
        await log_audit(admin["id"], "custom_format_add", "custom_format", payload.name, f"Added format {payload.name}")
        return {"ok": True}
    finally:
        await db.close()


@router.delete("/custom-formats/{fmt_id}")
async def delete_custom_format(fmt_id: int, admin: dict = Depends(get_current_admin)):
    """Remove a custom email format."""
    db = await get_db()
    try:
        await db.execute("DELETE FROM custom_email_formats WHERE id = ?", (fmt_id,))
        await db.commit()
        await log_audit(admin["id"], "custom_format_delete", "custom_format", str(fmt_id), "Deleted format")
        return {"ok": True}
    finally:
        await db.close()
