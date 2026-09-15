"""Member-owned conversations grounded in permission-filtered workspace documents."""
import json
import os
import time

from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field

from app.auth_deps import get_current_user
from app.database import get_db
from app.services.assistant_service import accessible_sources,answer,index_document_version
from app.services.assistant_operator import execute_write, sanitize_ask, sanitize_open, sanitize_propose
from app.services.generation_policy import reserve_assistant_request

router=APIRouter()


class AskRequest(BaseModel):
    question: str=Field(min_length=2,max_length=4000)
    thread_id: int | None=None
    project_id: int | None=None
    document_ids: list[int]=Field(default_factory=list,max_length=20)
    page_path: str | None=Field(None,max_length=200)


class ActRequest(BaseModel):
    tool: str=Field(min_length=1,max_length=80)
    args: dict=Field(default_factory=dict)
    thread_id: int | None=None


async def _thread(db,thread_id: int,user_id: int):
    row=await (await db.execute('SELECT * FROM assistant_threads WHERE id=? AND owner_user_id=?',(thread_id,user_id))).fetchone()
    if not row:
        raise HTTPException(404,'Conversation not found')
    return dict(row)


def _pack_assistant_payload(result: dict) -> str:
    return json.dumps({
        'citations': result.get('sources') or [],
        'pending_actions': result.get('pending_actions') or [],
        'navigations': result.get('navigations') or [],
        'asks': result.get('asks') or [],
        'lookups': result.get('lookups') or [],
    })


def _unpack_assistant_payload(raw: str) -> dict:
    try:
        data=json.loads(raw or '[]')
    except json.JSONDecodeError:
        data=[]
    empty={'sources':[],'pending_actions':[],'navigations':[],'asks':[],'lookups':[]}
    if isinstance(data,list):
        return {**empty,'sources':data}
    if not isinstance(data,dict):
        return empty
    citations=data.get('citations') if isinstance(data.get('citations'),list) else data.get('sources')
    if not isinstance(citations,list):
        citations=[]
    return {
        'sources':citations,
        'pending_actions':sanitize_propose(data.get('pending_actions')),
        'navigations':sanitize_open(data.get('navigations')),
        'asks':sanitize_ask(data.get('asks')),
        'lookups':data.get('lookups') if isinstance(data.get('lookups'),list) else [],
    }


async def _clear_thread_pending(db,thread_id: int) -> None:
    rows=await (await db.execute(
        "SELECT id,sources_json FROM assistant_messages WHERE thread_id=? AND role='assistant'",
        (thread_id,),
    )).fetchall()
    for row in rows:
        payload=_unpack_assistant_payload(row['sources_json'] or '[]')
        if not payload.get('pending_actions'):
            continue
        payload['pending_actions']=[]
        await db.execute(
            'UPDATE assistant_messages SET sources_json=? WHERE id=?',
            (_pack_assistant_payload(payload),row['id']),
        )


@router.get('/sources')
async def sources(user: dict=Depends(get_current_user)):
    return await accessible_sources(user['id'])


@router.post('/documents/{document_id}/index')
async def index_document(document_id: int,user: dict=Depends(get_current_user)):
    db=await get_db()
    try:
        await db.execute('BEGIN IMMEDIATE')
        row=await (await db.execute("""SELECT d.current_version,d.owner_user_id,i.state AS index_state
            FROM workspace_documents d LEFT JOIN assistant_document_indexes i ON i.version_id=d.current_version
            WHERE d.id=?""",(document_id,))).fetchone()
        if not row or row['owner_user_id']!=user['id']:
            raise HTTPException(404,'Document not found')
        if not row['current_version']:
            raise HTTPException(409,'Upload a document version before indexing')
        if row['index_state']=='indexing':
            raise HTTPException(409,'Document indexing is already in progress')
        version_id=row['current_version']
        await db.execute("""INSERT INTO assistant_document_indexes(version_id,document_id,state,last_error)
            VALUES(?,?,'indexing',NULL) ON CONFLICT(version_id) DO UPDATE SET state='indexing',last_error=NULL""",(version_id,document_id))
        await db.commit()
    finally:
        await db.close()
    return await index_document_version(version_id)


@router.get('/threads')
async def threads(user: dict=Depends(get_current_user)):
    db=await get_db()
    try:
        rows=await (await db.execute('SELECT id,title,created_at,updated_at FROM assistant_threads WHERE owner_user_id=? ORDER BY updated_at DESC LIMIT 50',(user['id'],))).fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


@router.get('/threads/{thread_id}')
async def thread_messages(thread_id: int,user: dict=Depends(get_current_user)):
    db=await get_db()
    try:
        await _thread(db,thread_id,user['id'])
        rows=await (await db.execute('SELECT id,role,content,sources_json,created_at FROM assistant_messages WHERE thread_id=? ORDER BY id',(thread_id,))).fetchall()
        result=[]
        for row in rows:
            item=dict(row)
            extras=_unpack_assistant_payload(item.pop('sources_json') or '[]')
            item.update(extras)
            result.append(item)
        return result
    finally:
        await db.close()


