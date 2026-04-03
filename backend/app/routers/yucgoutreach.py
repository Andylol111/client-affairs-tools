"""
YUCGoutreach company discovery: SQL-backed runs, parallel enrichment, Excel export.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.auth_deps import get_current_user
from app.database import get_db, row_to_dict
from app.services.yucgoutreach_discovery import _yucgoutreach_run_guard, build_yucgoutreach_excel_bytes

router = APIRouter()


class YucgOutreachRunCreate(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=500)
    company_domain: str | None = Field(None, max_length=255)
    linkedin_company_url: str | None = Field(None, max_length=2048)
    max_prospects: int = Field(25, ge=1, le=200)
    worker_concurrency: int = Field(4, ge=1, le=16)


def _run_to_dict(row: dict) -> dict:
    return {
        "id": row["id"],
        "company_name": row.get("company_name"),
        "company_domain": row.get("company_domain"),
        "linkedin_company_url": row.get("linkedin_company_url"),
        "max_prospects": row.get("max_prospects"),
        "worker_concurrency": row.get("worker_concurrency"),
        "status": row.get("status"),
        "progress_pct": row.get("progress_pct"),
        "progress_message": row.get("progress_message"),
        "prospects_count": row.get("prospects_count"),
        "research_json": row.get("research_json"),
        "error_message": row.get("error_message"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "completed_at": row.get("completed_at"),
    }


async def _get_run_for_user(run_id: int, user_id: int) -> dict | None:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM yucgoutreach_discovery_runs WHERE id = ? AND user_id = ?",
            (run_id, user_id),
        )
        row = await cur.fetchone()
        return row_to_dict(row) if row else None
    finally:
        await db.close()


@router.post("/runs")
async def create_run(body: YucgOutreachRunCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO yucgoutreach_discovery_runs (
                user_id, company_name, company_domain, linkedin_company_url,
                max_prospects, worker_concurrency, status, progress_message
            ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 'Queued')""",
            (
                user["id"],
                body.company_name.strip(),
                (body.company_domain or "").strip() or None,
                (body.linkedin_company_url or "").strip() or None,
                body.max_prospects,
                body.worker_concurrency,
            ),
        )
        await db.commit()
        run_id = cur.lastrowid
    finally:
        await db.close()

    asyncio.create_task(_yucgoutreach_run_guard(run_id))
    return {"id": run_id, "status": "queued"}


@router.get("/runs")
async def list_runs(user: dict = Depends(get_current_user), limit: int = 50):
    limit = max(1, min(limit, 200))
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT * FROM yucgoutreach_discovery_runs WHERE user_id = ?
            ORDER BY id DESC LIMIT ?""",
            (user["id"], limit),
        )
        rows = await cur.fetchall()
        return [_run_to_dict(row_to_dict(r)) for r in rows]
    finally:
        await db.close()


@router.get("/runs/{run_id}")
async def get_run(run_id: int, user: dict = Depends(get_current_user)):
    row = await _get_run_for_user(run_id, user["id"])
    if not row:
        raise HTTPException(404, "Run not found")
    return _run_to_dict(row)


@router.get("/runs/{run_id}/prospects")
async def list_prospects(run_id: int, user: dict = Depends(get_current_user), limit: int = 500):
    if not await _get_run_for_user(run_id, user["id"]):
        raise HTTPException(404, "Run not found")
    limit = max(1, min(limit, 2000))
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM yucgoutreach_prospects WHERE run_id = ? ORDER BY id LIMIT ?",
            (run_id, limit),
        )
        rows = await cur.fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        await db.close()


@router.get("/runs/{run_id}/export.xlsx")
async def export_run(run_id: int, user: dict = Depends(get_current_user)):
    run = await _get_run_for_user(run_id, user["id"])
    if not run:
        raise HTTPException(404, "Run not found")
    try:
        data = await build_yucgoutreach_excel_bytes(run_id)
    except ValueError:
        raise HTTPException(404, "Run not found")
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in (run.get("company_name") or "export"))[
        :80
    ]
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="YUCGoutreach_{safe_name}_{run_id}.xlsx"',
        },
    )


@router.delete("/runs/{run_id}")
async def delete_run(run_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cur = await db.execute(
            "DELETE FROM yucgoutreach_discovery_runs WHERE id = ? AND user_id = ?",
            (run_id, user["id"]),
        )
        await db.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Run not found")
    finally:
        await db.close()
    return {"ok": True, "deleted": run_id}
