#!/usr/bin/env python3
"""
Compact long conversation history to stay under token limits.

When messages exceed a token budget, keeps the last N messages intact and
replaces everything older with a short summary. Use with any chat UI or
API that stores history as JSON.

Usage:
  # Read messages from stdin (JSON array of {role, content}), output compacted JSON
  python scripts/compact_conversation.py --keep 5 --max-tokens 20000 < history.json > compacted.json

  # Or pass file path
  python scripts/compact_conversation.py --keep 5 --max-tokens 20000 --file history.json
"""

import argparse
import json
import sys
from pathlib import Path

# Approximate chars per token (English/code mix)
CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def compact(messages: list[dict], keep_last: int, max_tokens: int) -> list[dict]:
    if len(messages) <= keep_last:
        return messages

    recent = messages[-keep_last:]
    older = messages[:-keep_last]
    older_tokens = sum(estimate_tokens(m.get("content", "")) for m in older)

    if older_tokens <= max_tokens:
        return messages

    # Replace older messages with a single summary placeholder
    combined = "\n".join(
        f"{m.get('role', 'user')}: {m.get('content', '')[:500]}"
        for m in older
    )
    summary_content = (
        "[Earlier conversation summary]\n"
        + combined[:2000]
        + ("..." if len(combined) > 2000 else "")
    )
    summary_msg = {"role": "system", "content": summary_content}
    return [summary_msg] + recent


def main():
    ap = argparse.ArgumentParser(description="Compact conversation history to reduce tokens.")
    ap.add_argument("--keep", type=int, default=5, help="Number of most recent messages to keep intact")
    ap.add_argument("--max-tokens", type=int, default=20000, help="Target max tokens for older part (approximate)")
    ap.add_argument("--file", type=Path, help="Read from file instead of stdin")
    args = ap.parse_args()

    if args.file:
        data = json.loads(args.file.read_text())
    else:
        data = json.load(sys.stdin)

    if not isinstance(data, list):
        # Allow { "messages": [...] }
        data = data.get("messages", data) if isinstance(data, dict) else [data]

    out = compact(data, keep_last=args.keep, max_tokens=args.max_tokens)
    json.dump(out, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
