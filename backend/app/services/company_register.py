"""Bulk company register from free public sources.

The club's target pool was a 500-row hand-maintained spreadsheet plus
whatever anyone typed into Find people. This builds a browsable register
from registers that are free, bulk-downloadable, and legitimate to use:

- us_public: SEC's company_tickers.json (~10k US listed companies). SIC
  sector is filled in lazily from data.sec.gov/submissions on demand,
  because SEC publishes no bulk SIC file and per-company calls are rate
  limited to 10/sec by their fair-access policy.
- us_private: SEC Form D quarterly data sets (~3 MB per quarter, TSV).
  Every US company that raised under Reg D - the closest thing to a free
  startup register - with its industry group, revenue range, offering
  amount, and the executive officers named on the filing.
- uk: Companies House bulk BasicCompanyData, filtered at ingest to active
  companies in target SIC divisions. Officers need COMPANIES_HOUSE_API_KEY
  and are fetched on demand elsewhere.

Headcount honesty: no free US source publishes employee counts, so
`employees` stays NULL for US rows and the UI shows revenue range / last
raise instead. Only Companies House accounts carry a real headcount; it
is recorded with employees_source so a filter can say where it came from.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import re
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from app.database import get_db

logger = logging.getLogger(__name__)

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FORM_D_URL = "https://www.sec.gov/files/structureddata/data/form-d-data-sets/{quarter}_d.zip"
UK_BULK_URL = "http://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-{date}.zip"

# A Form D filing this small is usually a single-property LLC or a friends
# and family round, not a company with a consulting budget.
MIN_OFFERING_USD = float(os.getenv("REGISTER_FORMD_MIN_USD", "2000000"))
FORM_D_MONTHS = int(os.getenv("REGISTER_FORMD_MONTHS", "36"))
# Form D industry groups worth club outreach; pooled/real-estate vehicles are
# funds, not operating companies with projects for students.
# Compared case- and ampersand-insensitively: the live 2026Q1 file writes
# "REITS and Finance" and "Other Banking and Financial Services", so an
# ampersand spelling silently let every REIT and fund through.
FORM_D_SKIP_GROUPS = frozenset(_skip.lower() for _skip in (
    "Pooled Investment Fund", "Real Estate", "Residential", "Commercial",
    "REITS and Finance", "Other Real Estate", "Oil and Gas", "Coal Mining",
    "Other Banking and Financial Services", "Investing", "Investment Banking",
))


def _group_key(group: str) -> str:
    return re.sub(r"\s+", " ", (group or "").replace("&", "and")).strip().lower()
_OFFICER_RELATIONSHIPS = ("executive officer", "director")


def _sec_headers() -> dict[str, str]:
    from app.services.roster_watch import sec_user_agent

    return {"User-Agent": sec_user_agent(), "Accept-Encoding": "gzip, deflate"}


def recent_form_d_quarters(count: int | None = None) -> list[str]:
    """Completed quarters to ingest, newest first, e.g. ['2026q1', '2025q4'].

    SEC publishes a quarter's data set only after that quarter closes, so the
    quarter in progress is always a 404 and is never listed."""
    months = FORM_D_MONTHS if count is None else count * 3
    now = datetime.now(timezone.utc)
    quarters: list[str] = []
    year, quarter = now.year, (now.month - 1) // 3 + 1
    quarter -= 1                     # the current quarter is not published yet
    if quarter == 0:
        year, quarter = year - 1, 4
    for _ in range(max(1, months // 3)):
        quarters.append(f"{year}q{quarter}")
        quarter -= 1
        if quarter == 0:
            year, quarter = year - 1, 4
    return quarters


def _norm_name(name: str) -> str:
    text = re.sub(r"\s+", " ", (name or "").strip())
    text = re.sub(r"[,.]?\s*(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|plc|lp|l\.p)\.?$", "", text, flags=re.I)
    return text.strip(" ,.")


def _title_case(name: str) -> str:
    """Registers publish shouty names ('DICKERSON PIKE LLC'); a member should
    see 'Dickerson Pike LLC'. Existing mixed-case names are left alone."""
    text = (name or "").strip()
    if not text or text != text.upper():
        return text
    return re.sub(r"\b([A-Z])([A-Z']*)\b", lambda m: m.group(1) + m.group(2).lower(), text)


async def _http_get(url: str, *, timeout: float = 120.0) -> bytes:
    import httpx

    pause = float(os.getenv("ROSTER_SEC_PAUSE_SEC", "0.12") or 0)
    if pause > 0:
        await asyncio.sleep(pause)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.get(url, headers=_sec_headers())
        response.raise_for_status()
        return response.content


async def _record_ingest(source: str, batch_key: str, seen: int, written: int, status: str, detail: str = "") -> None:
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO company_register_ingests (source, batch_key, rows_seen, rows_written, status, detail)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(source, batch_key) DO UPDATE SET
                 rows_seen=excluded.rows_seen, rows_written=excluded.rows_written,
                 status=excluded.status, detail=excluded.detail, completed_at=CURRENT_TIMESTAMP""",
            (source, batch_key, seen, written, status, detail[:500]),
        )
        await db.commit()
    finally:
        await db.close()


