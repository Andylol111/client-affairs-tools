"""Company segments: AI-classified from a fixed list, then member-managed, plus
per-segment outreach goals feeding the actual-vs-goal comparison chart."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth_deps import get_current_user
from app.database import get_db
from app.services.generation_policy import reserve_segment_classification
from app.services.segment_classifier import SEGMENTS, classify_companies, unclassified_companies

router = APIRouter()


class SegmentReassign(BaseModel):
    segment: str = Field(min_length=1)


class SegmentGoal(BaseModel):
    segment: str = Field(min_length=1)
    target_companies: int = Field(ge=0, le=100000)


@router.get('/list')
async def list_segments():
    """Every known segment name, including ones with zero companies yet, so a
    goal can be set before any company has been classified into it."""
    return {"segments": SEGMENTS}


@router.get('/summary')
async def segment_summary():
    """Per-segment company/contact/sent/replied counts plus goal and progress,
    for the actual-vs-goal chart and the segment breakdown chart."""
    db = await get_db()
    try:
        assigned = await (await db.execute(
            """SELECT cs.segment, cs.company_key, cs.company_name, cs.company_domain,
                 count(DISTINCT c.id) AS contact_count,
                 count(DISTINCT CASE WHEN cc.status IN ('sent','replied','bounced') THEN c.id END) AS reached_contacts,
                 count(DISTINCT CASE WHEN cc.status = 'replied' THEN c.id END) AS replied_contacts
               FROM company_segments cs
               LEFT JOIN contacts c
                 ON (cs.company_domain IS NOT NULL AND cs.company_domain != '' AND lower(c.company_domain) = lower(cs.company_domain))
                 OR ((cs.company_domain IS NULL OR cs.company_domain = '') AND lower(c.company) = lower(cs.company_name))
               LEFT JOIN campaign_contacts cc ON cc.contact_id = c.id
               GROUP BY cs.company_key"""
        )).fetchall()
        goals = {r['segment']: r['target_companies'] for r in await (await db.execute(
            "SELECT segment, target_companies FROM segment_goals"
        )).fetchall()}
        unclassified_count = len(await unclassified_companies(db))
    finally:
        await db.close()

    by_segment: dict[str, dict] = {s: {"segment": s, "companies": 0, "contacts": 0, "reached_contacts": 0, "replied_contacts": 0} for s in SEGMENTS}
    companies_by_segment: dict[str, list[dict]] = {s: [] for s in SEGMENTS}
    for row in assigned:
        seg = row['segment'] if row['segment'] in by_segment else 'Other'
        bucket = by_segment[seg]
        bucket['companies'] += 1
        bucket['contacts'] += row['contact_count'] or 0
        bucket['reached_contacts'] += row['reached_contacts'] or 0
        bucket['replied_contacts'] += row['replied_contacts'] or 0
        companies_by_segment[seg].append({
            "company_key": row['company_key'],
            "company_name": row['company_name'],
            "company_domain": row['company_domain'],
            "contacts": row['contact_count'] or 0,
        })

    summary = []
    for s in SEGMENTS:
        bucket = by_segment[s]
        target = goals.get(s, 0)
        summary.append({
            **bucket,
            "target_companies": target,
            "progress_pct": round(min(100.0, bucket['companies'] / target * 100), 1) if target else None,
            "companies_list": companies_by_segment[s],
        })
    return {"summary": summary, "unclassified_companies": unclassified_count}


@router.post('/classify')
async def classify_unclassified(user: dict = Depends(get_current_user)):
    """AI-classify every company that has never been classified yet. A member
    can always override an individual result afterward via PUT /company/{key}."""
    await reserve_segment_classification(user['id'])
    db = await get_db()
    try:
        pending = await unclassified_companies(db)
    finally:
        await db.close()
    if not pending:
        return {"classified": 0, "remaining": 0}
    written = await classify_companies(pending, user['id'])
    db = await get_db()
    try:
        remaining = len(await unclassified_companies(db))
    finally:
        await db.close()
    return {"classified": written, "remaining": remaining}


@router.put('/company/{company_key}')
async def reassign_company(company_key: str, payload: SegmentReassign, user: dict = Depends(get_current_user)):
    """Member override of an AI (or prior member) segment assignment."""
    if payload.segment not in SEGMENTS:
        raise HTTPException(400, f"segment must be one of: {', '.join(SEGMENTS)}")
    db = await get_db()
    try:
        cursor = await db.execute(
            """UPDATE company_segments SET segment=?, source='member', rationale=NULL,
               classified_by=?, updated_at=CURRENT_TIMESTAMP WHERE company_key=?""",
            (payload.segment, user['id'], company_key),
        )
        if cursor.rowcount == 0:
            raise HTTPException(404, 'Company not found in segment registry')
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@router.get('/goals')
async def list_goals():
    db = await get_db()
    try:
        rows = await (await db.execute("SELECT segment, target_companies FROM segment_goals")).fetchall()
    finally:
        await db.close()
    return {"goals": {r['segment']: r['target_companies'] for r in rows}}


@router.put('/goals')
async def set_goal(payload: SegmentGoal, user: dict = Depends(get_current_user)):
    if payload.segment not in SEGMENTS:
        raise HTTPException(400, f"segment must be one of: {', '.join(SEGMENTS)}")
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO segment_goals (segment, target_companies, updated_by, updated_at)
               VALUES (?,?,?,CURRENT_TIMESTAMP)
               ON CONFLICT(segment) DO UPDATE SET
                 target_companies=excluded.target_companies, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP""",
            (payload.segment, payload.target_companies, user['id']),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}
