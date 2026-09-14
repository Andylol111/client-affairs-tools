import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

type Source = { id: number; title: string; owner_user_id: number; project_id?: number | null; project_name?: string | null; visibility: string; current_version: number; index_state?: string | null; character_count?: number; last_error?: string | null };
type Citation = { id: string; document_id: number; title: string; project_name?: string | null };
type PendingAction = { tool: string; args: Record<string, unknown>; summary: string };
type Navigation = { path: string; label: string };
type Lookup = { tool: string; data: unknown };
type Message = {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: Citation[];
  pending_actions?: PendingAction[];
  navigations?: Navigation[];
  lookups?: Lookup[];
};
type Thread = { id: number; title: string; updated_at: number };

export default function AssistantBubble({ user }: { user: { id?: number } }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const requested = params.get('assistant') === '1';
  const [manualOpen, setManualOpen] = useState(false);
  const open = requested || manualOpen;
  const [sources, setSources] = useState<Source[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<number>();
  const [question, setQuestion] = useState('');
  const [projectId, setProjectId] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [usage, setUsage] = useState({ member_requests: 0, club_requests: 0, member_estimated_usd: 0, club_estimated_usd: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const [nextSources, nextThreads, nextUsage] = await Promise.all([
      api.assistant.sources(),
      api.assistant.threads(),
      api.assistant.usage(),
    ]);
    setSources(nextSources);
    setThreads(nextThreads);
    setUsage({
      member_requests: nextUsage.member_requests,
      club_requests: nextUsage.club_requests,
      member_estimated_usd: nextUsage.member_estimated_usd,
      club_estimated_usd: nextUsage.club_estimated_usd,
    });
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void refresh().catch((err) => setError((err as Error).message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const projects = useMemo(
    () => Array.from(new Map(sources.filter((source) => source.project_id && source.project_name).map((source) => [source.project_id!, source.project_name!])).entries()),
    [sources],
  );

  const close = () => {
    setManualOpen(false);
    if (requested) {
      const next = new URLSearchParams(params);
      next.delete('assistant');
      setParams(next, { replace: true });
    }
  };

  async function openThread(id: number) {
    setBusy(true); setError('');
    try { setMessages(await api.assistant.messages(id)); setThreadId(id); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function ask() {
    const clean = question.trim();
    if (!clean || busy) return;
    setBusy(true); setError(''); setQuestion('');
    setMessages((current) => [...current, { role: 'user', content: clean }]);
    try {
      const result = await api.assistant.ask({
        question: clean,
        thread_id: threadId,
        project_id: projectId ? Number(projectId) : undefined,
        document_ids: selected,
        page_path: `${location.pathname}${location.search}`,
      });
      setThreadId(result.thread_id);
      setMessages((current) => [...current, {
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        pending_actions: result.pending_actions,
        navigations: result.navigations,
        lookups: result.lookups,
      }]);
      await refresh();
    } catch (err) {
      setMessages((current) => current.slice(0, -1));
      setQuestion(clean);
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  async function confirmAction(action: PendingAction, index: number) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.assistant.act({ tool: action.tool, args: action.args, thread_id: threadId });
      setMessages((current) => {
        const next = current.map((message, messageIndex) => {
          if (messageIndex !== index) return message;
          return { ...message, pending_actions: (message.pending_actions || []).filter((item) => item !== action) };
        });
        return [...next, { role: 'assistant', content: result.answer, navigations: result.navigations }];
      });
      const dest = result.navigations?.[0]?.path;
      if (dest) navigate(dest);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  async function index(source: Source) {
    setBusy(true); setError('');
    try { await api.assistant.indexDocument(source.id); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="assistant-bubble pointer-events-none fixed z-[60] right-4 bottom-20 lg:bottom-5">
      {open && (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="assistant-bubble-title"
          className="pointer-events-auto mb-3 w-[min(100vw-2rem,26rem)] h-[min(70vh,36rem)] bg-white border border-pale-sky rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          <header className="px-4 py-3 border-b border-pale-sky flex items-start justify-between gap-3">
            <div>
              <h2 id="assistant-bubble-title" className="text-sm font-semibold text-deep-navy">Assistant</h2>
              <p className="text-xs text-slate-600">Looks up contacts and can start Find people after you confirm. It cannot send mail or delete records.</p>
            </div>
            <button type="button" className="text-sm text-slate-600 hover:text-deep-navy" onClick={close} aria-label="Close assistant">Close</button>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" aria-live="polite">
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button type="button" className="shrink-0 text-xs rounded-full border border-pale-sky px-2 py-1" onClick={() => { setThreadId(undefined); setMessages([]); setError(''); }}>New chat</button>
              {threads.slice(0, 6).map((thread) => (
                <button key={thread.id} type="button" className={`shrink-0 text-xs rounded-full border px-2 py-1 ${thread.id === threadId ? 'border-deep-navy bg-pale-sky/40' : 'border-pale-sky'}`} onClick={() => void openThread(thread.id)}>{thread.title}</button>
              ))}
            </div>
            {!messages.length && <p className="text-sm text-slate-600">Ask it to find people at a company, check saved contacts, or open Pipeline. Writes wait for a confirm button.</p>}
            {messages.map((message, index) => (
              <article key={message.id ?? index} className={message.role === 'user' ? 'ml-6 rounded-xl bg-deep-navy text-white p-3 text-sm whitespace-pre-wrap' : 'mr-2 rounded-xl bg-pale-sky/20 border border-pale-sky p-3 text-sm whitespace-pre-wrap'}>
                {message.content}
                {!!message.lookups?.length && (
                  <p className="mt-2 text-xs text-slate-600">Looked up {message.lookups.map((item) => item.tool.replaceAll('_', ' ')).join(', ')}.</p>
                )}
                {!!message.pending_actions?.length && (
                  <div className="mt-2 space-y-2">
                    {message.pending_actions.map((action) => (
                      <button
                        key={`${action.tool}-${action.summary}`}
                        type="button"
                        className="block w-full text-left rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900"
                        disabled={busy}
                        onClick={() => void confirmAction(action, index)}
                      >
                        Confirm: {action.summary}
                      </button>
                    ))}
                  </div>
                )}
                {!!message.navigations?.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.navigations.map((item) => (
                      <button key={item.path} type="button" className="text-xs underline" onClick={() => navigate(item.path)}>{item.label}</button>
                    ))}
                  </div>
                )}
                {!!message.sources?.length && (
                  <div className="mt-2 pt-2 border-t border-white/20">
                    {message.sources.map((source) => (
                      <Link key={source.id} className="underline mr-2" to={`/documents?q=${encodeURIComponent(source.title)}`}>[{source.id}] {source.title}</Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {busy && <p role="status" className="text-xs text-slate-500">Working…</p>}
            <label className="block text-xs text-slate-600">Project
              <select className="mt-1 block w-full border border-pale-sky rounded-lg p-2 bg-white" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSelected([]); }}>
                <option value="">All accessible documents</option>
                {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="max-h-28 overflow-auto space-y-2">
              {sources.filter((source) => !projectId || String(source.project_id) === projectId).map((source) => (
                <label key={source.id} className="flex gap-2 text-xs">
                  <input type="checkbox" disabled={source.index_state !== 'ready'} checked={selected.includes(source.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} />
                  <span>{source.title}<small className="block text-slate-500">{source.index_state === 'ready' ? 'Indexed' : 'Not indexed'}</small></span>
                  {source.owner_user_id === user.id && source.current_version && source.index_state !== 'ready' && source.index_state !== 'pending' && source.index_state !== 'indexing' && (
                    <button type="button" className="underline" disabled={busy} onClick={() => void index(source)}>Index for assistant</button>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">This hour: {usage.member_requests}/15 of your requests · {usage.club_requests}/120 club requests.</p>
          </div>
          <form className="border-t border-pale-sky p-3" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            {error && <p role="alert" className="text-xs text-red-700 mb-2">{error}</p>}
            <label className="sr-only" htmlFor="assistant-question">Question or task</label>
            <textarea id="assistant-question" rows={2} className="w-full border border-pale-sky rounded-lg p-2 text-sm" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Find people at a company, check contacts, or ask about a document…" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <Link to="/documents" className="text-xs underline text-slate-600">Manage documents</Link>
              <button type="submit" className="ui-button ui-button--primary" disabled={busy || !question.trim()}>Ask assistant</button>
            </div>
          </form>
        </section>
      )}
      <button
        type="button"
        className="pointer-events-auto ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-deep-navy text-white shadow-lg hover:opacity-90"
        aria-label={open ? 'Assistant is open' : 'Open assistant'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setManualOpen(true))}
      >
        AI
      </button>
    </div>
  );
}
