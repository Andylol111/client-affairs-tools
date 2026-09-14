"""Shared mailbox assessment. External provider calls stay out of caller transactions."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.database import get_db
from app.services.contact_intelligence import (
    CONSUMER_DOMAINS,
    DISPOSABLE_DOMAINS,
    Mailbox,
    ROLE_LOCALS,
    mailbox_from_legacy,
    now_iso,
)
from app.services.contact_intelligence_schema import init_contact_intelligence_schema
from app.services.email_verifier import verify_email_deliverability, verify_email_format

logger = logging.getLogger(__name__)

DAILY_CAP = 25
CACHE_DAYS = max(1, min(int(os.getenv("VERIFALIA_RESPONSE_CACHE_DAYS", "14") or 14), 90))


def _day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _hash(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()


def _result(mailbox: str, method: str, reason: str, *, cost=0, expires_at=None, provider_state="not_requested", provider_request_id=None) -> dict:
    return {
        "mailbox": mailbox,
        "method": method,
        "reason": reason[:500],
        "checked_at": now_iso(),
        "expires_at": expires_at,
        "cost_units": cost,
        "source_ids": [],
        "provider_state": provider_state,
        "provider_request_id": provider_request_id,
    }


async def _ensure(db) -> None:
    await init_contact_intelligence_schema(db)


async def _admin(actor_id: int) -> None:
    db = await get_db()
    try:
        row = await (await db.execute("SELECT role FROM users WHERE id=?", (actor_id,))).fetchone()
        if not row or row["role"] != "admin":
            raise HTTPException(403, "Administrator access required")
    finally:
        await db.close()


def _enabled() -> bool:
    return os.getenv("EXTERNAL_EMAIL_VERIFICATION_ENABLED", "false").lower() == "true" and bool(
        (os.getenv("VERIFALIA_API_KEY") or "").strip()
    )


async def provider_capacity(*, actor_id: int) -> dict:
    await _admin(actor_id)
    db = await get_db()
    try:
        await _ensure(db)
        control = await (await db.execute("SELECT disabled FROM verification_provider_control WHERE provider='verifalia'")).fetchone()
        day = await (await db.execute("SELECT used, allowance FROM verification_provider_days WHERE day=?", (_day(),))).fetchone()
        allowance = int((day["allowance"] if day else min(DAILY_CAP, int(os.getenv("VERIFALIA_DAILY_CREDIT_CAP", str(DAILY_CAP)) or DAILY_CAP))))
        used = int(day["used"] if day else 0)
        return {
            "provider": "verifalia",
            "enabled": _enabled() and not (control and control["disabled"]),
            "day": _day(),
            "used": used,
            "remaining": max(0, allowance - used),
            "allowance": allowance,
        }
    finally:
        await db.close()


async def set_provider_enabled(*, actor_id: int, enabled: bool) -> dict:
    await _admin(actor_id)
    db = await get_db()
    try:
        await _ensure(db)
        await db.execute(
            """INSERT INTO verification_provider_control(provider,disabled,changed_by,changed_at)
               VALUES('verifalia',?,?,?)
               ON CONFLICT(provider) DO UPDATE SET disabled=excluded.disabled,changed_by=excluded.changed_by,changed_at=excluded.changed_at""",
            (0 if enabled else 1, actor_id, now_iso()),
        )
        await db.commit()
    finally:
        await db.close()
    return await provider_capacity(actor_id=actor_id)


async def assess_address(email: str, *, actor_id: int, external: bool = False, manual: bool = False, reason: str | None = None) -> dict:
    raw = (email or "").strip().lower()
    fmt = verify_email_format(raw)
    if not fmt.get("valid"):
        return _result(Mailbox.BAD_SYNTAX.value, "local", "Address syntax is not usable")
    local, _, domain = raw.partition("@")
    if local in ROLE_LOCALS:
        return _result(Mailbox.BAD_SYNTAX.value, "local", "Role or generic mailbox, not an individual address")
    if domain in CONSUMER_DOMAINS | DISPOSABLE_DOMAINS:
        return _result(Mailbox.BAD_SYNTAX.value, "local", "Consumer or disposable domain is not used for outreach")

    db = await get_db()
    try:
        await _ensure(db)
        suppressed = await (await db.execute(
            "SELECT state FROM candidate_suppressions WHERE email=? COLLATE NOCASE", (raw,)
        )).fetchone()
        if suppressed:
            return _result(Mailbox.PERMANENT_FAILURE_OBSERVED.value, "history", f"Address is {suppressed['state']}", expires_at=None)
        historic = await (await db.execute(
            """SELECT c.result, c.reason, c.checked_at, c.expires_at, c.verifier FROM email_checks c
               JOIN email_candidates e ON e.id=c.candidate_id
               WHERE e.email=? COLLATE NOCASE AND c.result IN ('previously_delivered','human_reply_observed','permanent_failure_observed')
               ORDER BY CASE c.result WHEN 'permanent_failure_observed' THEN 0 WHEN 'human_reply_observed' THEN 1 ELSE 2 END, c.checked_at DESC LIMIT 1""",
            (raw,),
        )).fetchone()
        if historic:
            return _result(historic["result"], historic["verifier"], historic["reason"], expires_at=historic["expires_at"])
        cached = await (await db.execute(
            "SELECT result_json FROM verification_cache WHERE address_hash=? AND actor_id=? AND expires_at>?",
            (_hash(raw), actor_id, now_iso()),
        )).fetchone()
        if cached:
            payload = json.loads(cached["result_json"])
            payload["provider_state"] = "cached"
            return payload
    finally:
        await db.close()

    local_check = await verify_email_deliverability(raw, smtp_probe=False)
    mailbox = mailbox_from_legacy(local_check)
    result = _result(mailbox, "dns_mx", local_check.get("reason") or "Mail-route lookup", expires_at=(datetime.now(timezone.utc) + timedelta(days=7)).isoformat())
    if mailbox in (Mailbox.BAD_SYNTAX.value, Mailbox.DOMAIN_HAS_NO_MAIL_ROUTE.value):
        return result
    if not external:
        return result

    if not _enabled():
        result["provider_state"] = "disabled"
        result["reason"] = "External mailbox validation is not configured. Mail-domain availability is recorded."
        return result
    if not reason and manual:
        raise HTTPException(422, "A reason is required to spend a validation credit")
    return await _external(raw, actor_id=actor_id, manual=manual, fallback=result)


async def _external(email: str, *, actor_id: int, manual: bool, fallback: dict) -> dict:
    reservation_id = None
    db = await get_db()
    try:
        await _ensure(db)
        await db.execute("BEGIN IMMEDIATE")
        control = await (await db.execute("SELECT disabled FROM verification_provider_control WHERE provider='verifalia'")).fetchone()
        if control and control["disabled"]:
            await db.rollback()
            return {**fallback, "provider_state": "disabled", "reason": "External validation is turned off by an administrator"}
        cap = min(DAILY_CAP, max(0, int(os.getenv("VERIFALIA_DAILY_CREDIT_CAP", str(DAILY_CAP)) or DAILY_CAP)))
        await db.execute(
            "INSERT INTO verification_provider_days(day,used,allowance) VALUES(?,0,?) ON CONFLICT(day) DO NOTHING",
            (_day(), cap),
        )
        day = await (await db.execute("SELECT used, allowance FROM verification_provider_days WHERE day=?", (_day(),))).fetchone()
        if int(day["used"]) >= int(day["allowance"]):
            await db.rollback()
            return {**fallback, "provider_state": "exhausted", "reason": "Daily free validation credits are used. Local mail-domain results are saved."}
        reservation_id = hashlib.sha256(f"{_day()}:{actor_id}:{_hash(email)}:{int(manual)}".encode()).hexdigest()
        try:
            await db.execute(
                """INSERT INTO verification_reservations(id,day,actor_id,address_hash,person_id,manual,reason,status,created_at)
                   VALUES(?,?,?,?,NULL,?,?,'reserved',?)""",
                (reservation_id, _day(), actor_id, _hash(email), 1 if manual else 0, None, now_iso()),
            )
        except Exception:
            await db.rollback()
            cached = await (await db.execute(
                "SELECT result_json FROM verification_cache WHERE address_hash=? AND actor_id=? AND expires_at>?",
                (_hash(email), actor_id, now_iso()),
            )).fetchone()
            if cached:
                payload = json.loads(cached["result_json"])
                payload["provider_state"] = "cached"
                return payload
            return {**fallback, "provider_state": "cached"}
        await db.execute("UPDATE verification_provider_days SET used=used+1 WHERE day=?", (_day(),))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()

    try:
        provider = await _verifalia(email)
    except Exception:
        logger.info("external mailbox check inconclusive")
        provider = {**fallback, "mailbox": Mailbox.INCONCLUSIVE.value, "provider_state": "unavailable",
                    "reason": "External validation did not complete. Local mail-domain results are saved.",
                    "method": "verifalia"}
    db = await get_db()
    try:
        await db.execute(
            "UPDATE verification_reservations SET status=? WHERE id=?",
            ("complete" if provider.get("provider_state") not in ("unavailable",) else "inconclusive", reservation_id),
        )
        expires = (datetime.now(timezone.utc) + timedelta(days=CACHE_DAYS)).isoformat()
        provider["expires_at"] = expires
        await db.execute(
            """INSERT INTO verification_cache(address_hash,actor_id,result_json,expires_at) VALUES(?,?,?,?)
               ON CONFLICT(address_hash,actor_id) DO UPDATE SET result_json=excluded.result_json,expires_at=excluded.expires_at""",
            (_hash(email), actor_id, json.dumps(provider), expires),
        )
        await db.commit()
    finally:
        await db.close()
    return provider


async def _verifalia(email: str) -> dict:
    import httpx

    key = (os.getenv("VERIFALIA_API_KEY") or "").strip()
    mapping = {
        "Success": Mailbox.PROVIDER_HIGH_CONFIDENCE.value,
        "Risky": Mailbox.ACCEPT_ALL_OR_RISKY.value,
        "Unknown": Mailbox.INCONCLUSIVE.value,
        "Failure": Mailbox.RECIPIENT_REJECTED.value,
    }
    async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
        response = await client.post(
            "https://api.verifalia.com/v2.6/email-validations",
            auth=(key, ""),
            json={"entries": [{"inputData": email}]},
        )
    if response.status_code == 402:
        return _result(Mailbox.INCONCLUSIVE.value, "verifalia", "Free validation credits were refused by the provider", provider_state="exhausted")
    if response.status_code >= 400:
        return _result(Mailbox.INCONCLUSIVE.value, "verifalia", "External validation returned an error", provider_state="unavailable")
    data = response.json()
    entries = data.get("entries") or {}
    status = None
    if isinstance(entries, dict):
        status = entries.get("classification") or entries.get("status")
    elif isinstance(entries, list) and entries:
        status = (entries[0] or {}).get("classification") or (entries[0] or {}).get("status")
    mailbox = mapping.get(str(status or ""), Mailbox.INCONCLUSIVE.value)
    return _result(mailbox, "verifalia", f"Provider classification: {status or 'unknown'}", cost=1,
                   provider_state="complete", provider_request_id=str(data.get("id") or "")[:80] or None)
