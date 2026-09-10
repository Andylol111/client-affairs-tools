# YUCG Outreach

Live club website for Yale Undergraduate Consulting Group outreach. Members share one catalog (contacts, campaigns, send facts) over HTTPS. It is not a laptop app.

**Site:** CloudFront `AppUrl` from stack `YucgOutreach-dev` (currently `https://d2vjpur8zjk0ai.cloudfront.net`). Sign in with `@yale.edu`.

**Ship:** GitHub Actions. `develop` is Intake only (no deploy). `feature` deploys beta. `main` deploys production. Image goes to ECR; SSM restarts the existing box. Nothing ships from a laptop. Do not `cdk deploy YucgOutreach-dev` (that replaces the instance and breaks CloudFront + SQLite).

## Members

Use `AppUrl` in any order: Home, Week, Studio, Send, Pipeline, Find, Stats.

- One SQLite file on the box is the warehouse. What you save is what other members see. Browser `localStorage` is not shared.
- Studio generate works against existing contacts (or a quick compose). You do not have to run Find first.
- AI on the host is Bedrock (`LLM_PROVIDER=bedrock`). There is no Ollama on the box.

## Operators

Daily loop:

1. Open a same-repo PR into `develop` (or push there). **Intake** runs the selected checks. Develop never deploys.
2. After Intake succeeds, promotion opens `develop` → `feature`. **Beta** must pass; a runtime push to `feature` deploys the beta box.
3. After Beta succeeds, promotion opens `feature` → `main`. **Production** must pass; a runtime push to `main` deploys the live box after environment approval.

A docs-only or workflow-only change still has to pass its selected checks, but it does not request a deployment. Add `release:hold`, request changes, or close the promotion PR to stop a candidate. Terraform apply is a separate reviewed saved-plan workflow.

`feature` is the beta hop, not an optional skip. Required checks have no administrator bypass. Random other branches cannot target `feature` or `main`.

On / off, secrets, the prospect workbook, and handoff live in [`infra/README.md`](infra/README.md). CloudShell only. After a secret change, Session Manager: `sudo /usr/local/bin/yucg-run.sh`.

Host: t3.small, CloudFront VPC origin (port 80 is not world-open), SQLite on a retained EBS volume. Same process as localhost: Vite SPA + FastAPI in one image. Do not set `VITE_API_URL`.

## Local UI (optional)

`./start-all.sh` is for UI work on a laptop. It does not deploy and it does not share the live database.

```bash
# backend/.env needs JWT_SECRET (and Google OAuth if you test login)
./start-all.sh
```

Frontend: http://localhost:5173 · API: http://localhost:8000. Press Ctrl+C to stop. If ports are busy: `./kill-ports.sh`.

## Layout

```
docker/app.Dockerfile   live image (SPA + API)
.github/workflows/        Intake (develop), Beta (feature), Production (main)
infra/                    CDK (box, OIDC). Do not deploy the app stack from Actions.
backend/                  FastAPI
frontend/                 Vite SPA
```
