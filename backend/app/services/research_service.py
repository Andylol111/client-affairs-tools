"""Member-owned bounded research runs; durable leases; evidence with citations."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.database import get_db
from app.services import research_providers as P
from app.services.research_schema import init_research_schema
from app.services.transaction_audit import audit

RESEARCH_QUEUE_LIMIT = max(1, int(os.getenv('RESEARCH_QUEUE_LIMIT', '20')))
TASK_KINDS = ('company_research', 'person_discovery', 'evidence_reconciliation')
MATCH_STATES = ('strong match', 'possible match', 'needs review', 'excluded',
                'strong_match', 'possible_match', 'needs_review')
TASK_TERMINAL = ('completed', 'failed', 'cancelled')
JOB_ACTIVE = ('queued', 'running')
LEASE_MINUTES = max(2, min(int(os.getenv('RESEARCH_LEASE_MINUTES', '5') or 5), 60))
MAX_TASK_ATTEMPTS = max(1, min(int(os.getenv('RESEARCH_MAX_TASK_ATTEMPTS', '3') or 3), 5))


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_sql() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def _clamp(value, low: int, high: int) -> int:
    try:
        return max(low, min(int(value), high))
    except (TypeError, ValueError):
        return low


def _norm_domain(value: str) -> str:
    from app.services.contact_scraper import normalize_domain
    return normalize_domain((value or '').strip().lower())


def _json(value, default):
    try:
        return json.loads(value) if value else default
    except (TypeError, ValueError):
        return default


class LeaseLost(RuntimeError):
    pass


async def ensure_schema(db) -> None:
    await init_research_schema(db)


async def _member_of(db, project_id: int, user_id: int) -> bool:
    row = await (await db.execute(
        'SELECT 1 FROM user_project_assignments WHERE project_id=? AND user_id=?',
        (project_id, user_id))).fetchone()
    return bool(row)


async def _brief_access(db, brief_id: int, user: dict) -> dict:
    await ensure_schema(db)
    row = await (await db.execute(
        'SELECT * FROM research_briefs WHERE id=? AND owner_id=?',
        (brief_id, user['id']))).fetchone()
    if not row:
        raise HTTPException(404, 'Brief not found')
    return dict(row)


async def _require_project(db, project_id: int, user: dict) -> None:
    if project_id is None:
        return
    if not await _member_of(db, project_id, user['id']):
        raise HTTPException(403, 'You are not a member of that project')


async def list_briefs(db, user: dict, project_id: int | None = None) -> list[dict]:
    await ensure_schema(db)
    params: list[Any] = [user['id']]
    where = 'owner_id=?'
    if project_id is not None:
        where += ' AND project_id=?'
        params.append(project_id)
    rows = await (await db.execute(
        f'SELECT * FROM research_briefs WHERE {where} ORDER BY id DESC', params)).fetchall()
    return [_brief_out(r) for r in rows]


def _brief_out(row) -> dict:
    d = dict(row)
    return {'id': d['id'], 'project_id': d['project_id'], 'name': d['name'],
            'spec': _json(d['spec_json'], {}), 'revision': d['revision'],
            'created_at': d['created_at'], 'updated_at': d['updated_at']}


def _company_out(row) -> dict:
    d = dict(row)
    return {'id': d['id'], 'brief_id': d['brief_id'], 'name': d['name'], 'domain': d['domain'],
            'reason': d['reason'], 'sources': _json(d['source_ids_json'], []),
            'match_state': str(d['match_state'] or 'needs_review').replace(' ', '_'),
            'disposition': d['disposition'],
            'warnings': _json(d['warnings_json'], []), 'observed_at': d['observed_at']}


def _job_out(row) -> dict:
    d = dict(row)
    return {'id': d['id'], 'brief_id': d['brief_id'], 'status': d['status'],
            'completed_tasks': d['completed_tasks'], 'total_tasks': d['total_tasks'],
            'people_count': d['people_count'], 'provider_state': d['provider_state'],
            'error': d['error'], 'created_at': d['created_at']}


def _recommendation_out(row, evidence: dict | None = None) -> dict:
    d = dict(row)
    return {'id': d['id'], 'brief_id': d['brief_id'],
            'person': _json(d['person_json'], {}), 'email': d['email'],
            'evidence': evidence if evidence is not None else _json(d['evidence_json'], {}),
            'state': d['state'], 'explanation': d['explanation'],
            'disposition': d['disposition'], 'contact_id': d['contact_id']}


async def _store_source(db, owner_id: int, brief_id: int, source: dict) -> int:
    from app.services.contact_scraper import extract_employee_emails_from_text
    url = (source.get('url') or '').strip()
    excerpt = (source.get('excerpt') or '').strip()
    if not url or not excerpt or not P.public_url(url):
        raise ValueError('Source missing a public URL or excerpt')
    emails = extract_employee_emails_from_text(excerpt, source.get('domain'))
    if emails:
        source = {**source, 'excerpt': excerpt, 'emails': emails}
    observed = source.get('observed_at') or P.utcnow()
    content_hash = hashlib.sha256(excerpt.encode('utf-8', 'ignore')).hexdigest()
    await db.execute('''INSERT OR IGNORE INTO research_sources
        (owner_id,brief_id,url,excerpt,title,observed_at,content_hash,source_type) VALUES (?,?,?,?,?,?,?,?)''',
        (owner_id, brief_id, url, excerpt[:4000], (source.get('title') or '')[:300], observed,
         content_hash, source.get('source_type') or 'public_search'))
    row = await (await db.execute('''SELECT id FROM research_sources
        WHERE owner_id=? AND brief_id=? AND url=? AND content_hash=?''',
        (owner_id, brief_id, url, content_hash))).fetchone()
    return int(row['id'])


async def create_brief(db, user: dict, name: str, spec: dict, project_id: int | None) -> dict:
    from pydantic import ValidationError
    from app.routers.research import ResearchSpec
    await ensure_schema(db)
    await _require_project(db, project_id, user)
    try:
        clean = ResearchSpec(**spec).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, 'Research specification is invalid') from exc
    cur = await db.execute('''INSERT INTO research_briefs (owner_id,project_id,name,spec_json)
        VALUES (?,?,?,?)''', (user['id'], project_id, name.strip()[:200], json.dumps(clean)))
    await db.commit()
    await audit(db, user['id'], 'create', 'research_brief', int(cur.lastrowid), {})
    return await _get_brief(db, int(cur.lastrowid), user)


async def _get_brief(db, brief_id: int, user: dict) -> dict:
    return _brief_out(await _brief_access(db, brief_id, user))


async def update_brief(db, brief_id: int, user: dict, name: str, spec: dict, project_id: int | None) -> dict:
    from pydantic import ValidationError
    from app.routers.research import ResearchSpec
    row = await _brief_access(db, brief_id, user)
    await _require_project(db, project_id, user)
    running = await (await db.execute(
        '''SELECT 1 FROM research_jobs WHERE brief_id=? AND status IN ('queued','running')''',
        (brief_id,))).fetchone()
    if running:
        raise HTTPException(409, 'Pause or wait for the active research run before editing this brief')
    try:
        clean = ResearchSpec(**spec).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, 'Research specification is invalid') from exc
    await db.execute('''UPDATE research_briefs SET name=?, spec_json=?, project_id=?, revision=revision+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=?''',
        (name.strip()[:200], json.dumps(clean), project_id, row['revision'] + 1, brief_id))
    await db.commit()
    await audit(db, user['id'], 'update', 'research_brief', brief_id, {'revision': row['revision'] + 1})
    return await _get_brief(db, brief_id, user)


async def upsert_company(db, brief_id: int, owner_id: int, company: dict, source_ids: list[int]) -> dict:
    await ensure_schema(db)
    domain = _norm_domain(company.get('domain') or '')
    name = (company.get('name') or '').strip()
    if not name or not domain:
        raise ValueError('Company recommendation requires a name and domain')
    match_state = company.get('match_state')
    if match_state not in MATCH_STATES:
        match_state = 'needs review'
    warnings = [str(w)[:300] for w in (company.get('warnings') or []) if str(w).strip()][:12]
    source_ids = [int(s) for s in (source_ids or []) if isinstance(s, (int, str)) and str(s).strip()][:20]
    prior = await (await db.execute(
        'SELECT * FROM research_companies WHERE brief_id=? AND domain=?', (brief_id, domain))).fetchone()
    prior_outreach = await (await db.execute(
        '''SELECT 1 FROM contacts c WHERE c.company_domain=? AND EXISTS (
            SELECT 1 FROM campaign_contacts cc WHERE cc.contact_id=c.id AND cc.sent_at IS NOT NULL) LIMIT 1''',
        (domain,))).fetchone()
    if prior_outreach and 'Previously contacted' not in warnings:
        warnings.append('Previously contacted')
    reason = (company.get('reason') or '').strip()[:800]
    observed = P.utcnow()
    evidence_hash = hashlib.sha256(json.dumps([source_ids, warnings, match_state], sort_keys=True).encode()).hexdigest()
    if prior:
        await db.execute('''UPDATE research_companies SET name=?,reason=?,source_ids_json=?,match_state=?,
            warnings_json=?,observed_at=?,evidence_hash=? WHERE id=?''',
            (name, reason, json.dumps(source_ids), match_state, json.dumps(warnings), observed, evidence_hash, prior['id']))
        company_id = int(prior['id'])
    else:
        cur = await db.execute('''INSERT INTO research_companies
            (brief_id,name,domain,reason,source_ids_json,match_state,warnings_json,observed_at,evidence_hash)
            VALUES (?,?,?,?,?,?,?,?,?)''',
            (brief_id, name, domain, reason, json.dumps(source_ids), match_state, json.dumps(warnings), observed, evidence_hash))
        company_id = int(cur.lastrowid)
    await db.commit()
    return _company_out(await (await db.execute(
        'SELECT * FROM research_companies WHERE id=?', (company_id,))).fetchone())


async def list_companies(db, brief_id: int, user: dict) -> list[dict]:
    await _brief_access(db, brief_id, user)
    rows = await (await db.execute(
        'SELECT * FROM research_companies WHERE brief_id=? ORDER BY id', (brief_id,))).fetchall()
    return [_company_out(r) for r in rows]


async def review_company(db, brief_id: int, company_id: int, user: dict, disposition: str, reason: str | None) -> dict:
    from app.routers.research import CompanyReview
    row = await _brief_access(db, brief_id, user)
    company = await (await db.execute(
        'SELECT * FROM research_companies WHERE id=? AND brief_id=?', (company_id, brief_id))).fetchone()
    if not company:
        raise HTTPException(404, 'Company not found')
    payload = CompanyReview(disposition=disposition, reason=reason)
    if payload.disposition == 'rejected' and not (payload.reason or '').strip():
        raise HTTPException(422, 'A rejection reason is required so research can learn from it')
    await db.execute('''UPDATE research_companies SET disposition=?, review_reason=?, match_state=CASE
        WHEN ?='accepted' THEN match_state WHEN ?='rejected' THEN 'excluded' ELSE match_state END
        WHERE id=?''', (payload.disposition, (payload.reason or '').strip()[:500] or None,
                        payload.disposition, payload.disposition, company_id))
    if payload.disposition == 'rejected':
        await db.execute('''UPDATE research_tasks SET status='cancelled', stop_reason='Company rejected'
            WHERE company_id=? AND status='queued' ''', (company_id,))
    await db.commit()
    await audit(db, user['id'], 'review', 'research_company', company_id,
                {'brief_id': brief_id, 'disposition': payload.disposition})
    return _company_out(await (await db.execute(
        'SELECT * FROM research_companies WHERE id=?', (company_id,))).fetchone())


async def create_job(db, brief_id: int, user: dict) -> dict:
    row = await _brief_access(db, brief_id, user)
    active = await (await db.execute(
        '''SELECT id FROM research_jobs WHERE owner_id=? AND status IN ('queued','running') ''',
        (user['id'],))).fetchone()
    if active:
        raise HTTPException(409, 'You already have a research run queued or active')
    club = await (await db.execute(
        '''SELECT COUNT(*) AS n FROM research_jobs WHERE status IN ('queued','running')''')).fetchone()
    if int(club['n'] or 0) >= RESEARCH_QUEUE_LIMIT:
        raise HTTPException(429, 'The club research queue is full; try again after a current run finishes')
    spec = _json(row['spec_json'], {})
    accepted = await (await db.execute(
        "SELECT * FROM research_companies WHERE brief_id=? AND disposition='accepted' ORDER BY id",
        (brief_id,))).fetchall()
    companies = list(accepted)
    if not companies:
        raise HTTPException(422, 'Accept at least one recommended company before starting research')
    rejected_names = [c['name'] for c in companies]
    total_tasks = 0
    await db.execute('''INSERT INTO research_jobs (owner_id,brief_id,project_id,spec_json,status,total_tasks)
        VALUES (?,?,?,?, 'queued', 0)''', (user['id'], brief_id, row['project_id'], json.dumps(spec)))
    job_id = int((await (await db.execute('SELECT last_insert_rowid() AS i')).fetchone())['i'])
    for c in companies:
        for kind in TASK_KINDS:
            await db.execute('''INSERT OR IGNORE INTO research_tasks
                (job_id,company_id,kind,cursor) VALUES (?,?,?,0)''', (job_id, c['id'], kind))
            total_tasks += 1
    await db.execute('UPDATE research_jobs SET total_tasks=? WHERE id=?', (total_tasks, job_id))
    await db.commit()
    await audit(db, user['id'], 'create', 'research_job', job_id, {'brief_id': brief_id})
    return _job_out(await (await db.execute('SELECT * FROM research_jobs WHERE id=?', (job_id,))).fetchone())


async def cancel_job(db, job_id: int, user: dict) -> dict:
    row = await _job_owner(db, job_id, user)
    await db.execute("""UPDATE research_tasks SET status='cancelled', stop_reason='Member cancelled'
        WHERE job_id=? AND status IN ('queued','running')""", (job_id,))
    await db.execute("""UPDATE research_jobs SET status='cancelled',
        error='Cancelled by member; completed evidence is retained', updated_at=CURRENT_TIMESTAMP,
        lease_token=NULL, lease_expires_at=NULL WHERE id=? AND status IN ('queued','running')""",
        (job_id,))
    await db.commit()
    await audit(db, user['id'], 'cancel', 'research_job', job_id, {})
    return _job_out(await (await db.execute('SELECT * FROM research_jobs WHERE id=?', (job_id,))).fetchone())


async def resume_job(db, job_id: int, user: dict) -> dict:
    row = await _job_owner(db, job_id, user)
    if row['status'] not in ('cancelled', 'paused', 'partially_completed'):
        raise HTTPException(409, 'Only a cancelled, paused, or partial run can be resumed')
    active = await (await db.execute(
        """SELECT id FROM research_jobs WHERE owner_id=? AND status IN ('queued','running') AND id<>?""",
        (user['id'], job_id))).fetchone()
    if active:
        raise HTTPException(409, 'You already have a research run queued or active')
    await db.execute("""UPDATE research_tasks SET status='queued', stop_reason=NULL, error=NULL
        WHERE job_id=? AND status IN ('cancelled','paused','failed') AND NOT EXISTS (
            SELECT 1 FROM research_companies c WHERE c.id=research_tasks.company_id
              AND c.disposition='rejected')""", (job_id,))
    await db.execute("""UPDATE research_jobs SET status='queued', error=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=?""", (job_id,))
    await db.commit()
    await audit(db, user['id'], 'resume', 'research_job', job_id, {})
    return _job_out(await (await db.execute('SELECT * FROM research_jobs WHERE id=?', (job_id,))).fetchone())


async def _job_owner(db, job_id: int, user: dict) -> dict:
    await ensure_schema(db)
    row = await (await db.execute(
        'SELECT * FROM research_jobs WHERE id=? AND owner_id=?', (job_id, user['id']))).fetchone()
    if not row:
        raise HTTPException(404, 'Research run not found')
    return dict(row)


async def list_jobs(db, user: dict, brief_id: int | None = None) -> list[dict]:
    await ensure_schema(db)
    params: list[Any] = [user['id']]
    where = 'owner_id=?'
    if brief_id is not None:
        where += ' AND brief_id=?'
        params.append(brief_id)
    rows = await (await db.execute(
        f'SELECT * FROM research_jobs WHERE {where} ORDER BY id DESC', params)).fetchall()
    return [_job_out(r) for r in rows]


async def get_job(db, job_id: int, user: dict) -> dict:
    return _job_out(await _job_owner(db, job_id, user))


async def discover_companies(db, brief: dict, user: dict) -> list[dict]:
    """Synchronous current-company research producing source-backed recommendations."""
    from app.routers.research import ResearchSpec
    spec = ResearchSpec(**_json(brief['spec_json'], {})).model_dump()
    owner = brief['owner_id']
    brief_id = int(brief['id'])
    sources: list[dict] = []
    queries = []
    for name in (spec.get('companies') or [])[:6]:
        queries.append(f'{name} official company website homepage')
    for industry in (spec.get('industries') or [])[:3]:
        geo = ' '.join((spec.get('geography') or [])[:2])
        queries.append(f'companies in {industry} {geo} official website')
    try:
        for query in queries[:6]:
            sources.extend(await P.search_sources(owner, query))
    except P.ProviderUnavailable:
        pass
    scored: dict[str, dict] = {}
    for source in sources:
        domain = _norm_domain(source.get('url') or '')
        if not domain:
            continue
        try:
            sid = await _store_source(db, owner, brief_id, {**source, 'domain': domain})
        except ValueError:
            continue
        bucket = scored.setdefault(domain, {'name': source.get('title') or domain, 'domain': domain,
                                            'reason': (source.get('excerpt') or '')[:800],
                                            'match_state': 'possible_match', 'warnings': [], 'source_ids': []})
        if sid not in bucket['source_ids']:
            bucket['source_ids'].append(sid)
    stored: list[dict] = []
    for company in scored.values():
        if not company['source_ids']:
            continue
        try:
            stored.append(await upsert_company(db, brief_id, owner, company, company['source_ids']))
        except ValueError:
            continue
    return stored


async def recommendations_for_brief(db, brief_id: int, user: dict, state: str | None = None,
                                    offset: int = 0, limit: int = 100) -> list[dict]:
    await _brief_access(db, brief_id, user)
    params: list[Any] = [brief_id, user['id']]
    where = 'brief_id=? AND owner_id=?'
    if state:
        where += ' AND state=?'
        params.append(state)
    rows = await (await db.execute(
        f'SELECT * FROM contact_recommendations WHERE {where} ORDER BY id LIMIT ? OFFSET ?',
        params + [limit, offset])).fetchall()
    return [_recommendation_out(r) for r in rows]


async def get_recommendation(db, rec_id: int, user: dict) -> dict:
    await ensure_schema(db)
    row = await (await db.execute(
        'SELECT * FROM contact_recommendations WHERE id=? AND owner_id=?',
        (rec_id, user['id']))).fetchone()
    if not row:
        raise HTTPException(404, 'Recommendation not found')
    return _recommendation_out(row)


async def review_recommendation(db, rec_id: int, user: dict, disposition: str, reason: str | None) -> dict:
    from app.services.contact_intelligence import ingest_contact
    row = await (await db.execute(
        'SELECT * FROM contact_recommendations WHERE id=? AND owner_id=?',
        (rec_id, user['id']))).fetchone()
    if not row:
        raise HTTPException(404, 'Recommendation not found')
    if row['disposition'] == 'accepted' and disposition == 'accepted':
        raise HTTPException(409, 'This recommendation was already accepted')
    if disposition not in ('accepted', 'rejected'):
        raise HTTPException(422, 'Disposition must be accepted or rejected')
    if disposition == 'rejected' and not (reason or '').strip():
        raise HTTPException(422, 'A rejection reason is required')
    brief = await _brief_access(db, int(row['brief_id']), user)
    if disposition == 'accepted':
        person = _json(row['person_json'], {})
        email = (row['email'] or '').strip()
        if not email:
            raise HTTPException(409, 'No address candidate exists for this person; resolve the evidence first')
        domain = _norm_domain(person.get('domain') or email.rpartition('@')[2])
        contact_id = row['contact_id']
        if not contact_id:
            existing = await (await db.execute(
                'SELECT id FROM contacts WHERE email=? COLLATE NOCASE', (email,))).fetchone()
            if existing:
                contact_id = existing['id']
            else:
                cur = await db.execute(
                    """INSERT INTO contacts (name, email, title, company, company_domain, owner_id, contact_source)
                       VALUES (?,?,?,?,?,?, 'research')""",
                    (person.get('name') or '', email, person.get('title'), person.get('company'), domain, user['id']))
                contact_id = cur.lastrowid
        contact = {'name': person.get('name') or '', 'email': email,
                   'title': person.get('title') or '', 'company': person.get('company') or '',
                   'domain': domain, 'profile_url': person.get('profile_url') or '',
                   'id': contact_id, 'disposition': 'accepted'}
        sources_payload = _json(row['evidence_json'], {}).get('sources') or []
        snapshot = await ingest_contact(db, contact=contact, actor_id=user['id'],
                                        project_id=brief.get('project_id'), origin='imported_without_evidence',
                                        sources=sources_payload)
        await db.execute("""UPDATE contact_recommendations SET disposition='accepted',
            contact_id=?, reviewer_id=?, review_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?""",
            (snapshot.get('contact_id'), user['id'], (reason or '').strip()[:500] or None, rec_id))
    else:
        await db.execute("""UPDATE contact_recommendations SET disposition='rejected', state='excluded',
            reviewer_id=?, review_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?""",
            (user['id'], (reason or '').strip()[:500] or None, rec_id))
    await db.commit()
    await audit(db, user['id'], 'review', 'contact_recommendation', rec_id,
                {'disposition': disposition, 'contact_id': row['contact_id']})
    return await get_recommendation(db, rec_id, user)


async def recover_research_jobs() -> int:
    """Requeue tasks and jobs whose worker died mid-lease; fenced owners keep their jobs."""
    db = await get_db()
    try:
        await ensure_schema(db)
        await db.execute("""UPDATE research_tasks SET status='queued',lease_token=NULL,lease_expires_at=NULL
            WHERE status='running' AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<=datetime('now'))""")
        cursor = await db.execute("""UPDATE research_jobs SET status='queued', error=NULL,
            updated_at=CURRENT_TIMESTAMP, lease_token=NULL, lease_expires_at=NULL
            WHERE status='running' AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<=datetime('now'))
            RETURNING id""")
        recovered = len(await cursor.fetchall())
        await db.commit()
        return recovered
    finally:
        await db.close()


async def drain_research_queue() -> dict:
    """Claim one runnable task fairly across members; fenced leases stop concurrent owners."""
    db = await get_db()
    try:
        await ensure_schema(db)
        await _fail_member_inactive(db)
        await db.execute("""UPDATE research_tasks SET status='queued',lease_token=NULL,lease_expires_at=NULL
            WHERE status='running' AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<=datetime('now'))""")
        await db.commit()
        row = await (await db.execute("""SELECT t.id, t.kind, t.company_id, t.job_id, j.owner_id,
            j.spec_json, j.project_id, c.name AS company_name, c.domain
            FROM research_tasks t JOIN research_jobs j ON j.id=t.job_id
            JOIN research_companies c ON c.id=t.company_id
            WHERE t.status='queued' AND t.available_at<=CURRENT_TIMESTAMP AND j.status IN ('queued','running')
              AND EXISTS (SELECT 1 FROM users u WHERE u.id=j.owner_id AND u.is_active=1)
              AND EXISTS (SELECT 1 FROM research_companies rc WHERE rc.id=t.company_id AND rc.disposition='accepted')
            ORDER BY (SELECT COUNT(*) FROM research_jobs rj WHERE rj.owner_id=j.owner_id AND rj.status='completed'), j.id
            LIMIT 1""")).fetchone()
        if not row:
            return {'ok': True, 'claimed': 0}
        if not await _start_job_if_needed(db, int(row['job_id'])):
            return {'ok': True, 'claimed': 0}
        token = uuid.uuid4().hex
        claimed = await (await db.execute("""UPDATE research_tasks SET status='running',
            lease_token=?, lease_expires_at=datetime('now', ?), attempt_count=attempt_count+1
            WHERE id=? AND status='queued' RETURNING id""",
            (token, f'+{LEASE_MINUTES} minutes', row['id']))).fetchone()
        if not claimed:
            await db.rollback()
            return {'ok': True, 'claimed': 0}
        await db.commit()
        payload = dict(row)
        task_id = int(row['id'])
    finally:
        await db.close()
    await _execute_task(task_id, token, payload)
    return {'ok': True, 'claimed': 1, 'task_id': task_id}


async def _fail_member_inactive(db) -> None:
    await db.execute("""UPDATE research_jobs SET status='failed',
        error='Research stopped because the member account is inactive', updated_at=CURRENT_TIMESTAMP,
        lease_token=NULL, lease_expires_at=NULL
        WHERE status IN ('queued','running') AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.id=research_jobs.owner_id AND u.is_active=1)""")
    await db.execute("""UPDATE research_tasks SET status='cancelled', stop_reason='Member inactive'
        WHERE status IN ('queued','running') AND NOT EXISTS (
            SELECT 1 FROM users u JOIN research_jobs j ON j.id=research_tasks.job_id
            WHERE u.id=j.owner_id AND u.is_active=1)""")


async def discover_companies_for_brief(db, brief_id: int, user: dict) -> list[dict]:
    row = await _brief_access(db, brief_id, user)
    return await discover_companies(db, row, user)


async def _start_job_if_needed(db, job_id: int) -> bool:
    row = await (await db.execute('SELECT * FROM research_jobs WHERE id=?', (job_id,))).fetchone()
    if not row or row['status'] not in ('queued', 'running'):
        return False
    if row['status'] == 'queued':
        await db.execute("""UPDATE research_jobs SET status='running', updated_at=CURRENT_TIMESTAMP,
            lease_token=?, lease_expires_at=datetime('now', ?) WHERE id=? AND status='queued' """,
            (uuid.uuid4().hex, f'+{LEASE_MINUTES} minutes', job_id))
        await db.commit()
    return True


async def _execute_task(task_id: int, token: str, row: dict) -> None:
    db = await get_db()
    try:
        await ensure_schema(db)
        row = {**row, '_token': token, 'id': task_id}
        await _refresh_job_lease(db, row['job_id'])
        try:
            if row['kind'] == 'company_research':
                await _task_company_research(db, row)
            elif row['kind'] == 'person_discovery':
                await _task_person_discovery(db, row)
            elif row['kind'] == 'evidence_reconciliation':
                await _task_evidence_reconciliation(db, row)
            else:
                await _task_fail(db, row, 'needs_review', 'Unknown task type')
            await _maybe_finish_job(db, row['job_id'])
        except LeaseLost:
            return
        except P.ProviderUnavailable as exc:
            await _task_fail(db, row, exc.state, str(exc))
        except Exception as exc:  # noqa: BLE001 - classify and retain partial evidence
            await _task_fail(db, row, 'needs_review', f'Attempt failed: {exc}')
    finally:
        await db.close()


async def _refresh_job_lease(db, job_id: int) -> None:
    cur = await db.execute("""UPDATE research_jobs SET lease_expires_at=datetime('now', ?)
        WHERE id=? AND status='running' """, (f'+{LEASE_MINUTES} minutes', job_id))
    if cur.rowcount == 0:
        raise LeaseLost('Job lease no longer owned by this worker')


async def _task_company_research(db, row: dict) -> None:
    brief = await (await db.execute("""SELECT b.* FROM research_briefs b
        JOIN research_jobs j ON j.brief_id=b.id WHERE j.id=?""", (row['job_id'],))).fetchone()
    if not brief:
        raise ValueError('Brief missing')
    companies = await discover_companies(db, brief, {'id': row['owner_id']})
    await _task_complete(db, row, len(companies))


async def _task_person_discovery(db, row: dict) -> None:
    from app.services.contact_scraper import extract_employee_emails_from_text, looks_like_person_name
    sources: list[dict] = []
    provider_state = 'not_started'
    try:
        sources = await P.crawl_source(row['owner_id'], row['domain'], 0)
        provider_state = 'available'
    except P.ProviderUnavailable as exc:
        provider_state = exc.state
    try:
        sources = sources + await P.search_sources(
            row['owner_id'], f'site:{row["domain"]} {row["company_name"]} team leadership people')
        provider_state = 'available'
    except P.ProviderUnavailable:
        pass
    stored: list[dict] = []
    for source in sources:
        try:
            sid = await _store_source(db, row['owner_id'], await _brief_for_job(db, row['job_id']), source)
            stored.append({**source, 'id': sid})
        except ValueError:
            continue
    if not stored:
        await _task_complete(db, row, 0, provider_state=provider_state,
                             stop_reason='No reachable sources; evidence remains from prior tasks')
        return
    try:
        interpretation = await P.interpret_sources(row['owner_id'], 'person_discovery',
                                                   _json(row['spec_json'], {}), stored,
                                                   {'company': row['company_name'], 'domain': row['domain']})
    except P.ProviderUnavailable as exc:
        await _task_complete(db, row, 0, provider_state=exc.state,
                             stop_reason='Interpretation unavailable; sources retained for a later run')
        return
    people = interpretation.get('people') or []
    accepted_people = 0
    for person in people[:30]:
        cited = [int(s) for s in (person.get('source_ids') or []) if isinstance(s, (int, str))][:20]
        if not cited or person.get('identity') in ('rejected',) or person.get('project_fit') == 'excluded':
            continue
        name = (person.get('name') or '').strip()
        if not name or not looks_like_person_name(name):
            continue
        person_key = hashlib.sha256(
            json.dumps([name.lower(), row['domain']], sort_keys=True).encode()).hexdigest()[:24]
        email = ''
        source_rows = [s for s in stored if s.get('id') in cited]
        emails = []
        for s in source_rows:
            emails.extend(extract_employee_emails_from_text(s.get('excerpt', ''), row['domain']))
        person_lower = name.lower()
        for candidate in dict.fromkeys(emails):
            local = candidate.split('@')[0]
            if all(token in local for token in person_lower.replace('-', ' ').split() if len(token) > 2):
                email = candidate
                break
        await _upsert_recommendation(db, row, person_key, person, email, cited, stored)
        accepted_people += 1
    await _task_complete(db, row, accepted_people, provider_state=provider_state)


async def _task_evidence_reconciliation(db, row: dict) -> None:
    from app.services.contact_intelligence import ingest_contact
    recommendations = await (await db.execute(
        """SELECT * FROM contact_recommendations WHERE owner_id=? AND brief_id=? AND disposition IS NULL""",
        (row['owner_id'], await _brief_for_job(db, row['job_id'])))).fetchall()
    processed = 0
    for rec in recommendations:
        person = _json(rec['person_json'], {})
        evidence = _json(rec['evidence_json'], {})
        sources = evidence.get('sources') or []
        email = (rec['email'] or '').strip()
        if not sources or not email:
            await db.execute("""UPDATE contact_recommendations SET state='needs_evidence' WHERE id=?""", (rec['id'],))
            continue
        payload = {'id': rec['contact_id'], 'name': person.get('name') or '', 'email': email,
                   'title': person.get('title') or '', 'company': person.get('company') or '',
                   'domain': row['domain'], 'profile_url': person.get('profile_url') or ''}
        snapshot = await ingest_contact(db, contact=payload, actor_id=row['owner_id'],
                                        project_id=row.get('project_id'), origin='public_source',
                                        sources=sources)
        new_state = 'needs_evidence' if snapshot.get('mailbox') in ('not_checked', 'bad_syntax',
                                                                    'domain_has_no_mail_route') else 'ready_to_review'
        await db.execute("""UPDATE contact_recommendations SET evidence_json=?, state=? WHERE id=?""",
                         (json.dumps(snapshot), new_state, rec['id']))
        processed += 1
    await _task_complete(db, row, processed)


async def _upsert_recommendation(db, row: dict, person_key: str, person: dict, email: str,
                                 source_ids: list[int], stored: list[dict]) -> None:
    sources = [s for s in stored if s.get('id') in source_ids]
    evidence = {'sources': [{'id': s['id'], 'url': s['url'], 'excerpt': s['excerpt'][:300],
                             'observed_at': s.get('observed_at') or P.utcnow()} for s in sources]}
    explanation = (person.get('explanation') or '')[:1200]
    state = 'needs_evidence' if not email else 'ready_to_review'
    fit = person.get('project_fit') if person.get('project_fit') in ('strong', 'possible', 'weak', 'excluded') else 'weak'
    await db.execute("""INSERT INTO contact_recommendations
        (owner_id,brief_id,company_id,person_key,person_json,email,evidence_json,state,explanation)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,brief_id,person_key) DO UPDATE SET
        person_json=excluded.person_json, email=CASE WHEN excluded.email!='' THEN excluded.email
            ELSE contact_recommendations.email END, evidence_json=excluded.evidence_json,
        state=excluded.state, explanation=excluded.explanation, updated_at=CURRENT_TIMESTAMP""",
        (row['owner_id'], await _brief_for_job(db, row['job_id']), row['company_id'], person_key,
         json.dumps({'name': person.get('name') or '', 'title': person.get('title') or '',
                     'company': person.get('company') or row['company_name'],
                     'profile_url': person.get('profile_url') or '',
                     'identity': person.get('identity') or 'unreviewed',
                     'employment': person.get('employment') or 'unknown',
                     'project_fit': fit}),
         email, json.dumps(evidence), state, explanation))


async def _brief_for_job(db, job_id: int) -> int:
    row = await (await db.execute(
        'SELECT brief_id FROM research_jobs WHERE id=?', (job_id,))).fetchone()
    return int(row['brief_id']) if row else 0


async def _task_complete(db, row: dict, result_count: int, provider_state: str | None = None,
                         stop_reason: str | None = None) -> None:
    await db.execute("""UPDATE research_tasks SET status='completed', result_count=?, stop_reason=?,
        lease_token=NULL, lease_expires_at=NULL WHERE id=? AND lease_token=?""",
        (result_count, stop_reason, row['id'], row.get('_token')))
    await db.execute("""UPDATE research_jobs SET completed_tasks=completed_tasks+1, people_count=people_count+?,
        provider_state=COALESCE(?, provider_state), updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='running'""", (result_count if row['kind'] == 'person_discovery' else 0,
                                             provider_state, row['job_id']))
    await db.commit()


async def _task_fail(db, row: dict, provider_state: str, error: str) -> None:
    attempts = await (await db.execute(
        'SELECT attempt_count FROM research_tasks WHERE id=?', (row['id'],))).fetchone()
    attempts = int(attempts['attempt_count']) if attempts else 1
    if attempts >= MAX_TASK_ATTEMPTS:
        await db.execute("""UPDATE research_tasks SET status='failed', error=?, lease_token=NULL,
            lease_expires_at=NULL WHERE id=?""", (error[:500], row['id']))
        await db.execute("""UPDATE research_jobs SET provider_state=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?""", (provider_state, row['job_id']))
    else:
        delay = min(60 * attempts, 300)
        await db.execute("""UPDATE research_tasks SET status='queued', error=?, lease_token=NULL,
            lease_expires_at=NULL, available_at=datetime('now', ?) WHERE id=?""",
            (error[:500], f'+{delay} seconds', row['id']))
    await db.commit()


async def _maybe_finish_job(db, job_id: int) -> None:
    row = await (await db.execute(
        'SELECT * FROM research_jobs WHERE id=?', (job_id,))).fetchone()
    if not row or row['status'] != 'running':
        return
    pending = await (await db.execute(
        """SELECT COUNT(*) AS n FROM research_tasks WHERE job_id=? AND status IN ('queued','running')""",
        (job_id,))).fetchone()
    failed = await (await db.execute(
        """SELECT COUNT(*) AS n FROM research_tasks WHERE job_id=? AND status='failed' """, (job_id,))).fetchone()
    if int(pending['n'] or 0) > 0:
        return
    status = 'completed'
    error = None
    if int(failed['n'] or 0) > 0:
        status = 'partially_completed'
        error = 'Some research tasks failed; retained evidence remains reviewable and the run can be resumed'
    await db.execute("""UPDATE research_jobs SET status=?, error=?, updated_at=CURRENT_TIMESTAMP,
        lease_token=NULL, lease_expires_at=NULL WHERE id=?""", (status, error, job_id))
    await db.commit()


async def research_metrics(db, actor_id: int) -> dict:
    """Privacy-safe aggregates for Operations Intelligence; no addresses or local parts."""
    await ensure_schema(db)
    role = await (await db.execute('SELECT role FROM users WHERE id=?', (actor_id,))).fetchone()
    if not role or role['role'] != 'admin':
        raise HTTPException(403, 'Administrator access required')
    jobs = await (await db.execute("""SELECT status, COUNT(*) AS n FROM research_jobs GROUP BY status""")).fetchall()
    recs = await (await db.execute("""SELECT state, COUNT(*) AS n FROM contact_recommendations GROUP BY state""")).fetchall()
    providers = await (await db.execute("""SELECT state, COUNT(*) AS n FROM research_provider_requests
        WHERE date(created_at)=date('now') GROUP BY state""")).fetchall()
    return {
        'jobs': {row['status']: row['n'] for row in jobs},
        'recommendations': {row['state']: row['n'] for row in recs},
        'provider_requests_today': {row['state']: row['n'] for row in providers},
    }
