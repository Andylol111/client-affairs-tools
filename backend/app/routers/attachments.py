"""
Attachments API - Email attachment library (intro PDFs, past workstreams, etc.)
"""
import os
import uuid
import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse

from app.database import get_db, row_to_dict
from app.auth_deps import get_current_user, get_current_admin
from app.services.settings_service import get_setting
from app.services.audit_service import log_audit

router = APIRouter()

# Storage folder next to backend
ATTACHMENTS_DIR = Path(__file__).parent.parent.parent / "attachments"
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB (Gmail limit per attachment)


def _ensure_dir():
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)


async def _attachments_enabled() -> bool:
    val = await get_setting("attachments_enabled")
    return val == "1" or val == "true"


@router.get("")
async def list_attachments(user: dict = Depends(get_current_user)):
    """List all attachments in the library. Requires attachments_enabled."""
    if not await _attachments_enabled():
        return []
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, filename, display_name, file_size, mime_type, created_at FROM email_attachments ORDER BY display_name, filename"
        )
        rows = await cursor.fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        await db.close()


@router.post("")
async def upload_attachment(
    file: UploadFile = File(...),
    display_name: str | None = Form(None),
    admin: dict = Depends(get_current_admin),
):
    """Upload a file to the attachment library. Admin only."""
    if not await _attachments_enabled():
        raise HTTPException(400, "Attachments are disabled. Enable in Settings.")
    _ensure_dir()
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Max {MAX_FILE_SIZE // (1024*1024)} MB.")
    storage_name = f"{uuid.uuid4().hex}{ext}"
    storage_path = ATTACHMENTS_DIR / storage_name
    storage_path.write_bytes(content)
    mime_type = mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO email_attachments (filename, display_name, storage_path, file_size, mime_type)
               VALUES (?, ?, ?, ?, ?)""",
            (file.filename or "unnamed", display_name or file.filename or "Unnamed", str(storage_path), len(content), mime_type),
        )
        await db.commit()
        row_id = cursor.lastrowid
        cursor = await db.execute("SELECT id, filename, display_name, file_size, mime_type, created_at FROM email_attachments WHERE id = ?", (row_id,))
        row = await cursor.fetchone()
        await log_audit(admin["id"], "attachment_upload", "attachment", str(row_id), file.filename or "unnamed")
        return row_to_dict(row)
    except Exception:
        if storage_path.exists():
            storage_path.unlink()
        raise
    finally:
        await db.close()


@router.delete("/{attachment_id}")
async def delete_attachment(attachment_id: int, admin: dict = Depends(get_current_admin)):
    """Remove an attachment from the library. Admin only."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT storage_path FROM email_attachments WHERE id = ?", (attachment_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Attachment not found")
        storage_path = Path(row["storage_path"])
        await db.execute("DELETE FROM email_attachments WHERE id = ?", (attachment_id,))
        await db.commit()
        if storage_path.exists():
            storage_path.unlink()
        await log_audit(admin["id"], "attachment_delete", "attachment", str(attachment_id), "Deleted")
        return {"ok": True}
    finally:
        await db.close()


async def get_attachment_data_for_send(attachment_ids: list[int]) -> list[tuple[bytes, str, str]]:
    """Get (content, filename, mime_type) for each attachment. Used when sending emails."""
    if not attachment_ids:
        return []
    from app.database import get_db
    db = await get_db()
    try:
        placeholders = ",".join("?" * len(attachment_ids))
        cursor = await db.execute(
            f"SELECT id, storage_path, filename, mime_type FROM email_attachments WHERE id IN ({placeholders})",
            attachment_ids,
        )
        rows = await cursor.fetchall()
        result = []
        for r in rows:
            path = Path(r["storage_path"])
            if path.exists():
                content = path.read_bytes()
                result.append((content, r["filename"] or "attachment", r["mime_type"] or "application/octet-stream"))
        return result
    finally:
        await db.close()


@router.get("/{attachment_id}/download")
async def download_attachment(attachment_id: int, user: dict = Depends(get_current_user)):
    """Download an attachment file."""
    if not await _attachments_enabled():
        raise HTTPException(400, "Attachments are disabled.")
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT storage_path, filename, mime_type FROM email_attachments WHERE id = ?",
            (attachment_id,),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Attachment not found")
        path = Path(row["storage_path"])
        if not path.exists():
            raise HTTPException(404, "File not found on disk")
        return FileResponse(
            path,
            filename=row["filename"] or "attachment",
            media_type=row["mime_type"] or "application/octet-stream",
        )
    finally:
        await db.close()
