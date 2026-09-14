"""Assistant retrieval, indexing, ownership and cost gates without live AWS."""
import asyncio
import io
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock,MagicMock,patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['JWT_SECRET']='assistant-test-secret-xxxxxxxxxxxxxxxx'

from fastapi import HTTPException
from app.database import get_db,init_db
from app.routers import assistant
from app.services import assistant_service


async def denied(coro,status):
    try:
        await coro
        raise AssertionError('Operation unexpectedly allowed')
    except HTTPException as exc:
        assert exc.status_code==status,exc


async def run():
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL']='sqlite:///'+tmp+'/assistant.db'
        await init_db()
        db=await get_db()
        await db.execute("INSERT INTO users(id,email,role) VALUES(1,'one@yale.edu','standard'),(2,'two@yale.edu','standard')")
        await db.execute("INSERT INTO projects(id,name) VALUES(1,'Shared project')")
        await db.execute("INSERT INTO user_project_assignments(user_id,project_id) VALUES(1,1),(2,1)")
        for document_id,title,visibility,project_id in [(1,'Private','private',None),(2,'Project brief','project',1),(3,'Club guide','club',None)]:
            await db.execute('INSERT INTO workspace_documents(id,title,owner_user_id,project_id,visibility,current_version,created_at) VALUES(?,?,?,?,?, ?,1)',(document_id,title,1,project_id,visibility,document_id))
            await db.execute("""INSERT INTO workspace_document_versions(id,document_id,uploaded_by,object_key,filename,byte_size,content_type,state,s3_version_id,storage_bucket,created_at)
                VALUES(?,?,?,?,?,?,?,'ready','v1','private-bucket',1)""",(document_id,document_id,1,f'key-{document_id}',f'{title}.txt',20,'text/plain'))
        await db.commit(); await db.close()

        client=MagicMock()
        client.get_object.return_value={'Body':io.BytesIO(b'Confidential pricing plan and outreach evidence.')}
        with patch('boto3.client',return_value=client):
            indexed=await assistant_service.index_document_version(1)
        assert indexed['state']=='ready' and indexed['chunks']==1
        assert client.get_object.call_args.kwargs['VersionId']=='v1'
        assert assistant_service._chunks('')==[]
        assert len(assistant_service._chunks('A'*1800+'\n'+'B'*1800))==2
        try:
            assistant_service._text_from_bytes(b'binary','application/octet-stream','file.bin')
            raise AssertionError('Unsupported document was indexed')
        except HTTPException as exc:
            assert exc.status_code==415
        await denied(assistant_service.index_document_version(999),404)
        db=await get_db()
        await db.execute('UPDATE workspace_document_versions SET byte_size=? WHERE id=1',(assistant_service.MAX_INDEX_BYTES+1,))
        await db.commit(); await db.close()
        await denied(assistant_service.index_document_version(1),413)
        db=await get_db()
        await db.execute('UPDATE workspace_document_versions SET byte_size=20,storage_bucket=NULL WHERE id=1')
        await db.commit(); await db.close()
        await denied(assistant_service.index_document_version(1),409)
        db=await get_db()
        await db.execute("UPDATE workspace_document_versions SET storage_bucket='private-bucket' WHERE id=1")
        await db.commit(); await db.close()
        empty_client=MagicMock(); empty_client.get_object.return_value={'Body':io.BytesIO(b'   ')}
        with patch('boto3.client',return_value=empty_client):
            await denied(assistant_service.index_document_version(1),422)
        db=await get_db()
        await db.execute("UPDATE assistant_document_indexes SET state='indexing' WHERE version_id=1")
        await db.commit(); await db.close()
        await assistant_service.recover_document_indexes()
        worker=AsyncMock(return_value={'state':'ready'})
        with patch.object(assistant_service,'index_document_version',worker):
            await assistant_service.drain_document_index_queue()
        worker.assert_awaited_once_with(1)
        db=await get_db()
        await db.execute("UPDATE assistant_document_indexes SET state='failed' WHERE version_id=1")
        await db.commit(); await db.close()
        manual=AsyncMock(return_value={'state':'ready'})
        with patch.object(assistant,'index_document_version',manual):
            await assistant.index_document(1,{'id':1})
        manual.assert_awaited_once_with(1)
        assert {source['id'] for source in await assistant_service.accessible_sources(2)}=={2,3}
        await denied(assistant.index_document(1,{'id':2}),404)

        db=await get_db()
        for document_id,text in [(2,'Project Acme needs a healthcare outreach plan.'),(3,'Club policy requires review before release.')]:
            await db.execute("INSERT INTO assistant_document_indexes(version_id,document_id,state,indexed_at,character_count) VALUES(?,?, 'ready',1,?)",(document_id,document_id,len(text)))
            await db.execute("INSERT INTO assistant_document_chunks(document_id,version_id,chunk_index,content) VALUES(?,?,0,?)",(document_id,document_id,text))
        await db.commit(); await db.close()
        completion=MagicMock(return_value='Use the reviewed plan [D2-C1].')
        with patch.object(assistant_service,'complete_text',completion):
            result=await assistant_service.answer({'id':2},'What is the Acme plan?',project_id=1)
        prompt=completion.call_args.args[0]
        assert 'Project Acme' in prompt and 'Confidential pricing' not in prompt
        assert result['sources']==[{'id':'D2-C1','document_id':2,'title':'Project brief','project_name':'Shared project'}]
        assert completion.call_args.kwargs=={'user_id':2,'purpose':'assistant','max_tokens':900}
        await denied(assistant_service.answer({'id':2},'Private pricing',document_ids=[1]),422)

        generated={'answer':'Grounded [D2-C1]','sources':result['sources'],'model':'haiku','grounded':True}
        with patch.object(assistant,'answer',AsyncMock(return_value=generated)):
            first=await assistant.ask(assistant.AskRequest(question='Build a plan'),{'id':2})
            assert first['thread_id']
            second=await assistant.ask(assistant.AskRequest(question='Continue',thread_id=first['thread_id']),{'id':2})
            assert second['thread_id']==first['thread_id']
            await denied(assistant.ask(assistant.AskRequest(question='Steal',thread_id=first['thread_id']),{'id':1}),404)
        messages=await assistant.thread_messages(first['thread_id'],{'id':2})
        assert [message['role'] for message in messages]==['user','assistant','user','assistant']
        await denied(assistant.thread_messages(first['thread_id'],{'id':1}),404)
        db=await get_db()
        await db.execute("INSERT INTO usage_events(user_id,event_type,resource_type,details_json) VALUES(2,'bedrock_reserved','assistant',?)",('{"input_tokens":1000,"output_tokens":200,"status":"completed"}',))
        await db.commit(); await db.close()
        usage=await assistant.usage({'id':2})
        assert usage['member_requests']==2 and usage['club_requests']==2
        assert usage['member_input_tokens']==1000 and usage['member_output_tokens']==200
        assert usage['member_estimated_usd']==0.002


if __name__=='__main__':
    asyncio.run(run())
    print('assistant boundaries: ok')
