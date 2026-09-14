"""Low-cost, permission-filtered retrieval for the in-app Bedrock assistant."""
from __future__ import annotations

import asyncio
import io
import os
import re
from html import escape
from typing import Any

from fastapi import HTTPException

from app.database import get_db
from app.services.llm import complete_text, rank_model_id
from app.services.assistant_operator import (
    execute_reads,
    operator_system_prompt,
    parse_operator_payload,
    sanitize_open,
    sanitize_propose,
    sanitize_reads,
)

MAX_INDEX_BYTES = 8 * 1024 * 1024
MAX_INDEX_CHARS = 600_000
CHUNK_CHARS = 2_400
MAX_CONTEXT_CHARS = 16_000
_WORD = re.compile(r"[a-z0-9][a-z0-9_-]{2,}")
_STOP = {"the", "and", "for", "that", "this", "with", "from", "what", "when", "where", "which", "into", "your", "about"}


def _text_from_bytes(body: bytes, content_type: str, filename: str) -> str:
    kind = (content_type or "").split(";", 1)[0].lower()
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if kind.startswith("text/") or suffix in {"txt", "md", "csv", "json"}:
        return body.decode("utf-8", errors="replace")
    if kind == "application/pdf" or suffix == "pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise HTTPException(503, "PDF indexing is not installed") from exc
        reader = PdfReader(io.BytesIO(body))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    raise HTTPException(415, "Assistant indexing supports text, Markdown, CSV, JSON, and PDF files")


