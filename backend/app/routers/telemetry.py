"""
Telemetry API - frontend logs usage events (page views, actions, cursor position). Internal only.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, Any, List

from app.auth_deps import get_current_user_optional
from app.services.usage_service import log_event

router = APIRouter()


class TelemetryEvent(BaseModel):
    event_type: str
    resource_type: Optional[str] = None
    details: Optional[dict[str, Any]] = None


class TelemetryBatch(BaseModel):
    events: List[TelemetryEvent]


@router.post("/event")
async def record_event(payload: TelemetryEvent, user: dict | None = Depends(get_current_user_optional)):
    """Log a usage event. Auth optional (user_id null if not logged in). Internal only."""
    user_id = user["id"] if user else None
    await log_event(
        user_id=user_id,
        event_type=payload.event_type,
        resource_type=payload.resource_type,
        details=payload.details,
    )
    return {"ok": True}


@router.post("/batch")
async def record_batch(payload: TelemetryBatch, user: dict | None = Depends(get_current_user_optional)):
    """Log multiple events (e.g. cursor samples). Capped at 50 per request. Internal only."""
    user_id = user["id"] if user else None
    for ev in payload.events[:50]:
        await log_event(
            user_id=user_id,
            event_type=ev.event_type,
            resource_type=ev.resource_type,
            details=ev.details,
        )
    return {"ok": True, "count": min(len(payload.events), 50)}
