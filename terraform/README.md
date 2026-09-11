# Review-only Terraform transition

Nothing here is applied. New storage defaults off. Existing CloudFront adoption and a narrow existing-role document grant are separately opt-in; existing EC2/EBS/database ownership remains with CloudFormation. Account ID and globally unique bucket prefix are explicit inputs. No automatic expiration of club records is configured.

1. Establish a separately approved private, versioned, encrypted state bucket with TLS-only access and least-privilege state/lock access. Supply backend settings with `terraform init -backend-config=backend.hcl`; enable S3 lockfile support. State and saved plans can contain secrets. Never put them in Git or public build artifacts.
2. Install Terraform, run init, fmt, validate and provider security checks. Review and commit the generated `.terraform.lock.hcl` with platform checksums. The checked-in lock selects signed AWS provider 5.100.0; review provider upgrades explicitly.
3. Inventory live CDK logical/physical IDs, dependencies, policies and drift. Verify retained-volume mount, SQLite online backup and restore in isolation before infrastructure migration. Existing IDs from the audit are evidence, not an import manifest.
4. Retain every resource selected for handoff in CDK, deploy that retention change after approval, remove only those resources from the stack without deletion, then import them into exact reviewed Terraform definitions. Never run both controllers against the same resource. An import is not a handoff. CloudFront VPC origin associations require special review because earlier stack updates rolled back.
5. Require a zero-replacement/no-delete plan for existing resources. Protect volume, database storage, documents and state with lifecycle safeguards. A reviewer must approve the exact saved plan against its commit, account and cost delta; replan after any change. No automatic apply workflow is provided.
6. Separately approve new private static/documents/backup buckets. Wire CloudFront OAC to static only; preserve API routing to the VPC origin. Do not make document buckets public. App authorization must precede short-lived presigned upload/download grants; validate size/type, object ownership, upload completion and project membership.
7. Copy legacy attachments, verify hashes and counts, update metadata transactionally, test owner/project/outsider access, keep originals until reviewed cutover. Backup SQLite via its backup API, upload encrypted snapshots, test restoration and record RPO/RTO. EBS snapshots alone are not the application restore test.
8. Agree retention and storage budget before adding lifecycle expiration. Count current versions, noncurrent versions, backups, requests and egress. Monitor these separately from promotional credits.

Current production policy uses the sole maintainer's explicit approval and main-only deployment branches; a second reviewer and preventing self-review are deferred. Verify the actual environment and environment-scoped OIDC trust before an approved release. Do not redeploy the replacement-sensitive app stack merely to update IAM.

Local recurring AWS cost delta: $0. Proposed buckets have usage-based charges; no cost has been incurred by this configuration.

Verification in this local pass: infra TypeScript typecheck, shell syntax, YAML parsing, and mutable-image rejection passed. Terraform 1.10.5 was checksum-verified, AWS provider initialization ran with backend disabled, and schema validation passed. Bandit high-severity/high-confidence scanning passed locally; full dependency/Trivy scans and Docker/SSM rollout/rollback were not run. CI now blocks on high-severity dependency audit, high-confidence/high-severity Bandit findings, and pinned Trivy secret/misconfiguration/container scans; this is not a substitute for authorization tests, independent review. Python deployment dependencies now use a hashed Linux/Python3.12 lock; execution on that target remains a CI check. Docker base tags still need reviewed digest locking. Configure required checks/owners and environment reviewers in GitHub; YAML cannot enforce repository settings by itself.

## Existing CloudFront adoption and application cutover

`cloudfront.tf` is opt-in and uses an import block for the audited existing `E35QVGFDWHVOPG`. Both `adopt_existing_distribution` and new storage must be enabled. An explicit CloudFormation-relinquished acknowledgment and exact existing VPC origin/domain inputs are required. The import block is inactive by default; neither import nor plan/apply ran during implementation. Preserve any live aliases/certificate/WAF/logging differences found during fresh inventory before approving the plan. The current code represents the audited default CloudFront hostname, not arbitrary production custom-domain configuration.

The API retains private VPC-origin routing for `/api` and `/api/*`, forwarding viewer identity and disabling caching. Static S3 uses OAC restricted to this distribution; SPA rewrites run only on static behavior. Upload assets with immutable long-lived cache headers and `index.html` with `Cache-Control: no-cache`; the custom static cache policy permits zero TTL. Static asset deployment/invalidation permissions and rollout must be approved before enabling the origin split. Keep the container-hosted SPA until static files and deep links pass smoke tests.

