"""Company-specific role suggestions: grounded in titles the system has
observed (SEC roster, prior runs, shared contacts), filled from one
LinkedIn search when thin, and an equivalence mapping that can only pick
from observed titles - never invent one.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('JWT_SECRET', 'role-suggestions-secret-xxxxxxxxxxxxxxxxx')


def tests() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "t.db"}'
        os.environ['LLM_PROVIDER'] = 'bedrock'
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]

        from app.database import get_db, init_db
        from app.services import role_suggestions as rs

        asyncio.run(init_db())

        # --- pure title normalisation from LinkedIn result headlines ---
        assert rs.title_from_search_result('Jane Doe - Product Lead at Anthropic | LinkedIn') == 'Product Lead'
        assert rs.title_from_search_result('John Q. Public – Member of Technical Staff – OpenAI') == 'Member of Technical Staff'
        assert rs.title_from_search_result('Ada Lovelace - VP, Healthcare Partnerships - OpenAI | LinkedIn') == 'VP, Healthcare Partnerships'
        assert rs.title_from_search_result('OpenAI | LinkedIn') == ''          # company page, no person
        assert rs.title_from_search_result('Someone - 2019 - LinkedIn') == ''   # no letters in the title slot
        assert rs.normalize_title('VP Product at Acme') == 'VP Product'
        assert rs.normalize_title('  ') == ''
        # Stored prospect titles are often raw headlines / non-titles seen live.
        assert rs.normalize_title('Taylor Gordon - Member of Technical Staff', 'OpenAI') == 'Member of Technical Staff'
        assert rs.normalize_title('OpenAI', 'OpenAI') == ''                    # the company itself
        assert rs.normalize_title('YouTube', 'OpenAI') == ''
        assert rs.normalize_title('Leadership vs. Management - What it means ...', 'OpenAI') == ''
        assert rs.normalize_title('The Net Zero Asset Managers initiative', 'Anthropic') == ''
        # Job postings are the company's own vocabulary.
        assert rs.title_from_job_posting('Product Manager, Business Technology at Anthropic - LinkedIn', 'Anthropic') == 'Product Manager, Business Technology'
        assert rs.title_from_job_posting('Web Product Manager at Anthropic — New York, NY - Jobs - LinkedIn', 'Anthropic') == 'Web Product Manager'
        assert rs.title_from_job_posting('Research Product Manager, Model Behaviors - LinkedIn', 'Anthropic') == 'Research Product Manager, Model Behaviors'
        assert rs.title_from_job_posting('Anthropic: Jobs - LinkedIn', 'Anthropic') == ''
        assert rs.title_from_job_posting('Anthropic hiring Product Management, Research in San Francisco, CA - LinkedIn', 'Anthropic') == 'Product Management, Research'

        async def seed() -> None:
            db = await get_db()
            try:
                await db.execute("INSERT INTO users (id, email, name, is_active) VALUES (1, 'a@yale.edu', 'A', 1)")
                # SEC roster: two officers.
                await db.execute(
                    "INSERT INTO company_rosters (company_key, company_name, company_domain, next_verify_at, created_at, updated_at) "
                    "VALUES ('openai', 'OpenAI', 'openai.com', '2026-01-01', '2026-01-01', '2026-01-01')")
                for name, title in [('Sam A', 'Chief Executive Officer'), ('Brad L', 'Chief Operating Officer')]:
                    await db.execute(
                        "INSERT INTO company_roster_people (roster_id, normalized_name, full_name, title, source, first_seen_at, last_seen_at) "
                        "VALUES (1, ?, ?, ?, 'sec', '2026-01-01', '2026-01-01')", (name.lower(), name, title))
                # A prior Find people run with three prospects (one title repeated).
                cur = await db.execute(
                    "INSERT INTO yucgoutreach_discovery_runs (user_id, company_name, company_domain, max_prospects, worker_concurrency, status) "
                    "VALUES (1, 'OpenAI', 'openai.com', 50, 4, 'completed')")
                run_id = cur.lastrowid
                for title in ['Member of Technical Staff', 'Member of Technical Staff', 'Head of Health AI']:
                    await db.execute(
                        "INSERT INTO yucgoutreach_prospects (run_id, first_name, last_name, email, title) VALUES (?, 'X', 'Y', ?, ?)",
                        (run_id, f'{title.replace(" ", "").lower()}@openai.com', title))
                # Shared catalog contact at the company.
                await db.execute(
                    "INSERT INTO contacts (name, email, title, company, company_domain) VALUES ('Z', 'z@openai.com', 'Product Lead', 'OpenAI', 'openai.com')")
                await db.commit()
            finally:
                await db.close()

        asyncio.run(seed())

        observed = asyncio.run(rs.observed_titles('OpenAI', 'openai.com'))
        by_title = {o['title']: o for o in observed}
        assert by_title['Member of Technical Staff']['count'] == 2 and by_title['Member of Technical Staff']['source'] == 'run'
        assert by_title['Chief Executive Officer']['source'] == 'roster'
        assert by_title['Product Lead']['source'] == 'catalog'
        assert observed[0]['title'] == 'Member of Technical Staff'  # most common first

        # --- search fill happens when observed is thin or hints are given;
        # LLM equivalents are constrained to observed titles ---
        search_calls: list[str] = []

        async def fake_search(query, max_results=8, user_id=None):
            search_calls.append(query)
            return [
                {'title': 'Pat K - Product Lead at OpenAI | LinkedIn', 'url': 'https://www.linkedin.com/in/patk', 'content': ''},
                {'title': 'Lee M - Product Lead - OpenAI', 'url': 'https://www.linkedin.com/in/leem', 'content': ''},
                {'title': 'Ana R - Healthcare Go-To-Market Lead at OpenAI', 'url': 'https://www.linkedin.com/in/anar', 'content': ''},
                {'title': 'OpenAI | LinkedIn', 'url': 'https://www.linkedin.com/company/openai', 'content': ''},
                {'title': 'Product Manager, Health at OpenAI - LinkedIn', 'url': 'https://www.linkedin.com/jobs/view/pm-health-123', 'content': ''},
                {'title': "Someone's Post - Product Lead, Consumer - LinkedIn", 'url': 'https://www.linkedin.com/posts/someone_x', 'content': ''},
            ]

        llm_prompts: list[str] = []

        def fake_complete_json(prompt, model_id=None, system=None):
            llm_prompts.append(prompt)
            return {'equivalents': [
                {'asked': 'healthcare PMs', 'at_company': ['Product Lead', 'Healthcare Go-To-Market Lead', 'Chief Product Officer'],
                 'note': 'OpenAI does not use the PM title; product roles are Product Lead.'},
                {'asked': 'VPs', 'at_company': [], 'note': 'No VP titles observed; senior leaders are C-level.'},
            ]}

        with patch('app.services.web_fetch.web_search', fake_search), \
             patch('app.services.web_fetch.web_search_configured', lambda: True), \
             patch('app.services.llm.complete_json', fake_complete_json):
            result = asyncio.run(rs.suggest_roles(user_id=1, company='OpenAI', domain='openai.com', hints='healthcare PMs, VPs'))

        assert search_calls == ['OpenAI healthcare PMs, VPs site:linkedin.com/in']  # plain words, no quotes/OR
        titles = [r['title'] for r in result['roles']]
        assert 'Product Lead' in titles and 'Healthcare Go-To-Market Lead' in titles
        assert 'OpenAI' not in titles  # company page headline never becomes a role
        assert 'Product Manager, Health' in titles and next(r for r in result['roles'] if r['title'] == 'Product Manager, Health')['source'] == 'jobs'
        assert 'Product Lead, Consumer' not in titles  # /posts/ are not evidence of a role held
        # Product Lead: 1 catalog + 2 search = 3, so it now outranks the roster officers.
        assert next(r for r in result['roles'] if r['title'] == 'Product Lead')['count'] == 3
        assert next(r for r in result['roles'] if r['title'] == 'Product Lead')['source'] == 'catalog'

        eq = {e['asked']: e for e in result['equivalents']}
        # 'Chief Product Officer' was never observed - the model's suggestion of it is dropped.
        assert eq['healthcare PMs']['at_company'] == ['Product Lead', 'Healthcare Go-To-Market Lead']
        assert 'Product Lead' in eq['healthcare PMs']['note']
        assert eq['VPs']['at_company'] == []
        assert 'Member of Technical Staff' in llm_prompts[0] and 'choose ONLY from these' in llm_prompts[0]
        assert result['sources'] == {'run': 2, 'roster': 2, 'catalog': 1, 'search': 2, 'jobs': 1}  # distinct titles per source

        # --- no hints and enough observed titles: no search, no model call ---
        search_calls.clear()
        llm_prompts.clear()
        with patch('app.services.web_fetch.web_search', fake_search), \
             patch('app.services.web_fetch.web_search_configured', lambda: True), \
             patch('app.services.llm.complete_json', fake_complete_json):
            quiet = asyncio.run(rs.suggest_roles(user_id=1, company='OpenAI', domain='openai.com', hints=None))
        # 5 distinct observed titles (< threshold 6) -> one fill search, but no LLM without hints.
        assert len(search_calls) == 1
        assert llm_prompts == []
        assert quiet['equivalents'] == []

        # --- unknown company, search unavailable: empty but well-formed ---
        with patch('app.services.web_fetch.web_search_configured', lambda: False):
            empty = asyncio.run(rs.suggest_roles(user_id=1, company='Nonexistent Widgets', domain=None, hints=None))
        assert empty['roles'] == [] and empty['equivalents'] == []
        assert 'not configured' in empty['note']

        # --- quota exhausted mid-request: honest note, observed titles still returned ---
        from fastapi import HTTPException

        async def quota_search(query, max_results=8, user_id=None):
            raise HTTPException(429, 'Web search limit reached. Please try again later.')

        with patch('app.services.web_fetch.web_search', quota_search), \
             patch('app.services.web_fetch.web_search_configured', lambda: True):
            limited = asyncio.run(rs.suggest_roles(user_id=1, company='OpenAI', domain='openai.com', hints=None))
        assert limited['note'].startswith('Web search limit reached')
        assert any(r['title'] == 'Member of Technical Staff' for r in limited['roles'])


if __name__ == '__main__':
    tests()
    print('role suggestions: ok')
