# YUCG Outreach

**Intelligent Client Outreach Platform** — AI-powered email generation, contact scraping, and campaign management for the Yale Undergraduate Consulting Group.

---

## Features

- **Google OAuth login** — Sign in with @yale.edu accounts
- **Login state UI** — When logged in, the nav shows "Welcome, {name}" instead of the Log in button; the login page shows "Welcome back, {name}!" with a link to the dashboard
- **Live email visualizer** — In Email Studio, a live Gmail-style preview updates as you type, with font picker (Lato, Open Sans, Roboto, Georgia, etc.) and font size controls (12–24px)
- **Per-user generated emails** — Each user sees only their own generated emails; contacts are shared across all users
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
# Google OAuth (required for login)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
FRONTEND_URL=http://localhost:5173

# JWT secret - REQUIRED for login to work across page reloads (use a long random string in production)
JWT_SECRET=your-secret-at-least-32-characters-long

# Optional: LinkedIn scraping via Apify
APIFY_API_TOKEN=your-apify-token
```

**Google OAuth setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 Client ID (Web application)
3. Add redirect URI: `http://localhost:8000/api/auth/google/callback`
4. For HTTPS: also add `https://localhost:8000/api/auth/google/callback`
5. Copy Client ID and Client Secret into `.env`

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

### Ollama not running

AI email generation requires Ollama. Start it and pull a model:

```bash
ollama run llama3.2
```

### Login fails / "Waiting for localhost"

1. Ensure the backend is running on port 8000
2. Check that `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are set in `backend/.env`
3. Only `@yale.edu` emails can sign in

### Yale Duo verification

@yale.edu accounts use Yale's Duo two-factor authentication. When signing in, you'll be prompted to verify via Duo Mobile, phone call, or passcode. This is handled by Yale's systems—complete the Duo step when it appears.

- **Manage devices:** [mfa.its.yale.edu](https://mfa.its.yale.edu)
- **Help:** ITS Help Desk 203-432-9000 or information.security@yale.edu

### Gmail test send fails

Configure Gmail in **Settings**:
- Gmail address
- [App Password](https://support.google.com/accounts/answer/185833) (not your regular password)

---

## Project Structure

```
client affairs tools/
├── backend/
│   ├── main.py              # FastAPI app
│   ├── app/
│   │   ├── routers/         # auth, contacts, emails, campaigns, analytics, settings
│   │   ├── services/       # ollama_email_service, contact_scraper, email_sender
│   │   ├── database.py
│   │   └── auth_deps.py
│   ├── requirements.txt
│   └── .env                 # Create this (see Environment Variables)
├── frontend/
│   ├── src/
│   │   ├── pages/           # Dashboard, Scraper, EmailStudio, Campaigns, Analytics, Settings, Login
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

- **Backend:** FastAPI, SQLite, Ollama, PyJWT (Google OAuth)
- **Frontend:** React, TypeScript, Tailwind CSS, Vite
- **AI:** Ollama (local LLM, no cloud API keys)
