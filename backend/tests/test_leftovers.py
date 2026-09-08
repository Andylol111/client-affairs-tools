"""Bounce + Think-Cell pack checks. From backend/: python tests/test_leftovers.py"""
from __future__ import annotations

import os
import sys
from io import BytesIO
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("JWT_SECRET", "p2-test-secret-not-a-known-default-xx")

from app.jwt_utils import COOKIE_NAME, create_token
from app.services.gmail_reply_sync import thread_has_bounce
from app.services.thinkcell_pack import build_pack_bytes


def test_bounce_from_mailer_daemon() -> None:
    thread = {
        "messages": [
            {
                "payload": {
                    "headers": [
                        {"name": "From", "value": "Mail Delivery Subsystem <mailer-daemon@googlemail.com>"},
                        {"name": "Subject", "value": "Undeliverable: Quick question"},
                    ]
                }
            }
        ]
    }
    assert thread_has_bounce(thread) is True
    assert thread_has_bounce({"messages": []}) is False


def test_thinkcell_table_names() -> None:
    from openpyxl import load_workbook

    data = build_pack_bytes([["Acme", "Aviation", "ASD", 8, "pending"]])
    wb = load_workbook(BytesIO(data))
    names = {t for ws in wb.worksheets for t in ws.tables}
    assert names == {"Table_Slate", "Table_Addresses", "Table_Pipeline", "Table_Send"}


def test_pending_2fa_not_authenticated() -> None:
    from fastapi.testclient import TestClient
    from main import app

    token = create_token(1, "test@yale.edu", extra={"2fa": "pending"}, expiry_hours=0.25)
    with TestClient(app) as client:
        r = client.get("/api/auth/me", cookies={COOKIE_NAME: token})
        assert r.status_code == 200
        assert r.json().get("authenticated") is False


def test_anthropic_catalog_opus_to_haiku() -> None:
    from app.services.llm import BEDROCK_ANTHROPIC, is_bedrock_model, list_models

    tiers = {m["tier"] for m in BEDROCK_ANTHROPIC}
    assert "opus" in tiers and "haiku" in tiers
    assert is_bedrock_model("us.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert not is_bedrock_model("ollama:llama3.2")
    catalog = list_models()
    assert catalog["groups"][0]["id"] == "anthropic"


def test_health_ok_without_spa() -> None:
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


if __name__ == "__main__":
    test_bounce_from_mailer_daemon()
    test_thinkcell_table_names()
    test_pending_2fa_not_authenticated()
    test_anthropic_catalog_opus_to_haiku()
    print("ok")
