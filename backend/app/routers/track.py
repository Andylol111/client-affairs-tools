"""
Tracking API - Open tracking pixel for campaign emails.
No auth required (loaded by recipient's email client).
"""
import os
from fastapi import APIRouter
from fastapi.responses import Response
from app.database import get_db

router = APIRouter()

# 1x1 transparent GIF
TRACKING_PIXEL = bytes([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
    0x44, 0x01, 0x00, 0x3b
])


@router.get("/open/{campaign_contact_id}")
async def track_open(campaign_contact_id: int):
    """Tracking pixel - records open when recipient loads images. Returns 1x1 transparent GIF."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE campaign_contacts SET opened_at = CURRENT_TIMESTAMP WHERE id = ? AND opened_at IS NULL",
            (campaign_contact_id,),
        )
        await db.commit()
    except Exception:
        pass
    finally:
        await db.close()
    return Response(content=TRACKING_PIXEL, media_type="image/gif")


def get_tracking_pixel_url(campaign_contact_id: int) -> str:
    """Build tracking pixel URL for injection into emails."""
    base = (os.getenv("API_BASE_URL") or "http://localhost:8000").rstrip("/")
    return f"{base}/api/track/open/{campaign_contact_id}"
