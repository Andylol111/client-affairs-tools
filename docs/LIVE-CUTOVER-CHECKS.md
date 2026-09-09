# Live cutover checks — 2026-09-09

## Fresh read-only evidence

- AWS profile `andreheidvscode` authenticates to account `442429446212` as root. Use a scoped operational identity for the proposed mutations; none were made in this pass.
- `YucgOutreach-dev` remains `UPDATE_ROLLBACK_COMPLETE`. Existing instance output is `i-09a071e22270b027c`.
- CloudFront `E35QVGFDWHVOPG` is deployed/enabled, with one VPC origin (`vo_1cUN7wIxTWcCDPYkk4dLaX`) at `ip-172-31-14-232.ec2.internal`. Read timeout is 120 seconds, keepalive 5 seconds. There are no ordered cache behaviors. Static origin cutover has not happened.
- Existing catalog bucket `yucgoutreach-dev-catalog742f25fd-y8qmakbekdds` returns `NoSuchCORSConfiguration`. Browser uploads through the compatibility bucket are not ready.
- GitHub authentication now works with repository administrator access. Main is protected by ruleset 22605433, but still requires obsolete `gate-branch`, permits zero approvals and administrator PR bypass. There is no `production` environment. Only Andylol111 is listed as a collaborator. Latest inspected develop run skipped all verification jobs. See [reviewable protection payloads](../infra/github/README.md).

These reads do not verify host filesystem mounts, runtime settings, database health, IAM permissions or Google consent configuration. No secret values or club records were fetched.

## GitHub progression

Authentication is verified. Before activation, recheck repository rules/rulesets, main branch protection, production environment reviewers/deployment branches, and Actions permissions before proposing modifications. Require `required-checks`, owner review of the latest revision, resolved conversations, and restricted bypasses. The user deferred a second maintainer: use zero required peer approvals and an owner-approved production environment with self-review allowed for now. Independent approval becomes mandatory only when another maintainer is available. Verify plan entitlement supports these protections. Identify actual maintainers before configuring reviewer identities; do not invent CODEOWNERS.

The proposed workflow uses environment-scoped OIDC. Read deployed ship-role trust/policies and reconcile that trust with the production environment before shipping. Existing broad infrastructure permissions must not be copied into the app ship role. Build the reviewed revision, preserve the scanned artifact, and deploy that digest through the existing ECR/SSM path. A dirty local tree is not an approved release artifact.

## AWS progression

1. Read the deployed template and resource dependencies. Separate storage creation from CloudFront adoption so document storage does not require a CDN migration first.
2. Prepare the exact target buckets, retention/recovery policy, scoped IAM and browser origin. Keep new storage disabled until the saved plan is reviewed. Bootstrap private Terraform state separately; never share application document access with state access.
3. Obtain host mount/image/database health and online backup/restore evidence through a narrowly scoped reviewed diagnostic command. Do not print environment files, tokens or member data.
4. For CloudFront adoption, prepare retention and ownership removal without an EC2 replacement. Inspect the CloudFormation change set before execution; the current full app stack is replacement-sensitive. Require exact live routing/certificate/logging parity before approving migration.
5. Review saved Terraform plan, account, revision/hash, resource ownership and gross cost assumptions. Run the local handoff-plan safety check. Apply only that approved plan; re-review changes after drift.
6. Configure application storage/runtime URLs, deploy through the verified shipping path, and perform the controlled checks below. Enable scheduled backups only after independent restore verification.

## Controlled integration acceptance

Use two explicitly authorized test members A/B, one administrator and a controlled recipient. Record case, release digest, time, expected/actual result and sanitized evidence. Obtain exact test mailbox addresses and authorization before any sends. Do not use club prospects as test recipients.

| Case | Required result |
| --- | --- |
| Invitation | A creates for B's exact verified address; B accepts once with intended projects; replay, expiry, wrong account and revoked invitation fail. Invitation delivery uses its creator's Gmail only. |
| Identity/Gmail | Identity login alone does not connect Gmail. Connecting another mailbox fails. Disconnecting A blocks A's queued sends without choosing B. |
| Sender/concurrency | A sends a single approved message; B cannot mutate/release/drain A's campaign. Two workers do not duplicate a claim. Shared ledger identifies A and the exact recipient. |
| Ambiguous send | Interrupt a controlled send only in a test environment. Recovery verifies the exact sent message or remains blocked; it never blindly resends. |
| Tracking | Confirm production HTTPS pixel URL and message-specific token. Observe an open request, reply before/after reminder, and sync timestamp. Treat opens as approximate. |
| Bounce | Use a provider-approved simulator or a controlled test-domain delivery failure. Distinguish delayed/permanent failure and suppress inappropriate follow-ups. Do not send to guessed addresses. |
| S3 versions | A uploads benign fixture bytes through browser CORS; finalization pins bucket/version. A later version does not change earlier download bytes. |
| Permissions | B and administrator cannot read A's private file. Project/club scopes work only as intended. Direct API attempts enforce the same rules. |
| Share | Explicit link works before expiry, then fails after revocation/expiry; the S3 bucket stays private. An already issued download URL can remain usable until its short expiry. |
| Quota/recovery | Concurrent reservations respect quota. Incorrect size/type fails; expired absent upload can be abandoned safely. |
| Restore/rollback | Restore a new isolated database from backup and verify application behavior; readiness failure restores the prior compatible image without restoring/deleting production data automatically. |

Retain sanitized results, not OAuth codes, signed URLs, raw mailbox contents or production database exports. Failed cases block the relevant cutover.

Gross deployed AWS delta remains $0 from this work. No resources changed and no Cost Explorer queries were issued in this pass. Proposed storage and backup costs remain unapproved and depend on retained GB-months, requests and transfer; credits do not reduce the gross estimate.

Container deployment now uses UID/GID 10001. Before live cutover, review existing `/data` and SQLite file ownership and permissions for that identity. The restart script checks access before stopping the old container and fails closed; it does not recursively change production file ownership. Backup creation uses an explicit root exec to write the root-only backup directory.
