"""Find-contacts company AI uses Bedrock rank, not laptop Ollama."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("JWT_SECRET", "ai-recommend-test-secret-not-a-known-default")

from app.services.llm import rank_model_id
from app.services.yucg_ollama_recommender import ai_recommend_prospects

_CANDIDATE = {
    "row_index": 12,
    "company": "Acme",
    "sector": "Tech",
    "incentive_score": 80,
    "contact_type": "VP",
    "yale_hook": "alum",
    "has_yale_hook": True,
    "engagement_theme": "growth",
    "why_attractive": "fit",
    "outreach_priority": 2,
    "verification_source_url": "https://example.com",
    "yucg_service_tags": ["strategy"],
    "first_message_angle": "intro",
    "score_rationale": "strong fit",
}
_CORPUS = "=== Home ===\nSource: https://www.yaleconsulting.org/\n---\nYUCG consulting\n"
_PARSED = {
    "recommendations": [
        {
            "rank": 1,
            "row_index": 12,
            "company": "Acme",
            "rationale": "Strong Yale hook",
            "reasoning_chain": ["sheet", "fit"],
            "yucg_website_url": "https://www.yaleconsulting.org/",
            "yucg_website_excerpt": "YUCG consulting",
        }
    ]
}


def _run(provider: str | None):
    env = {"OLLAMA_MODEL": "llama3.2", "YUCG_OUTREACH_MODEL": "llama3.2"}
    if provider is not None:
        env["LLM_PROVIDER"] = provider
    with patch.dict(os.environ, env, clear=False):
        if provider is None:
            os.environ.pop("LLM_PROVIDER", None)
        with patch(
            "app.services.yucg_ollama_recommender.load_website_corpus",
            return_value=_CORPUS,
        ), patch(
            "app.services.yucg_ollama_recommender.top_prospects_for_ai",
            return_value=[_CANDIDATE],
        ), patch(
            "app.services.llm.complete_json",
            return_value=_PARSED,
        ) as complete:
            result = asyncio.run(ai_recommend_prospects(n=1))
            return result, complete


def test_bedrock_refresh_uses_rank_model_not_ollama() -> None:
    result, complete = _run("bedrock")
    assert result.get("error") is None
    assert result["count"] == 1
    assert result["recommendations"][0]["prospect"]["company"] == "Acme"
    assert complete.call_args.args[1] == rank_model_id()
    assert "haiku" in str(complete.call_args.args[1]).lower()
    assert "llama" not in str(result.get("model") or "").lower()


def test_unset_provider_still_uses_bedrock_rank() -> None:
    result, complete = _run(None)
    assert result.get("error") is None
    assert result["count"] == 1
    assert complete.call_args.args[1] == rank_model_id()


if __name__ == "__main__":
    test_bedrock_refresh_uses_rank_model_not_ollama()
    test_unset_provider_still_uses_bedrock_rank()
    print("ok")
