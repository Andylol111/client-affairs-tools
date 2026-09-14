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


async def denied(coro, status):
    try:
        await coro
        raise AssertionError('Operation unexpectedly allowed')
    except HTTPException as exc:
        assert exc.status_code == status, exc


async def run():
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = 'sqlite:///' + tmp + '/operator.db'
        await init_db()
        db = await get_db()
        await db.execute("INSERT INTO users(id,email,role) VALUES(1,'one@yale.edu','standard'),(2,'two@yale.edu','standard')")
        await db.execute("INSERT INTO contacts(id,name,email,title,company,owner_id) VALUES(1,'Ada Lovelace','ada@acme.com','Director','Acme',1)")
        await db.commit()
        await db.close()

        plan = json.dumps({
            "answer": "I can start a Find people run for Acme after you confirm.",
            "reads": [{"tool": "search_contacts", "args": {"q": "Acme"}}],
            "propose": [{"tool": "start_find_people", "args": {"company_name": "Acme", "max_prospects": 250}, "summary": "Find people at Acme (up to 250)"}],
            "open": [{"path": "/scraper", "label": "Find contacts"}],
        })
        with patch.object(assistant_service, 'complete_text', MagicMock(return_value=plan)):
            result = await assistant_service.answer({'id': 1, 'role': 'standard'}, 'Find people at Acme', page_path='/scraper')
        assert result['pending_actions'][0]['tool'] == 'start_find_people'
        assert result['lookups'][0]['data']['count'] == 1
        assert result['navigations'][0]['path'] == '/scraper'
        assert 'ada@acme.com' in json.dumps(result['lookups'])

        runs_before = await assistant_operator.execute_reads({'id': 1, 'role': 'standard'}, [{'tool': 'list_discovery_runs', 'args': {}}])
        assert runs_before[0]['data'] == []

        created = await assistant.act(assistant.ActRequest(tool='start_find_people', args={'company_name': 'Acme', 'max_prospects': 40}), {'id': 1, 'role': 'standard'})
        assert created['ok'] and created['result']['id']
        assert 'Started Find people' in created['answer']

        await denied(assistant.act(assistant.ActRequest(tool='send_mail', args={'to': 'ada@acme.com'}), {'id': 1, 'role': 'standard'}), 422)
        await denied(assistant.act(assistant.ActRequest(tool='delete_contact', args={'id': 1}), {'id': 1, 'role': 'standard'}), 422)
        await denied(assistant_operator.execute_write({'id': 1}, 'clear_contacts', {}), 422)

        leaked = assistant_operator.sanitize_open([{'path': 'https://evil.example', 'label': 'x'}, {'path': '/scraper', 'label': 'Find contacts'}])
        assert leaked == [{'path': '/scraper', 'label': 'Find contacts'}]
        assert assistant_operator.sanitize_propose([{'tool': 'send_mail', 'args': {}}]) == []

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


if __name__ == '__main__':
    asyncio.run(run())
    print('assistant operator: ok')
