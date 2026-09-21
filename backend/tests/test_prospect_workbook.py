"""Replacing the club target list from the website.

The curated sheet steers every member's outreach, so the upload has to be
admin-only, has to refuse anything it cannot read rather than wiping the list,
and has to show up in the register immediately - a member who uploads a list
and then sees yesterday's companies would upload it again.
"""
import asyncio
import io
import os
import sys
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI
from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

COLUMNS = ['Company', 'Sector', 'Why attractive prospect for YUCG',
           'Suggested engagement theme', 'Yale hook', 'Outreach priority',
           'Contact type', 'Target role title']


def _workbook(rows: list[tuple[str, str]], *, sheet: str = 'YUCG Prospects') -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(COLUMNS)
    for company, sector in rows:
        ws.append([company, sector, 'Cost programme under way', 'Operations',
                   'Yale alumni on the leadership team', 2, 'Head of Operations',
                   'Director of Operations'])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _empty_workbook() -> bytes:
    wb = Workbook()
    wb.active.title = 'YUCG Prospects'
    wb.active.append(COLUMNS)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _register_names(tier: str = 'club_targets') -> set[str]:
    from app.database import get_db

    db = await get_db()
    try:
        cur = await db.execute(
            'SELECT company_name FROM company_register WHERE tier = ?', (tier,))
        return {r[0] for r in await cur.fetchall()}
    finally:
        await db.close()


