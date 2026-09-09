#!/bin/bash
# Optional operator-scheduled backup; no scheduling or cloud calls occur on installation.
set -euo pipefail
[ "${BACKUP_UPLOAD_APPROVED:-false}" = true ] || { echo 'Backup upload not approved'; exit 1; }
: "${BACKUP_BUCKET:?Set dedicated approved private backup bucket}"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]
SOURCE="${1:?Pass explicit SQLite source path}"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
python3 "$SCRIPT_DIR/backup_sqlite.py" "$SOURCE" --destination "$WORK/snapshot.db" > "$WORK/manifest.json"
# Rehearse the completed online snapshot before uploading it.
python3 "$SCRIPT_DIR/backup_sqlite.py" "$WORK/snapshot.db" > "$WORK/restore-check.json"
KEY="sqlite/$(date -u +%Y/%m/%d/%Y%m%dT%H%M%SZ)-$(basename "$WORK")"
aws s3 cp "$WORK/snapshot.db" "s3://${BACKUP_BUCKET}/${KEY}/snapshot.db" --sse AES256 --only-show-errors
aws s3 cp "$WORK/restore-check.json" "s3://${BACKUP_BUCKET}/${KEY}/restore-check.json" --sse AES256 --only-show-errors
# Manifest last marks complete backup sets. No object expiration or deletion here.
aws s3 cp "$WORK/manifest.json" "s3://${BACKUP_BUCKET}/${KEY}/manifest.json" --sse AES256 --only-show-errors
