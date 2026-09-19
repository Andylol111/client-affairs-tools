"""
YUCG outreach target recommendations using website corpus + prospect spreadsheet.
Inference is Bedrock rank (Haiku) via llm.py.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from app.services.prospect_coordinator import (
    _prospect_api_row,
    score_prospect,
    top_prospects_for_ai,
)


def _resolve_data_dir() -> Path:
    """The corpus ships as a git-tracked file at <repo_root>/data/ in local
    dev (backend/app/services/file.py -> backend -> repo_root, 3 levels up).
    The Docker image's WORKDIR (/app) does not preserve a "backend/"
    wrapper - docker/app.Dockerfile's `COPY backend .` flattens backend's
    contents directly into /app, so the equivalent file in the image is one
    level shallower (/app/app/services/file.py -> /app, 2 levels up). Check
    both rather than hard-coding one depth, so this keeps working if either
    layout changes independently."""
    here = Path(__file__).resolve()
    for candidate in (here.parents[3] / "data", here.parents[2] / "data"):
        if (candidate / "yucg_website_corpus.txt").is_file():
            return candidate
    return here.parents[3] / "data"


_REPO_ROOT = _resolve_data_dir().parent
DEFAULT_CORPUS_PATH = _resolve_data_dir() / "yucg_website_corpus.txt"
YUCG_CORPUS_PATH = Path(
    os.getenv("YUCG_CORPUS_PATH", str(DEFAULT_CORPUS_PATH))
)
if not YUCG_CORPUS_PATH.is_absolute():
    YUCG_CORPUS_PATH = _REPO_ROOT / YUCG_CORPUS_PATH

_SECTION_RE = re.compile(
    r"^===\s*(.+?)\s*===\s*\nSource:\s*(https?://\S+)\s*\n-+\s*\n",
    re.MULTILINE,
)


def corpus_path() -> Path:
    return YUCG_CORPUS_PATH


def load_website_corpus() -> str:
    path = corpus_path()
    if not path.is_file():
        raise FileNotFoundError(
            f"YUCG website corpus not found at {path}. "
            "Run: python scripts/build_yucg_ollama_context.py"
        )
    return path.read_text(encoding="utf-8")


def parse_corpus_sections(corpus: str) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    matches = list(_SECTION_RE.finditer(corpus))
    for i, m in enumerate(matches):
        title = m.group(1).strip()
        url = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(corpus)
        body = corpus[start:end].strip()
        if body:
            sections.append({"title": title, "url": url, "excerpt": body[:1200]})
    if not sections and corpus.strip():
        sections.append(
            {
                "title": "corpus",
                "url": "https://www.yaleconsulting.org/",
                "excerpt": corpus.strip()[:1200],
            }
        )
    return sections


def _find_corpus_citation(
    sections: list[dict[str, str]], url: str | None, excerpt_hint: str | None
) -> tuple[str, str]:
    if url:
        for s in sections:
            if s["url"].rstrip("/") == url.rstrip("/") or url in s["url"]:
                ex = (excerpt_hint or s["excerpt"])[:500]
                return s["url"], ex
    if excerpt_hint:
        blob = excerpt_hint.lower()[:80]
        for s in sections:
            if blob and blob in s["excerpt"].lower():
                return s["url"], excerpt_hint[:500]
    if sections:
        s = sections[0]
        return s["url"], (excerpt_hint or s["excerpt"])[:500]
    return "https://www.yaleconsulting.org/", (excerpt_hint or "")[:500]


# Bedrock caps a reply at 4096 tokens, and the reply is JSON that must parse
# whole: one recommendation over the line truncates the object mid-string and
# the entire response is lost, which is what "Model returned no parseable
# JSON" was reporting. Roughly 4 chars per token, so the per-field limits
# below keep a full set of MAX_RECOMMENDATIONS inside the budget with room to
# spare, rather than relying on the model to be brief unprompted.
MAX_RECOMMENDATIONS = 10
_REPLY_TOKEN_BUDGET = 4096


def _build_system_prompt(corpus: str, n: int = 5) -> str:
    return f"""You are the YUCG (Yale Undergraduate Consulting Group) outreach coordinator AI.
