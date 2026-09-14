"""Member-owned research briefs, durable runs, and sourced recommendations."""
from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth_deps import get_current_user
from app.database import get_db
from app.services import research_service as S

router = APIRouter()


class ResearchSpec(BaseModel):
    industries: list[str] = Field(default_factory=list, max_length=12)
    companies: list[str] = Field(default_factory=list, max_length=12)
    geography: list[str] = Field(default_factory=list, max_length=8)
    size: list[str] = Field(default_factory=list, max_length=4)
    roles: list[str] = Field(default_factory=list, max_length=12)
    seniority: list[str] = Field(default_factory=list, max_length=6)
    people_per_company: int = Field(default=2, ge=1, le=10)
    exclusions: list[str] = Field(default_factory=list, max_length=12)
    reason: str = Field(min_length=1, max_length=2000)


class BriefCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    project_id: int | None = None
    spec: ResearchSpec


class BriefUpdate(BriefCreate):
    pass


class CompanyResearch(BaseModel):
    brief_id: int


class CompanyReview(BaseModel):
    disposition: Literal['accepted', 'rejected']
    reason: str | None = Field(default=None, max_length=500)


class JobCreate(BaseModel):
    brief_id: int


class RecommendationReview(BaseModel):
    disposition: Literal['accepted', 'rejected']
    reason: str | None = Field(default=None, max_length=500)


@router.get('/briefs')
async def list_briefs(project_id: int | None = None, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return {'items': await S.list_briefs(db, user, project_id)}
    finally:
        await db.close()


@router.post('/briefs')
async def create_brief(payload: BriefCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.create_brief(db, user, payload.name, payload.spec.model_dump(), payload.project_id)
    finally:
        await db.close()


@router.put('/briefs/{brief_id}')
async def update_brief(brief_id: int, payload: BriefUpdate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.update_brief(db, brief_id, user, payload.name, payload.spec.model_dump(), payload.project_id)
    finally:
        await db.close()


@router.post('/briefs/{brief_id}/companies')
async def research_current_companies(brief_id: int, user: dict = Depends(get_current_user)):
    """Research current company recommendations for this brief now (not a durable job)."""
    db = await get_db()
    try:
        brief = await S.discover_companies_for_brief(db, brief_id, user)
        return {'items': brief}
    finally:
        await db.close()


@router.get('/briefs/{brief_id}/companies')
async def list_brief_companies(brief_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return {'items': await S.list_companies(db, brief_id, user)}
    finally:
        await db.close()


@router.patch('/companies/{company_id}')
async def review_company(company_id: int, payload: CompanyReview, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        await S.ensure_schema(db)
        row = await (await db.execute('SELECT brief_id FROM research_companies WHERE id=?', (company_id,))).fetchone()
        if not row:
            raise HTTPException(404, 'Company not found')
        return await S.review_company(db, row['brief_id'], company_id, user,
                                      payload.disposition, payload.reason)
    finally:
        await db.close()


@router.post('/jobs')
async def create_job(payload: JobCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.create_job(db, payload.brief_id, user)
    finally:
        await db.close()


@router.get('/jobs')
async def list_jobs(brief_id: int | None = None, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return {'items': await S.list_jobs(db, user, brief_id)}
    finally:
        await db.close()


@router.get('/jobs/{job_id}')
async def get_job(job_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.get_job(db, job_id, user)
    finally:
        await db.close()


@router.post('/jobs/{job_id}/cancel')
async def cancel_job(job_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.cancel_job(db, job_id, user)
    finally:
        await db.close()


@router.post('/jobs/{job_id}/resume')
async def resume_job(job_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.resume_job(db, job_id, user)
    finally:
        await db.close()


@router.get('/recommendations')
async def list_recommendations(brief_id: int, state: str | None = None, offset: int = 0,
                               limit: int = 100, user: dict = Depends(get_current_user)):
    if state and state not in ('ready_to_review', 'needs_evidence', 'excluded'):
        raise HTTPException(422, 'state must be ready_to_review, needs_evidence, or excluded')
    offset = max(0, offset)
    limit = max(1, min(limit, 200))
    db = await get_db()
    try:
        return {'items': await S.recommendations_for_brief(db, brief_id, user, state, offset, limit)}
    finally:
        await db.close()


@router.get('/recommendations/{rec_id}')
async def get_recommendation(rec_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.get_recommendation(db, rec_id, user)
    finally:
        await db.close()


@router.post('/recommendations/{rec_id}/review')
async def review_recommendation(rec_id: int, payload: RecommendationReview,
                                user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        return await S.review_recommendation(db, rec_id, user, payload.disposition, payload.reason)
    finally:
        await db.close()
