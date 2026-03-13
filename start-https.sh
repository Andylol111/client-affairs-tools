#!/bin/bash
# Start YUCG Outreach with HTTPS (self-signed certs for local dev)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || { echo "Could not change to script directory"; exit 1; }

# Load env vars from backend/.env (SSL_KEY_PATH, SSL_CERT_PATH)
if [ -f backend/.env ]; then
  set -a
  source backend/.env
  set +a
fi

# Default cert paths (relative to backend/); override via env
SSL_KEY_PATH="${SSL_KEY_PATH:-certs/key.pem}"
SSL_CERT_PATH="${SSL_CERT_PATH:-certs/cert.pem}"

CERT_DIR="./backend/certs"
mkdir -p "$CERT_DIR"

# Auto-generate self-signed certs only when using default paths
if [ "$SSL_KEY_PATH" = "certs/key.pem" ] && [ ! -f "$CERT_DIR/key.pem" ]; then
  echo "Generating self-signed certificates..."
  openssl req -x509 -newkey rsa:2048 -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -days 365 -nodes -subj "/CN=localhost"
fi

echo "Starting backend with HTTPS on https://localhost:8000"
cd backend
source venv/bin/activate
python -m uvicorn main:app --reload --port 8000 --ssl-keyfile="$SSL_KEY_PATH" --ssl-certfile="$SSL_CERT_PATH" &
cd ..

echo "Starting frontend with HTTPS on https://localhost:5173"
cd frontend
VITE_HTTPS=true VITE_PROXY_TARGET=https://localhost:8000 npm run dev &
cd ..

echo ""
echo "=== HTTPS servers ==="
echo "  Frontend: https://localhost:5173 (accept self-signed cert in browser)"
echo "  Backend:  https://localhost:8000"
echo ""
echo "For Google OAuth: add https://localhost:8000/api/auth/google/callback to authorized redirect URIs"
wait
