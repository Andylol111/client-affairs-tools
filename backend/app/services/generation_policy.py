"""Reserve draft requests transactionally before paid inference; store no prompt text."""
import os
import json
import sqlite3
from contextlib import closing
from fastapi import HTTPException
from app.database import get_db
from app.services.llm import validate_model


def reserve_bedrock_invocation(model: str):
    """Count every paid attempt, including ranking/fanout, across worker processes.

    This synchronous boundary runs in inference threads and never nests an event
    loop. Failed/uncertain provider calls retain reservations to avoid undercounts.
    """
    from app.database import is_postgres, sqlite_file_path
    if is_postgres():
        raise HTTPException(503,'Paid inference requires a verified transactional quota store')
    try:
        limit=int(os.getenv('BEDROCK_CALLS_PER_CLUB_PER_HOUR','200'))
        if not 0 <= limit <= 2000:
            raise ValueError()
    except ValueError as exc:
        raise HTTPException(503,'Paid inference quota configuration is invalid') from exc
    try:
        # mode=rw refuses to invent an empty database when its durable mount is absent.
        uri=sqlite_file_path().resolve().as_uri()+'?mode=rw'
        with closing(sqlite3.connect(uri,uri=True,timeout=5,isolation_level=None)) as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                used=db.execute("""SELECT COUNT(*) FROM usage_events WHERE event_type='bedrock_reserved'
                    AND created_at >= datetime('now','-1 hour')""").fetchone()[0]
                if used >= limit:
                    raise HTTPException(429,'Club inference limit reached. Please try again later.')
                db.execute("""INSERT INTO usage_events(user_id,event_type,resource_type,details_json)
                    VALUES(NULL,'bedrock_reserved','inference',?)""",(json.dumps({'model_id':model}),))
                db.commit()
            finally:
                if db.in_transaction:
                    db.rollback()
    except sqlite3.Error as exc:
        raise HTTPException(503,'Paid inference quota could not be recorded') from exc


async def reserve_generation(user_id: int, model: str | None):
    validate_model(model)
    member_limit = min(100, max(1, int(os.getenv('DRAFTS_PER_MEMBER_PER_HOUR', '20'))))
    club_limit = min(2000, max(1, int(os.getenv('DRAFTS_PER_CLUB_PER_HOUR', '200'))))
    db = await get_db()
    try:
        await db.execute('BEGIN IMMEDIATE')
        row = await (await db.execute("""SELECT count(*) AS total,
            coalesce(sum(CASE WHEN user_id = ? THEN 1 ELSE 0 END), 0) AS member
            FROM usage_events WHERE event_type = 'draft_reserved'
            AND created_at >= datetime('now', '-1 hour')""", (user_id,))).fetchone()
        if row['total'] >= club_limit or row['member'] >= member_limit:
            raise HTTPException(429, 'Draft generation limit reached. Please try again later.')
        await db.execute("INSERT INTO usage_events(user_id,event_type,resource_type) VALUES(?,'draft_reserved','email')", (user_id,))
        await db.commit()
    finally:
        await db.close()
