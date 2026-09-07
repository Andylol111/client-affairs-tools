"""
Email deliverability checks — MX required; optional SMTP RCPT probe (best-effort).
Parallel-friendly: shared MX cache, configurable worker timeouts.
"""
from __future__ import annotations

import asyncio
import os
import re
import smtplib
import socket
from typing import Any

import dns.resolver

from app.services.company_email_cache import pattern_for_email

SMTP_PROBE_TIMEOUT = float(os.getenv("SMTP_PROBE_TIMEOUT", "1.5"))
MX_PREFETCH_WORKERS = int(os.getenv("MX_PREFETCH_WORKERS", "24"))
VERIFY_AGENTS = int(os.getenv("VERIFY_AGENTS", os.getenv("RECONCILE_WORKERS", "20")))
SMTP_MAX_CONCURRENT = int(os.getenv("SMTP_MAX_CONCURRENT", "6"))
# mx = MX lookup only (fast). auto = skip SMTP for trusted aligned scrapes. smtp = RCPT probe when requested.
INBOX_VERIFY_MODE = os.getenv("INBOX_VERIFY_MODE", "mx").strip().lower()
_smtp_sem = asyncio.Semaphore(max(1, SMTP_MAX_CONCURRENT))


def _effective_smtp_probe(requested: bool) -> bool:
    if not requested:
        return False
    if INBOX_VERIFY_MODE == "mx":
        return False
    if INBOX_VERIFY_MODE == "smtp":
        return True
    return requested  # auto — caller sets per-item


async def verify_mx(domain: str) -> tuple[bool, list[str]]:
    try:
        answers = await asyncio.to_thread(dns.resolver.resolve, domain, "MX")
        hosts = sorted(str(r.exchange).rstrip(".") for r in answers)
        return bool(hosts), hosts
    except Exception:
        return False, []


async def get_mx_cached(
    domain: str,
    cache: dict[str, tuple[bool, list[str]]] | None = None,
) -> tuple[bool, list[str]]:
    if cache is not None and domain in cache:
        return cache[domain]
    result = await verify_mx(domain)
    if cache is not None:
        cache[domain] = result
    return result


async def preload_mx_for_domains(
    domains: set[str],
    cache: dict[str, tuple[bool, list[str]]],
    *,
    workers: int | None = None,
) -> None:
    """Resolve MX for all domains in parallel (one lookup per domain)."""
    missing = {d for d in domains if d and d not in cache}
    if not missing:
        return
    sem = asyncio.Semaphore(workers or MX_PREFETCH_WORKERS)

    async def _one(dom: str) -> None:
        async with sem:
            cache[dom] = await verify_mx(dom)

    await asyncio.gather(*[_one(d) for d in missing])


async def _smtp_rcpt_probe(email: str, mx_host: str, timeout: float) -> str:
    """
    Best-effort RCPT TO. Returns: valid | invalid | unknown
    Many corporate servers greylist or accept-all — treat ambiguous as unknown.
    """

    def _probe() -> str:
        try:
            with smtplib.SMTP(timeout=timeout) as smtp:
                smtp.connect(mx_host, 25)
                smtp.helo(socket.gethostname() or "clientreach.local")
                smtp.mail("verify@clientreach.local")
                code, _ = smtp.rcpt(email)
                if 200 <= code < 300:
                    return "valid"
                if 500 <= code < 600:
                    return "invalid"
                return "unknown"
        except smtplib.SMTPServerDisconnected:
            return "unknown"
        except socket.timeout:
            return "unknown"
        except OSError:
            return "unknown"
        except Exception:
            return "unknown"

    try:
        async with _smtp_sem:
            return await asyncio.wait_for(asyncio.to_thread(_probe), timeout=timeout + 0.75)
    except Exception:
        return "unknown"


def verify_email_format(email: str) -> dict[str, Any]:
    """Syntax only. Used by GET /outreach/verify-email. Not inbox existence."""
    raw = (email or "").strip().lower()
    if not raw or "@" not in raw:
        return {"valid": False, "reason": "Invalid format"}
    local, _, domain = raw.partition("@")
    if not re.match(r"^[a-z0-9._+-]+$", local):
        return {"valid": False, "reason": "Invalid local part"}
    if "." not in domain or not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", domain):
        return {"valid": False, "reason": "Invalid domain"}
    return {"valid": True}


