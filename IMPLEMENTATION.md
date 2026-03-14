# Implementation Status & Missing Features

This document lists what is implemented, what must be configured for features to work, and what is still to be implemented so the app runs smoothly.

---

## Configured / Required for Features

### 1. Tavily API (Find Contact)

- **Status:** Implemented but **optional**. The "Find Contact" tab in Scraper uses web search to look up people by name (and optional company).
- **To enable:** Add to `backend/.env`:
  ```bash
  TAVILY_API_KEY=your_tavily_api_key_here
  ```
- **How to get a key:** [Tavily](https://tavily.com) (free tier available).
- **If not set:** The UI still works; the API returns a message that web search is not configured.

### 2. Slack

- **Status:** **Implemented** (OAuth connect, callback, status, disconnect). Profile → Settings shows "Connect Slack" when not configured.
- **To enable:** Add to `backend/.env`:
  ```bash
  SLACK_CLIENT_ID=your_slack_client_id
  SLACK_CLIENT_SECRET=your_slack_client_secret
  ```
- **Also set:** `BACKEND_URL` (e.g. `http://localhost:8000` or your production URL) for the OAuth redirect.
- **If not set:** Slack connect button will fail with "Slack integration not configured."

### 3. Google OAuth (Sign-in & Gmail)

- **Status:** Implemented. Used for login and sending email (Gmail API).
- **Required in `backend/.env`:**
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`
  - `FRONTEND_URL`
  - `JWT_SECRET`

### 4. Apify (LinkedIn scraping)

- **Status:** Implemented. Used when scraping contacts from a LinkedIn company URL.
- **To enable:** `APIFY_API_TOKEN` in `backend/.env`.
- **If not set:** LinkedIn-based scraping will return an error or skip that source.

### 5. Ollama (AI email generation)

- **Status:** Implemented. Used for generating email copy and optional "Find Contact" summary.
- **To enable:** Run Ollama locally (e.g. `ollama run llama3.2`). Optional `OLLAMA_URL` in `.env` (default `http://localhost:11434`).
- **If not set:** Email generation and LLM summary for Find Contact will not work.

---

## Not Yet Implemented / To Incorporate

### 1. Google Drive support

- **Status:** **Not incorporated.**
- **Suggested scope:**
  - Attach files from Google Drive when composing emails (e.g. "Insert from Drive" in Email Studio).
  - Or: Import contact lists from a Google Sheet (e.g. CSV export from Sheets).
- **Notes:** Would require Google Drive API scope in addition to existing Gmail OAuth, and backend endpoints to list/read Drive files.

### 2. Microsoft Office / OneDrive support

- **Status:** **Not incorporated.**
- **Suggested scope:**
  - Attach files from OneDrive when composing emails.
  - Or: Import contacts from Excel Online or an uploaded `.xlsx` (upload is already supported; "Microsoft support" could mean native OneDrive/Office 365 integration).
- **Notes:** Would require Microsoft identity (Azure AD / Entra) OAuth and OneDrive/Graph API integration.

### 3. Other possible gaps

- **Email body as HTML:** The email editor supports rich text (bold, italic, underline, lists, font/size). Outgoing campaign emails that use tracking send an HTML part; ensure all send paths that use signature/signature image also send HTML where appropriate (currently implemented for campaign send with tracking).
- **Test send with signature image:** Test send from Email Studio appends the text signature only (plain text). Campaign send uses HTML with signature + signature image. To match behavior, test-send could be extended to send multipart (plain + HTML) when `signature_image_url` is set.

---

## Implemented Features (Quick Reference)

- Dark mode (Settings → Appearance).
- 2FA for admins (Admin → 2FA): setup, verify, disable, reset; QR expiry and regenerate.
- Contact scraper: domain + LinkedIn (Apify), merge; Find Contact (Tavily + optional Ollama).
- Email Studio: rich text body (bold, italic, underline, lists, font/size), signature + signature image URL, drafts, sentiment analysis, attachments library.
- Admin: user list, invite, role/status, export users to Excel (YUCG-styled).
- Campaigns: create, add contacts, send via Gmail API with tracking and signature (including signature image).
- Slack: OAuth connect/status/disconnect (when env is set).

---

## Checklist for "Everything Running Smoothly"

1. **Backend `.env`:**
   - [ ] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `FRONTEND_URL`, `JWT_SECRET` (required for login and Gmail).
   - [ ] `TAVILY_API_KEY` (optional; for Find Contact web search).
   - [ ] `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `BACKEND_URL` (optional; for Slack connect).
   - [ ] `APIFY_API_TOKEN` (optional; for LinkedIn scraping).
2. **Ollama:** [ ] Running locally if you use AI email generation or Find Contact summary.
3. **Google Drive / Microsoft Office:** [ ] Not yet implemented; add to product backlog if desired.

---

## Going public / widely accessible on the internet

To run this site when it is public and widely accessible, configure the following so everything works without hardcoded localhost.

### Backend (production)

1. **`.env` – required for public deployment**
   - `FRONTEND_URL` = your public frontend origin (e.g. `https://outreach.yucg.org`). Used for OAuth redirects and CORS.
   - `BACKEND_URL` or same host = your public API origin (e.g. `https://api.yucg.org`). Used for Slack/Google callback URLs.
   - `GOOGLE_REDIRECT_URI` = `https://your-backend-domain/api/auth/google/callback`.
   - `JWT_SECRET` = a strong secret (different from dev).

2. **CORS**
   - The app allows origins from a fixed list in code. For production, set your frontend origin in `main.py` (e.g. add `https://outreach.yucg.org` to `allow_origins`) or make origins configurable via an env var (e.g. `CORS_ORIGINS`) and split by comma.

3. **Ollama (optional)**
   - For a public server, Ollama can run on the same host or an internal URL. Set `OLLAMA_URL` to that URL (e.g. `http://127.0.0.1:11434` or internal service URL). Do not expose Ollama directly to the internet unless secured.

4. **Database**
   - `clientreach.db` is SQLite by default. For high traffic, consider migrating to PostgreSQL and switching the DB layer; the schema and queries can stay the same.

### Frontend (production)

1. **API base URL**
   - Build with `VITE_API_URL` set to your public backend URL (e.g. `https://api.yucg.org`). In dev, the app uses same-origin (proxy); in production it uses `VITE_API_URL` for all `/api` requests.

2. **OAuth**
   - In Google Cloud Console, add your production frontend URL to authorized JavaScript origins and (if used) redirect URIs. Ensure `GOOGLE_REDIRECT_URI` in backend `.env` matches the backend’s public callback URL.

### Checklist for public deployment

- [ ] Set `FRONTEND_URL` and backend public URL (and `GOOGLE_REDIRECT_URI`, `BACKEND_URL`) in backend `.env`.
- [ ] Set `CORS_ORIGINS` in backend `.env` to your production frontend URL(s), comma-separated (e.g. `https://outreach.yucg.org`). If unset, defaults to localhost for dev.
- [ ] Build frontend with `VITE_API_URL=<backend public URL>`.
- [ ] Serve frontend (e.g. Nginx/static host) and backend (e.g. Gunicorn/Uvicorn behind a reverse proxy) over HTTPS.
- [ ] Restrict Admin and Operations to admins only (already enforced by `get_current_admin`); ensure login and 2FA are in use.
- [ ] (Optional) Run Ollama on the server and set `OLLAMA_URL` for Operations Intelligence and email generation.
