# Proposed GitHub protection migration

The production environment and main-only deployment policy are now applied and verified. Topic branch restrictions are disabled. Feature requires `feature-required-checks`; main requires `production-required-checks`. Both preserve PR/deletion/force-push protections and have no administrator bypass. The repository is public, current caller has administrator access, and only Andylol111 is listed as a collaborator. The user has deferred a second maintainer. The current proposal supports one maintainer; the future independent-review policy is retained separately.

Fresh inspection on 2026-09-09:

- Main uses active ruleset 22605433, not legacy branch protection. It requires five old checks including `gate-branch`, zero approvals, and allows administrator PR bypass.
- Ruleset 22605072 blocks ordinary topic-branch creation. The proposed disabled payload permits topic branches; main and feature retain their separate protections.
- `production` now requires owner Andylol111 approval, allows self-review for the sole maintainer, disables administrator bypass, and permits only branch main. Existing copilot is unchanged.
- Actions defaults to read-only tokens and cannot approve PRs. Preserve these settings.
- AWS_SHIP_ROLE_ARN points to `yucg-github-ship-dev`; no static deployment variables are present.
- Recent develop run 34351025174 succeeded only in `develop-open`; all verification jobs were skipped. It is not evidence for the current local changes.

## Safe activation order

1. Use the single-maintainer policy for now: mandatory automated checks and PRs, zero required peer approvals, resolved discussions and no administrator check bypass. The owner manually approves production deployment. A second maintainer is not a rollout prerequisite.
2. Review `topic-branches.proposed.json` for ruleset 22605072 and the workflow changes together. Do not remove the separate main/feature protections.
3. Publish a reviewed candidate branch and run the new workflow on its PR. Confirm the stage-specific aggregate context belongs to GitHub Actions and every selected dependency ran successfully. Never manufacture a successful check to bypass it.
4. Once the owner has reviewed the candidate and the new real check results exist, update ruleset 22605433 using `main-ruleset.proposed.json`. This replaces the obsolete gate with the aggregate gate, requires resolved discussions while allowing the sole maintainer to merge without a peer approval, blocks force-push/deletion, and removes administrator bypass. Check all other applicable rulesets for contradictions before updating.
5. Create `production` using `production-environment.proposed.json`: verified owner Andylol111 (ID 214901652) as required reviewer, self-review allowed, administrator bypass disabled. Create the main-only branch policy separately using `production-branch.proposed.json`. This is a deliberate owner approval gate, not independent review. Verify both returned configurations before deployment.
6. Verify deployed AWS OIDC trust for `repo:Andylol111/client-affairs-tools:environment:production` and narrow shipping permissions before merge. Keep deployment blocked while trust/protection verification is incomplete.
7. Merge only the exact verified revision. Confirm the production approval waits, then approve the concrete release separately. Deployment success requires image digest, SSM success, readiness and persistence evidence.

Do not run these API updates on an unreviewed revision. Save the previous ruleset settings privately before modification for an explicitly reviewed rollback. Avoid a temporary unprotected-main window. The proposed JSON contains no credentials and does not create any resources by itself.

## Later: second maintainer

When another maintainer is available, review `main-ruleset.future-reviewers.json` to require one fresh independent PR approval and last-push approval. Add the authorized deployment reviewer and enable prevention of self-review. Until then, this future policy must not block the current workflow. No collaborator invitation is requested or sent.

Both promotion branches use the same aggregate gate: `feature-ruleset.proposed.json` targets ruleset 22605434 and `main-ruleset.proposed.json` targets 22605433. Both were activated after candidate d616543 passed all hosted checks. Branch progression remains develop → feature → main, with topic PRs also permitted.

When feature is behind main, synchronize main into develop and promote that merge through a passing develop-to-feature PR. Direct protected-head updates are rejected by design; do not bypass the rule to synchronize branches.

The deployed ship role was found to have account-wide infrastructure permissions. The reviewed replacement in `ship-role-policy.proposed.json` limits it to reading the existing stack, pushing to the existing ECR repository, sending `AWS-RunShellScript` to the existing instance, and reading that command's result. `ship-role-trust.proposed.json` limits OIDC to this repository's protected `production` environment. Preserve the old documents privately before applying either change, update policy before trust, and verify both afterward.

Current consolidation status (`develop` revision `f380bc7`, 2026-09-11):

- Create the `beta` environment from `beta-environment.proposed.json` and bind it to `feature` with `beta-branch.proposed.json`. Do not point beta at `i-09a071e22270b027c`. Until a separate box exists, leave repository variable `BETA_AWS_INSTANCE_ID` empty so Beta verifies and explains the skipped deploy.
- The repository ships three workflow files: Intake, Beta, and Production. Shared steps live in `.github/actions/` so they do not appear as extra Actions workflows. Terraform plan/apply and optional static publish are Production dispatch operations. Bot-opened PRs do not start `pull_request` workflows. Trusted feature/main history is merged straight into develop.
- Keep stage-specific contexts: `intake-required-checks`, `feature-required-checks`, and `production-required-checks`. Never reuse a lower-stage context on a higher branch.
- Dependabot opens at most one monthly npm PR on develop. Actions and Terraform ecosystems are not polled. The Actions "Copilot" entry is a GitHub-owned reviewer and cannot be disabled from the workflow list.

The composite-loading and metadata gaps are fixed; 48 infrastructure/controller/workflow tests and actionlint pass. Every local-action caller checks out first. Privileged promotion loads only the existing default-branch script, without a GitHub App or new sync PRs. Dispatched shipping uses first-parent changes so a workflow-only merge cannot accidentally request a runtime deployment. The consolidation is committed on `develop`; it will not remove the old Actions sidebar entries until it progresses to the default branch. GitHub settings and current production revision must be checked afresh; the dated observations above are historical. The complete current contract is [delivery guardrails](../../docs/DELIVERY-GUARDRAILS.md).
