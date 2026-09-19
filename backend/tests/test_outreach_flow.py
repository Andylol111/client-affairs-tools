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
            title_hints='VPs', angle='question_hook', max_contacts=10,
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
        assert generated[0][1] == 'question_hook' and generated[0][2] is None
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


if __name__ == '__main__':
    tests()
    print('outreach flow: ok')
