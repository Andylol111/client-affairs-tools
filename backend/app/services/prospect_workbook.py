"""Replacing the club target list from inside the website.

The curated list is a spreadsheet — 600-odd companies with why they fit, the
Yale hook and the role to aim at — and until now it could only change by
editing a file in the repository and shipping a new image. A club cannot
maintain its own target list that way, so an administrator uploads the
workbook here instead.

Three rules make that safe:

* Nothing is replaced until the upload parses. The candidate is written to a
  temporary file and read with the same loader the app uses; a workbook that
  yields no companies is refused and the current list is untouched.
* The previous workbook is kept. Replacing a curated list is a destructive
  act, so the copy it replaced stays addressable for rollback.
* The register is re-ingested in the same request, so the Companies tab shows
  what was just uploaded rather than what the nightly job last saw.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALLOWED_SUFFIXES = {".xlsx", ".xlsm"}
MAX_WORKBOOK_BYTES = 25 * 1024 * 1024
CURRENT_KEY = "prospects/current.xlsx"
# The admin catalog lists prospects/versions/; an archive under any other
# prefix would exist in the bucket and be invisible in the app.
ARCHIVE_PREFIX = "prospects/versions"


class WorkbookRejected(ValueError):
    """The upload is not a usable club target list; nothing was replaced."""


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _catalog_enabled() -> bool:
    return bool((os.getenv("CATALOG_BUCKET") or "").strip()) and not (
        os.getenv("YUCG_PROSPECT_XLSX") or ""
    ).strip()


def parse_candidate(content: bytes, filename: str) -> list[dict[str, Any]]:
    """Read the upload with the app's own loader, or refuse it."""
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise WorkbookRejected(
            f"{filename or 'This file'} is not an Excel workbook. "
            f"Export the club list as .xlsx and upload that."
        )
    if not content:
        raise WorkbookRejected("The uploaded file is empty.")
    if len(content) > MAX_WORKBOOK_BYTES:
        raise WorkbookRejected(f"Workbook is larger than {MAX_WORKBOOK_BYTES // (1024 * 1024)} MB.")

    from app.services.prospect_coordinator import SHEET_NAME, _load_rows_from_xlsx

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(content)
        candidate = Path(handle.name)
    try:
        try:
            rows = _load_rows_from_xlsx(candidate)
        except Exception as exc:  # openpyxl/pandas raise their own types
            raise WorkbookRejected(
                f"That workbook could not be read: {exc}. It needs a '{SHEET_NAME}' sheet "
                "with a Company column."
            ) from exc
    finally:
        candidate.unlink(missing_ok=True)

    if not rows:
        raise WorkbookRejected(
            f"No companies found. The '{SHEET_NAME}' sheet needs a header row and at least "
            "one row with a company name."
        )
    return rows


def _store(content: bytes) -> dict[str, Any]:
    """Keep the replaced copy, then put the new one where the app reads it."""
    if _catalog_enabled():
        from app.services.object_catalog import get_bytes, put_bytes

        archived = None
        try:
            previous = get_bytes(CURRENT_KEY)
        except Exception:
            previous = None
        if previous:
            archived = f"{ARCHIVE_PREFIX}/{_stamp()}.xlsx"
            put_bytes(archived, previous,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        put_bytes(CURRENT_KEY, content,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        return {"location": f"s3://{CURRENT_KEY}", "replaced_copy": archived}

    from app.services.prospect_coordinator import prospect_xlsx_path

    path = prospect_xlsx_path()
    archived = None
    if path.is_file():
        archive_dir = path.parent / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive = archive_dir / f"{path.stem}-{_stamp()}{path.suffix}"
        shutil.copy2(path, archive)
        archived = str(archive)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(path)
    return {"location": str(path), "replaced_copy": archived}


async def replace_club_target_list(content: bytes, filename: str) -> dict[str, Any]:
    """Validate, store, reload and re-ingest. Returns what changed."""
    from app.services.company_register import ingest_club_targets
    from app.services.prospect_coordinator import (
        invalidate_prospect_cache, load_prospects, prospects_meta,
    )

    try:
        before = len(load_prospects())
    except Exception:
        before = 0

    rows = parse_candidate(content, filename)
    stored = _store(content)

    # The loader caches on path and mtime, and the S3 copy is cached on disk;
    # both have just changed underneath it.
    invalidate_prospect_cache()
    load_prospects(force_reload=True)
    ingest = await ingest_club_targets()

    return {
        "ok": True,
        "companies": len(rows),
        "companies_before": before,
        "register_rows_written": ingest.get("written"),
        "register_rows_dropped": ingest.get("dropped"),
        # Sheet lines naming an already-listed company and segment: this is
        # why the register can hold fewer rows than the sheet has lines.
        "folded_duplicates": ingest.get("folded") or [],
        **stored,
        "meta": prospects_meta(),
    }