async def verify_email_deliverability(
    email: str,
    *,
    full_name: str | None = None,
    smtp_probe: bool = True,
    smtp_timeout: float | None = None,
    mx_cache: dict[str, tuple[bool, list[str]]] | None = None,
) -> dict[str, Any]:
    """
    Returns status: valid | likely_valid | invalid | unknown
    """
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return {"status": "invalid", "mx_valid": False, "reason": "bad_format"}

    local, domain = email.rsplit("@", 1)
    if not re.match(r"^[a-z0-9._+-]+$", local):
        return {"status": "invalid", "mx_valid": False, "reason": "bad_local"}

    mx_valid, mx_hosts = await get_mx_cached(domain, mx_cache)
    if not mx_valid:
        return {"status": "invalid", "mx_valid": False, "reason": "no_mx"}

    result: dict[str, Any] = {
        "status": "likely_valid",
        "mx_valid": True,
        "mx_hosts": mx_hosts[:3],
        "matched_pattern": pattern_for_email(email, full_name) if full_name else None,
        "smtp_probe": None,
    }

    if not smtp_probe or not mx_hosts:
        return result

    timeout = smtp_timeout if smtp_timeout is not None else SMTP_PROBE_TIMEOUT
    probe = await _smtp_rcpt_probe(email, mx_hosts[0], timeout)
    result["smtp_probe"] = probe
    if probe == "valid":
        result["status"] = "valid"
    elif probe == "invalid":
        result["status"] = "invalid"
        result["reason"] = "smtp_rejected"
    else:
        result["status"] = "likely_valid"
    return result


def _verify_mx_only(
    email: str,
    full_name: str | None,
    cache: dict[str, tuple[bool, list[str]]],
) -> dict[str, Any]:
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return {"status": "invalid", "mx_valid": False, "reason": "bad_format"}

    local, domain = email.rsplit("@", 1)
    if not re.match(r"^[a-z0-9._+-]+$", local):
        return {"status": "invalid", "mx_valid": False, "reason": "bad_local"}

    mx_valid, mx_hosts = cache.get(domain, (False, []))
    if not mx_valid:
        return {"status": "invalid", "mx_valid": False, "reason": "no_mx"}

    return {
        "status": "likely_valid",
        "mx_valid": True,
        "mx_hosts": mx_hosts[:3],
        "matched_pattern": pattern_for_email(email, full_name) if full_name else None,
        "smtp_probe": None,
    }


async def verify_emails_parallel(
    items: list[dict[str, Any]] | list[tuple[str, str | None]],
    *,
    smtp_probe: bool = True,
    smtp_timeout: float | None = None,
    workers: int | None = None,
    mx_cache: dict[str, tuple[bool, list[str]]] | None = None,
    on_progress: Any = None,
) -> list[dict[str, Any]]:
    """
    Verify many emails concurrently. Items are either:
    - dict with keys email, full_name (optional), smtp_probe (optional bool)
    - tuple (email, full_name)
    """
    if not items:
        return []

    normalized: list[tuple[str, str | None, bool]] = []
    for item in items:
        if isinstance(item, dict):
            email = (item.get("email") or "").strip().lower()
            name = item.get("full_name")
            probe = _effective_smtp_probe(bool(item.get("smtp_probe", smtp_probe)))
            normalized.append((email, name, probe))
        else:
            email, name = item
            normalized.append(((email or "").strip().lower(), name, _effective_smtp_probe(smtp_probe)))

    cache = mx_cache if mx_cache is not None else {}
    domains = {e.rsplit("@", 1)[1].lower() for e, _, _ in normalized if e and "@" in e}
    await preload_mx_for_domains(domains, cache)

    if not any(p for _, _, p in normalized):
        total = len(normalized)
        results = [_verify_mx_only(e, n, cache) for e, n, _ in normalized]
        if on_progress:
            maybe = on_progress(total, total)
            if maybe is not None:
                await maybe
        return results

    pool = workers or VERIFY_AGENTS
    sem = asyncio.Semaphore(pool)
    done = 0
    lock = asyncio.Lock()
    total = len(normalized)

    async def _one(email: str, full_name: str | None, probe: bool) -> dict[str, Any]:
        nonlocal done
        async with sem:
            result = await verify_email_deliverability(
                email,
                full_name=full_name,
                smtp_probe=probe,
                smtp_timeout=smtp_timeout,
                mx_cache=cache,
            )
            if on_progress:
                async with lock:
                    done += 1
                    current = done
                maybe = on_progress(current, total)
                if maybe is not None:
                    await maybe
            return result

    return await asyncio.gather(*[_one(e, n, p) for e, n, p in normalized])
