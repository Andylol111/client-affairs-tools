import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import PageHeader from '../components/PageHeader';

type Source = { id: number; title: string; owner_user_id: number; project_id?: number | null; project_name?: string | null; visibility: string; current_version: number; index_state?: string | null; character_count?: number; last_error?: string | null };
type Citation = { id: string; document_id: number; title: string; project_name?: string | null };
type Message = { id?: number; role: 'user' | 'assistant'; content: string; sources?: Citation[] };
type Thread = { id: number; title: string; updated_at: number };

export default function Assistant() {
  const { user } = useOutletContext<{ user: { id?: number } }>();
  const [sources,setSources]=useState<Source[]>([]);
  const [threads,setThreads]=useState<Thread[]>([]);
  const [messages,setMessages]=useState<Message[]>([]);
  const [threadId,setThreadId]=useState<number>();
  const [question,setQuestion]=useState('');
  const [projectId,setProjectId]=useState('');
  const [selected,setSelected]=useState<number[]>([]);
  const [usage,setUsage]=useState<{member_requests:number;club_requests:number;member_estimated_usd?:number;club_estimated_usd?:number}>({member_requests:0,club_requests:0});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function refresh() {
    const [nextSources,nextThreads,nextUsage]=await Promise.all([api.assistant.sources(),api.assistant.threads(),api.assistant.usage()]);
    setSources(nextSources); setThreads(nextThreads); setUsage(nextUsage);
  }
  useEffect(()=>{ const timer=window.setTimeout(()=>{void refresh().catch(err=>setError((err as Error).message));},0); return()=>window.clearTimeout(timer); },[]);
  const projects=useMemo(()=>Array.from(new Map(sources.filter(source=>source.project_id && source.project_name).map(source=>[source.project_id!,source.project_name!])).entries()),[sources]);
  const available=sources.filter(source=>source.index_state==='ready' && (!projectId || String(source.project_id)===projectId));

  async function openThread(id:number) {
    setBusy(true); setError('');
    try { setMessages(await api.assistant.messages(id)); setThreadId(id); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function ask() {
    const clean=question.trim(); if (!clean || busy) return;
    setBusy(true); setError(''); setQuestion('');
    setMessages(current=>[...current,{role:'user',content:clean}]);
    try {
      const result=await api.assistant.ask({question:clean,thread_id:threadId,project_id:projectId?Number(projectId):undefined,document_ids:selected});
      setThreadId(result.thread_id);
      setMessages(current=>[...current,{role:'assistant',content:result.answer,sources:result.sources}]);
      await refresh();
    } catch (err) {
      setMessages(current=>current.slice(0,-1)); setQuestion(clean); setError((err as Error).message);
    } finally { setBusy(false); }
  }
  async function index(source:Source) {
    setBusy(true); setError('');
    try { await api.assistant.indexDocument(source.id); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="app-assistant">
    <PageHeader title="Assistant" subtitle="Ask club questions and build work from documents you are allowed to read." />
    <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <aside className="surface-card p-4 h-fit">
        <button className="ui-button ui-button--primary w-full" onClick={()=>{setThreadId(undefined);setMessages([]);setError('');}}>New conversation</button>
        <h2 className="font-semibold mt-5 mb-2">Recent</h2>
        <div className="space-y-1">{threads.map(thread=><button key={thread.id} className={`block w-full text-left rounded px-2 py-2 text-sm ${thread.id===threadId?'bg-pale-sky/40 font-semibold':'hover:bg-pale-sky/20'}`} onClick={()=>void openThread(thread.id)}>{thread.title}</button>)}</div>
        {!threads.length&&<p className="text-sm text-slate-500">No conversations yet.</p>}
      </aside>

      <section className="surface-card min-h-[34rem] flex flex-col" aria-label="Assistant conversation">
        <div className="p-5 border-b border-[var(--border)]">
          <p className="text-sm font-semibold">Claude Haiku 4.5 on Amazon Bedrock</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">Answers are grounded in your selected internal sources. It cannot send mail or change records.</p>
        </div>
        <div className="p-5 flex-1 space-y-4" aria-live="polite">
          {!messages.length&&<div className="max-w-xl"><h2 className="app-section-title">Start with a concrete task</h2><p className="text-slate-600 dark:text-slate-300">Summarize a project brief, find evidence for an outreach angle, compare past work, or turn source material into a reviewable plan.</p></div>}
          {messages.map((message,index)=><article key={message.id??index} className={message.role==='user'?'ml-auto max-w-2xl rounded-xl bg-deep-navy text-white p-4':'max-w-3xl rounded-xl bg-pale-sky/20 border border-[var(--border)] p-4'}>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {!!message.sources?.length&&<div className="mt-3 pt-3 border-t border-[var(--border)]"><p className="text-xs font-semibold uppercase tracking-wide mb-1">Sources used</p>{message.sources.map(source=><Link key={source.id} className="text-sm underline mr-3" to={`/documents?q=${encodeURIComponent(source.title)}`}>[{source.id}] {source.title}</Link>)}</div>}
          </article>)}
          {busy&&<p role="status" className="text-sm text-slate-500">Working from the selected sources…</p>}
        </div>
        <div className="p-5 border-t border-[var(--border)]">
          {error&&<p role="alert" className="ui-notice ui-notice--danger mb-3">{error}</p>}
          <label className="sr-only" htmlFor="assistant-question">Question or task</label>
          <textarea id="assistant-question" rows={3} className="w-full border rounded-lg p-3 bg-white dark:bg-slate-800" value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void ask();}}} placeholder="Ask a question grounded in the selected documents…" />
          <div className="flex justify-between gap-3 items-center mt-2"><p className="text-xs text-slate-500">Enter sends · Shift+Enter adds a line</p><button className="ui-button ui-button--primary" disabled={busy||!question.trim()||!available.length} onClick={()=>void ask()}>Ask assistant</button></div>
        </div>
      </section>

      <aside className="surface-card p-4 h-fit">
        <h2 className="font-semibold">Knowledge scope</h2>
        <label className="block text-sm mt-3">Project<select className="block w-full border rounded p-2 mt-1 bg-white dark:bg-slate-800" value={projectId} onChange={event=>{setProjectId(event.target.value);setSelected([]);}}><option value="">All accessible documents</option>{projects.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <p className="text-xs text-slate-500 mt-3">Select specific sources, or leave all unchecked to search every indexed document in this scope.</p>
        <div className="space-y-3 mt-3 max-h-80 overflow-auto">{sources.filter(source=>!projectId||String(source.project_id)===projectId).map(source=><div key={source.id} className="border-b border-[var(--border)] pb-3">
          <label className="flex gap-2 text-sm"><input type="checkbox" disabled={source.index_state!=='ready'} checked={selected.includes(source.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,source.id]:current.filter(id=>id!==source.id))}/><span>{source.title}<small className="block text-slate-500">{source.index_state==='ready'?`${Math.round((source.character_count||0)/1000)}k characters indexed`:source.current_version?'Not indexed':'Awaiting file'}</small></span></label>
          {source.owner_user_id===user.id&&source.current_version&&source.index_state!=='ready'&&source.index_state!=='pending'&&source.index_state!=='indexing'&&<button className="text-sm underline mt-1" disabled={busy} onClick={()=>void index(source)}>Index for assistant</button>}
          {source.last_error&&<p className="text-xs text-red-700 mt-1">{source.last_error}</p>}
        </div>)}</div>
        <p className="text-xs text-slate-500 mt-4">This hour: {usage.member_requests}/15 of your requests · {usage.club_requests}/120 club requests.</p>
        <p className="text-xs text-slate-500 mt-1">Estimated Bedrock usage: ${(usage.member_estimated_usd||0).toFixed(4)} yours · ${(usage.club_estimated_usd||0).toFixed(4)} club.</p>
        <Link to="/documents" className="ui-button ui-button--secondary w-full mt-3 text-center">Manage documents</Link>
      </aside>
    </div>
  </div>;
}
