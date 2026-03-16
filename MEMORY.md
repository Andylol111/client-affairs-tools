# Project Memory

This file is used by both local (Ollama) and cloud AI assistants. Update it when conventions or decisions change so context survives resets.

---

## Stack

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS 4, React Router 7
- **Backend:** Python 3.10+, FastAPI, aiosqlite (SQLite), Pydantic
- **AI:** Ollama (local); optional cloud for complex tasks
- **Auth:** Google OAuth (Gmail), JWT; Slack OAuth optional
- **Other:** Apify (LinkedIn), Tavily (optional search), open tracking, 2FA for admins

---

## File structure

```
client affairs tools/
├── frontend/          # Vite + React app (port 5173)
│   ├── src/
│   │   ├── pages/     # Route pages (Dashboard, Outreach, EmailStudio, etc.)
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── lib/       # api.ts, userPreferences, emailDrafts
│   │   └── main.tsx, App.tsx
│   └── index.html, vite.config.ts
├── backend/           # FastAPI (port 8000)
│   ├── app/
│   │   ├── routers/   # contacts, emails, campaigns, outreach, auth, admin, etc.
│   │   ├── services/  # ollama_email_service, gmail_api, contact_scraper, etc.
│   │   ├── database.py, auth_deps.py, models.py, jwt_utils.py
│   │   └── main.py
│   ├── .env           # API keys, OLLAMA_URL, GOOGLE_*, SLACK_*, etc.
│   └── clientreach.db
├── docs/              # SLACK-SETUP.md, LOCAL-AI-STRATEGY.md
├── scripts/           # RAG index, compact conversation (local AI helpers)
├── MEMORY.md          # This file
├── Modelfile          # Ollama system prompt for this project
└── IMPLEMENTATION.md  # Feature status, env vars, not-yet-implemented
```

---

## Conventions

- **UI labels & buttons:** Title Case (e.g. "Add To Campaign", "Save Template")
- **Frontend:** Functional components, TypeScript strict; API via `frontend/src/api.ts`
- **Backend:** Async endpoints, Pydantic models in `app/models.py`, env in `backend/.env`
- **DB:** SQLite via aiosqlite; migrations by hand if needed
- **Ollama:** Used for email generation and optional Find Contact summary; default URL `http://localhost:11434`

---

## Last worked on

- Outreach Hub: button/label Title Case consistency
- Local AI strategy: MEMORY.md, Modelfile, RAG/compact scripts

---

## Known issues

- See IMPLEMENTATION.md for "Not Yet Implemented" (e.g. Google Drive, Microsoft/OneDrive)
- Slack OAuth requires HTTPS callback in production; use ngrok for local testing

---

## Decisions made

- Using Tailwind for styling (no CSS modules or styled-components)
- Single SQLite DB; no separate Redis/cache for now
- Ollama for local AI; cloud only when needed (see docs/LOCAL-AI-STRATEGY.md)
