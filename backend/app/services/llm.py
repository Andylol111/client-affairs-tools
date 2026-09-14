"""Text generation: current Claude on Bedrock US inference profiles."""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any

# US geo profiles. Converse will not take a bare anthropic.* foundation id.
# Keep the default catalog deliberately small. Administrators can add a reviewed
# model ID through BEDROCK_ALLOWED_MODEL_IDS without exposing costly models by default.
BEDROCK_ANTHROPIC: list[dict[str, str]] = [
    {
        "id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "label": "Claude Haiku 4.5",
        "tier": "haiku",
        "blurb": "Fast, grounded club work",
    },
]

_HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
_ALLOWED = {m["id"] for m in BEDROCK_ANTHROPIC}
_inference_slots = threading.BoundedSemaphore(2)
_UNAVAILABLE = "The language model is unavailable right now."


def allowed_bedrock_models() -> set[str]:
    configured = os.getenv('BEDROCK_ALLOWED_MODEL_IDS', '')
    if configured.strip():
        return {value.strip() for value in configured.split(',') if value.strip()}
    return _ALLOWED | {default_model_id(), rank_model_id()}


def validate_model(model_id: str | None) -> str:
    from fastapi import HTTPException
    mid = (model_id or default_model_id()).strip()
    if (llm_provider() == 'bedrock' or is_bedrock_model(mid)) and mid not in allowed_bedrock_models():
        raise HTTPException(400, 'This model is not enabled by the administrator')
    return mid


def llm_provider() -> str:
    return (os.getenv("LLM_PROVIDER") or "ollama").strip().lower()


def default_model_id() -> str:
    explicit = (os.getenv("BEDROCK_MODEL_ID") or os.getenv("LLM_MODEL") or "").strip()
    if explicit:
        return explicit
    return _HAIKU


def rank_model_id() -> str:
    """Cheap labels on the host. Studio still uses the UI / default_model_id()."""
    explicit = (os.getenv("BEDROCK_RANK_MODEL_ID") or "").strip()
    if explicit:
        return explicit
    return _HAIKU


def is_bedrock_model(model_id: str | None) -> bool:
    mid = (model_id or "").strip()
    return mid.startswith("us.anthropic.") or mid.startswith("anthropic.") or mid.startswith("global.anthropic.")


def list_models() -> dict[str, Any]:
    return {
        "provider": llm_provider(),
        "default": default_model_id(),
        "groups": [
            {"id": "anthropic", "label": "Claude on Bedrock", "models": [m for m in BEDROCK_ANTHROPIC if m['id'] in allowed_bedrock_models()]},
        ],
    }


def complete_text(
    prompt: str,
    model_id: str | None = None,
    system: str | None = None,
    *,
    user_id: int | None = None,
    purpose: str = 'inference',
    max_tokens: int = 2048,
) -> str:
    from fastapi import HTTPException
    mid = validate_model(model_id)
    if is_bedrock_model(mid):
        return _bedrock_text(prompt, mid, system, user_id=user_id, purpose=purpose, max_tokens=max_tokens)
    try:
        return _ollama_text(prompt, mid, system)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, _UNAVAILABLE) from exc


def complete_json(prompt: str, model_id: str | None = None, system: str | None = None) -> dict[str, Any] | None:
    raw = complete_text(prompt, model_id=model_id, system=system)
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return None
    try:
        data = json.loads(match.group())
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _ollama_text(prompt: str, model_id: str, system: str | None) -> str:
    ollama_name = model_id.split(":", 1)[1] if model_id.startswith("ollama:") else model_id
    from ollama import chat

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    response = chat(model=ollama_name, messages=messages)
    return (response.message.content or "").strip()


_cli_login_client = None
_cli_login_until = 0.0


def _bedrock_client_from_cli_login(region: str, config: Any):
    """Use `aws login` sessions from AWS_PROFILE when boto3 cannot load them natively."""
    import subprocess
    import boto3
    from fastapi import HTTPException

    global _cli_login_client, _cli_login_until
    now = time.time()
    if _cli_login_client is not None and now < _cli_login_until:
        return _cli_login_client
    profile = (os.getenv("AWS_PROFILE") or "").strip()
    if not profile:
        raise HTTPException(503, _UNAVAILABLE)
    try:
        completed = subprocess.run(
            ["aws", "configure", "export-credentials", "--profile", profile, "--format", "env"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except Exception as exc:
        raise HTTPException(503, _UNAVAILABLE) from exc
    if completed.returncode != 0:
        raise HTTPException(503, _UNAVAILABLE)
    try:
        exported: dict[str, str] = {}
        for line in (completed.stdout or "").splitlines():
            row = line.strip()
            if row.startswith("export "):
                row = row[7:]
            if "=" not in row:
                continue
            key, value = row.split("=", 1)
            exported[key.strip()] = value.strip().strip('"').strip("'")
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=config,
            aws_access_key_id=exported["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=exported["AWS_SECRET_ACCESS_KEY"],
            aws_session_token=exported.get("AWS_SESSION_TOKEN") or None,
        )
    except Exception as exc:
        raise HTTPException(503, _UNAVAILABLE) from exc
    _cli_login_client = client
    _cli_login_until = now + 8 * 60
    return client


def _bedrock_text(
    prompt: str,
    model_id: str,
    system: str | None,
    *,
    user_id: int | None = None,
    purpose: str = 'inference',
    max_tokens: int = 2048,
) -> str:
    import boto3

    from fastapi import HTTPException
    from botocore.config import Config
    mid = validate_model(model_id)
    if len(prompt) + len(system or '') > 24000:
        raise HTTPException(413, 'Draft input exceeds the 24,000 character limit')
    region = (os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1").strip()
    if not 1 <= max_tokens <= 4096:
        raise HTTPException(503, 'Model output limit is invalid')
    kwargs: dict[str, Any] = {
        "modelId": mid,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {"maxTokens": max_tokens},
    }
    if system:
        kwargs["system"] = [{"text": system}]
    if not _inference_slots.acquire(blocking=False):
        raise HTTPException(429, 'Draft generation is busy; please retry shortly')
    try:
        from app.services.generation_policy import reserve_bedrock_invocation, complete_bedrock_invocation
        reservation_id = reserve_bedrock_invocation(
            mid,
            user_id=user_id,
            purpose=purpose,
            estimated_input_tokens=max(1,(len(prompt)+len(system or ''))//4),
            max_output_tokens=max_tokens,
        )
        runtime_config = Config(connect_timeout=5, read_timeout=60, retries={'total_max_attempts': 1})
        try:
            client = boto3.client("bedrock-runtime", region_name=region, config=runtime_config)
            resp = client.converse(**kwargs)
        except HTTPException:
            raise
        except Exception as exc:
            from botocore.exceptions import NoCredentialsError
            if not isinstance(exc, NoCredentialsError):
                raise HTTPException(503, _UNAVAILABLE) from exc
            try:
                client = _bedrock_client_from_cli_login(region, runtime_config)
                resp = client.converse(**kwargs)
            except HTTPException:
                raise
            except Exception as retry_exc:
                raise HTTPException(503, _UNAVAILABLE) from retry_exc
        usage = resp.get('usage') or {}
        complete_bedrock_invocation(reservation_id,usage.get('inputTokens'),usage.get('outputTokens'))
    finally:
        _inference_slots.release()
    parts = ((resp.get("output") or {}).get("message") or {}).get("content") or []
    texts = [p.get("text") or "" for p in parts if isinstance(p, dict)]
    return "".join(texts).strip()
