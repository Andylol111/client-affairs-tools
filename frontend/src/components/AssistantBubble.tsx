import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

type Source = { id: number; title: string; owner_user_id: number; project_id?: number | null; project_name?: string | null; visibility: string; current_version: number; index_state?: string | null; character_count?: number; last_error?: string | null };
type Citation = { id: string; document_id: number; title: string; project_name?: string | null };
type PendingAction = { tool: string; args: Record<string, unknown>; summary: string };
type Navigation = { path: string; label: string };
type Lookup = { tool: string; data: unknown };
type AskField = { id: string; label: string; value: string; required: boolean; placeholder?: string };
type Message = {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: Citation[];
  pending_actions?: PendingAction[];
  navigations?: Navigation[];
  lookups?: Lookup[];
  asks?: AskField[];
};
type Thread = { id: number; title: string; updated_at: number };

function lookupLine(item: Lookup) {
  const data = item.data;
  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
    return `${item.tool}: ${String((data as { error: unknown }).error)}`;
  }
  if (item.tool === 'predict_email' && data && typeof data === 'object') {
    const row = data as { best?: string | null; domain?: string; candidates?: string[] };
    if (row.best) {
      const extra = (row.candidates?.length || 0) - 1;
      return `predict_email: ${row.best}${extra > 0 ? ` (+${extra} other form${extra > 1 ? 's' : ''})` : ''}`;
    }
    return `predict_email: no address derived for ${row.domain || 'that domain'}`;
  }
  if (item.tool === 'get_company_pattern' && data && typeof data === 'object') {
    const row = data as {
      domain?: string;
      patterns?: { pattern_template?: string; verified_samples?: number }[];
      total?: number;
    };
    if (Array.isArray(row.patterns)) {
      const best = row.patterns[0];
      if (!best) return `get_company_pattern: no format on record for ${row.domain || 'that domain'}`;
      return `get_company_pattern: ${row.domain || ''} uses ${best.pattern_template} (${best.verified_samples ?? 0} verified)`.trim();
    }
    if (typeof row.total === 'number') return `get_company_pattern: ${row.total} company format(s) on record`;
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'count' in data) {
    return `${item.tool}: ${String((data as { count: unknown }).count)} row(s)`;
  }
  if (Array.isArray(data)) return `${item.tool}: ${data.length} row(s)`;
  if (data && typeof data === 'object' && 'company_name' in data) {
    const row = data as { company_name?: string; status?: string; prospects_count?: number };
    return `${item.tool}: ${row.company_name || 'run'} · ${row.status || ''} · ${row.prospects_count ?? 0} people`.replace(/\s+·\s+$/, '');
  }
  return item.tool;
}

