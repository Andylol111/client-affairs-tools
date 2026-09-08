# YUCG prospect data

Company-level outreach targets for the YUCG outreach coordinator. This folder is the **source-of-truth boundary** between spreadsheet curation and the app database.

## Source of truth

| Asset | Role |
|-------|------|
| `YUCG_Prospect_List.xlsx` | Canonical prospect list (513 companies, 5 base columns; edit here first) |
| `YUCG_Prospect_List.expanded.xlsx` | Optional expanded list (Agent 2 adds outreach columns); sync with `--xlsx` |
| `prospects.schema.json` | Column definitions and DB mapping for the base five columns |
| `backend/clientreach.db` → `yucg_prospect_targets` | Synced copy used by the app at runtime |

**Workflow:** Edit the spreadsheet → run sync → backend reads from SQLite.

Do not treat the database as authoritative for company targets; re-run sync after spreadsheet changes.

## Spreadsheet columns

**620 company rows** (June 2026 expansion: +107 under-covered sectors and entertainment role splits). Backup snapshot: `YUCG_Prospect_List.expanded.xlsx`.

| Header | DB column | Notes |
|--------|-----------|-------|
| Company | `company` | Unique key; required |
| Sector | `sector` | Industry / segment |
| Why Attractive Prospect for YUCG | `why_attractive` | Fit rationale |
| Suggested Engagement Theme | `suggested_engagement_theme` | Outreach narrative |
| Yale / YUCG Hook | `yale_yucg_hook` | Yale-specific lead |
| Outreach Priority | `extra_json.outreach_priority` | 1–5 (1 = highest) |
| Contact Type | `extra_json.contact_type` | Persona bucket for outreach |
| Target Role Title | `extra_json.target_role_title` | Job title to hunt |
| Incentive Score | `extra_json.incentive_score` | 0–100; see README sheet for weights |
| Score Rationale | `extra_json.score_rationale` | Brief score justification |
| Verification Source URL | `extra_json.verification_source_url` | Public page or search template |
| Recommended First Message Angle | `extra_json.first_message_angle` | One-sentence opener |
| Contact Discovery Hint | `extra_json.discovery_hint` | Conferences, alumni, press, etc. |

Outreach extension columns sync via `extra_json` (see `scripts/sync_prospects_from_xlsx.py`). Regenerate with `python scripts/expand_yucg_prospects.py`.

## Sync into SQLite

From the repo root (requires `openpyxl`, already in `backend/requirements.txt`):

```bash
# Default: data/YUCG_Prospect_List.xlsx → backend/clientreach.db
python scripts/sync_prospects_from_xlsx.py

# Preview parse only
python scripts/sync_prospects_from_xlsx.py --dry-run

# After Agent 2 column expansion (optional alternate file)
python scripts/sync_prospects_from_xlsx.py --xlsx data/YUCG_Prospect_List.expanded.xlsx
```

Sync is **upsert by company name**: existing rows update, new companies insert, nothing deletes removed spreadsheet rows automatically.

The base list has **513 spreadsheet rows** and **505 unique company names** (8 companies appear twice). Duplicate rows last-write-wins on sync.

## Related database tables

| Table | Purpose |
|-------|---------|
| `yucg_prospect_targets` | Spreadsheet-backed **company** targets (this data layer) |
| `yucgoutreach_discovery_runs` | User-triggered per-company contact discovery jobs |
| `yucgoutreach_prospects` | **People** found during a discovery run |
| `contacts` | CRM contacts (import from discovery or manual) |

Company targets seed outreach; discovery runs enrich them with individual contacts.

## Other files in `data/`

| File | Purpose |
|------|---------|
| `Modelfile.yucg-outreach` | Ollama system prompt for outreach agents |
| `yucg_website_corpus.txt` | Static YUCG context for RAG / prompts |
| `.yucg_cache/` | Local fetch cache (safe to delete) |