async def _already_ingested(source: str, batch_key: str) -> bool:
    db = await get_db()
    try:
        row = await (await db.execute(
            "SELECT 1 FROM company_register_ingests WHERE source=? AND batch_key=? AND status='ok'",
            (source, batch_key),
        )).fetchone()
        return bool(row)
    finally:
        await db.close()


async def upsert_companies(rows: Iterable[dict[str, Any]]) -> int:
    """Insert or refresh register rows. A row already present keeps its
    first_seen_at and only gains newer facts."""
    written = 0
    db = await get_db()
    try:
        for row in rows:
            await db.execute(
                """INSERT INTO company_register (
                       source, source_key, tier, country, company_name, company_domain,
                       sector_code, sector_label, region, employees, employees_source,
                       last_event_at, last_event_amount, last_event_kind, metadata_json
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(source, source_key) DO UPDATE SET
                       company_name=excluded.company_name,
                       tier=excluded.tier,
                       company_domain=COALESCE(excluded.company_domain, company_register.company_domain),
                       sector_code=COALESCE(excluded.sector_code, company_register.sector_code),
                       sector_label=COALESCE(excluded.sector_label, company_register.sector_label),
                       region=COALESCE(excluded.region, company_register.region),
                       employees=COALESCE(excluded.employees, company_register.employees),
                       employees_source=COALESCE(excluded.employees_source, company_register.employees_source),
                       last_event_at=MAX(COALESCE(excluded.last_event_at, ''), COALESCE(company_register.last_event_at, '')),
                       last_event_amount=COALESCE(excluded.last_event_amount, company_register.last_event_amount),
                       last_event_kind=COALESCE(excluded.last_event_kind, company_register.last_event_kind),
                       metadata_json=COALESCE(excluded.metadata_json, company_register.metadata_json),
                       updated_at=CURRENT_TIMESTAMP""",
                (
                    row["source"], row["source_key"], row["tier"], row.get("country") or "US",
                    row["company_name"], row.get("company_domain"),
                    row.get("sector_code"), row.get("sector_label"), row.get("region"),
                    row.get("employees"), row.get("employees_source"),
                    row.get("last_event_at"), row.get("last_event_amount"), row.get("last_event_kind"),
                    json.dumps(row["metadata"]) if row.get("metadata") else None,
                ),
            )
            written += 1
        await db.commit()
    finally:
        await db.close()
    return written


async def _attach_people(people_by_key: dict[tuple[str, str], list[dict[str, Any]]]) -> int:
    if not people_by_key:
        return 0
    attached = 0
    db = await get_db()
    try:
        for (source, source_key), people in people_by_key.items():
            row = await (await db.execute(
                "SELECT id FROM company_register WHERE source=? AND source_key=?", (source, source_key),
            )).fetchone()
            if not row:
                continue
            register_id = int(row["id"])
            for person in people:
                await db.execute(
                    """INSERT INTO company_register_people (register_id, full_name, relationship, observed_at, source_url)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(register_id, full_name) DO UPDATE SET
                         relationship=COALESCE(excluded.relationship, company_register_people.relationship),
                         observed_at=MAX(COALESCE(excluded.observed_at, ''), COALESCE(company_register_people.observed_at, ''))""",
                    (register_id, person["full_name"], person.get("relationship"),
                     person.get("observed_at"), person.get("source_url")),
                )
                attached += 1
            await db.execute(
                "UPDATE company_register SET officer_count=(SELECT COUNT(*) FROM company_register_people WHERE register_id=?) WHERE id=?",
                (register_id, register_id),
            )
        await db.commit()
    finally:
        await db.close()
    return attached


