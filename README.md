# YUCG Outreach

Live club website for Yale Undergraduate Consulting Group outreach. Members share one catalog (contacts, campaigns, send facts) over HTTPS. It is not a laptop app.

**Site:** CloudFront `AppUrl` from stack `YucgOutreach-dev` (currently `https://d2vjpur8zjk0ai.cloudfront.net`). Sign in with `@yale.edu`.

**Ship:** GitHub Actions (**verify and ship**) on `main`. Image goes to ECR; SSM restarts the existing box. Nothing ships from a laptop. Do not `cdk deploy YucgOutreach-dev` (that replaces the instance and breaks CloudFront + SQLite).

## Members

Use `AppUrl` in any order: Home, Week, Studio, Send, Pipeline, Find, Stats.

- One SQLite file on the box is the warehouse. What you save is what other members see. Browser `localStorage` is not shared.
- Studio generate works against existing contacts (or a quick compose). You do not have to run Find first.
- AI on the host is Bedrock (`LLM_PROVIDER=bedrock`). There is no Ollama on the box.

## Operators

Daily loop:

1. Push to `develop` (no required checks).
2. PR `develop` → `main`. Wait for tests and `build-image`.
3. Merge. The same workflow `ship` job builds `docker/app.Dockerfile`, pushes a unique ECR tag, and SSM-restarts the container.

`feature` is an optional test-only hop. Repo **Admins** can **Bypass rules** on a PR. Random other branches cannot target `main`.

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
.github/workflows/ci.yml  verify and ship
infra/                    CDK (box, OIDC). Do not deploy the app stack from Actions.
backend/                  FastAPI
frontend/                 Vite SPA
```
