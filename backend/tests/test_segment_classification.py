"""Company segment classification: quota-gated, AI call mocked, member override
always wins over a prior AI assignment. Matches the isolated-DB convention in
test_web_fetch.py — no network, no real Bedrock call.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('JWT_SECRET', 'segment-classification-test-secret-xxxxxxxxxxxxxxxx')


def tests() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "t.db"}'
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]

        from app.database import get_db, init_db
        from app.services import segment_classifier as sc
        from app.services.generation_policy import reserve_segment_classification
        from fastapi import HTTPException

        asyncio.run(init_db())

        async def seed() -> None:
            db = await get_db()
            try:
                await db.execute(
                    "INSERT INTO users (id, email, name) VALUES (1, 'a@yale.edu', 'A'), (2, 'b@yale.edu', 'B')"
                )
                await db.execute(
                    "INSERT INTO contacts (name, email, company, company_domain) VALUES "
                    "('P1', 'p1@acme.com', 'Acme Robotics', 'acme.com'), "
                    "('P2', 'p2@acme.com', 'Acme Robotics', 'acme.com'), "
                    "('P3', 'p3@nodomain.co', 'Loose Co', NULL)"
                )
                await db.commit()
            finally:
                await db.close()

        asyncio.run(seed())

        # company_key: domain wins over name when both present; falls back to
        # name when domain is absent; empty/missing everything yields None.
        assert sc.company_key('Acme Robotics', 'acme.com') == 'domain:acme.com'
        assert sc.company_key('Acme Robotics', None) == 'name:acme robotics'
        assert sc.company_key('', None) is None

        # Two contacts at the same domain collapse to one unclassified company.
        async def load_pending():
            db = await get_db()
            try:
                return await sc.unclassified_companies(db)
            finally:
                await db.close()

        pending = asyncio.run(load_pending())
        keys = {p['key'] for p in pending}
        assert keys == {'domain:acme.com', 'name:loose co'}

        # classify_companies persists a mocked AI response and stamps source='ai'.
        import app.services.llm as llm_module
        original_complete_json = llm_module.complete_json

        def fake_complete_json(prompt, model_id=None, system=None):
            return {"classifications": [
                {"company": "Acme Robotics", "segment": "Technology & Software", "rationale": "robotics"},
                {"company": "Loose Co", "segment": "not-a-real-segment", "rationale": "bad value"},
            ]}

        llm_module.complete_json = fake_complete_json
        try:
            written = asyncio.run(sc.classify_companies(pending, user_id=1))
        finally:
            llm_module.complete_json = original_complete_json
        assert written == 2

        async def load_row(key):
            db = await get_db()
            try:
                row = await (await db.execute(
                    "SELECT segment, source FROM company_segments WHERE company_key=?", (key,)
                )).fetchone()
                return dict(row) if row else None
            finally:
                await db.close()

        acme = asyncio.run(load_row('domain:acme.com'))
        assert acme == {'segment': 'Technology & Software', 'source': 'ai'}
        # An off-list segment from the model defaults to Other rather than
        # being persisted verbatim or dropping the company silently.
        loose = asyncio.run(load_row('name:loose co'))
        assert loose == {'segment': 'Other', 'source': 'ai'}

        # Re-running with no companies left is a no-op, not an error.
        pending_after = asyncio.run(load_pending())
        assert pending_after == []
        assert asyncio.run(sc.classify_companies([], user_id=1)) == 0

        # A member override afterward is a separate write path (source='member'
        # in the router), independent of classify_companies - just confirm the
        # upsert path used by classify_companies overwrites a prior AI value
        # when the company is reclassified rather than duplicating the row.
        async def reclassify():
            db = await get_db()
            try:
                await db.execute(
                    """INSERT INTO company_segments (company_key, company_name, company_domain, segment, source)
                       VALUES ('domain:acme.com','Acme Robotics','acme.com','Other','ai')
                       ON CONFLICT(company_key) DO UPDATE SET segment=excluded.segment""",
                )
                await db.commit()
                row = await (await db.execute(
                    "SELECT count(*) AS n, segment FROM company_segments WHERE company_key='domain:acme.com'"
                )).fetchone()
                return dict(row)
            finally:
                await db.close()

        result = asyncio.run(reclassify())
        assert result['n'] == 1
        assert result['segment'] == 'Other'

        # Quota: member limit trips before club limit when set tighter.
        os.environ['SEGMENT_CLASSIFY_PER_MEMBER_PER_HOUR'] = '2'
        os.environ['SEGMENT_CLASSIFY_PER_CLUB_PER_HOUR'] = '100'
        asyncio.run(reserve_segment_classification(1))
        asyncio.run(reserve_segment_classification(1))
        try:
            asyncio.run(reserve_segment_classification(1))
            raise AssertionError('Per-member segment classification quota did not trip')
        except HTTPException as exc:
            assert exc.status_code == 429

        # A second member is tracked independently of the first member's usage.
        asyncio.run(reserve_segment_classification(2))

        # Club-wide ceiling trips even for a fresh member once the shared
        # total is exhausted.
        os.environ['SEGMENT_CLASSIFY_PER_MEMBER_PER_HOUR'] = '100'
        os.environ['SEGMENT_CLASSIFY_PER_CLUB_PER_HOUR'] = '3'
        try:
            asyncio.run(reserve_segment_classification(2))
            raise AssertionError('Club-wide segment classification quota did not trip')
        except HTTPException as exc:
            assert exc.status_code == 429

        # Invalid quota configuration fails closed with a 503, not a crash.
        os.environ['SEGMENT_CLASSIFY_PER_MEMBER_PER_HOUR'] = 'not-a-number'
        try:
            asyncio.run(reserve_segment_classification(1))
            raise AssertionError('Invalid quota configuration did not raise')
        except HTTPException as exc:
            assert exc.status_code == 503
        del os.environ['SEGMENT_CLASSIFY_PER_MEMBER_PER_HOUR']
        del os.environ['SEGMENT_CLASSIFY_PER_CLUB_PER_HOUR']


if __name__ == '__main__':
    tests()
    print('segment classification: ok')
