"""
Multi-agent thread pool for local Ollama — N worker threads each run model requests in parallel.
Async callers dispatch via run_in_executor so inbox verify and scrape stay responsive.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "90.0"))
OLLAMA_RETRIES = int(os.getenv("OLLAMA_RETRIES", "2"))
AI_REVIEW_WORKERS = int(os.getenv("AI_REVIEW_WORKERS", "6"))
OLLAMA_MAX_CONCURRENT = int(
    os.getenv("OLLAMA_MAX_CONCURRENT", str(max(AI_REVIEW_WORKERS, 1)))
)

_pool: ThreadPoolExecutor | None = None
_pool_lock = threading.Lock()
_tls = threading.local()


def agent_pool_size() -> int:
    return max(1, min(OLLAMA_MAX_CONCURRENT, AI_REVIEW_WORKERS))


def get_agent_pool() -> ThreadPoolExecutor:
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            n = agent_pool_size()
            _pool = ThreadPoolExecutor(max_workers=n, thread_name_prefix="ollama-agent")
    return _pool


def _sync_client() -> httpx.Client:
    client = getattr(_tls, "client", None)
    if client is None or client.is_closed:
        client = httpx.Client(
            base_url=OLLAMA_URL.rstrip("/"),
            timeout=OLLAMA_TIMEOUT,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=2),
        )
        _tls.client = client
    return client


def _parse_json_object(text: str) -> dict[str, Any] | None:
    text = (text or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        data = json.loads(m.group())
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def ollama_chat_json_sync(
    *,
    user: str,
    system: str | None = None,
    model: str | None = None,
    timeout: float | None = None,
) -> dict[str, Any] | None:
    """Blocking Ollama chat with optional system prompt — thread-pool agents only."""
    t = timeout if timeout is not None else OLLAMA_TIMEOUT
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    payload = {
        "model": model or OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_predict": 2048},
    }
    client = _sync_client()
    last_err: Exception | None = None
    for attempt in range(max(1, OLLAMA_RETRIES)):
        try:
            r = client.post("/api/chat", json=payload, timeout=t)
            if r.status_code != 200:
                last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
                continue
            body = r.json()
            content = (body.get("message") or {}).get("content") or body.get("response") or ""
            parsed = _parse_json_object(str(content))
            if parsed:
                return parsed
            last_err = RuntimeError("No JSON object in model response")
        except Exception as e:
            last_err = e
    if last_err:
        return None
    return None


def ollama_json_sync(
    prompt: str,
    *,
    model: str | None = None,
    timeout: float | None = None,
) -> dict[str, Any] | None:
    """Blocking Ollama chat call — intended for thread-pool agents only."""
    return ollama_chat_json_sync(user=prompt, model=model, timeout=timeout)


async def ollama_json_async(
    prompt: str,
    *,
    model: str | None = None,
    timeout: float | None = None,
) -> dict[str, Any] | None:
    """Dispatch one Ollama request to the multi-agent thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        get_agent_pool(),
        lambda: ollama_json_sync(prompt, model=model, timeout=timeout),
    )


async def ollama_chat_json_async(
    *,
    user: str,
    system: str | None = None,
    model: str | None = None,
    timeout: float | None = None,
) -> dict[str, Any] | None:
    """Dispatch Ollama chat (system + user) to the multi-agent thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        get_agent_pool(),
        lambda: ollama_chat_json_sync(
            user=user, system=system, model=model, timeout=timeout
        ),
    )
