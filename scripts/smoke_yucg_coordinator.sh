#!/usr/bin/env bash
# Smoke test for YUCG Outreach Coordinator API (requires running backend + auth token).
# Usage:
#   export YUCG_TOKEN="your-jwt"
#   ./scripts/smoke_yucg_coordinator.sh
# Optional: API_BASE=http://localhost:8000

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
TOKEN="${YUCG_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "Set YUCG_TOKEN (JWT from browser localStorage yucg_token after login)." >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

echo "== GET /api/yucg/prospects/meta =="
meta=$(curl -sf "${auth[@]}" "${API_BASE}/api/yucg/prospects/meta")
echo "$meta" | head -c 400
echo ""
row_count=$(echo "$meta" | python3 -c "import sys,json; print(json.load(sys.stdin).get('row_count',0))")
if [[ "$row_count" -lt 1 ]]; then
  echo "WARN: row_count is 0 — ensure data/YUCG_Prospect_List.xlsx exists." >&2
fi

echo ""
echo "== GET /api/yucg/prospects?min_incentive_score=50&limit=5 =="
list=$(curl -sf "${auth[@]}" "${API_BASE}/api/yucg/prospects?min_incentive_score=50&limit=5")
count=$(echo "$list" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))")
echo "count=$count"

echo ""
echo "== GET /api/yucg/prospects/recommend?n=3 =="
rec=$(curl -sf "${auth[@]}" "${API_BASE}/api/yucg/prospects/recommend?n=3")
rec_count=$(echo "$rec" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))")
echo "recommendations=$rec_count"

echo ""
echo "== POST /api/yucg/prospects/export-shortlist (first row if any) =="
first_row=$(echo "$list" | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('prospects') or d.get('items') or []
print(items[0]['row_index'] if items else '')
" 2>/dev/null || true)
if [[ -n "$first_row" ]]; then
  curl -sf "${auth[@]}" -X POST "${API_BASE}/api/yucg/prospects/export-shortlist" \
    -d "{\"row_indices\":[$first_row]}" -o /tmp/yucg_shortlist_smoke.csv
  lines=$(wc -l < /tmp/yucg_shortlist_smoke.csv | tr -d ' ')
  echo "CSV lines=$lines (saved /tmp/yucg_shortlist_smoke.csv)"
else
  echo "SKIP export — no prospect rows returned"
fi

echo ""
echo "== POST /api/yucg/prospects/ai-recommend (optional; may 503 if Ollama down) =="
if curl -sf "${auth[@]}" -X POST "${API_BASE}/api/yucg/prospects/ai-recommend" \
  -d '{"n":2,"min_incentive_score":50}' >/tmp/yucg_ai_rec.json 2>/dev/null; then
  ai_count=$(python3 -c "import json; print(json.load(open('/tmp/yucg_ai_rec.json')).get('count',0))")
  echo "ollama recommendations=$ai_count"
else
  echo "Ollama recommend skipped or failed (503 expected when Ollama offline)"
fi

echo ""
echo "Smoke checks complete."
