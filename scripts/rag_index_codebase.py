#!/usr/bin/env python3
"""
RAG index for the codebase. Lets a local model answer questions about any file
without loading everything into context.

Setup (optional, separate from main backend):
  pip install llama-index chromadb llama-index-embeddings-huggingface

Or use OpenAI embeddings (if you have API key):
  pip install llama-index chromadb llama-index-embeddings-openai

Usage:
  python scripts/rag_index_codebase.py index   # build/update index
  python scripts/rag_index_codebase.py query "Where is pipeline status updated?"
"""

import os
import sys
from pathlib import Path

# Repo root (parent of scripts/)
REPO_ROOT = Path(__file__).resolve().parent.parent
INDEX_DIR = REPO_ROOT / ".rag_index"


def _check_deps():
    try:
        from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
    except ImportError:
        print("Missing deps. Install with:", file=sys.stderr)
        print("  pip install 'llama-index>=0.10' chromadb 'llama-index-embeddings-huggingface'", file=sys.stderr)
        print("Or (OpenAI): pip install 'llama-index>=0.10' chromadb 'llama-index-embeddings-openai'", file=sys.stderr)
        sys.exit(1)


def run_index():
    _check_deps()
    from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, Settings
    from llama_index.vector_stores.chroma import ChromaVectorStore
    import chromadb

    exclude_dirs = {"node_modules", "__pycache__", ".git", ".rag_index", "venv", ".venv"}
    allowed_suffix = (".py", ".ts", ".tsx", ".js", ".jsx", ".md", ".json")

    reader = SimpleDirectoryReader(
        input_dir=str(REPO_ROOT),
        exclude_hidden=True,
        required_extensions=list(allowed_suffix),
    )
    docs = reader.load_data()
    # Drop docs from excluded dirs or unwanted paths
    filtered = []
    for doc in docs:
        path = (doc.metadata or {}).get("file_path", "")
        if not path or any(part in path for part in exclude_dirs):
            continue
        if path.endswith(("package-lock.json",)) or ".env" in path:
            continue
        filtered.append(doc)

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    chroma_client = chromadb.PersistentClient(path=str(INDEX_DIR / "chroma"))
    chroma_collection = chroma_client.get_or_create_collection("codebase", metadata={"description": "Project code and docs"})
    vector_store = ChromaVectorStore(chroma_collection=chroma_collection)

    try:
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        Settings.embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-small-en-v1.5")
    except Exception:
        pass

    index = VectorStoreIndex.from_documents(filtered, vector_store=vector_store, show_progress=True)
    print("Index built and persisted to", INDEX_DIR)


def run_query(q: str):
    _check_deps()
    from llama_index.core import VectorStoreIndex, Settings
    from llama_index.vector_stores.chroma import ChromaVectorStore
    import chromadb

    if not (INDEX_DIR / "chroma").exists():
        print("No index found. Run: python scripts/rag_index_codebase.py index", file=sys.stderr)
        sys.exit(1)

    chroma_client = chromadb.PersistentClient(path=str(INDEX_DIR / "chroma"))
    chroma_collection = chroma_client.get_collection("codebase")
    vector_store = ChromaVectorStore(chroma_collection=chroma_collection)

    try:
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        Settings.embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-small-en-v1.5")
    except Exception:
        pass

    index = VectorStoreIndex.from_vector_store(vector_store)

    query_engine = index.as_query_engine(similarity_top_k=5)
    response = query_engine.query(q)
    print(response.response)


def main():
    if len(sys.argv) < 2:
        print("Usage: rag_index_codebase.py index | query <question>")
        sys.exit(1)
    cmd = sys.argv[1].lower()
    if cmd == "index":
        run_index()
    elif cmd == "query":
        if len(sys.argv) < 3:
            print("Usage: rag_index_codebase.py query \"Your question\"")
            sys.exit(1)
        run_query(" ".join(sys.argv[2:]))
    else:
        print("Unknown command. Use: index | query")
        sys.exit(1)


if __name__ == "__main__":
    main()
