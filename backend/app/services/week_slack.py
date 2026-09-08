"""Week-shaped Slack posts. Failures are swallowed — Slack is the hallway, not the CRM."""
from __future__ import annotations

import os

import httpx


def post_week_event(text: str) -> bool:
    token = (os.getenv("SLACK_BOT_TOKEN") or "").strip()
    channel = (os.getenv("SLACK_DIGEST_CHANNEL_ID") or "").strip()
    if not token or not channel or not text.strip():
        return False
    try:
        with httpx.Client(timeout=12.0) as client:
            r = client.post(
                "https://slack.com/api/chat.postMessage",
                headers={"Authorization": f"Bearer {token}"},
                json={"channel": channel, "text": text.strip()},
            )
        return bool(r.json().get("ok"))
    except Exception:
        return False
