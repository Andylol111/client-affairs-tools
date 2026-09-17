# S3 backup bootstrap — one-time, from CloudShell

Turns on the opt-in SQLite→S3 backup that already exists as source
(`infra/scripts/backup-to-s3.sh`, `infra/systemd/yucg-backup.*`) but was
never installed on the running box. Verified against the live host before
writing this: `/usr/bin/aws` (2.33.15), `/usr/bin/python3` (3.9.25, no
3.10+ syntax in `backup_sqlite.py`), `/usr/bin/systemctl` all present.

Bucket name `yucgbak442429446212` is fixed in the policy/config JSON
files below — change it in all of them (and re-upload) for a different
name.

## Steps

1. In AWS CloudShell (console, region us-east-1), use **Actions ▸ Upload
   file** to upload these eight files from your local checkout — no
   typing, avoids the terminal's line-wrap-to-Enter issue on long
   JSON/script lines:
   - `infra/scripts/backup-to-s3.sh`
   - `infra/scripts/backup_sqlite.py`
   - `infra/systemd/yucg-backup.service`
   - `infra/systemd/yucg-backup.timer`
   - `infra/ops/backup-bootstrap/bucket-policy.json`
   - `infra/ops/backup-bootstrap/iam-policy.json`
   - `infra/ops/backup-bootstrap/encryption.json`
   - `infra/ops/backup-bootstrap/ssm-deploy.json`

2. Open `cloudshell-commands.txt` from this directory locally (not
   uploaded — its lines are pasted into the CloudShell prompt one block
   at a time, in order top to bottom; each line is already short enough
   to survive the terminal's wrap-to-Enter behavior on paste).

3. The last two commands in that file check the result: systemd status for
   `yucg-backup.service` and an `aws s3 ls` on the bucket's `sqlite/`
   prefix. A successful run shows `snapshot.db`, `restore-check.json`, and
   `manifest.json` under one timestamped key.

## What this does NOT do

- Does not touch the CDK stack (`cdk deploy` is never run here).
- Does not change the live serving path — the app still reads
  `/data/clientreach.db` directly; S3 only ever receives a copy.
- Grants the box's role write access only under `sqlite/*` in this one
  bucket, and read access only under `bootstrap/*` — not full bucket
  access, not access to any other bucket.
- The `bootstrap/*` objects (the scripts themselves) are one-time install
  media, not backups; safe to delete from S3 after the timer/service are
  installed, though leaving them costs a few KB.
