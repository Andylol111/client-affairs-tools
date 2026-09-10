# Implementation status — 2026-09-09

The six stages below are implemented and verified. Independent backend, frontend and infrastructure subagents reviewed and revised their respective changes. The application was deployed through the protected GitHub Actions path on 2026-09-10. No Terraform apply/import or real email delivery was performed.

## 1. Sender isolation and reliable outreach

Campaign ownership and authorized sender are persisted separately. Mutations and detailed reads enforce ownership; shared reporting cannot initiate another member’s mail. Release captures immutable recipient, content, signature and follow-up snapshots. Transactional SQLite claims prevent concurrent workers from claiming the same send. Ambiguous Gmail outcomes remain blocked until exact-message reconciliation proves delivery; they are never blindly retried. Historical ownership requires evidence and explicit administrator confirmation.

Follow-ups retain the original sender. Disabled/disconnected accounts cannot fall back to another member’s credentials. All Gmail send boundaries reject recipient lists and header-control characters. Tracking uses individual message identity, reply/bounce matching and visible sync status. An open is an observed pixel request, not proof a human read the message. Shared activity reports confirmed messages and their actual sender/recipient, without exposing message bodies or credentials.

## 2. Consistent frontend

Removed the fixed backdrop, competing main scroll container and route-entry motion. Grouped navigation, consistent titles and shared page headers now connect outreach, projects, documents and administration. Shared campaigns expose read-only summaries. Responsive document cards, loading/error states and recovery controls are present. Imported/generated rich HTML, previews, signatures and paste/drop content are sanitized with a strict DOMPurify policy.

## 3. Invitations and account admission

Persistent invitations record creator, exact email, assigned projects, expiry, revocation and delivery state. Only the creating member can send the invitation through their connected Gmail account. Uncertain delivery remains visible. Google admission requires verified identity and an existing roster entry or matching valid invitation. Browser-bound, single-use OAuth challenges prevent replay; ordinary identity login is separate from Gmail authorization. Access logs redact OAuth/invitation query parameters and shared-link tokens.

## 4. Private project/document workspace

Database metadata powers permission-filtered search, project membership and frontend views; S3 holds document bytes. Private, project and club visibility are explicit. Administrators do not implicitly gain access to private documents. Uploads reserve quota transactionally and use conditional presigned PUTs. Finalized versions pin the exact bucket and S3 version. Downloads are short-lived attachments. Owner-created bearer shares expire and can be revoked; the bucket remains private. Pending upload recovery preserves reservations when completion is uncertain.

## 5. Delivery and security gates

CI includes backend branch coverage, frontend lint/build/browser tests, dependency and security scans, infrastructure validation and a stable aggregate required-check job. Actions are pinned and Python dependencies are hash-locked. Shipping uses the scanned image artifact and resolved digest. Deployment scripts check the mounted database, create a consistent backup, wait for readiness and support application rollback. PR guidance requests behavior evidence, authorization review, rollout details and a short gross cost delta.

GitHub main and feature rules now require the aggregate GitHub Actions check with no administrator bypass. Production requires owner approval and allows only main. The user deferred a second maintainer, so independent review is a future requirement. Scanners and coverage do not establish that the entire legacy codebase is secure.

## 6. AWS/Terraform preparation

Terraform provides opt-in private versioned storage, constrained role policies and a guarded CloudFront/static-origin handoff. Existing CDK ownership must be relinquished safely before adoption; no competing ownership is permitted. Static publication uploads immutable assets before replacing the index. SQLite backup/restore scripts and optional daily backup systemd units are prepared. Data-bearing storage is retained, and version-pinned documents are not expired by a blanket lifecycle rule.

The current database implementation remains a single-server SQLite deployment. Durable claims cover concurrent processes on that database; this is not a completed PostgreSQL or horizontally distributed writer implementation. Storage can grow independently in S3. Quota reservation is an application control, not an AWS spending cap.

## Final local verification

- All **21 isolated backend regression scripts pass** under Python 3.12 with the production dependency lock.
- Combined backend statement/branch coverage is **31%**. New critical-module gates require at least 80% individually: invitations **91%**, workspace **85%**, dispatch claims **88%**, dispatch recovery **99%**, mailbox validation **89%**. Broad legacy coverage remains work to do.
- Frontend production build and lint pass: **0 errors, 0 warnings**. **42 Chromium desktop/mobile browser tests pass**, including WCAG accessibility checks across 11 main pages and malicious HTML cases. APIs are mocked in these browser tests.
- Frontend and locked backend dependency audits reported **0 known vulnerabilities** at verification time.
- Three infrastructure regression scripts pass, including backup/restore and static publication failure handling. Infrastructure TypeScript, shell syntax, Terraform formatting/validation and diff whitespace checks pass.
- Hosted Linux image scanning now passes on Python 3.12.14 Alpine 3.24; non-root startup and all backend regressions inside that image also pass. The Debian runtime failed on 54 high/critical OS findings and was replaced without weakening the scan threshold. No local Docker execution was available. Native systemd validation, additional browser engines and live service behavior were not exercised locally.

## Approval-dependent production completion

1. Verify live resource ownership, database mount, existing configuration and a restorable backup; review the exact Terraform plan and cost delta before any apply/import.
2. GitHub required checks and owner-approved production protection are configured. Update the deployed AWS OIDC trust from the legacy main-branch subject to the protected production-environment subject through an approved IAM change.
3. Perform the approved CDK-to-Terraform handoff and configure storage CORS, application environment and optional static origin without replacing data-bearing resources.
4. Deploy the verified artifact, exercise readiness and rollback, and enable the backup timer only after a controlled restore rehearsal.
5. Use explicitly authorized test accounts for end-to-end invitation, Google/Gmail connection, send/open/reply/bounce and S3 permission/version/share tests. Reconcile legacy campaign ownership before resuming old outreach.

The deployed revision is `26969f6`, using ECR digest `sha256:757a65e12664017b9534a1d0c4dc59df6be99e2f1eb0f80ae82afdc064c71319`. The container runs as UID/GID 10001, the retained database passes `PRAGMA quick_check`, and CloudFront `/api/health` responds successfully. The one-time ownership variable was removed immediately after job start. Aggregate post-deploy checks found zero active campaigns and zero ready dispatches.

Gross recurring AWS resource allocation remains unchanged; no resources were created or resized. The new tagged ECR image consumes incremental layer storage, partly deduplicated, and the 393,216-byte predeploy backup consumes existing EBS capacity. Future storage versions/backups, requests, transfer, logs and CI usage remain usage-based. Credits are excluded from gross estimates.
