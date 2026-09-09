"""Text generation: current Claude on Bedrock US inference profiles."""
from __future__ import annotations

import json
import os
import re
from typing import Any

# US geo profiles. Converse will not take a bare anthropic.* foundation id.
# IDs from Bedrock model cards (Opus 5 / Sonnet 5 / Haiku 4.5).
BEDROCK_ANTHROPIC: list[dict[str, str]] = [
    {
        "id": "us.anthropic.claude-opus-5",
        "label": "Claude Opus 5",
        "tier": "opus",
        "blurb": "Hardest reasoning",
    },
    {
        "id": "us.anthropic.claude-sonnet-5",
        "label": "Claude Sonnet 5",
        "tier": "sonnet",
        "blurb": "Default for club week",
    },
    {
        "id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "label": "Claude Haiku 4.5",
        "tier": "haiku",
        "blurb": "Fast drafts",
    },
]

_ALLOWED = {m["id"] for m in BEDROCK_ANTHROPIC}


def llm_provider() -> str:
    return (os.getenv("LLM_PROVIDER") or "ollama").strip().lower()


def default_model_id() -> str:
    explicit = (os.getenv("BEDROCK_MODEL_ID") or os.getenv("LLM_MODEL") or "").strip()
    if explicit:
        return explicit
    return "us.anthropic.claude-sonnet-5"


def rank_model_id() -> str:
    """Cheap labels on the host. Studio still uses the UI / default_model_id()."""
    explicit = (os.getenv("BEDROCK_RANK_MODEL_ID") or "").strip()
    if explicit:
        return explicit
    return "us.anthropic.claude-haiku-4-5-20251001-v1:0"


def is_bedrock_model(model_id: str | None) -> bool:
    mid = (model_id or "").strip()
    return mid.startswith("us.anthropic.") or mid.startswith("anthropic.") or mid.startswith("global.anthropic.")


def list_models() -> dict[str, Any]:
    return {
        "provider": llm_provider(),
        "default": default_model_id(),
        "groups": [
            {"id": "anthropic", "label": "Claude on Bedrock", "models": BEDROCK_ANTHROPIC},
        ],
    }


def complete_text(prompt: str, model_id: str | None = None, system: str | None = None) -> str:
    mid = (model_id or default_model_id()).strip()
    if is_bedrock_model(mid):
        return _bedrock_text(prompt, mid, system)
    ollama_name = mid.split(":", 1)[1] if mid.startswith("ollama:") else mid
    from ollama import chat

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    response = chat(model=ollama_name, messages=messages)
    return (response.message.content or "").strip()


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


def _bedrock_text(prompt: str, model_id: str, system: str | None) -> str:
    import boto3

    mid = model_id if model_id in _ALLOWED or is_bedrock_model(model_id) else default_model_id()
    region = (os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1").strip()
    client = boto3.client("bedrock-runtime", region_name=region)
    kwargs: dict[str, Any] = {
        "modelId": mid,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
    }
    if system:
        kwargs["system"] = [{"text": system}]
    resp = client.converse(**kwargs)
    parts = ((resp.get("output") or {}).get("message") or {}).get("content") or []
    texts = [p.get("text") or "" for p in parts if isinstance(p, dict)]
    return "".join(texts).strip()