def _chunks(text: str) -> list[str]:
    normalized = re.sub(r"\r\n?", "\n", text).strip()[:MAX_INDEX_CHARS]
    if not normalized:
        return []
    chunks: list[str] = []
    cursor = 0
    while cursor < len(normalized):
        end = min(len(normalized), cursor + CHUNK_CHARS)
        if end < len(normalized):
            boundary = normalized.rfind("\n", cursor + CHUNK_CHARS // 2, end)
            if boundary > cursor:
                end = boundary
        piece = normalized[cursor:end].strip()
        if piece:
            chunks.append(piece)
        cursor = max(end, cursor + 1)
    return chunks


async def index_document_version(version_id: int) -> dict[str, Any]:
    """Fetch one immutable S3 version and replace its local searchable chunks."""
    db = await get_db()
    try:
        row = await (await db.execute("""SELECT v.*,d.current_version FROM workspace_document_versions v
            JOIN workspace_documents d ON d.id=v.document_id
            WHERE v.id=? AND v.state='ready' AND d.current_version=v.id""",(version_id,))).fetchone()
        if not row:
            raise HTTPException(404, "Completed document version not found")
        version = dict(row)
        if version['byte_size'] > MAX_INDEX_BYTES:
            raise HTTPException(413, "Files larger than 8 MB remain downloadable but are not indexed for the assistant")
        if not version.get('storage_bucket') or not version.get('s3_version_id'):
            raise HTTPException(409, "Document storage version is not verified")
    finally:
        await db.close()

    def read_object() -> bytes:
        import boto3
        response = boto3.client('s3').get_object(
            Bucket=version['storage_bucket'], Key=version['object_key'], VersionId=version['s3_version_id'],
        )
        stream=response['Body']
        try:
            return stream.read(MAX_INDEX_BYTES + 1)
        finally:
            stream.close()

    try:
        body = await asyncio.to_thread(read_object)
        if len(body) > MAX_INDEX_BYTES:
            raise HTTPException(413, "Document exceeds the assistant indexing limit")
        text = await asyncio.to_thread(_text_from_bytes,body,version['content_type'],version['filename'])
        pieces = _chunks(text)
        if not pieces:
            raise HTTPException(422, "No readable text was found in this document")
    except Exception as exc:
        db = await get_db()
        try:
            message = exc.detail if isinstance(exc,HTTPException) else "Document indexing failed"
            await db.execute("""INSERT INTO assistant_document_indexes(version_id,document_id,state,last_error)
                VALUES(?,?,'failed',?) ON CONFLICT(version_id) DO UPDATE SET state='failed',last_error=excluded.last_error""",
                (version_id,version['document_id'],str(message)[:300]))
            await db.commit()
        finally:
            await db.close()
        raise

    db = await get_db()
    try:
        await db.execute('BEGIN IMMEDIATE')
        current = await (await db.execute("""SELECT v.state,d.current_version FROM workspace_document_versions v
            JOIN workspace_documents d ON d.id=v.document_id WHERE v.id=?""",(version_id,))).fetchone()
        if not current or current['state'] != 'ready' or current['current_version'] != version_id:
            raise HTTPException(409, "Document version changed during indexing")
        await db.execute('DELETE FROM assistant_document_chunks WHERE document_id=?',(version['document_id'],))
        await db.execute('DELETE FROM assistant_document_indexes WHERE document_id=? AND version_id<>?',(version['document_id'],version_id))
        await db.executemany("""INSERT INTO assistant_document_chunks(document_id,version_id,chunk_index,content)
            VALUES(?,?,?,?)""",[(version['document_id'],version_id,index,piece) for index,piece in enumerate(pieces)])
        await db.execute("""INSERT INTO assistant_document_indexes(version_id,document_id,state,indexed_at,character_count,last_error)
            VALUES(?,?,'ready',strftime('%s','now'),?,NULL) ON CONFLICT(version_id) DO UPDATE SET
            state='ready',indexed_at=excluded.indexed_at,character_count=excluded.character_count,last_error=NULL""",
            (version_id,version['document_id'],sum(len(piece) for piece in pieces)))
        await db.commit()
    finally:
        await db.close()
    return {'state':'ready','chunks':len(pieces),'characters':sum(len(piece) for piece in pieces)}


async def recover_document_indexes() -> None:
    """A process exit can interrupt extraction; make that durable work eligible again."""
    db=await get_db()
    try:
        await db.execute("UPDATE assistant_document_indexes SET state='pending',last_error=NULL WHERE state='indexing'")
        await db.commit()
    finally:
        await db.close()


async def drain_document_index_queue() -> None:
    """Claim and index at most one document so PDF work cannot fan out on the small host."""
    db=await get_db()
    try:
        await db.execute('BEGIN IMMEDIATE')
        row=await (await db.execute("SELECT version_id FROM assistant_document_indexes WHERE state='pending' ORDER BY version_id LIMIT 1")).fetchone()
        if not row:
            await db.commit()
            return
        version_id=row['version_id']
        changed=await db.execute("UPDATE assistant_document_indexes SET state='indexing',last_error=NULL WHERE version_id=? AND state='pending'",(version_id,))
        await db.commit()
        if changed.rowcount!=1:
            return
    finally:
        await db.close()
    try:
        await index_document_version(version_id)
    except Exception:
        # index_document_version records a bounded public-safe error for manual retry.
        return


async def accessible_sources(user_id: int) -> list[dict[str, Any]]:
    db = await get_db()
    try:
        rows = await (await db.execute("""SELECT d.id,d.title,d.owner_user_id,d.project_id,d.visibility,d.current_version,
            i.state AS index_state,i.character_count,i.last_error,p.name AS project_name
            FROM workspace_documents d LEFT JOIN projects p ON p.id=d.project_id
            LEFT JOIN assistant_document_indexes i ON i.version_id=d.current_version
            WHERE d.owner_user_id=? OR d.visibility='club' OR (d.visibility='project' AND EXISTS
              (SELECT 1 FROM user_project_assignments a WHERE a.project_id=d.project_id AND a.user_id=?))
            ORDER BY d.created_at DESC,d.id DESC""",(user_id,user_id))).fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def retrieve_context(user_id: int, question: str, project_id: int | None, document_ids: list[int]) -> tuple[str,list[dict[str, Any]]]:
    terms = [term for term in _WORD.findall(question.lower()) if term not in _STOP][:20]
    db = await get_db()
    try:
        params: list[Any] = [user_id,user_id]
        filters = ["d.current_version=c.version_id"]
        if project_id is not None:
            filters.append('d.project_id=?')
            params.append(project_id)
        if document_ids:
            filters.append('d.id IN ('+','.join('?' for _ in document_ids)+')')
            params.extend(document_ids)
        rows = await (await db.execute(f"""SELECT c.id,c.document_id,c.chunk_index,c.content,d.title,p.name AS project_name
            FROM assistant_document_chunks c JOIN workspace_documents d ON d.id=c.document_id
            LEFT JOIN projects p ON p.id=d.project_id
            WHERE (d.owner_user_id=? OR d.visibility='club' OR (d.visibility='project' AND EXISTS
              (SELECT 1 FROM user_project_assignments a WHERE a.project_id=d.project_id AND a.user_id=?)))
              AND {' AND '.join(filters)} LIMIT 2500""",tuple(params))).fetchall()
    finally:
        await db.close()
    ranked = []
    for row in rows:
        lowered = (row['title']+' '+row['content']).lower()
        score = sum(lowered.count(term) for term in terms)
        ranked.append((score,dict(row)))
    ranked.sort(key=lambda item:(item[0],-item[1]['chunk_index']),reverse=True)
    selected=[]; total=0; citations=[]
    for _,row in ranked[:12]:
        if total + len(row['content']) > MAX_CONTEXT_CHARS:
            continue
        source_id=f"D{row['document_id']}-C{row['chunk_index']+1}"
        selected.append(f'<source id="{source_id}" title="{escape(row["title"],quote=True)}">\n{escape(row["content"])}\n</source>')
        citations.append({'id':source_id,'document_id':row['document_id'],'title':row['title'],'project_name':row['project_name']})
        total += len(row['content'])
    return '\n'.join(selected),citations


async def answer(
    user: dict,
    question: str,
    project_id: int | None = None,
    document_ids: list[int] | None = None,
    history: list[dict[str,str]] | None = None,
    page_path: str | None = None,
) -> dict[str, Any]:
    context,citations = await retrieve_context(user['id'],question,project_id,(document_ids or [])[:20])
    prior='\n'.join(f"{item['role'].upper()}: {item['content'][:1500]}" for item in (history or [])[-6:])[:6000]
    page = (page_path or '').strip()[:200] or '(unknown)'
    sources_block = context or '(no indexed document matched; use site tools instead)'
    prompt=(
        f"CURRENT PAGE\n{page}\n\nSOURCE BLOCKS\n{sources_block}\n\n"
        f"RECENT CONVERSATION\n{prior or '(new conversation)'}\n\nMEMBER QUESTION\n{question}"
    )
    response = await asyncio.to_thread(
        complete_text,prompt,rank_model_id(),operator_system_prompt(),
        user_id=user['id'],purpose='assistant',max_tokens=900,
    )
    payload = parse_operator_payload(response)
    if payload:
        answer_text = str(payload.get('answer') or '').strip()
        lookups = await execute_reads(user, sanitize_reads(payload.get('reads')))
        pending = sanitize_propose(payload.get('propose'))
        navigations = sanitize_open(payload.get('open'))
        if lookups:
            bits = []
            for item in lookups:
                data = item.get('data')
                if isinstance(data, dict) and data.get('error'):
                    bits.append(f"{item['tool']}: {data['error']}")
                elif isinstance(data, dict) and 'count' in data:
                    bits.append(f"{item['tool']}: {data['count']} row(s)")
                elif isinstance(data, list):
                    bits.append(f"{item['tool']}: {len(data)} row(s)")
            if bits:
                answer_text = f"{answer_text}\n\nLooked up: " + '; '.join(bits)
    else:
        answer_text = (response or '').strip() or (
            'I can look up contacts, start Find people after you confirm, and open the right page. I cannot send mail or delete records.'
        )
        lookups = []
        pending = []
        navigations = []
    cited={match for match in re.findall(r'\[(D\d+-C\d+)\]',answer_text)}
    return {
        'answer': answer_text,
        'sources': [source for source in citations if source['id'] in cited],
        'model': rank_model_id(),
        'grounded': bool(context),
        'lookups': lookups,
        'pending_actions': pending,
        'navigations': navigations,
    }
