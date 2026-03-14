"""
ClientReach AI - Intelligent Client Outreach Platform
Backend API - FastAPI
"""
import os
from dotenv import load_dotenv
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import contacts, emails, campaigns, analytics, settings, auth, outreach, track, admin, attachments, telemetry, operations

# CORS: use CORS_ORIGINS env (comma-separated) when going public; default localhost for dev
_default_origins = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "https://localhost:5173", "https://127.0.0.1:5173",
]
_cors_origins = os.getenv("CORS_ORIGINS", "").strip()
CORS_ORIGINS = [o.strip() for o in _cors_origins.split(",") if o.strip()] if _cors_origins else _default_origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


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
