"""In-app operator: allowlisted lookups, confirmed writes, no send/delete."""
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['JWT_SECRET'] = 'assistant-operator-secret-xxxxxxxx'

from fastapi import HTTPException
from app.database import get_db, init_db
from app.routers import assistant
from app.services import assistant_operator, assistant_service
from app.services.assistant_operator import (
    _clean_write_args,
    _default_summary,
    _safe_path,
    _trim,
    execute_read,
    execute_reads,
    execute_write,
    parse_operator_payload,
    sanitize_ask,
    sanitize_open,
    sanitize_propose,
    sanitize_reads,
)


async def denied(coro, status):
    try:
        await coro
        raise AssertionError('Operation unexpectedly allowed')
    except HTTPException as exc:
        assert exc.status_code == status, exc


def expect_http(fn, status=422):
    try:
        fn()
        raise AssertionError('Operation unexpectedly allowed')
    except HTTPException as exc:
        assert exc.status_code == status, exc


def test_payload_and_sanitizers():
    assert parse_operator_payload('') is None
    assert parse_operator_payload('not json') is None
    assert parse_operator_payload('{') is None
    assert parse_operator_payload('{"answer":}') is None
    assert parse_operator_payload('[]') is None
    assert parse_operator_payload('{"answer": "  "}') is None
    wrapped = 'Here you go\n{"answer": "Ready", "reads": []}\n'
    assert parse_operator_payload(wrapped)['answer'] == 'Ready'
    like = assistant_service._find_people_payload(
        'help me find people at companies like Niantic'
    )
    assert like['propose'][0]['args']['company_name'] == 'Niantic'
    assert 'offline' not in like['answer'].lower()
    assert assistant_service._named_company('Find people at Garmin') == 'Garmin'
    prompt = assistant_operator.operator_system_prompt()
    assert 'in-app operator' in prompt
    assert 'companies like' in prompt.lower()
    assert 'website harness' in prompt
    assert 'optional' in prompt.lower() or 'fill Find people' in prompt.lower() or 'ask fields' in prompt.lower()
    assert sanitize_ask([{'id': 'titles', 'value': 'VPs'}])[0]['value'] == 'VPs'
    assert sanitize_ask([{'id': 'explode'}]) == []

    prose = assistant_service._merge_operator_payload(
        'Find people at Garmin', '', {'answer': 'Sure, I can help.'}
    )
    assert prose['propose'][0]['args']['company_name'] == 'Garmin'
    assert any(item['id'] == 'titles' for item in prose['ask'])
    last = assistant_service._merge_operator_payload(
        'Import the last run into contacts', '/scraper?view=company&run=7', {'answer': 'Ok'}
    )
    assert last['propose'][0]['tool'] == 'import_run_to_contacts'
    assert last['propose'][0]['args']['run_id'] == 7
    listed = assistant_service._merge_operator_payload('Import the last run', '', {'answer': 'Ok'})
    assert listed['propose'] == []
    assert listed['reads'][0]['tool'] == 'list_discovery_runs'
    opened = assistant_service._merge_operator_payload('take me to pipeline', '', {'answer': ''})
    assert opened['open'][0]['path'] == '/outreach'
    assert 'open that page' in opened['answer'].lower()
    stay = assistant_service._merge_operator_payload('Send the campaign', '', {'answer': 'I will not send mail.', 'propose': [], 'open': []})
    assert stay['propose'] == []
    assert stay['open'] == []

    assert sanitize_reads(None) == []
    assert sanitize_reads('search_contacts') == []
    mixed_reads = [
        'skip',
        {'tool': 'search_contacts', 'args': 'Acme'},
        {'tool': 'send_mail', 'args': {'to': 'x'}},
        {'tool': 'list_companies', 'args': {'q': 'x'}},
        {'tool': 'list_discovery_runs', 'args': {}},
    ]
    cleaned = sanitize_reads(mixed_reads)
    assert [item['tool'] for item in cleaned] == ['search_contacts']
    assert cleaned[0]['args'] == {}
    later = sanitize_reads([
        {'tool': 'not_a_tool'},
        {'tool': 'list_companies', 'args': {'q': 'x'}},
        {'tool': 'list_discovery_runs', 'args': {}},
        {'tool': 'get_discovery_run', 'args': {'run_id': 1}},
    ])
    assert [item['tool'] for item in later] == ['list_companies', 'list_discovery_runs']

    assert sanitize_propose(None) == []
    assert sanitize_propose('start') == []
    assert sanitize_propose([{'tool': 'send_mail', 'args': {}}]) == []
    assert sanitize_propose(['skip', {'tool': 'unknown'}]) == []
    proposed = sanitize_propose([
        {'tool': 'start_find_people', 'args': {'company_name': 'Acme', 'max_prospects': 900, 'company_domain': 'acme.com'}},
        {'tool': 'import_run_to_contacts', 'args': {'run_id': '12'}, 'summary': '  Bring them in  ' + 'x' * 200},
    ])
    assert proposed[0]['args']['max_prospects'] == 800
    assert proposed[0]['args']['company_domain'] == 'acme.com'
    assert proposed[0]['summary'].startswith('Find people at Acme')
    assert proposed[1]['args'] == {'run_id': 12}
    assert len(proposed[1]['summary']) <= 160

    assert sanitize_propose([{'tool': 'start_find_people', 'args': {}}]) == []
    expect_http(lambda: _clean_write_args('start_find_people', {}))
    expect_http(lambda: _clean_write_args('import_run_to_contacts', {}))
    expect_http(lambda: _clean_write_args('import_run_to_contacts', {'run_id': 0}))
    expect_http(lambda: _clean_write_args('explode', {}))
    capped = _clean_write_args('start_find_people', {
        'company_name': '  Acme  ',
        'max_prospects': 'nope',
    })
    assert capped['max_prospects'] == 250
    assert 'linkedin_company_url' not in capped
    floor = _clean_write_args('start_find_people', {'company_name': 'Acme', 'max_prospects': 1})
    assert floor['max_prospects'] == 25

    assert _default_summary('start_find_people', {}) == 'Find people at this company (up to 250)'
    assert _default_summary('import_run_to_contacts', {'run_id': 9}) == 'Import run #9 into Contacts'
    assert _default_summary('other', {}) == 'other'

    assert sanitize_open(None) == []
    assert sanitize_open('/scraper') == []
    assert sanitize_open(['skip', {'path': ''}]) == []
    assert _safe_path('/scraper') == '/scraper'
    assert _safe_path('/campaigns/1') == '/campaigns/1'
    assert _safe_path('/scraper?run=12') == '/scraper?run=12'
    assert _safe_path('/scraper?x=<script>') is None
    assert _safe_path('https://example.com') is None
    assert _safe_path('//evil.example') is None
    assert _safe_path('/scraper\\x') is None
    assert _safe_path('/admin') is None
    assert _safe_path('scraper') is None
    opened = sanitize_open([
        {'path': 'https://evil.example', 'label': 'x'},
        {'path': '/scraper'},
        {'path': '/outreach?tab=pipeline', 'label': 'Pipeline'},
        {'path': '/documents', 'label': 'Docs'},
        {'path': '/studio', 'label': 'Drafts'},
        {'path': '/admin', 'label': 'Admin'},
    ])
    assert opened[0] == {'path': '/scraper', 'label': 'Find contacts'}
    assert opened[1]['path'].startswith('/outreach')
    assert [item['path'] for item in opened] == ['/scraper', '/outreach?tab=pipeline', '/documents']
    extra = sanitize_open([
        {'path': '/studio', 'label': 'Drafts'},
        {'path': '/analytics', 'label': 'Results'},
        {'path': '/', 'label': 'Home'},
        {'path': '/yucgoutreach', 'label': 'Targets'},
        {'path': '/campaigns/1', 'label': 'Campaign'},
    ])
    assert len(extra) == 4

    assert _trim({'ok': True}) == {'ok': True}
    huge = _trim({'blob': 'n' * 3000}, limit=40)
    assert huge['truncated'] is True
    assert huge['preview'].startswith('{')


