"""Rank model is Haiku on Bedrock. From backend/: python3 tests/test_llm_provider.py"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from fastapi import HTTPException
from app.services.llm import complete_text, default_model_id, llm_provider, rank_model_id  # noqa: E402


def test_bedrock_rank_is_haiku() -> None:
    os.environ["LLM_PROVIDER"] = "bedrock"
    os.environ.pop("BEDROCK_RANK_MODEL_ID", None)
    os.environ.pop("BEDROCK_MODEL_ID", None)
    os.environ.pop("LLM_MODEL", None)
    assert llm_provider() == "bedrock"
    assert "haiku" in rank_model_id().lower()
    assert rank_model_id() == default_model_id(), "Interactive and ranking work share the reviewed low-cost model"


def test_explicit_rank_wins() -> None:
    os.environ["LLM_PROVIDER"] = "bedrock"
    os.environ["BEDROCK_RANK_MODEL_ID"] = "us.anthropic.claude-3-haiku-20240307-v1:0"
    assert rank_model_id() == "us.anthropic.claude-3-haiku-20240307-v1:0"


def test_assistant_stays_on_bedrock_when_provider_is_unset() -> None:
    os.environ.pop("LLM_PROVIDER", None)
    os.environ.pop("BEDROCK_RANK_MODEL_ID", None)
    os.environ.pop("BEDROCK_MODEL_ID", None)
    os.environ.pop("LLM_MODEL", None)
    os.environ["OLLAMA_MODEL"] = "llama3.2"
    assert "haiku" in rank_model_id().lower()
    assert "haiku" in default_model_id().lower()


def test_missing_bedrock_credentials_are_unavailable() -> None:
    os.environ["LLM_PROVIDER"] = "bedrock"
    os.environ.pop("BEDROCK_RANK_MODEL_ID", None)
    os.environ.pop("BEDROCK_MODEL_ID", None)
    os.environ.pop("LLM_MODEL", None)
    os.environ.pop("AWS_PROFILE", None)
    import app.services.llm as llm_mod
    llm_mod._cli_login_client = None
    llm_mod._cli_login_until = 0.0
    with patch("boto3.client", side_effect=RuntimeError("Unable to locate credentials")):
        try:
            complete_text("ping", rank_model_id())
            raise AssertionError("Missing credentials became a 500")
        except HTTPException as exc:
            assert exc.status_code == 503
            assert "unavailable" in str(exc.detail).lower()


def test_aws_cli_login_session_is_used() -> None:
    from types import SimpleNamespace
    from botocore.exceptions import NoCredentialsError
    import app.services.llm as llm_mod

    os.environ["LLM_PROVIDER"] = "bedrock"
    os.environ["AWS_PROFILE"] = "andreheidvscode"
    os.environ.pop("BEDROCK_RANK_MODEL_ID", None)
    os.environ.pop("BEDROCK_MODEL_ID", None)
    os.environ.pop("LLM_MODEL", None)
    llm_mod._cli_login_client = None
    llm_mod._cli_login_until = 0.0
    first = SimpleNamespace(converse=lambda **_k: (_ for _ in ()).throw(NoCredentialsError()))
    second = SimpleNamespace(converse=lambda **_k: {"output": {"message": {"content": [{"text": "pong"}]}}, "usage": {}})
    exported = "\n".join([
        "export AWS_ACCESS_KEY_ID=AKIATEST",
        "export AWS_SECRET_ACCESS_KEY=secret",
        "export AWS_SESSION_TOKEN=token",
    ])
    with patch("boto3.client", side_effect=[first, second]) as factory, patch(
        "subprocess.run",
        return_value=SimpleNamespace(returncode=0, stdout=exported, stderr=""),
    ):
        assert complete_text("ping", rank_model_id()) == "pong"
        assert factory.call_count == 2
        assert factory.call_args.kwargs["aws_access_key_id"] == "AKIATEST"


if __name__ == "__main__":
    test_bedrock_rank_is_haiku()
    test_explicit_rank_wins()
    test_assistant_stays_on_bedrock_when_provider_is_unset()
    test_missing_bedrock_credentials_are_unavailable()
    test_aws_cli_login_session_is_used()
    print("ok")