Recommend exactly {n} companies from the candidate spreadsheet summary for this week's outreach.

Use ONLY facts from the YUCG website corpus below when citing services, clients, or positioning.
Every recommendation MUST cite a real spreadsheet row_index and a corpus URL with a short excerpt.

Keep the reply short enough to finish: rationale at most 200 characters, each
reasoning step at most 120 characters, exactly 3 steps, excerpt at most 200
characters. A truncated reply is discarded in full, so brevity is required.

YUCG WEBSITE CORPUS (verified sources):
{corpus[:14000]}

Output valid JSON only with this schema:
{{
  "recommendations": [
    {{
      "rank": 1,
      "row_index": <Excel row number from candidates>,
      "company": "<company name>",
      "rationale": "<one sentence>",
      "reasoning_chain": ["<step1>", "<step2>", "<step3>"],
      "yucg_website_url": "https://www.yaleconsulting.org/...",
      "yucg_website_excerpt": "<verbatim short quote from corpus>",
      "suggested_contact_type": "<from sheet or best fit>",
      "engagement_angle": "<10-week project angle>"
    }}
  ]
}}"""


def _build_user_prompt(
    candidates: list[dict[str, Any]],
    *,
    sector: str | None,
    contact_type: str | None,
    n: int,
) -> str:
    slim = [
        {
            "row_index": c.get("row_index"),
            "company": c.get("company"),
            "sector": c.get("sector"),
            "incentive_score": c.get("incentive_score"),
            "contact_type": c.get("contact_type"),
            "yale_hook": c.get("yale_hook"),
            "engagement_theme": (c.get("engagement_theme") or "")[:280],
            "why_attractive": (c.get("why_attractive") or "")[:280],
        }
        for c in candidates
    ]
    filters = {
        "sector": sector,
        "contact_type": contact_type,
        "pick_count": n,
    }
    return (
        f"Filters: {json.dumps(filters)}\n\n"
        f"Candidate prospects (top {len(slim)} by incentive_score):\n"
        f"{json.dumps(slim, indent=2)}\n\n"
        f"Pick the best {n} for outreach this week. Prefer strong Yale hooks and clear YUCG service fit."
    )


def _row_by_index(candidates: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(c["row_index"]): c for c in candidates if c.get("row_index") is not None}


_PROMPT_CHAR_BUDGET = 22000  # margin below llm.py's hard 24,000-char limit
_CORPUS_PROMPT_CAP = 9000  # generous room for real citations without dominating the budget


def _fit_prompt_budget(
    corpus: str,
    candidates: list[dict[str, Any]],
    *,
    sector: str | None,
    contact_type: str | None,
    n: int,
) -> tuple[str, list[dict[str, Any]]]:
    """Trim the corpus and/or candidate list so the real system+user prompt
    stays under llm.py's 24,000-character hard limit, with margin. Computed
    from the actual prompt builders rather than fixed guesses, so this stays
    correct if the corpus grows (build_yucg_ollama_context.py re-scrapes more
    pages) or the candidate count changes - both silently broke this exact
    call once the corpus started loading for real (previously
    load_website_corpus() always raised first, hiding it). Candidates are
    pre-sorted best-first by incentive_score, so dropping from the tail
    drops the least useful ones first."""
    trimmed_corpus = corpus[:_CORPUS_PROMPT_CAP]
    trimmed_candidates = list(candidates)
    while trimmed_candidates:
        total = (
            len(_build_system_prompt(trimmed_corpus))
            + len(_build_user_prompt(trimmed_candidates, sector=sector, contact_type=contact_type, n=n))
        )
        if total <= _PROMPT_CHAR_BUDGET:
            break
        trimmed_candidates = trimmed_candidates[:-1]
    return trimmed_corpus, trimmed_candidates


async def ai_recommend_prospects(
    *,
    n: int = 5,
    sector: str | None = None,
    contact_type: str | None = None,
    min_incentive_score: float | None = None,
    candidate_limit: int = 30,
    model_id: str | None = None,
) -> dict[str, Any]:
    from app.services.llm import complete_json, is_bedrock_model, rank_model_id

    explicit = (model_id or "").strip()
    model = explicit if is_bedrock_model(explicit) else rank_model_id()
    # More than this cannot be returned inside one parseable reply.
    n = max(1, min(int(n or 5), MAX_RECOMMENDATIONS))

    try:
        corpus = load_website_corpus()
    except FileNotFoundError as e:
        return {
            "mode": "ai",
            "count": 0,
            "recommendations": [],
            "model": model,
            "error": str(e),
        }

    sections = parse_corpus_sections(corpus)
    candidates = top_prospects_for_ai(
        limit=candidate_limit,
        sector=sector,
        contact_type=contact_type,
        min_incentive_score=min_incentive_score,
    )
    if not candidates:
        return {
            "mode": "ai",
            "count": 0,
            "recommendations": [],
            "model": model,
            "error": "No prospects matched filters in spreadsheet.",
        }

    corpus, candidates = _fit_prompt_budget(corpus, candidates, sector=sector, contact_type=contact_type, n=n)
    if not candidates:
        return {
            "mode": "ai",
            "count": 0,
            "recommendations": [],
            "model": model,
            "error": "The website corpus alone exceeds the model's input limit; shrink data/yucg_website_corpus.txt.",
        }

    import asyncio
    from fastapi import HTTPException

    try:
        parsed = await asyncio.to_thread(
            complete_json,
            _build_user_prompt(candidates, sector=sector, contact_type=contact_type, n=n),
            model,
            _build_system_prompt(corpus, n),
            _REPLY_TOKEN_BUDGET,
        )
    except HTTPException as exc:
        return {
            "mode": "ai",
            "count": 0,
            "recommendations": [],
            "model": model,
            "error": str(exc.detail),
        }
    if not parsed or "recommendations" not in parsed:
        return {
            "mode": "ai",
            "count": 0,
            "recommendations": [],
            "model": model,
            "error": "Model returned no parseable JSON.",
        }

    by_row = _row_by_index(candidates)
    recommendations: list[dict[str, Any]] = []
    raw_items = parsed.get("recommendations") or []
    if not isinstance(raw_items, list):
        raw_items = []

    for item in raw_items[:n]:
        if not isinstance(item, dict):
            continue
        try:
            row_index = int(item.get("row_index"))
        except (TypeError, ValueError):
            continue
        row = by_row.get(row_index)
        if not row:
            for c in candidates:
                if (c.get("company") or "").lower() == str(item.get("company", "")).lower():
                    row = c
                    row_index = int(c["row_index"])
                    break
        if not row:
            continue

        composite, breakdown = score_prospect(row, contact_type_query=contact_type)
        breakdown["total"] = composite
        breakdown["rationale"] = item.get("rationale") or row.get("score_rationale")

        cite_url, cite_excerpt = _find_corpus_citation(
            sections,
            str(item.get("yucg_website_url") or ""),
            str(item.get("yucg_website_excerpt") or ""),
        )
        chain = item.get("reasoning_chain")
        if not isinstance(chain, list):
            chain = [str(item.get("rationale") or "Matched spreadsheet + YUCG fit")]
        chain = [str(x) for x in chain if x][:6]

        recommendations.append(
            {
                "prospect": _prospect_api_row(row),
                "verifiability": {
                    "company": row.get("company"),
                    "row_index": row_index,
                    "score_breakdown": breakdown,
                    "verification_source_url": row.get("verification_source_url"),
                    "yucg_service_tags": row.get("yucg_service_tags") or [],
                    "website_citation_url": cite_url,
                    "website_citation_excerpt": cite_excerpt,
                    "reasoning_chain": chain,
                },
                "composite_score": composite,
            }
        )

    return {
        "mode": "ai",
        "count": len(recommendations),
        "recommendations": recommendations,
        "model": model,
        "error": None if recommendations else "Model returned no valid row_index matches.",
    }
