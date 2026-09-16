"""The company email-format registry must be browsable, teachable, and usable.

The learner already derived patterns from observed samples, but nothing
exposed them: the endpoint required a domain the member already knew, there
was no prediction call, and the only writable format list was global and
admin-only. These cases pin the three surfaces plus the precedence rule that
observed evidence outranks a stated format.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('JWT_SECRET', 'email-pattern-registry-secret-xxxxxxxx')


def tests() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "t.db"}'
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]

        from fastapi.testclient import TestClient
        from app.database import get_db, init_db
        from app.jwt_utils import create_token
        from app.services.company_email_cache import (
            MEMBER_ASSERTED_CONFIDENCE,
            list_all_domain_patterns,
            set_member_asserted_pattern,
        )
        import main

        asyncio.run(init_db())

        async def seed() -> None:
            db = await get_db()
            try:
                await db.execute(
                    "INSERT INTO users (id,email,name,role,is_active) VALUES (1,'a@yale.edu','A','standard',1)"
                )
                # A well-corroborated learned pattern.
                await db.execute(
                    """INSERT INTO company_email_patterns
                       (company_domain,company_name,pattern_key,pattern_template,confidence,
                        sample_count,verified_samples,sources_json)
                       VALUES ('learned.com','Learned','first.last','{first}.{last}',0.98,40,40,'["web_discovery"]')"""
                )
                await db.commit()
            finally:
                await db.close()

        asyncio.run(seed())
        client = TestClient(main.app)
        client.cookies.set('yucg_session', create_token(1, 'a@yale.edu', 'A', None, 'standard'))

        # Browse: the registry is listable without knowing a domain up front.
        listed = client.get('/api/contacts/email-patterns')
        assert listed.status_code == 200, listed.text[:200]
        body = listed.json()
        assert body['total'] >= 1
        assert any(i['company_domain'] == 'learned.com' for i in body['items'])

        # Search narrows it.
        found = client.get('/api/contacts/email-patterns', params={'q': 'learned'}).json()
        assert found['total'] == 1, found

        # Teach: a member records a format first-hand.
        saved = client.post('/api/contacts/email-patterns', json={
            'domain': 'asserted.com', 'pattern_template': '{first_initial}{last}',
            'company_name': 'Asserted Co',
        })
        assert saved.status_code == 200, saved.text[:200]
        assert saved.json()['pattern_key'] == 'flast', saved.json()

        rows = asyncio.run(list_all_domain_patterns(q='asserted'))['items']
        assert len(rows) == 1
        assert rows[0]['member_asserted'] is True
        assert rows[0]['confidence'] == MEMBER_ASSERTED_CONFIDENCE
        # A stated format is not an observed sample and must not claim to be one.
        assert rows[0]['verified_samples'] == 0

        # A stated format must never outrank corroborated observation.
        asyncio.run(set_member_asserted_pattern(
            'learned.com', '{first_initial}{last}', member_id=1))
        ordered = asyncio.run(list_all_domain_patterns(q='learned.com'))['items']
        top = ordered[0]
        assert top['pattern_key'] == 'first.last', 'observed evidence must stay on top'
        assert top['confidence'] == 0.98

        # Predict: a person at a known-format company resolves through it.
        pred = client.get('/api/contacts/predict-email',
                          params={'name': 'Jane Doe', 'domain': 'learned.com'})
        assert pred.status_code == 200, pred.text[:200]
        out = pred.json()
        assert out['best'] == 'jane.doe@learned.com', out
        assert out['basis'] == 'learned_pattern'
        assert out['patterns_known'] >= 1

        # Rejections stay explicit rather than silently storing junk.
        assert client.post('/api/contacts/email-patterns', json={
            'domain': 'x.com', 'pattern_template': 'no-placeholders'}).status_code == 400
        assert client.get('/api/contacts/predict-email', params={'name': 'Jane Doe'}).status_code == 400

        # A company NAME is not a mail domain. "Learned" must resolve through
        # what is on record instead of producing jane.doe@learned.
        by_name = client.get('/api/contacts/predict-email',
                             params={'name': 'Jane Doe', 'company': 'Learned'}).json()
        assert by_name['domain'] == 'learned.com', by_name
        assert by_name['best'] == 'jane.doe@learned.com', by_name

        # An unresolvable company yields no guess at all, never an address
        # against a hostname that cannot receive mail.
        unknown = client.get('/api/contacts/predict-email',
                             params={'name': 'Jane Doe', 'company': 'Nowhere Partners'}).json()
        assert unknown['basis'] == 'unknown_domain', unknown
        assert unknown['best'] is None, unknown
        assert unknown['candidates'] == [], unknown

        # The same rule guards writes, so the shared registry cannot be keyed
        # to an unmailable hostname.
        rejected = client.post('/api/contacts/email-patterns', json={
            'domain': 'Nowhere Partners', 'pattern_template': '{first}.{last}'})
        assert rejected.status_code == 400, rejected.text[:200]
        assert 'not a mail domain' in rejected.text

        # Send limit is member-adjustable and cannot exceed the club default.
        from app.services.settings_service import member_daily_send_limit
        os.environ['CAMPAIGN_DAILY_SEND_LIMIT'] = '100'
        assert client.put('/api/settings', json={'daily_send_limit': 25}).status_code == 200
        assert asyncio.run(member_daily_send_limit(1)) == 25
        assert client.put('/api/settings', json={'daily_send_limit': 5000}).status_code == 200
        assert asyncio.run(member_daily_send_limit(1)) == 100, 'must clamp to the club ceiling'
        assert client.put('/api/settings', json={'daily_send_limit': 0}).status_code == 400
        assert client.get('/api/settings').json()['daily_send_limit'] == 100


if __name__ == '__main__':
    tests()
    print('email pattern registry: ok')