async def ingest_sec_public() -> dict[str, Any]:
    """Every US listed company from SEC's ticker file. Sector is filled in
    later by backfill_sec_sectors; SEC publishes no bulk SIC file."""
    batch = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        raw = await _http_get(SEC_TICKERS_URL, timeout=60.0)
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        await _record_ingest("sec_public", batch, 0, 0, "failed", f"{type(exc).__name__}: {exc}")
        return {"ok": False, "source": "sec_public", "error": str(exc)}
    rows = []
    for item in (data or {}).values():
        if not isinstance(item, dict):
            continue
        cik = str(item.get("cik_str") or "").strip()
        name = _title_case(str(item.get("title") or "").strip())
        if not cik or not name:
            continue
        rows.append({
            "source": "sec_public", "source_key": cik.zfill(10), "tier": "us_public", "country": "US",
            "company_name": name,
            "metadata": {"ticker": str(item.get("ticker") or "").strip(), "cik": cik},
        })
    written = await upsert_companies(rows)
    await _record_ingest("sec_public", batch, len(rows), written, "ok")
    return {"ok": True, "source": "sec_public", "seen": len(rows), "written": written}


def parse_form_d_zip(payload: bytes) -> tuple[list[dict[str, Any]], dict[tuple[str, str], list[dict[str, Any]]]]:
    """Issuers meeting the size/recency/industry bar, plus their named
    executive officers. Pure: the network and database stay outside."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30 * FORM_D_MONTHS)).strftime("%Y-%m-%d")

    def table(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
        member = next((n for n in zf.namelist() if n.upper().endswith(f"{name}.TSV")), None)
        if not member:
            return []
        with zf.open(member) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8", errors="replace")
            return list(csv.DictReader(text, delimiter="\t"))

    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        issuers = table(zf, "ISSUERS")
        offerings = {row["ACCESSIONNUMBER"]: row for row in table(zf, "OFFERING") if row.get("ACCESSIONNUMBER")}
        persons = table(zf, "RELATEDPERSONS")

    kept: dict[str, dict[str, Any]] = {}
    for row in issuers:
        accession = (row.get("ACCESSIONNUMBER") or "").strip()
        if not accession or (row.get("IS_PRIMARYISSUER_FLAG") or "").upper() != "YES":
            continue
        offering = offerings.get(accession) or {}
        group = (offering.get("INDUSTRYGROUPTYPE") or "").strip()
        if _group_key(group) in FORM_D_SKIP_GROUPS:
            continue
        try:
            amount = float(offering.get("TOTALOFFERINGAMOUNT") or 0)
        except ValueError:
            amount = 0.0
        sold = offering.get("TOTALAMOUNTSOLD")
        try:
            amount = max(amount, float(sold or 0))
        except ValueError:
            pass
        if amount < MIN_OFFERING_USD:
            continue
        sale_date = (offering.get("SALE_DATE") or "").strip()
        iso_date = ""
        for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%m/%d/%Y"):
            try:
                iso_date = datetime.strptime(sale_date, fmt).strftime("%Y-%m-%d")
                break
            except ValueError:
                continue
        if iso_date and iso_date < cutoff:
            continue
        name = _title_case((row.get("ENTITYNAME") or "").strip())
        cik = (row.get("CIK") or "").strip().zfill(10)
        if not name or not cik:
            continue
        existing = kept.get(cik)
        if existing and (existing.get("last_event_at") or "") >= iso_date:
            continue
        kept[cik] = {
            "source": "sec_form_d", "source_key": cik, "tier": "us_private", "country": "US",
            "company_name": name,
            "sector_label": group or None,
            "region": (row.get("STATEORCOUNTRYDESCRIPTION") or "").strip().title() or None,
            "last_event_at": iso_date or None,
            "last_event_amount": amount,
            "last_event_kind": "reg_d_offering",
            "metadata": {
                "accession": accession,
                "revenue_range": (offering.get("REVENUERANGE") or "").strip() or None,
                "entity_type": (row.get("ENTITYTYPE") or "").strip() or None,
                "year_of_inc": (row.get("YEAROFINC_VALUE_ENTERED") or "").strip() or None,
                "city": (row.get("CITY") or "").strip().title() or None,
            },
        }

    accession_to_cik = {item["metadata"]["accession"]: cik for cik, item in kept.items()}
    people: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in persons:
        cik = accession_to_cik.get((row.get("ACCESSIONNUMBER") or "").strip())
        if not cik:
            continue
        relationships = [
            (row.get(f"RELATIONSHIP_{i}") or "").strip()
            for i in (1, 2, 3)
        ]
        relationship = next((r for r in relationships if r), "")
        if not any(r.lower() in _OFFICER_RELATIONSHIPS for r in relationships if r):
            continue
        full_name = " ".join(part for part in [
            (row.get("FIRSTNAME") or "").strip(),
            (row.get("MIDDLENAME") or "").strip(),
            (row.get("LASTNAME") or "").strip(),
        ] if part)
        if len(full_name.split()) < 2:
            continue
        accession = (row.get("ACCESSIONNUMBER") or "").strip()
        people.setdefault(("sec_form_d", cik), []).append({
            "full_name": _title_case(full_name),
            "relationship": relationship or None,
            "observed_at": kept[cik].get("last_event_at"),
            "source_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/",
        })
    return list(kept.values()), people


async def ingest_form_d(quarter: str, *, force: bool = False) -> dict[str, Any]:
    if not force and await _already_ingested("sec_form_d", quarter):
        return {"ok": True, "source": "sec_form_d", "quarter": quarter, "skipped": "already ingested"}
    try:
        payload = await _http_get(FORM_D_URL.format(quarter=quarter), timeout=180.0)
        companies, people = await asyncio.to_thread(parse_form_d_zip, payload)
    except Exception as exc:
        # 404 means SEC has not published that quarter; record it so the log
        # reads honestly, and let the caller move on to an older quarter.
        missing = "404" in str(exc)
        await _record_ingest("sec_form_d", quarter, 0, 0, "unpublished" if missing else "failed",
                             f"{type(exc).__name__}: {exc}")
        return {"ok": False, "source": "sec_form_d", "quarter": quarter,
                "unpublished": missing, "error": str(exc)}
    written = await upsert_companies(companies)
    attached = await _attach_people(people)
    await _record_ingest("sec_form_d", quarter, len(companies), written, "ok", f"{attached} officer(s)")
    return {"ok": True, "source": "sec_form_d", "quarter": quarter,
            "seen": len(companies), "written": written, "officers": attached}


async def backfill_sec_sectors(limit: int = 40) -> dict[str, Any]:
    """Fill SIC sector for listed companies, a few per pass. SEC's fair
    access policy caps requests, so this trickles rather than sweeps."""
    db = await get_db()
    try:
        rows = await (await db.execute(
            """SELECT id, source_key FROM company_register
               WHERE tier='us_public' AND sector_label IS NULL
               ORDER BY id LIMIT ?""",
            (max(1, min(limit, 200)),),
        )).fetchall()
        targets = [(int(r["id"]), str(r["source_key"])) for r in rows]
    finally:
        await db.close()
    if not targets:
        return {"ok": True, "filled": 0, "remaining": 0}
    filled = 0
    for register_id, cik in targets:
        try:
            raw = await _http_get(f"https://data.sec.gov/submissions/CIK{cik}.json", timeout=30.0)
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            logger.info("sector backfill skipped CIK %s: %s", cik, exc)
            continue
        db = await get_db()
        try:
            await db.execute(
                """UPDATE company_register
                   SET sector_code=?, sector_label=?, region=COALESCE(?, region),
                       company_domain=COALESCE(?, company_domain), updated_at=CURRENT_TIMESTAMP
                   WHERE id=?""",
                (
                    str(payload.get("sic") or "").strip() or None,
                    str(payload.get("sicDescription") or "").strip() or None,
                    str(payload.get("stateOfIncorporationDescription") or "").strip().title() or None,
                    str(payload.get("website") or "").strip().lower() or None,
                    register_id,
                ),
            )
            await db.commit()
            filled += 1
        finally:
            await db.close()
    db = await get_db()
    try:
        row = await (await db.execute(
            "SELECT COUNT(*) AS n FROM company_register WHERE tier='us_public' AND sector_label IS NULL"
        )).fetchone()
        remaining = int(row["n"] or 0)
    finally:
        await db.close()
    return {"ok": True, "filled": filled, "remaining": remaining}


async def drain_company_register() -> dict[str, Any]:
    """One scheduler pass: refresh the listed-company list monthly, pull any
    Form D quarter not yet ingested, then trickle sector backfill."""
    if (os.getenv("REGISTER_INGEST_ENABLED", "1") or "1").strip().lower() not in {"1", "true", "yes"}:
        return {"ok": True, "skipped": "disabled"}
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    result: dict[str, Any] = {"ok": True}
    if not await _already_ingested("sec_public", month):
        result["sec_public"] = await ingest_sec_public()
        return result
    for quarter in recent_form_d_quarters():
        if await _already_ingested("sec_form_d", quarter):
            continue
        outcome = await ingest_form_d(quarter)
        result["form_d"] = outcome
        if outcome.get("ok"):
            return result
        # A quarter SEC has not published (or a transient failure) must not
        # block the older quarters behind it; try the next one this pass.
        continue
    result["sectors"] = await backfill_sec_sectors()
    return result


async def search_register(
    *,
    q: str | None = None,
    tier: str | None = None,
    country: str | None = None,
    sector: str | None = None,
    min_amount: float | None = None,
    with_officers: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    where: list[str] = []
    args: list[Any] = []
    if q and q.strip():
        where.append("(lower(company_name) LIKE ? OR lower(COALESCE(sector_label,'')) LIKE ?)")
        term = f"%{q.strip().lower()}%"
        args.extend([term, term])
    if tier and tier.strip():
        where.append("tier = ?")
        args.append(tier.strip())
    if country and country.strip():
        where.append("country = ?")
        args.append(country.strip().upper())
    if sector and sector.strip():
        where.append("lower(COALESCE(sector_label,'')) LIKE ?")
        args.append(f"%{sector.strip().lower()}%")
    if min_amount:
        where.append("COALESCE(last_event_amount, 0) >= ?")
        args.append(float(min_amount))
    if with_officers:
        where.append("officer_count > 0")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    limit = max(1, min(int(limit), 200))
    db = await get_db()
    try:
        total = await (await db.execute(f"SELECT COUNT(*) AS n FROM company_register {clause}", tuple(args))).fetchone()
        rows = await (await db.execute(
            f"""SELECT * FROM company_register {clause}
                ORDER BY COALESCE(last_event_at, '') DESC, COALESCE(last_event_amount, 0) DESC,
                         officer_count DESC, company_name
                LIMIT ? OFFSET ?""",
            (*args, limit, max(0, int(offset))),
        )).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
            items.append(item)
        return {"items": items, "total": int(total["n"] or 0), "limit": limit, "offset": max(0, int(offset))}
    finally:
        await db.close()


async def register_summary() -> dict[str, Any]:
    db = await get_db()
    try:
        tiers = await (await db.execute(
            "SELECT tier, country, COUNT(*) AS n, SUM(officer_count > 0) AS with_officers FROM company_register GROUP BY tier, country"
        )).fetchall()
        sectors = await (await db.execute(
            """SELECT sector_label AS sector, COUNT(*) AS n FROM company_register
               WHERE sector_label IS NOT NULL AND sector_label != ''
               GROUP BY sector_label ORDER BY n DESC LIMIT 40"""
        )).fetchall()
        ingests = await (await db.execute(
            "SELECT source, batch_key, rows_written, status, detail, completed_at FROM company_register_ingests ORDER BY completed_at DESC LIMIT 10"
        )).fetchall()
        return {
            "tiers": [dict(r) for r in tiers],
            "sectors": [dict(r) for r in sectors],
            "recent_ingests": [dict(r) for r in ingests],
        }
    finally:
        await db.close()