async def _register_rows() -> list[tuple]:
    from app.database import get_db

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, source_key, company_name, first_seen_at FROM company_register "
            "WHERE source = 'club_sheet' ORDER BY id")
        return [tuple(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def _club_metadata(company: str) -> dict:
    import json

    from app.database import get_db

    db = await get_db()
    try:
        cur = await db.execute(
            'SELECT metadata_json FROM company_register WHERE company_name = ?', (company,))
        row = await cur.fetchone()
        return json.loads(row[0]) if row and row[0] else {}
    finally:
        await db.close()


async def _club_segments(company: str) -> set:
    import json

    from app.database import get_db

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT metadata_json FROM company_register WHERE company_name = ? "
            "AND source = 'club_sheet'", (company,))
        return {json.loads(r[0]).get('segment') for r in await cur.fetchall() if r[0]}
    finally:
        await db.close()


async def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        live = Path(tmp) / 'YUCG_Prospect_List.xlsx'
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "targets.db"}'
        os.environ['YUCG_PROSPECT_XLSX'] = str(live)
        os.environ.setdefault('JWT_SECRET', 'test-secret-value-for-prospect-workbook-0123456789')
        os.environ.pop('CATALOG_BUCKET', None)
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]

        from app.auth_deps import get_current_user
        from app.database import get_db, init_db
        from app.routers.admin import router as admin_router
        from app.services import prospect_workbook
        from app.services.prospect_coordinator import load_prospects

        await init_db()
        db = await get_db()
        try:
            await db.execute(
                "INSERT INTO users (id, email, name, role, is_active) VALUES "
                "(1,'chair@yale.edu','Chair','admin',1),(2,'member@yale.edu','Member','standard',1)")
            await db.commit()
        finally:
            await db.close()

        # The list as it stands before anybody uploads anything.
        live.write_bytes(_workbook([('Existing Holdings Ltd', 'Industrials')]))
        assert [r['company'] for r in load_prospects(force_reload=True)] == ['Existing Holdings Ltd']

        app = FastAPI()
        app.include_router(admin_router, prefix='/api/admin')
        actor = {'id': 2, 'email': 'member@yale.edu', 'role': 'standard'}
        app.dependency_overrides[get_current_user] = lambda: actor

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
            replacement = _workbook([('Nova Robotics Inc', 'Technology'),
                                     ('Harbour Health Trust', 'Healthcare')])

            # A standard member cannot rewrite what the whole club works from.
            res = await client.post(
                '/api/admin/target-list',
                files={'file': ('list.xlsx', replacement, 'application/vnd.ms-excel')})
            assert res.status_code == 403, res.text
            assert live.read_bytes() != replacement, 'a refused upload still replaced the list'

            actor.update({'id': 1, 'email': 'chair@yale.edu', 'role': 'admin'})

            # Neither does a file the loader cannot read - and the list survives it.
            for name, body, fragment in (
                ('targets.csv', b'Company,Sector\nNova,Tech\n', 'not an Excel workbook'),
                ('targets.xlsx', b'this is not a zip container at all', 'could not be read'),
                ('targets.xlsx', _empty_workbook(), 'No companies found'),
            ):
                res = await client.post(
                    '/api/admin/target-list', files={'file': (name, body, 'application/vnd.ms-excel')})
                assert res.status_code == 400, (name, res.status_code)
                assert fragment in res.json()['detail'], (name, res.json())
            assert [r['company'] for r in load_prospects()] == ['Existing Holdings Ltd']

            res = await client.post(
                '/api/admin/target-list',
                files={'file': ('spring-2026.xlsx', replacement, 'application/vnd.ms-excel')})
            assert res.status_code == 200, res.text
            body = res.json()
            assert body['companies'] == 2 and body['companies_before'] == 1

            # Uploading is the whole act: the register a member searches now
            # holds the new companies, and only those.
            names = await _register_names()
            assert names == {'Nova Robotics Inc', 'Harbour Health Trust'}, names
            assert [r['company'] for r in load_prospects()] == [
                'Nova Robotics Inc', 'Harbour Health Trust']

            # The list it replaced is still recoverable.
            archived = Path(body['replaced_copy'])
            assert archived.is_file()
            assert prospect_workbook.parse_candidate(
                archived.read_bytes(), archived.name)[0]['company'] == 'Existing Holdings Ltd'

            # An admin editing the sheet moves rows. Keyed by company, a
            # reorder is not a change: the same register rows stay, with their
            # ids and first-seen dates, instead of being deleted and recreated.
            before = await _register_rows()
            res = await client.post(
                '/api/admin/target-list',
                files={'file': ('reordered.xlsx',
                                _workbook([('Harbour Health Trust', 'Healthcare'),
                                           ('Nova Robotics Inc', 'Technology')]),
                                'application/vnd.ms-excel')})
            assert res.status_code == 200, res.text
            assert res.json()['register_rows_dropped'] == 0, res.json()
            assert await _register_rows() == before

            # Two lines naming the same company and the same segment are two
            # notes on one target: one row, both write-ups, and the merge is
            # named in the response rather than left to be discovered.
            res = await client.post(
                '/api/admin/target-list',
                files={'file': ('with-duplicate.xlsx',
                                _workbook([('Nova Robotics Inc', 'Technology'),
                                           ('Harbour Health Trust', 'Healthcare'),
                                           ('Nova Robotics, Inc.', 'Technology')]),
                                'application/vnd.ms-excel')})
            assert res.status_code == 200, res.text
            body = res.json()
            assert body['companies'] == 3, body  # three sheet lines
            assert body['register_rows_written'] == 2, body
            assert body['folded_duplicates'] == ['Nova Robotics Inc'], body
            names = await _register_names()
            assert names == {'Nova Robotics Inc', 'Harbour Health Trust'}, names
            metadata = await _club_metadata('Nova Robotics Inc')
            assert len(metadata['also_listed']) == 1, metadata
            assert metadata['also_listed'][0]['row_index'] == 4, metadata

            # But a segment is a different pitch, not a duplicate: the sheet's
            # author meant both "McKinsey & Company" and its public-sector
            # practice, so both stay, and neither is merged away.
            res = await client.post(
                '/api/admin/target-list',
                files={'file': ('segments.xlsx',
                                _workbook([('Harbour Health Trust', 'Healthcare'),
                                           ('Harbour Health Trust \u2014 Community clinics', 'Healthcare')]),
                                'application/vnd.ms-excel')})
            assert res.status_code == 200, res.text
            body = res.json()
            assert body['folded_duplicates'] == [], body
            assert body['register_rows_written'] == 2, body
            segments = await _club_segments('Harbour Health Trust')
            assert segments == {None, 'Community clinics'}, segments

            # Taking a company off the sheet takes it out of the club tier.
            # Row indexes shift when a line is deleted, so the company that
            # moved up must not leave its old key behind as a second target.
            res = await client.post(
                '/api/admin/target-list',
                files={'file': ('spring-2026-v2.xlsx',
                                _workbook([('Harbour Health Trust', 'Healthcare')]),
                                'application/vnd.ms-excel')})
            assert res.status_code == 200, res.text
            assert res.json()['register_rows_dropped'] == 1, res.json()
            assert await _register_names() == {'Harbour Health Trust'}

            res = await client.get('/api/admin/target-list')
            status = res.json()
            assert status['row_count'] == 1, status
            assert status['last_upload']['email'] == 'chair@yale.edu'
            assert 'spring-2026-v2.xlsx' in status['last_upload']['details']

    print('prospect workbook: ok')


if __name__ == '__main__':
    asyncio.run(main())
