## Cursor Cloud specific instructions

- **Backend:** `cd backend && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt` → `./venv/bin/python -m uvicorn main:app --reload --port 8000`
- **Frontend:** `cd frontend && npm install && npm run dev` → http://localhost:5173
- **Health check (no OAuth):** `curl http://localhost:8000/api/health`
- **Login:** requires `backend/.env` from `.env.example` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, URLs). See root `README.md`.
- **Lint:** `npm run lint` in `frontend/` (many existing ESLint findings). **Build:** `npm run build` in `frontend/`.
- **All-in-one:** `./start-all.sh` from repo root (starts backend + frontend).