function findPeoplePath(company: string, answers: Record<string, string>, runId?: number) {
  const params = new URLSearchParams({ view: 'company', company });
  if (answers.titles?.trim()) params.set('titles', answers.titles.trim());
  if (answers.company_domain?.trim()) params.set('domain', answers.company_domain.trim());
  if (runId) params.set('run', String(runId));
  return `/scraper?${params.toString()}`;
}

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
  const [answersByMessage, setAnswersByMessage] = useState<Record<number, Record<string, string>>>({});
  const [askError, setAskError] = useState<Record<number, string>>({});
  const composer = useRef<HTMLTextAreaElement>(null);

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

  function answersFor(index: number, message: Message) {
    const seed: Record<string, string> = {};
    for (const field of message.asks || []) seed[field.id] = field.value || '';
    return { ...seed, ...(answersByMessage[index] || {}) };
  }

  function missingRequired(index: number, message: Message) {
    const answers = answersFor(index, message);
    return (message.asks || []).filter((field) => field.required && !answers[field.id]?.trim());
  }

  function fillFindPeople(index: number, message: Message) {
    const action = message.pending_actions?.find((item) => item.tool === 'start_find_people');
    const company = String(action?.args.company_name || '').trim();
    if (!company) {
      const dest = message.navigations?.[0]?.path || '/scraper?view=company';
      navigate(dest);
      return;
    }
    const missing = missingRequired(index, message);
    if (missing.length) {
      setAskError((current) => ({ ...current, [index]: `Answer ${missing.map((field) => field.label.toLowerCase()).join(', ')} before filling Find people.` }));
      return;
    }
    setAskError((current) => ({ ...current, [index]: '' }));
    navigate(findPeoplePath(company, answersFor(index, message)));
  }

  async function ask() {
    const clean = question.trim();
    if (!clean || busy) return;
    setBusy(true); setError(''); setQuestion('');
    if (composer.current) composer.current.style.height = 'auto';
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
        asks: result.asks,
      }]);
      await refresh();
    } catch (err) {
      setMessages((current) => current.slice(0, -1));
      setQuestion(clean);
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  async function confirmAction(action: PendingAction, index: number, message: Message) {
    if (busy) return;
    if (action.tool === 'start_find_people') {
      const missing = missingRequired(index, message);
      if (missing.length) {
        setAskError((current) => ({ ...current, [index]: `Answer ${missing.map((field) => field.label.toLowerCase()).join(', ')} before starting a search.` }));
        return;
      }
    }
    setBusy(true); setError(''); setAskError((current) => ({ ...current, [index]: '' }));
    const answers = answersFor(index, message);
    const args = { ...action.args };
    if (answers.company_domain?.trim()) args.company_domain = answers.company_domain.trim();
    if (answers.titles?.trim()) args.title_hints = answers.titles.trim();
    try {
      const result = await api.assistant.act({ tool: action.tool, args, thread_id: threadId });
      setMessages((current) => {
        const next = current.map((item, messageIndex) => {
          if (messageIndex !== index) return item;
          return { ...item, pending_actions: (item.pending_actions || []).filter((entry) => entry !== action) };
        });
        return [...next, { role: 'assistant', content: result.answer, navigations: result.navigations }];
      });
      if (action.tool === 'start_find_people') {
        const company = String(args.company_name || action.args.company_name || '').trim();
        const runId = Number((result as { result?: { id?: number } }).result?.id);
        navigate(findPeoplePath(company, answers, Number.isFinite(runId) && runId > 0 ? runId : undefined));
      } else {
        const dest = result.navigations?.[0]?.path;
        if (dest) navigate(dest);
      }
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
          className="pointer-events-auto mb-3 flex h-[min(78vh,42rem)] w-[min(100vw-1.5rem,24rem)] flex-col overflow-hidden rounded-2xl border border-pale-sky bg-white shadow-2xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-pale-sky px-4 py-3">
            <div>
              <h2 id="assistant-bubble-title" className="text-sm font-semibold text-deep-navy">Site assistant</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-600">Fills Find people (company-wide search). Person lookup is a different tab for one named person. It cannot send mail.</p>
            </div>
            <button type="button" className="text-xs font-medium text-slate-600 hover:text-deep-navy" onClick={close} aria-label="Close assistant">Close</button>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button type="button" className="shrink-0 rounded-full border border-pale-sky px-2.5 py-1 text-xs" onClick={() => { setThreadId(undefined); setMessages([]); setError(''); setAnswersByMessage({}); }}>New chat</button>
              {threads.slice(0, 6).map((thread) => (
                <button key={thread.id} type="button" className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${thread.id === threadId ? 'border-deep-navy bg-pale-sky/40' : 'border-pale-sky'}`} onClick={() => void openThread(thread.id)}>{thread.title}</button>
              ))}
            </div>
            {!messages.length && (
              <p className="rounded-xl bg-[#f5f7fa] px-3 py-2.5 text-sm leading-6 text-slate-600">
                Ask it to find people at a company. It fills the Find people boxes. Reaching more real people comes from that form, not extra model calls.
              </p>
            )}
            {messages.map((message, index) => (
              <article key={message.id ?? index} className={message.role === 'user' ? 'ml-8 rounded-2xl bg-deep-navy px-3 py-2.5 text-sm leading-6 text-white' : 'mr-2 rounded-2xl border border-pale-sky bg-white px-3 py-2.5 text-sm leading-6 text-deep-navy'}>
                <p className="whitespace-pre-wrap">{message.content}</p>
                {!!message.lookups?.length && message.role === 'assistant' && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {message.lookups
                      .filter((item) => !(item.tool === 'search_contacts' && message.pending_actions?.some((action) => action.tool === 'start_find_people')))
                      .map((item, lookupIndex) => (
                        <li key={`${item.tool}-${lookupIndex}`}>{lookupLine(item)}</li>
                      ))}
                  </ul>
                )}
                {!!message.asks?.length && message.role === 'assistant' && (
                  <div className="mt-3 space-y-2 rounded-xl border border-pale-sky bg-[#f5f7fa] p-3">
                    {message.asks.map((field) => (
                      <label key={field.id} className="block text-xs font-medium text-slate-600">
                        {field.label}{field.required ? ' *' : ''}
                        <input
                          className="mt-1 block w-full rounded-lg border border-pale-sky bg-white px-3 py-2 text-sm text-deep-navy"
                          value={answersFor(index, message)[field.id] || ''}
                          placeholder={field.placeholder}
                          aria-required={field.required}
                          onChange={(event) => {
                            const value = event.target.value;
                            setAnswersByMessage((current) => ({ ...current, [index]: { ...answersFor(index, message), [field.id]: value } }));
                            setAskError((current) => ({ ...current, [index]: '' }));
                          }}
                        />
                      </label>
                    ))}
                    {!!askError[index] && <p role="alert" className="text-xs text-red-700">{askError[index]}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" className="rounded-lg bg-deep-navy px-3 py-2 text-xs font-semibold text-white" onClick={() => fillFindPeople(index, message)}>
                        Fill Find people
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-pale-sky bg-white px-3 py-2 text-xs font-medium text-slate-700"
                        onClick={() => {
                          setAnswersByMessage((current) => ({ ...current, [index]: { ...answersFor(index, message), titles: answersFor(index, message).titles || 'any relevant' } }));
                          setAskError((current) => ({ ...current, [index]: '' }));
                        }}
                      >
                        Skip titles
                      </button>
                    </div>
                  </div>
                )}
                {!!message.pending_actions?.length && (
                  <div className="mt-2 space-y-2">
                    {message.pending_actions.map((action) => (
                      <button
                        key={`${action.tool}-${action.summary}`}
                        type="button"
                        className="block w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-xs font-semibold text-emerald-900 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void confirmAction(action, index, message)}
                      >
                        {action.tool === 'start_find_people' ? `Start search: ${action.summary}` : `Confirm: ${action.summary}`}
                      </button>
                    ))}
                  </div>
                )}
                {!!message.navigations?.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.navigations.map((item) => (
                      <button key={item.path} type="button" className="text-xs font-medium text-steel-blue underline" onClick={() => navigate(item.path)}>{item.label}</button>
                    ))}
                  </div>
                )}
                {!!message.sources?.length && (
                  <div className="mt-2 border-t border-pale-sky pt-2">
                    {message.sources.map((source) => (
                      <Link key={source.id} className="mr-2 text-xs underline" to={`/documents?q=${encodeURIComponent(source.title)}`}>[{source.id}] {source.title}</Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {busy && <p role="status" className="text-xs text-slate-500">Working…</p>}
          </div>
          <div className="border-t border-pale-sky bg-[#f5f7fa] px-3 py-2">
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-700">Optional documents</summary>
              <label className="mt-2 block">Project
                <select className="mt-1 block w-full rounded-lg border border-pale-sky bg-white p-2" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSelected([]); }}>
                  <option value="">All accessible documents</option>
                  {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <div className="mt-2 max-h-24 space-y-2 overflow-auto">
                {sources.filter((source) => !projectId || String(source.project_id) === projectId).map((source) => (
                  <label key={source.id} className="flex gap-2">
                    <input type="checkbox" disabled={source.index_state !== 'ready'} checked={selected.includes(source.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} />
                    <span>{source.title}<small className="block text-slate-500">{source.index_state === 'ready' ? 'Indexed' : 'Not indexed'}</small></span>
                    {source.owner_user_id === user.id && source.current_version && source.index_state !== 'ready' && source.index_state !== 'pending' && source.index_state !== 'indexing' && (
                      <button type="button" className="underline" disabled={busy} aria-label="Index for assistant" onClick={() => void index(source)}>Index</button>
                    )}
                  </label>
                ))}
              </div>
              <Link to="/documents" className="mt-2 inline-block underline">Manage documents</Link>
            </details>
          </div>
          <form className="border-t border-pale-sky p-3" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            {error && <p role="alert" className="mb-2 text-xs text-red-700">{error}</p>}
            <label className="sr-only" htmlFor="assistant-question">Question or task</label>
            <div className="flex items-end gap-2 rounded-2xl border border-pale-sky bg-white px-3 py-2 focus-within:border-steel-blue">
              <textarea
                id="assistant-question"
                ref={composer}
                rows={1}
                className="max-h-24 min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent py-1.5 text-sm leading-5 text-deep-navy outline-none"
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  event.target.style.height = 'auto';
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 96)}px`;
                }}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }}
                placeholder="Find people at Garmin…"
              />
              <button type="submit" className="h-9 shrink-0 rounded-xl bg-deep-navy px-3 text-xs font-semibold text-white disabled:opacity-40" disabled={busy || !question.trim()} aria-label="Send">Send</button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">This hour: {usage.member_requests}/15 of your requests · {usage.club_requests}/120 club requests.</p>
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
        {open ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
            <path d="M20 3H4a2 2 0 00-2 2v11a2 2 0 002 2h3.2L12 22l4.8-4H20a2 2 0 002-2V5a2 2 0 00-2-2zm-4 10H8v-2h8v2zm2-4H6V7h12v2z" />
          </svg>
        )}
      </button>
    </div>
  );
}
