"""Rank model is Haiku on Bedrock. From backend/: python3 tests/test_llm_provider.py"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.llm import default_model_id, llm_provider, rank_model_id  # noqa: E402


def test_bedrock_rank_is_haiku() -> None:
    os.environ["LLM_PROVIDER"] = "bedrock"
    os.environ.pop("BEDROCK_RANK_MODEL_ID", None)
    os.environ.pop("BEDROCK_MODEL_ID", None)
    os.environ.pop("LLM_MODEL", None)
    assert llm_provider() == "bedrock"
    assert "haiku" in rank_model_id().lower()
    assert rank_model_id() != default_model_id()


def test_explicit_rank_wins() -> None:
    os.environ["LLM_PROVIDER"] = "bedrock"
    os.environ["BEDROCK_RANK_MODEL_ID"] = "us.anthropic.claude-3-haiku-20240307-v1:0"
    assert rank_model_id() == "us.anthropic.claude-3-haiku-20240307-v1:0"


if __name__ == "__main__":
    test_bedrock_rank_is_haiku()
    test_explicit_rank_wins()
    print("ok")