@router.post('/ask')
async def ask(payload: AskRequest,user: dict=Depends(get_current_user)):
    question=payload.question.strip()
    if not question:
        raise HTTPException(422,'Question cannot be blank')
    history=[]
    if payload.thread_id is not None:
        db=await get_db()
        try:
            await _thread(db,payload.thread_id,user['id'])
            rows=await (await db.execute("SELECT role,content FROM assistant_messages WHERE thread_id=? ORDER BY id DESC LIMIT 6",(payload.thread_id,))).fetchall()
            history=[dict(row) for row in reversed(rows)]
        finally:
            await db.close()
    await reserve_assistant_request(user['id'])
    result=await answer(user,question,payload.project_id,payload.document_ids,history,payload.page_path)
    now=int(time.time())
    db=await get_db()
    try:
        await db.execute('BEGIN IMMEDIATE')
        if payload.thread_id is None:
            title=' '.join(question.split())[:80]
        else:
            await _thread(db,payload.thread_id,user['id'])
            thread_id=payload.thread_id
        if payload.thread_id is None:
            # Keep creation in the same transaction as both messages.
            cur=await db.execute('INSERT INTO assistant_threads(owner_user_id,title,created_at,updated_at) VALUES(?,?,?,?)',(user['id'],title,now,now))
            thread_id=cur.lastrowid
        await db.execute("INSERT INTO assistant_messages(thread_id,role,content,created_at) VALUES(?,'user',?,?)",(thread_id,question,now))
        await db.execute("INSERT INTO assistant_messages(thread_id,role,content,sources_json,created_at) VALUES(?,'assistant',?,?,?)",
            (thread_id,result['answer'],_pack_assistant_payload(result),now))
        await db.execute('UPDATE assistant_threads SET updated_at=? WHERE id=?',(now,thread_id))
        await db.commit()
    finally:
        await db.close()
    return {**result,'thread_id':thread_id}


@router.post('/act')
async def act(payload: ActRequest,user: dict=Depends(get_current_user)):
    """Execute one confirmed write. Sending mail and deletes are not in the catalog."""
    result=await execute_write(user,payload.tool.strip(),payload.args or {})
    now=int(time.time())
    thread_id=payload.thread_id
    db=await get_db()
    try:
        if thread_id is not None:
            await _thread(db,thread_id,user['id'])
            await _clear_thread_pending(db,thread_id)
            await db.execute("INSERT INTO assistant_messages(thread_id,role,content,sources_json,created_at) VALUES(?,'assistant',?,?,?)",
                (thread_id,result['answer'],_pack_assistant_payload({
                    'sources':[],
                    'pending_actions':[],
                    'navigations':result.get('navigations') or [],
                    'asks':[],
                    'lookups':[],
                }),now))
            await db.execute('UPDATE assistant_threads SET updated_at=? WHERE id=?',(now,thread_id))
            await db.commit()
        else:
            thread_id=None
    finally:
        await db.close()
    return {**result,'thread_id':thread_id,'sources':[],'pending_actions':[],'lookups':[]}


@router.get('/usage')
async def usage(user: dict=Depends(get_current_user)):
    db=await get_db()
    try:
        row=await (await db.execute("""SELECT
          sum(CASE WHEN event_type='assistant_reserved' AND user_id=? THEN 1 ELSE 0 END) AS member_requests,
          sum(CASE WHEN event_type='assistant_reserved' THEN 1 ELSE 0 END) AS club_requests
          FROM usage_events WHERE created_at>=datetime('now','-1 hour')""",(user['id'],))).fetchone()
        token_rows=await (await db.execute("""SELECT user_id,details_json FROM usage_events
          WHERE event_type='bedrock_reserved' AND resource_type='assistant'
          AND created_at>=datetime('now','-1 hour')""")).fetchall()
        member_input=member_output=club_input=club_output=0
        for token_row in token_rows:
            try:
                details=json.loads(token_row['details_json'] or '{}')
                input_tokens=int(details.get('input_tokens') or 0)
                output_tokens=int(details.get('output_tokens') or 0)
            except (ValueError,TypeError,json.JSONDecodeError):
                continue
            club_input+=input_tokens; club_output+=output_tokens
            if token_row['user_id']==user['id']:
                member_input+=input_tokens; member_output+=output_tokens
        try:
            input_rate=float(os.getenv('BEDROCK_INPUT_USD_PER_MILLION','1.00'))
            output_rate=float(os.getenv('BEDROCK_OUTPUT_USD_PER_MILLION','5.00'))
            if input_rate<0 or output_rate<0:
                raise ValueError()
        except ValueError as exc:
            raise HTTPException(503,'Bedrock price configuration is invalid') from exc
        estimate=lambda inputs,outputs: round((inputs*input_rate+outputs*output_rate)/1_000_000,6)
        return {'member_requests':int(row['member_requests'] or 0),'club_requests':int(row['club_requests'] or 0),
                'member_input_tokens':member_input,'member_output_tokens':member_output,
                'club_input_tokens':club_input,'club_output_tokens':club_output,
                'member_estimated_usd':estimate(member_input,member_output),'club_estimated_usd':estimate(club_input,club_output),
                'pricing_note':'Estimate from configured per-token rates; AWS billing is authoritative.'}
    finally:
        await db.close()