async def run():
    test_payload_and_sanitizers()
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = 'sqlite:///' + tmp + '/operator.db'
        await init_db()
        db = await get_db()
        await db.execute("INSERT INTO users(id,email,role) VALUES(1,'one@yale.edu','standard'),(2,'two@yale.edu','standard'),(3,'admin@yale.edu','admin')")
        await db.execute("INSERT INTO contacts(id,name,email,title,company,owner_id) VALUES(1,'Ada Lovelace','ada@acme.com','Director','Acme',1)")
        await db.execute("INSERT INTO contacts(id,name,email,title,company,owner_id) VALUES(2,'Hidden Other','other@beta.com','Lead','Beta',2)")
        await db.execute("INSERT INTO contacts(id,name,email,title,company,owner_id) VALUES(3,'No Company','solo@yale.edu','Fellow','',1)")
        await db.execute(
            """INSERT INTO yucgoutreach_discovery_runs(id,user_id,company_name,company_domain,status,progress_pct,progress_message,prospects_count,max_prospects)
               VALUES(7,1,'Acme','acme.com','completed',100,'Done',1,40)"""
        )
        await db.execute(
            """INSERT INTO yucgoutreach_prospects(run_id,first_name,last_name,title,email,score)
               VALUES(7,'Ada','Lovelace','Director','ada@acme.com',9.5)"""
        )
        await db.commit()
        await db.close()

        acme_plan = json.dumps(assistant_service._find_people_payload('Find people at Acme'))
        with patch.object(assistant_service, 'complete_text', MagicMock(return_value=acme_plan)) as acme_llm:
            result = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'Find people at Acme', page_path='/scraper')
        acme_llm.assert_called_once()
        assert 'Find people at Acme' in acme_llm.call_args.args[0]
        assert result['pending_actions'][0]['tool'] == 'start_find_people'
        assert result['lookups'][0]['data']['count'] == 1
        assert result['navigations'][0]['path'].startswith('/scraper?')
        assert 'company=Acme' in result['navigations'][0]['path']
        assert result['asks'][0]['id'] == 'titles'
        assert result['asks'][0]['required'] is True
        assert 'ada@acme.com' in json.dumps(result['lookups'])
        assert 'haiku' in result['model']

        garmin_q = 'help me find people at Garmin to reach out to, VPs, execs in project management'
        garmin_plan = json.dumps(assistant_service._find_people_payload(garmin_q))
        with patch.object(assistant_service, 'complete_text', MagicMock(return_value=garmin_plan)) as garmin_llm:
            garmin = await assistant_service.answer({'id': 1, 'role': 'standard'}, garmin_q)
        garmin_llm.assert_called_once()
        assert garmin['pending_actions'][0]['args']['company_name'] == 'Garmin'
        assert garmin['pending_actions'][0]['args'].get('title_hints')
        titles = next(item['value'] for item in garmin['asks'] if item['id'] == 'titles')
        assert 'VP' in titles and 'exec' in titles.lower()
        assert 'Looked up: search_contacts' not in garmin['answer']
        assert 'not the live search' in garmin['answer']
        assert 'titles=' in garmin['navigations'][0]['path']
        assert garmin['asks'][0]['required'] is True

        with patch.object(assistant_service, 'complete_text', MagicMock(return_value='Sure, I can help with that.')):
            prose = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'Find people at Garmin')
        assert prose['pending_actions'][0]['args']['company_name'] == 'Garmin'
        assert prose['asks'][0]['id'] == 'titles'

        with patch.object(assistant_service, 'complete_text', MagicMock(return_value='I can import that after you confirm.')):
            importing = await assistant_service.answer(
                {'id': 1, 'role': 'standard'},
                'Import run 7 into contacts',
                page_path='/scraper?view=company&run=7',
            )
        assert importing['pending_actions'][0]['tool'] == 'import_run_to_contacts'
        assert importing['pending_actions'][0]['args']['run_id'] == 7
        assert importing['lookups'][0]['tool'] == 'get_discovery_run'

        with patch.object(assistant_service, 'complete_text', MagicMock(return_value='I can import the latest completed run.')):
            latest = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'Import the last run into contacts')
        assert latest['pending_actions'][0]['args']['run_id'] == 7
        assert latest['navigations'][0]['path'] == '/outreach'

        with patch.object(assistant_service, 'complete_text', MagicMock(return_value='Opening Pipeline.')):
            jump = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'take me to pipeline')
        assert jump['navigations'][0]['path'] == '/outreach'
        assert jump['pending_actions'] == []

        with patch.object(assistant, 'answer', AsyncMock(return_value={
            'answer': 'Confirm Acme',
            'sources': [],
            'model': 'haiku',
            'grounded': False,
            'lookups': [],
            'pending_actions': [{
                'tool': 'start_find_people',
                'args': {'company_name': 'Acme', 'max_prospects': 250},
                'summary': 'Find people at Acme (up to 250)',
            }],
            'navigations': [{'path': '/scraper?view=company&company=Acme', 'label': 'Find people'}],
            'asks': [{'id': 'titles', 'label': 'Titles', 'value': '', 'required': True, 'placeholder': 'VPs'}],
        })):
            asked = await assistant.ask(assistant.AskRequest(question='Find people at Acme'), {'id': 1, 'role': 'standard'})
        stored = await assistant.thread_messages(asked['thread_id'], {'id': 1})
        assert stored[1]['pending_actions'][0]['tool'] == 'start_find_people'
        assert stored[1]['asks'][0]['id'] == 'titles'
        with patch('app.routers.yucgoutreach.import_run_to_contacts', AsyncMock(return_value={'created': 0, 'updated': 0, 'skipped': 0})):
            await assistant.act(
                assistant.ActRequest(tool='import_run_to_contacts', args={'run_id': 7}, thread_id=asked['thread_id']),
                {'id': 1, 'role': 'standard'},
            )
        after = await assistant.thread_messages(asked['thread_id'], {'id': 1})
        assert after[1]['pending_actions'] == []
        assert after[-1]['navigations'][0]['path'] == '/outreach'

        from fastapi import HTTPException as FastAPIHTTPException
        with patch.object(assistant_service, 'complete_text', MagicMock(side_effect=FastAPIHTTPException(503, 'The language model is unavailable right now.'))):
            offline = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'What should I do on Pipeline?')
        assert 'couldn\'t complete' in offline['answer'].lower()
        assert 'company' in offline['answer'].lower()
        assert offline['model'] == 'site-tools'
        with patch.object(assistant_service, 'complete_text', MagicMock(side_effect=FastAPIHTTPException(503, 'The language model is unavailable right now.'))):
            fallback = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'help me find people at companies like Niantic')
        assert fallback['pending_actions'][0]['args']['company_name'] == 'Niantic'

        runs_before = await execute_reads({'id': 1, 'role': 'standard'}, [{'tool': 'list_discovery_runs', 'args': {}}])
        assert runs_before[0]['data'][0]['id'] == 7

        created = await assistant.act(assistant.ActRequest(tool='start_find_people', args={'company_name': 'Acme', 'max_prospects': 40, 'title_hints': 'VPs'}), {'id': 1, 'role': 'standard'})
        assert created['ok'] and created['result']['id']
        assert 'Started Find people' in created['answer']
        assert 'view=company' in created['navigations'][0]['path']
        assert 'company=Acme' in created['navigations'][0]['path']
        assert f"run={created['result']['id']}" in created['navigations'][0]['path']

        await denied(assistant.act(assistant.ActRequest(tool='send_mail', args={'to': 'ada@acme.com'}), {'id': 1, 'role': 'standard'}), 422)
        await denied(assistant.act(assistant.ActRequest(tool='delete_contact', args={'id': 1}), {'id': 1, 'role': 'standard'}), 422)
        await denied(execute_write({'id': 1}, 'clear_contacts', {}), 422)

        leaked = sanitize_open([{'path': 'https://evil.example', 'label': 'x'}, {'path': '/scraper', 'label': 'Find contacts'}])
        assert leaked == [{'path': '/scraper', 'label': 'Find contacts'}]
        assert sanitize_propose([{'tool': 'send_mail', 'args': {}}]) == []

        forbidden_plan = json.dumps({
            "answer": "I will not send mail.",
            "reads": [{"tool": "send_mail", "args": {}}],
            "propose": [{"tool": "delete_run", "args": {"run_id": 1}}],
            "open": [{"path": "/admin", "label": "Admin"}],
        })
        with patch.object(assistant_service, 'complete_text', MagicMock(return_value=forbidden_plan)):
            blocked = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'Send the campaign')
        assert blocked['pending_actions'] == []
        assert blocked['lookups'] == []
        assert blocked['navigations'] == []

        companies = await execute_read({'id': 1, 'role': 'standard'}, 'list_companies', {})
        assert any(row['company'] == 'Acme' for row in companies)
        assert all(row['company'] != 'Beta' for row in companies)
        admin_companies = await execute_read({'id': 3, 'role': 'admin'}, 'list_companies', {})
        assert {row['company'] for row in admin_companies} >= {'Acme', 'Beta'}

        owned = await execute_read({'id': 1, 'role': 'standard'}, 'search_contacts', {'company': 'Ada'})
        assert owned['count'] == 1
        admin_all = await execute_read({'id': 3, 'role': 'admin'}, 'search_contacts', {})
        assert admin_all['count'] >= 2

        missing_run = await execute_read({'id': 1, 'role': 'standard'}, 'get_discovery_run', {})
        assert missing_run == {'error': 'run_id required'}
        absent = await execute_read({'id': 1, 'role': 'standard'}, 'get_discovery_run', {'run_id': 99})
        assert absent == {'error': 'Run not found'}
        present = await execute_read({'id': 1, 'role': 'standard'}, 'get_discovery_run', {'run_id': 7})
        assert present['company_name'] == 'Acme'
        assert present['sample'][0]['first_name'] == 'Ada'
        other = await execute_read({'id': 2, 'role': 'standard'}, 'get_discovery_run', {'run_id': 7})
        assert other == {'error': 'Run not found'}

        with patch('app.services.prospect_coordinator.recommend_prospects', return_value=[
            {'prospect': {'company': 'Acme', 'sector': 'Tech', 'recommended_message_angle': 'Alumni'}},
        ]):
            recs = await execute_read({'id': 1, 'role': 'standard'}, 'recommend_companies', {'n': 'bad'})
        assert recs[0]['company'] == 'Acme'
        with patch('app.services.prospect_coordinator.recommend_prospects', return_value=[]):
            empty = await execute_read({'id': 1, 'role': 'standard'}, 'recommend_companies', {'n': 3})
        assert empty == []

        unnamed = await execute_read({'id': 1, 'role': 'standard'}, 'search_person', {})
        assert unnamed == {'error': 'name required'}
        with patch('app.routers.contacts.search_person', AsyncMock(return_value={'name': 'Ada', 'hits': 1})):
            person = await execute_read({'id': 1, 'role': 'standard'}, 'search_person', {'name': 'Ada', 'company': 'Acme'})
        assert person['name'] == 'Ada'
        await denied(execute_read({'id': 1, 'role': 'standard'}, 'send_mail', {}), 422)

        mixed = await execute_reads({'id': 1, 'role': 'standard'}, [
            {'tool': 'send_mail', 'args': {}},
            {'tool': 'list_companies', 'args': {}},
        ])
        assert mixed[0]['data']['error']
        assert isinstance(mixed[1]['data'], list)
        with patch.object(assistant_operator, 'execute_read', AsyncMock(side_effect=RuntimeError('boom'))):
            crashed = await execute_reads({'id': 1}, [{'tool': 'list_companies', 'args': {}}])
        assert 'boom' in crashed[0]['data']['error']

        with patch('app.routers.yucgoutreach.import_run_to_contacts', AsyncMock(return_value={'created': 1, 'updated': 0, 'skipped': 2})):
            imported = await execute_write({'id': 1, 'role': 'standard'}, 'import_run_to_contacts', {'run_id': 7})
        assert imported['ok'] is True
        assert 'Imported into Contacts: 1 new' in imported['answer']
        assert imported['navigations'][0]['path'] == '/outreach'


if __name__ == '__main__':
    asyncio.run(run())
    print('assistant operator: ok')
