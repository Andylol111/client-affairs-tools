# Local AI Strategy: Self-Sufficiency and Rate Limit Resilience

This doc describes how to train and practice with the project’s “internal” setup so most work stays **local** (free, unlimited) and **cloud** (e.g. Claude) is used only when needed.

---

## Core Philosophy

```
Cloud (Claude)          → expensive, rate limited, powerful
Local (your model)      → free, unlimited, less powerful

Goal: push as much as possible local,
      use cloud only when truly needed
```

---

## What to Build, In Order

### Phase 1 — Foundation (Do This First)

**1. RAG on your codebase**  
Your model “knows” the whole site without burning context.

```bash
pip install llama-index chromadb
```

Point it at the project folder, embed everything. Then the local model can answer questions about any file without loading them all into context. See `scripts/rag_index_codebase.py`.

**2. A good Modelfile**  
Hardcode stack, conventions, and preferences into the model’s behavior. See repo root `Modelfile`:

- Build: `ollama create clientreach -f Modelfile`
- Run: `ollama run clientreach`

**3. Persistent memory file**  
`MEMORY.md` in the project root is read by both local and cloud models:

- Stack, file structure, conventions
- Last worked on, known issues, decisions made

Update it manually or have the model update it. It survives context resets.

---

### Phase 2 — Reduce Cloud Dependency

**4. Compact logic**  
When conversation history gets long (e.g. tokens > 20000), summarize older messages: keep the last N messages intact and replace everything older with a summary. See `scripts/compact_conversation.py`.

**5. Task router**  
Decide which model handles what:

- Simple edit / boilerplate → local (e.g. Ollama qwen)
- Complex bug / architecture → Claude
- Anything about this stack → local (RAG handles it)

**6. Fine-tune on your codebase**  
Once RAG works, collect good local-model outputs and use them as fine-tuning data so the model improves on this project’s patterns over time.

---

### Phase 3 — Full Self-Sufficiency

**7. Agentic loop**  
Model can run, test, and fix its own code:

- Write code → run tests → if fail → fix → repeat  
- Tools: LangChain agents or LlamaIndex agents

**8. Long-term memory**  
Beyond `MEMORY.md`: a vector DB of important decisions, bug fixes, and architecture choices. The model retrieves relevant history automatically.

**9. Offline eval**  
A test suite that scores the model’s outputs on this codebase so you can tell when fine-tuning actually helped.

---

## Priority Matrix

| Build this           | Because                                      |
|----------------------|----------------------------------------------|
| RAG                  | Cuts token waste immediately                 |
| Modelfile system     | Free, instant behavior improvement           |
| MEMORY.md            | Survives context resets, works with both     |
| Compact script       | Avoid getting stuck at token limit            |
| Fine-tuning          | Makes local model feel native to codebase    |
| Task router          | Stops wasting cloud credits on easy tasks    |

---

## Rate Limit Strategy

Use cloud only for work that genuinely needs it:

```
90% of work  →  local (Ollama + RAG) — free, unlimited
9% of work   →  cloud, short focused sessions
1% of work   →  cloud, deep architectural work
```

To stay under cloud rate limits:

- Don’t use cloud for boilerplate
- Compact before long sessions when possible
- Reference only the files needed (e.g. `@file`)
- End sessions when the task is done

---

## Honest Starting Point

**Don’t build everything at once.** Fastest path:

1. **Today** — `Modelfile` and `MEMORY.md` (already in repo)
2. **This week** — Get RAG working on the codebase (see `scripts/rag_index_codebase.py`)
3. **This month** — Add compact logic + task router
4. **Eventually** — Fine-tune when you have enough good examples

By step 2, the local setup already feels much more capable, and you’ll rarely need to hit cloud limits for this project.