`existing_instance_role_name` optionally adds narrowly scoped document object access to the verified application role. Set the output `DOCUMENTS_BUCKET` in the backend environment at cutover. Existing production `CATALOG_BUCKET` remains the compatibility fallback, but browser PUT requires matching CORS on that existing bucket; do not claim new uploads work live until this is configured and verified. Runtime file migrations must retain their source bucket/version IDs; changing a global bucket setting does not migrate old documents.

The CDK catalog now uses RETAIN and disables automatic object deletion for every environment, including dev. Deploy this explicit retention safety change under the approved handoff plan before relinquishing any CloudFormation ownership. Existing exports/discovery lifecycle remains limited to temporary prefixes.

## Opt-in operational scripts

CI preserves the verified frontend `dist` artifact. `publish-static` runs only after successful backend shipping, protected production approval, and explicit `STATIC_CUTOVER_APPROVED=true` / `STATIC_BUCKET` settings. Supply `AWS_STATIC_ROLE_ARN` for a separately reviewed production-environment OIDC role; its optional narrow policy is represented by `existing_static_publish_role_name`. Publication uploads hashed assets first, secondary files next, index last with `no-cache`; no sync deletion occurs. Optional `STATIC_INVALIDATION_APPROVED=true` and the adopted distribution ID enable index invalidation. Old assets remain for old entry pages and need a separately reviewed retention policy.

`python3 infra/scripts/backup_sqlite.py /path/to/database.db` rehearses online backup and restoration entirely inside a temporary directory and prints integrity/row-count evidence. `--destination` produces a new snapshot and refuses existing targets. Unit tests cover uncheckpointed WAL data and exact restored values. This is SQLite restore verification, not full application disaster recovery or live S3 restore verification.

`BACKUP_UPLOAD_APPROVED=true BACKUP_BUCKET=<approved-private-bucket> bash infra/scripts/backup-to-s3.sh /explicit/source.db` optionally uploads a verified snapshot and completion manifest after isolated restoration checks. The instance policy grants only PutObject under backup `sqlite/*`; restore operators need a separately approved read role. No scheduler is installed and no retention deletion is configured. Budget retained snapshots/version bytes before enabling scheduled backups; expiration requires a reviewed recovery-window policy. A live restore drill remains necessary before production cutover.

### Optional daily backup scheduling

Prepared systemd units in `infra/systemd/` are not installed or enabled. The timer schedules 06:00 UTC with up to 15 minutes jitter and runs once after downtime if missed. The service requires mounted `/data`, takes a local lock, runs as root with a private temporary directory, and reads only root-managed configuration. A failed backup is visible in the unit journal; alert routing remains part of the approved operational rollout. Size temporary disk space for two snapshot copies during restoration checks and retain the previous successful backup until reviewed cleanup.

After approving the backup bucket, scoped instance IAM policy, recovery window and storage budget, review these installation commands on the intended EC2 host. Ensure Python3, AWS CLI and flock are installed first:

```sh
sudo install -d -m 0755 /opt/yucg/backup
sudo install -m 0755 infra/scripts/backup-to-s3.sh infra/scripts/backup_sqlite.py /opt/yucg/backup/
sudo install -d -m 0755 /etc/yucg
sudo install -m 0600 infra/systemd/backup.env.example /etc/yucg/backup.env
# Edit the ROOT-OWNED file with the approved bucket; set BACKUP_UPLOAD_APPROVED=true.
sudoedit /etc/yucg/backup.env
sudo install -m 0644 infra/systemd/yucg-backup.service infra/systemd/yucg-backup.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/yucg-backup.service /etc/systemd/system/yucg-backup.timer
sudo systemctl daemon-reload
# First run uploads a real backup: execute only after the reviewed approval.
sudo systemctl start yucg-backup.service
sudo journalctl -u yucg-backup.service --no-pager
# Enable only after successful upload and independent restore validation.
sudo systemctl enable --now yucg-backup.timer
```

These are reviewable instructions, not executed operations. Disable with `sudo systemctl disable --now yucg-backup.timer`; this does not delete backups. Unit runtime validation requires Linux/systemd and was not available on the local macOS host. Shell approval requirements and mocked upload behavior are covered by the infrastructure unit tests.

## Saved-plan safety check

After generating a plan for a reviewed revision with a scoped identity, store its JSON in a private local directory and run `python3 infra/scripts/check_handoff_plan.py /private/path/plan.json`. The check rejects deletion/replacement, compute/database mutations, incomplete plans and observed drift. It does not approve IAM changes or prove CloudFormation relinquishment. Review the full plan separately, record its SHA-256 and revision, and never publish the raw JSON (it may contain secrets). The current local three-workflow consolidation exposes plan/apply as explicit Production dispatch operations, with protected infrastructure environments and private saved plans. Ordinary application delivery never applies Terraform. See [delivery guardrails](../docs/DELIVERY-GUARDRAILS.md).
