#!/usr/bin/env bash
# Create optional yucg-outreach Ollama model from data/Modelfile.yucg-outreach.
# The API works without this step (RAG-in-prompt via YUCG_OUTREACH_MODEL / OLLAMA_MODEL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is not installed. Get it from https://ollama.com" >&2
  exit 1
fi

if ! curl -sf "http://localhost:11434/api/tags" >/dev/null 2>&1; then
  echo "Start Ollama first: ollama serve" >&2
  exit 1
fi

echo "Pulling base model llama3.2 if needed..."
ollama pull llama3.2

echo "Creating yucg-outreach from data/Modelfile.yucg-outreach..."
ollama create yucg-outreach -f data/Modelfile.yucg-outreach

echo ""
echo "Done. Set in backend/.env:"
echo "  YUCG_OUTREACH_MODEL=yucg-outreach"
echo ""
echo "Build website corpus (required for ai-recommend citations):"
echo "  python scripts/build_yucg_ollama_context.py"
