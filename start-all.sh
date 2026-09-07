#!/bin/bash
# Start YUCG Outreach - Backend + Frontend
cd "$(dirname "$0")"

echo "=== YUCG Outreach - Starting from scratch ==="

# 1. Backend setup
echo ""
echo "1. Setting up backend..."
if [ ! -f backend/.env ] || ! grep -qE '^JWT_SECRET=.+' backend/.env; then
  echo "   ERROR: backend/.env must set JWT_SECRET (not the example placeholder)."
  echo "   Copy backend/.env.example and run: python3 -c \"import secrets; print(secrets.token_hex(32))\""
  exit 1
fi
cd backend
if [ ! -d "venv" ]; then
  echo "   Creating Python virtual environment..."
  python3 -m venv venv
fi
echo "   Activating venv and installing dependencies..."
source venv/bin/activate
pip install -q -r requirements.txt
echo "   Starting backend on http://localhost:8000"
python -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# 2. Frontend setup
echo ""
echo "2. Setting up frontend..."
cd frontend
if [ ! -x "node_modules/.bin/vite" ]; then
  echo "   Installing npm dependencies (vite not found — node_modules may be incomplete)..."
  npm install
fi
if [ ! -x "node_modules/.bin/vite" ]; then
  echo ""
  echo "   ERROR: Could not install frontend dependencies."
  echo "   Run manually:  cd frontend && npm install && npm run dev"
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi
echo "   Starting frontend on http://localhost:5173"
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "=== Both servers starting ==="
echo "   Backend:  http://localhost:8000"
echo "   Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both"
wait $BACKEND_PID $FRONTEND_PID
