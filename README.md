# YUCG Outreach

**Intelligent Client Outreach Platform** — AI-powered email generation, contact scraping, and campaign management for the Yale Undergraduate Consulting Group.

---

## Features

- **Google OAuth login** — Sign in with @yale.edu accounts only; Gmail sending uses OAuth tokens (no App Passwords)
- **Outreach pipeline** — Kanban board (cold → contacted → replied → meeting → closed), notes, activity log
- **Template library** — Reusable email templates with merge fields
- **Follow-up sequences** — Automated multi-step follow-ups
- **Profile analysis** — Value prop, role, online sentiment, receptiveness
- **Sentiment analyzer** — Analyze email tone in Email Studio
- **Email verification** — Format validation for contacts
- **Open tracking** — Tracking pixel in campaign emails
- **Admin & security** — Roles (admin/standard), audit log, user management, API keys, notification prefs, 2FA for admins
- **Live email visualizer** — Gmail-style preview with font picker and size controls
- **Contact scraper** — Discover contacts from domains and LinkedIn
- **AI email generation** — Ollama-powered personalized emails
- **Campaigns & analytics** — Create campaigns, send emails, track metrics

---

## Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- **Ollama** (for AI email generation) — [Install Ollama](https://ollama.ai), then run:
  ```bash
  ollama run llama3.2
  ```

---

## First-Time Setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

### Environment Variables

Create `backend/.env` with:

```env
# Google OAuth (required for login + Gmail sending)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
FRONTEND_URL=http://localhost:5173

# JWT secret - REQUIRED for login (use a long random string in production)
JWT_SECRET=your-secret-at-least-32-characters-long

# Optional: LinkedIn scraping via Apify
APIFY_API_TOKEN=your-apify-token

# Optional: Slack integration (Community sidebar)
SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret
BACKEND_URL=http://localhost:8000
```

**Slack OAuth setup (optional):**
1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Under OAuth & Permissions, add Redirect URL: `http://localhost:8000/api/auth/slack/callback` (use `https://` and your domain in production)
3. Add Bot Token Scopes: `users:read`, `users:read.email`, `team:read`
4. Copy Client ID and Client Secret to `.env`

**Google OAuth setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 Client ID (Web application)
3. Add redirect URI: `http://localhost:8000/api/auth/google/callback`
4. For HTTPS: also add `https://localhost:8000/api/auth/google/callback`
5. **Enable Gmail API** — In APIs & Services → Library, enable "Gmail API" for your project (required for sending emails)
6. Copy Client ID and Client Secret into `.env`

---

## Running the App

### Option 1: One Command (Recommended)

From the project root:

```bash
./start-all.sh
```

This starts both backend and frontend. Press `Ctrl+C` to stop both.

### Option 2: Manual (Two Terminals)

**Terminal 1 — Backend:**
```bash
cd backend
source venv/bin/activate
python -m uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

### Option 3: HTTPS (for OAuth / production-like testing)

```bash
./start-https.sh
```

- Frontend: https://localhost:5173
- Backend: https://localhost:8000
- Accept the self-signed certificate in your browser
- Add `https://localhost:8000/api/auth/google/callback` to Google OAuth redirect URIs

---

## URLs

| Service        | URL                          |
|----------------|------------------------------|
| Frontend       | http://localhost:5173        |
| Backend API    | http://localhost:8000        |
| API Docs       | http://localhost:8000/docs   |
| Health Check   | http://localhost:8000/api/health |

---

## Troubleshooting

### "Address already in use" or ports busy

Free ports 8000 and 5173–5180:

```bash
./kill-ports.sh
```

Then run `./start-all.sh` again.

### Login fails / "Invalid login attempt"

1. **invalid_callback** — Start the login flow again from the login page (don’t reuse an old Google redirect URL). If the backend restarted, the OAuth state is cleared.
2. **callback_failed** — Check the backend terminal for the full error. Common causes: missing env vars, Gmail API not enabled, database issues.
3. Ensure the backend is running on port 8000.
4. Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `backend/.env`.
5. Only `@yale.edu` emails can sign in.

### "Waiting for localhost"

The backend may not be responding. Run `./kill-ports.sh` then `./start-all.sh`.

### Gmail send fails (403 / not authorized)

- **Gmail API must be enabled** in Google Cloud Console for your OAuth project.
- Sign out and sign back in to refresh OAuth tokens and re-authorize Gmail.

### Ollama not running

AI email generation requires Ollama. Start it and pull a model:

```bash
ollama run llama3.2
```

### Yale Duo verification

@yale.edu accounts use Yale's Duo two-factor authentication. When signing in, you'll be prompted to verify via Duo Mobile, phone call, or passcode. This is handled by Yale's systems—complete the Duo step when it appears.

- **Manage devices:** [mfa.its.yale.edu](https://mfa.its.yale.edu)
- **Help:** ITS Help Desk 203-432-9000 or information.security@yale.edu

---

## Project Structure

```
client affairs tools/
├── backend/
│   ├── main.py              # FastAPI app
│   ├── app/
│   │   ├── routers/         # auth, contacts, emails, campaigns, analytics, settings, outreach, track, admin
│   │   ├── services/        # ollama_email_service, gmail_api, contact_scraper, sentiment_analyzer, etc.
│   │   ├── database.py
│   │   ├── auth_deps.py
│   │   └── jwt_utils.py
│   ├── requirements.txt
│   └── .env                 # Create this (see Environment Variables)
├── frontend/
│   ├── src/
│   │   ├── pages/           # Dashboard, Scraper, EmailStudio, Campaigns, Analytics, Outreach, Admin, Settings, Login
│   │   ├── api.ts
│   │   └── App.tsx
│   └── package.json
├── start-all.sh             # Start backend + frontend
├── start-https.sh           # Start with HTTPS
├── kill-ports.sh            # Free ports 8000, 5173–5180
└── README.md
```

---

## Tech Stack

- **Backend:** FastAPI, SQLite, Ollama, PyJWT (Google OAuth), Gmail API
- **Frontend:** React, TypeScript, Tailwind CSS, Vite
- **AI:** Ollama (local LLM, no cloud API keys)
