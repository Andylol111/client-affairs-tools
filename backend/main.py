
import os
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory so it works whether we're run from repo root or backend/
_backend_dir = Path(__file__).resolve().parent
_env_path = _backend_dir / ".env"
load_dotenv(_env_path, override=True)
if _env_path.exists():
    _cid = (os.getenv("SLACK_CLIENT_ID") or "").strip()
    _secret = (os.getenv("SLACK_CLIENT_SECRET") or "").strip()
    print(f"[env] Loaded backend/.env (Slack: client_id={'set' if _cid else 'NOT SET'}, client_secret={'set' if _secret else 'NOT SET'})")
else:
    print(f"[env] No backend/.env found at {_env_path}")

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.database import init_db
from app.routers import contacts, emails, campaigns, analytics, settings, auth, outreach, track, admin, attachments, telemetry, operations
from app.services.follow_up_job import run_follow_up_sequences
from app.services.notification_digest_job import run_notification_digests

# CORS: use CORS_ORIGINS env (comma-separated) when going public; default localhost for dev
_default_origins = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "https://localhost:5173", "https://127.0.0.1:5173",
]
_cors_origins = os.getenv("CORS_ORIGINS", "").strip()
CORS_ORIGINS = [o.strip() for o in _cors_origins.split(",") if o.strip()] if _cors_origins else _default_origins


_loop_for_jobs = None


def _run_follow_ups_sync():
    """Bridge for APScheduler (runs in thread): schedule async job on main loop."""
    if _loop_for_jobs:
        _loop_for_jobs.call_soon_threadsafe(
            lambda: asyncio.ensure_future(run_follow_up_sequences(), loop=_loop_for_jobs)
        )


def _run_digests_sync():
    """Bridge for APScheduler: schedule notification digest job on main loop."""
    if _loop_for_jobs:
        _loop_for_jobs.call_soon_threadsafe(
            lambda: asyncio.ensure_future(run_notification_digests(), loop=_loop_for_jobs)
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _loop_for_jobs
    await init_db()
    _loop_for_jobs = asyncio.get_running_loop()
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_follow_ups_sync,
        "cron",
        hour=8,
        minute=0,
        id="follow_up_sequences",
    )
    scheduler.add_job(
        _run_digests_sync,
        "cron",
        hour=8,
        minute=5,
        id="notification_digests",
    )
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)
    _loop_for_jobs = None


app = FastAPI(
    lifespan=lifespan,
    title="ClientReach AI",
    description="Intelligent Client Outreach, Automated from First Contact to Close",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(contacts.router, prefix="/api/contacts", tags=["contacts"])
app.include_router(emails.router, prefix="/api/emails", tags=["emails"])
app.include_router(campaigns.router, prefix="/api/campaigns", tags=["campaigns"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(outreach.router, prefix="/api/outreach", tags=["outreach"])
app.include_router(track.router, prefix="/api/track", tags=["track"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(attachments.router, prefix="/api/attachments", tags=["attachments"])
app.include_router(telemetry.router, prefix="/api/telemetry", tags=["telemetry"])
app.include_router(operations.router, prefix="/api/admin/operations", tags=["operations"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "ClientReach AI"}
