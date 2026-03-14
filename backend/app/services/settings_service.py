"""
Settings service - key-value storage for app config
"""
from app.database import get_db


async def get_setting(key: str) -> str | None:
    """Get a setting value by key."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else None
    finally:
        await db.close()


async def set_setting(key: str, value: str | None) -> None:
    """Set a setting value."""
    db = await get_db()
    try:
        if value is None:
            await db.execute("DELETE FROM settings WHERE key = ?", (key,))
        else:
            await db.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )
        await db.commit()
    finally:
        await db.close()


async def get_all_settings() -> dict[str, str]:
    """Get all settings as key-value dict."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT key, value FROM settings")
        rows = await cursor.fetchall()
        result = {}
        for r in rows:
            result[r["key"]] = r["value"] or ""
        # Defaults for optional keys
        if "attachments_enabled" not in result:
            result["attachments_enabled"] = "0"
        return result
    finally:
        await db.close()
