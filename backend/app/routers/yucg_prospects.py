"""
YUCG outreach coordinator API — spreadsheet-backed prospect list, recommendations, shortlist export.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth_deps import get_current_user
from app.services.prospect_coordinator import (
    _prospect_api_row,
    build_shortlist_csv,
    filter_prospects,
    load_prospects,
    prospects_meta,
    recommend_prospects,
    score_prospect,
)
from app.services.yucg_ollama_recommender import ai_recommend_prospects

router = APIRouter()


class AiRecommendRequest(BaseModel):
    sector: str | None = None
    contact_type: str | None = None
    min_incentive_score: float | None = Field(None, ge=0, le=100)
    n: int = Field(5, ge=1, le=10)
    model: str | None = None


class ExportShortlistRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    row_indexes: list[int] | None = Field(
        None,
        description="Explicit Excel row numbers to export; if omitted, uses filters + limit",
        alias="row_indices",
    )
    sector: str | None = None
    priority: int | None = Field(None, ge=1, le=5)
    min_incentive_score: float | None = Field(None, ge=0, le=100)
    contact_type: str | None = None
    q: str | None = None
    limit: int = Field(25, ge=1, le=200)
    contact_type_match: str | None = Field(
        None,
        description="Boost ranking by contact type (same as recommend query param)",
    )


@router.post("/prospects/refresh")
async def refresh_prospects(user: dict = Depends(get_current_user)):
    """Check the live catalog and reload the workbook only when its object changed."""
    try:
        load_prospects(force_reload=True)
        return prospects_meta()
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/prospects/meta")
async def get_prospects_meta(user: dict = Depends(get_current_user)):
    """Spreadsheet source info and distinct filter values."""
    try:
        return prospects_meta()
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/prospects")
async def list_prospects(
    user: dict = Depends(get_current_user),
    sector: str | None = None,
    priority: int | None = Query(None, ge=1, le=5),
    outreach_priority: int | None = Query(None, ge=1, le=5, alias="outreach_priority"),
    min_incentive_score: float | None = Query(None, ge=0, le=100),
    contact_type: str | None = None,
    q: str | None = None,
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    """List prospect targets from data/YUCG_Prospect_List.xlsx with optional filters."""
    effective_priority = outreach_priority if outreach_priority is not None else priority
    try:
        rows = filter_prospects(
            load_prospects(),
            sector=sector,
            priority=effective_priority,
            min_incentive_score=min_incentive_score,
            contact_type=contact_type,
            q=q,
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    total = len(rows)
    page = [_prospect_api_row(r) for r in rows[offset : offset + limit]]
    return {
        "prospects": page,
        "count": total,
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": page,
    }


@router.get("/prospects/recommend")
async def recommend_prospect_targets(
    user: dict = Depends(get_current_user),
    n: int = Query(10, ge=1, le=50),
    top: int | None = Query(None, ge=1, le=50),
    sector: str | None = None,
    priority: int | None = Query(None, ge=1, le=5),
    outreach_priority: int | None = Query(None, ge=1, le=5),
    min_incentive_score: float | None = Query(None, ge=0, le=100),
    contact_type: str | None = None,
    contact_type_match: str | None = None,
    q: str | None = None,
):
    """
    Top N outreach targets with weighted composite score and verifiability payload.
    Weights: incentive (45%), priority (25%), Yale hook (15%), contact type match (15%).
    """
    limit_n = top if top is not None else n
    effective_priority = outreach_priority if outreach_priority is not None else priority
    try:
        items = recommend_prospects(
            n=limit_n,
            sector=sector,
            priority=effective_priority,
            min_incentive_score=min_incentive_score,
            contact_type=contact_type,
            contact_type_match=contact_type_match,
            q=q,
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    return {
        "mode": "rules",
        "count": len(items),
        "recommendations": items,
        "model": None,
        "ollama_error": None,
    }


@router.post("/prospects/ai-recommend")
async def ai_recommend_targets(
    body: AiRecommendRequest,
    user: dict = Depends(get_current_user),
):
    """
    Ollama recommendations using YUCG website corpus + top spreadsheet candidates.
    Each item cites spreadsheet row_index, yaleconsulting.org URL/excerpt, and reasoning_chain.
    """
    try:
        result = await ai_recommend_prospects(
            n=body.n,
            sector=body.sector,
            contact_type=body.contact_type,
            min_incentive_score=body.min_incentive_score,
            model_id=body.model,
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    if result.get("ollama_error") and not result.get("recommendations"):
        raise HTTPException(503, detail=result["ollama_error"])
    return result


@router.post("/prospects/export-shortlist")
async def export_shortlist(body: ExportShortlistRequest, user: dict = Depends(get_current_user)):
    """CSV export for outreach week — explicit row_indexes or filtered top targets by score."""
    try:
        all_rows = load_prospects()
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    if body.row_indexes:
        wanted = set(body.row_indexes)
        selected = [r for r in all_rows if r.get("row_index") in wanted]
        selected.sort(key=lambda r: r.get("row_index") or 0)
    else:
        filtered = filter_prospects(
            all_rows,
            sector=body.sector,
            priority=body.priority,
            min_incentive_score=body.min_incentive_score,
            contact_type=body.contact_type,
            q=body.q,
        )
        scored: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
        for row in filtered:
            composite, breakdown = score_prospect(
                row,
                contact_type_query=body.contact_type_match or body.contact_type,
            )
            scored.append((composite, breakdown, row))
        scored.sort(key=lambda x: (-x[0], x[2].get("row_index") or 0))
        selected = []
        for composite, breakdown, row in scored[: body.limit]:
            enriched = dict(row)
            enriched["composite_score"] = composite
            enriched["score_breakdown"] = breakdown
            selected.append(enriched)

    if not selected:
        raise HTTPException(400, "No prospects matched export criteria")

    csv_bytes = build_shortlist_csv(selected)
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="yucg_outreach_shortlist.csv"'},
    )
