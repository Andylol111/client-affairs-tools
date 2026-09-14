"""Durable research jobs recover, drain without live providers, and keep member ownership.
From backend/: python3 tests/test_research_jobs.py"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"
os.environ["JWT_SECRET"] = "p-research-jobs-secret-not-a-known-default-xx"
os.environ.pop("VERIFALIA_API_KEY", None)
os.environ["EXTERNAL_EMAIL_VERIFICATION_ENABLED"] = "false"

from app.database import get_db, init_db  # noqa: E402
from app.services import research_service as S  # noqa: E402
from app.services.research_providers import ProviderUnavailable  # noqa: E402

SPEC = {
    "industries": ["logistics"],
    "companies": ["Acme"],
    "geography": ["Connecticut"],
    "size": [],
    "roles": ["operations"],
    "seniority": ["director"],
    "people_per_company": 1,
    "exclusions": [],
    "reason": "Alumni-led program supporting Connecticut manufacturers",
}
SOURCE = {
    "url": "https://acme.com/team",
    "excerpt": "Ada Lovelace (ada.lovelace@acme.com) leads engineering at Acme.",
    "title": "Acme team",
    "observed_at": "2026-09-01T12:00:00+00:00",
}


async def _denied(coro, status: int) -> None:
    try:
        await coro
        raise AssertionError(f"expected HTTP {status}")
    except HTTPException as exc:
        assert exc.status_code == status, exc


async def _seed() -> None:
    await init_db()
    db = await get_db()
    try:
        await db.execute("INSERT INTO users (id, email, role, is_active) VALUES (1, 'a@yale.edu', 'standard', 1)")
        await db.execute("INSERT INTO users (id, email, role, is_active) VALUES (2, 'b@yale.edu', 'standard', 1)")
        await db.execute("INSERT INTO users (id, email, role, is_active) VALUES (3, 'ops@yale.edu', 'admin', 1)")
        await db.commit()
    finally:
        await db.close()


async def _run() -> None:
    await _seed()
    owner = {"id": 1, "role": "standard"}
    other = {"id": 2, "role": "standard"}
    admin = {"id": 3, "role": "admin"}
    db = await get_db()
    try:
        brief = await S.create_brief(db, owner, "Spring manufacturers", SPEC, None)
        await _denied(S._brief_access(db, brief["id"], other), 404)
        assert await S.list_briefs(db, other) == []

        with patch("app.services.research_providers.search_sources", AsyncMock(return_value=[SOURCE])):
            companies = await S.discover_companies_for_brief(db, brief["id"], owner)
        assert companies, companies
        company = await S.review_company(db, brief["id"], companies[0]["id"], owner, "accepted", "")
        assert company["disposition"] == "accepted"

        job = await S.create_job(db, brief["id"], owner)
        assert job["status"] == "queued"
        assert job["total_tasks"] == 3
        await _denied(S.create_job(db, brief["id"], owner), 409)
        await _denied(S.get_job(db, job["id"], other), 404)

        search = AsyncMock(return_value=[SOURCE])
        crawl = AsyncMock(return_value=[SOURCE])
        async def interpret(_owner, _kind, _spec, stored, _context):
            sid = stored[0]["id"]
            return {"people": [{
                "name": "Ada Lovelace", "title": "CTO", "company": "Acme", "source_ids": [sid],
                "identity": "plausible", "employment": "current_source_observed", "project_fit": "strong",
                "explanation": "Named on the current team page with a published address.",
                "profile_url": "https://acme.com/team",
            }]}
        interpret = AsyncMock(side_effect=interpret)
        with patch("app.services.research_providers.search_sources", search), \
             patch("app.services.research_providers.crawl_source", crawl), \
             patch("app.services.research_providers.interpret_sources", interpret):
            claimed = 0
            for _ in range(6):
                result = await S.drain_research_queue()
                claimed += int(result.get("claimed") or 0)
                if result.get("claimed") == 0 and claimed:
                    break
        assert claimed == 3, claimed
        finished = await S.get_job(db, job["id"], owner)
        assert finished["status"] in {"completed", "partially_completed"}, finished
        recs = await S.recommendations_for_brief(db, brief["id"], owner)
        assert recs, recs
        assert recs[0]["email"] == "ada.lovelace@acme.com"

        accepted = await S.review_recommendation(db, recs[0]["id"], owner, "accepted", "Matches the brief")
        assert accepted["disposition"] == "accepted"
        assert accepted["contact_id"]
        contact = await (await db.execute(
            "SELECT owner_id, email FROM contacts WHERE id=?", (accepted["contact_id"],))).fetchone()
        assert contact["owner_id"] == 1
        await _denied(S.review_recommendation(db, recs[0]["id"], other, "accepted", "x"), 404)

        await db.execute(
            """UPDATE research_jobs SET status='running', lease_token='dead',
               lease_expires_at=datetime('now', '-10 minutes') WHERE id=?""",
            (job["id"],),
        )
        await db.execute(
            """UPDATE research_tasks SET status='running', lease_token='dead',
               lease_expires_at=datetime('now', '-10 minutes') WHERE job_id=?""",
            (job["id"],),
        )
        await db.commit()
        recovered = await S.recover_research_jobs()
        assert recovered >= 1
        restored = await S.get_job(db, job["id"], owner)
        assert restored["status"] == "queued", restored
        metrics = await S.research_metrics(db, admin["id"])
        assert "jobs" in metrics
        await _denied(S.research_metrics(db, owner["id"]), 403)

        with patch("app.services.research_providers.search_sources", AsyncMock(side_effect=ProviderUnavailable("unavailable", "down"))):
            empty = await S.discover_companies_for_brief(db, brief["id"], owner)
        assert isinstance(empty, list)
    finally:
        await db.close()


def test_research_jobs_recover_and_stay_owned() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    test_research_jobs_recover_and_stay_owned()
    print("ok")
