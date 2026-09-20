"""One-click outreach flow: a completed Find people run becomes imported
contacts, one draft per contact, and a draft campaign the member reviews -
with nothing sent, ownership preserved, and the draft quota respected.

Discovery itself is not exercised here (it has its own tests); the run is
seeded as already completed with prospects, which is exactly the state the
flow drain picks up from.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('JWT_SECRET', 'outreach-flow-secret-xxxxxxxxxxxxxxxxxxxx')


def tests() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "t.db"}'
        os.environ['LLM_PROVIDER'] = 'bedrock'
        os.environ['DRAFTS_PER_MEMBER_PER_HOUR'] = '4'  # Ada 2 attempts + Grace 2 attempts; Alan hits the quota
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]

        from fastapi import HTTPException
        from app.database import get_db, init_db
        from app.services import outreach_flow

        asyncio.run(init_db())

        async def seed() -> None:
            db = await get_db()
            try:
                await db.execute("INSERT INTO users (id, email, name, is_active) VALUES (1, 'a@yale.edu', 'A', 1)")
                await db.commit()
            finally:
                await db.close()

        asyncio.run(seed())

        # Start: enqueues a discovery run and records the flow.
        flow = asyncio.run(outreach_flow.start_outreach_flow(
            user_id=1, company_name='Acme Corp', company_domain='acme.com',
            title_hints='VPs', angle='case_study', max_contacts=10,
        ))
        assert flow['status'] == 'discovering'
        assert flow['run_id']
        assert flow['campaign_id'] is None

        # A second flow for the same member is refused while one is open.
        try:
            asyncio.run(outreach_flow.start_outreach_flow(
                user_id=1, company_name='Other', company_domain=None,
                title_hints=None, angle=None, max_contacts=5,
            ))
            raise AssertionError('second concurrent flow should be refused')
        except HTTPException as exc:
            assert exc.status_code == 409

        # Nothing to do while discovery is still running.
        assert asyncio.run(outreach_flow.drain_outreach_flows())['claimed'] == 0

        # Simulate discovery completing with three good prospects.
        async def complete_run() -> None:
            db = await get_db()
            try:
                for i, (first, last) in enumerate([('Ada', 'Lovelace'), ('Grace', 'Hopper'), ('Alan', 'Turing')]):
                    await db.execute(
                        """INSERT INTO yucgoutreach_prospects
                           (run_id, first_name, last_name, email, company, title, score, fit_status,
                            email_verification_status, ai_verdict, contact_source)
                           VALUES (?, ?, ?, ?, 'Acme Corp', 'VP', ?, 'strong', 'likely_valid', 'real', 'web_discovery')""",
                        (flow['run_id'], first, last, f'{first.lower()}.{last.lower()}@acme.com', 90 - i),
                    )
                await db.execute(
                    "UPDATE yucgoutreach_discovery_runs SET status='completed', progress_pct=100, prospects_count=3 WHERE id=?",
                    (flow['run_id'],),
                )
                await db.commit()
            finally:
                await db.close()

        asyncio.run(complete_run())

        generated: list[tuple[str, str, str | None]] = []

        def fake_generate(**kwargs):
            """Studio's validator rejects with a 502 HTTPException. Ada is
            rejected once then accepted on the retry; Grace is rejected on both
            attempts; Alan never gets an attempt because the quota (4/hour)
            is spent by then: Ada 2 + Grace 2."""
            name = kwargs['contact_name']
            generated.append((name, kwargs['angle'], kwargs['custom_instructions']))
            attempts = sum(1 for g in generated if g[0] == name)
            if name == 'Ada Lovelace' and attempts == 1:
                raise HTTPException(502, 'Draft generation failed. Your existing draft is unchanged; please retry.')
            if name == 'Grace Hopper':
                raise HTTPException(502, 'Draft generation failed. Your existing draft is unchanged; please retry.')
            return f"Hello {name}", f"Body for {name} ({kwargs['angle']})"

        async def fake_evidence(db, contact, actor_id):
            return {"facts": []}

        async def fake_assess(email, actor_id=None):
            return {"status": "likely_valid"}

        with patch('app.services.ollama_email_service.generate_email', fake_generate), \
             patch('app.services.generation_policy.draft_evidence', fake_evidence), \
             patch('app.services.yucgoutreach_import.assess_address', fake_assess):
            result = asyncio.run(outreach_flow.drain_outreach_flows())
        assert result['claimed'] == 1

        done = asyncio.run(outreach_flow.get_flow(flow['id'], 1))
        assert done['status'] == 'ready', done
        assert done['imported_count'] == 3
        assert done['drafted_count'] == 1, done
        assert 'did not pass the draft rules' in (done['progress_message'] or '')
        assert 'hourly draft limit' in (done['progress_message'] or '')
        assert done['campaign_id']
        # Retry uses the validator-aligned angle + instruction; the first try keeps the member's angle.
        assert [g[0] for g in generated] == ['Ada Lovelace', 'Ada Lovelace', 'Grace Hopper', 'Grace Hopper']
        assert generated[0][1] == 'case_study' and generated[0][2] is None
        assert generated[1][1] == 'pain_point' and 'exactly one thing' in (generated[1][2] or '')

        async def inspect() -> None:
            db = await get_db()
            try:
                camp = await (await db.execute("SELECT * FROM campaigns WHERE id=?", (done['campaign_id'],))).fetchone()
                assert camp['status'] == 'draft', 'flow must never release'
                assert int(camp['owner_user_id']) == 1 and int(camp['sender_user_id']) == 1
                rows = await (await db.execute(
                    "SELECT cc.email_subject, cc.status, c.email FROM campaign_contacts cc JOIN contacts c ON c.id=cc.contact_id WHERE cc.campaign_id=? ORDER BY c.email",
                    (done['campaign_id'],),
                )).fetchall()
                assert len(rows) == 3
                by_email = {r['email']: r for r in rows}
                assert by_email['ada.lovelace@acme.com']['email_subject'] == 'Hello Ada Lovelace'
                assert by_email['grace.hopper@acme.com']['email_subject'] == ''  # rejected twice, still attached
                assert by_email['alan.turing@acme.com']['email_subject'] == ''  # quota-hit contact, still attached
                assert all(r['status'] == 'pending' for r in rows)
                owners = await (await db.execute("SELECT DISTINCT owner_id FROM contacts")).fetchall()
                assert [o['owner_id'] for o in owners] == [1]
                bound = await (await db.execute(
                    "SELECT COUNT(*) AS n FROM generated_emails WHERE campaign_id=?", (done['campaign_id'],)
                )).fetchone()
                assert bound['n'] == 1
            finally:
                await db.close()

        asyncio.run(inspect())

        # Terminal: another drain does nothing, and the member may start a new flow.
        assert asyncio.run(outreach_flow.drain_outreach_flows())['claimed'] == 0
        assert len(asyncio.run(outreach_flow.list_flows(1))) == 1

        # A failed discovery run fails its flow with the run's reason.
        async def seed_failed() -> None:
            db = await get_db()
            try:
                cur = await db.execute(
                    """INSERT INTO yucgoutreach_discovery_runs (user_id, company_name, max_prospects, worker_concurrency, status, error_message)
                       VALUES (1, 'Broken Co', 10, 4, 'failed', 'Search stopped after repeated worker interruption')"""
                )
                await db.execute(
                    "INSERT INTO outreach_flows (user_id, company_name, run_id, status) VALUES (1, 'Broken Co', ?, 'discovering')",
                    (cur.lastrowid,),
                )
                await db.commit()
            finally:
                await db.close()

        asyncio.run(seed_failed())
        asyncio.run(outreach_flow.drain_outreach_flows())
        flows = asyncio.run(outreach_flow.list_flows(1))
        failed = [f for f in flows if f['company_name'] == 'Broken Co'][0]
        assert failed['status'] == 'failed'
        assert 'worker interruption' in failed['error_message']

        del os.environ['DRAFTS_PER_MEMBER_PER_HOUR']


def board_only_gate_tests() -> None:
    """A run that surfaced only board seats is an unfinished search, not a
    campaign. On the live register 58.7% of named people are directors or
    trustees, and only 26.2% of companies with filed officers have anyone at
    working level - so this is the common case, not an edge one."""
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "gate.db"}'
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]
        from app.database import get_db, init_db
        from app.services import outreach_flow

        async def scenario() -> None:
            await init_db()
            db = await get_db()
            await db.execute("INSERT INTO users(id,email,role,is_active) VALUES (1,'me@yale.edu','standard',1)")
            people = [
                (1, 'Ada Lovelace', 'ada@acme.com', 'Trustee'),
                (2, 'Grace Hopper', 'grace@acme.com', 'Board Member'),
                (3, 'Alan Turing', 'alan@acme.com', 'Director'),
                (4, 'Jean Bartik', 'jean@acme.com', 'Director of Operations'),
                (5, 'Klara Dan', 'klara@acme.com', None),
            ]
            for cid, name, email, title in people:
                await db.execute(
                    "INSERT INTO contacts(id,name,email,title,owner_id) VALUES (?,?,?,?,1)",
                    (cid, name, email, title))
            await db.commit()
            await db.close()

            # Board seats are dropped and named; the working-level person and
            # the untitled one survive - discovery searched for a role, so an
            # unlabelled row is far likelier to be staff than a trustee.
            keepers, board = await outreach_flow._drop_board_only([1, 2, 3, 4, 5])
            assert keepers == [4, 5], keepers
            assert sorted(board) == ['Ada Lovelace', 'Alan Turing', 'Grace Hopper'], board

            # A bare "Director" is a board seat here, which is what a filing
            # means by it 97,292 times over in the live register.
            keepers, board = await outreach_flow._drop_board_only([1, 2, 3])
            assert keepers == [] and len(board) == 3

            # The club already recorded who to aim at, so a member who types
            # nothing still gets a targeted search rather than a generic one.
            from app.services.company_register import upsert_companies
            await upsert_companies([{
                'source': 'club_sheet', 'source_key': '2', 'tier': 'club_targets',
                'country': 'US', 'company_name': 'Acme Corp',
                'metadata': {'target_role_title': 'VP Strategic Partnerships'},
            }])
            assert await outreach_flow._recorded_target_role('acme corp') == 'VP Strategic Partnerships'
            assert await outreach_flow._recorded_target_role('Nobody Ltd') is None

        asyncio.run(scenario())


if __name__ == '__main__':
    tests()
    board_only_gate_tests()
    print('outreach flow: ok')
