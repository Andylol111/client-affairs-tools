"""S3 workbook refresh must avoid unchanged downloads. From backend/: python3 tests/test_prospect_refresh.py"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ["CATALOG_BUCKET"] = "test-catalog"
os.environ.pop("YUCG_PROSPECT_XLSX", None)

from app.services import object_catalog, prospect_coordinator  # noqa: E402


def test_catalog_refresh_is_conditional() -> None:
    metadata = {"etag": "first", "updated": "2026-01-02T03:04:05+00:00", "size": 5}
    downloads: list[str] = []

    def fake_metadata(_key: str) -> dict[str, object]:
        return dict(metadata)

    def fake_bytes(key: str) -> bytes:
        downloads.append(key)
        return metadata["etag"].encode()

    original_root = prospect_coordinator._REPO_ROOT
    original_metadata = object_catalog.object_metadata
    original_bytes = object_catalog.get_bytes
    try:
        with tempfile.TemporaryDirectory() as temporary:
            prospect_coordinator._REPO_ROOT = Path(temporary)
            prospect_coordinator._cache.update({"etag": None, "source_updated_at": None})
            object_catalog.object_metadata = fake_metadata
            object_catalog.get_bytes = fake_bytes

            path = prospect_coordinator._xlsx_from_catalog(force_refresh=True)
            assert path.read_bytes() == b"first"
            assert downloads == ["prospects/current.xlsx"]

            prospect_coordinator._xlsx_from_catalog(force_refresh=True)
            assert downloads == ["prospects/current.xlsx"]

            metadata.update({"etag": "second", "updated": "2026-01-03T03:04:05+00:00"})
            prospect_coordinator._xlsx_from_catalog(force_refresh=True)
            assert path.read_bytes() == b"second"
            assert downloads == ["prospects/current.xlsx", "prospects/current.xlsx"]
    finally:
        prospect_coordinator._REPO_ROOT = original_root
        object_catalog.object_metadata = original_metadata
        object_catalog.get_bytes = original_bytes


if __name__ == "__main__":
    test_catalog_refresh_is_conditional()
    print("ok")
