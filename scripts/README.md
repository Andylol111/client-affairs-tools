# Scripts (Local AI & Utilities)

Scripts here support the **local-first AI** workflow described in [docs/LOCAL-AI-STRATEGY.md](../docs/LOCAL-AI-STRATEGY.md).

## RAG codebase index

Lets a local model answer questions about the codebase without loading every file into context.

```bash
# One-time: install optional deps (use a venv if you like)
pip install -r scripts/requirements-rag.txt

# Build/update index (run from repo root)
python scripts/rag_index_codebase.py index

# Query
python scripts/rag_index_codebase.py query "Where is pipeline status updated?"
```

Index is stored under `.rag_index/` (gitignored).

## Compact conversation

When chat history gets too long, compact it to stay under token limits:

```bash
python scripts/compact_conversation.py --keep 5 --max-tokens 20000 --file history.json
# Or: ... < history.json > compacted.json
```

Input: JSON array of `{ "role": "user"|"assistant"|"system", "content": "..." }`.  
Output: Same format, with older messages replaced by a summary and the last `--keep` messages unchanged.

## See also

- **MEMORY.md** (repo root) — Stack, conventions, last worked on; update so both local and cloud models stay in sync.
- **Modelfile** (repo root) — Ollama system prompt: `ollama create clientreach -f Modelfile` then `ollama run clientreach`.
