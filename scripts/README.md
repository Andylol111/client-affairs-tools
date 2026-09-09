# Scripts (local utilities)

The live site uses Bedrock, not these scripts. Members use `AppUrl`. See [`README.md`](../README.md).

Scripts here support a **laptop** workflow (optional RAG index, conversation compact, website corpus). They are not part of GitHub ship.


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

## YUCG website corpus (outreach AI)

Build verifiable context from [yaleconsulting.org](https://www.yaleconsulting.org) for `POST /api/yucg/prospects/ai-recommend`:

```bash
python scripts/build_yucg_ollama_context.py
# Optional custom Ollama model:
bash scripts/ollama_create_yucg.sh
```

Corpus output: `data/yucg_website_corpus.txt`. Requires `data/YUCG_Prospect_List.xlsx`.

## See also

- **MEMORY.md** (repo root) — Stack, conventions, last worked on; update so both local and cloud models stay in sync.
- **Modelfile** (repo root) — Ollama system prompt: `ollama create clientreach -f Modelfile` then `ollama run clientreach`.
