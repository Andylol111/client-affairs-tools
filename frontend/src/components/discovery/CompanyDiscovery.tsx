import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type OutreachFlow } from '../../api';
import CompanyAutocomplete, { CompanySuggestions, type CompanyOption } from '../CompanyAutocomplete';
import { legacyMailboxLabel } from '../../lib/contactEvidence';
import OutreachFlowTracker from './OutreachFlowTracker';

type RunRow = {
  id: number;
  company_name: string;
  status: string;
  progress_pct?: number;
  progress_message?: string;
  prospects_count?: number;
  max_prospects?: number;
  error_message?: string;
  created_at?: string;
};

type DiscoveryProspectRow = {
  id: number;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  contact_source?: string;
  email_verification_status?: string;
  ai_verdict?: string;
  ai_reason?: string;
  score?: number;
  fit_status?: string;
};


function aiLabel(verdict?: string | null): string {
  if (verdict === 'real') return 'Relevant';
  if (verdict === 'junk') return 'Rejected';
  if (verdict === 'review') return 'Review';
  return verdict || 'Not reviewed';
}

export default function CompanyDiscovery() {
  const [params] = useSearchParams();
  const [companyName, setCompanyName] = useState(() => params.get('company') || '');
  const [domain, setDomain] = useState(() => params.get('domain') || '');
  const [titleHints, setTitleHints] = useState(() => params.get('titles') || '');
  const [maxProspects, setMaxProspects] = useState(() => {
    const raw = Number(params.get('max') || 250);
    return Number.isFinite(raw) ? Math.min(800, Math.max(25, raw)) : 250;
  });

  const applyCompany = (option: CompanyOption) => {
    setCompanyName(option.name);
    if (option.domain) setDomain(option.domain);
  };
  const [submitting, setSubmitting] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [prospects, setProspects] = useState<DiscoveryProspectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedCompany, setImportedCompany] = useState<string | null>(null);
  const requestedRun = Number(params.get('run') || '');
  const [selectedId, setSelectedId] = useState<number | null>(
    Number.isFinite(requestedRun) && requestedRun > 0 ? requestedRun : null,
  );

  const loadRuns = useCallback(async () => {
    try {
      const list = await api.yucgoutreach.listRuns(40);
      setRuns(list as RunRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs');
    }
  }, []);
  const [flowStarting, setFlowStarting] = useState(false);
  const [flows, setFlows] = useState<OutreachFlow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<number | null>(null);

  useEffect(() => {
    api.outreach.flows.list(10).then((list) => {
      setFlows(list);
      const live = list.find((f) => f.status !== 'ready' && f.status !== 'failed');
      if (live) setActiveFlowId(live.id);
    }).catch(() => setFlows([]));
  }, []);

  const onFlowDone = useCallback((flow: OutreachFlow) => {
    setFlows((prev) => [flow, ...prev.filter((f) => f.id !== flow.id)]);
  }, []);

  const startFlow = async () => {
    setError(null);
    setInfo(null);
    if (!companyName.trim()) {
      setError('Company name is required.');
      return;
    }
    if (!titleHints.trim()) {
      setError('Add titles to prioritize so the search knows who to collect.');
      return;
    }
    setFlowStarting(true);
    try {
      const flow = await api.outreach.flows.create({
        company_name: companyName.trim(),
        company_domain: domain.trim() || undefined,
        title_hints: titleHints.trim(),
        max_contacts: Math.min(200, Math.max(1, Math.round(maxProspects / 10) || 25)),
      });
      setActiveFlowId(flow.id);
      setFlows((prev) => [flow, ...prev]);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start outreach');
    } finally {
      setFlowStarting(false);
    }
  };

  useEffect(() => {
    api.yucgoutreach.listRuns(40).then((list) => setRuns(list as RunRow[])).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load runs');
    });
  }, []);

  const refreshSelected = useCallback(async () => {
    if (selectedId == null) return;
    try {
      const [run, pros] = await Promise.all([
        api.yucgoutreach.getRun(selectedId),
        api.yucgoutreach.listProspects(selectedId, 800),
      ]);
      setRuns((prev) => {
        const others = prev.filter((r) => r.id !== selectedId);
        return [run as RunRow, ...others].sort((a, b) => b.id - a.id);
      });
      setProspects(pros as DiscoveryProspectRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run');
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    Promise.all([
      api.yucgoutreach.getRun(selectedId),
      api.yucgoutreach.listProspects(selectedId, 800),
    ]).then(([run, pros]) => {
      setRuns((prev) => {
        const others = prev.filter((r) => r.id !== selectedId);
        return [run as RunRow, ...others].sort((a, b) => b.id - a.id);
      });
      setProspects(pros as DiscoveryProspectRow[]);
    }).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load run'));
    const t = setInterval(refreshSelected, 3000);
    return () => clearInterval(t);
  }, [selectedId, refreshSelected]);

  const [clubMemory, setClubMemory] = useState<Record<string, unknown> | null>(null);
  const rosterQuery = companyName.trim();
  useEffect(() => {
    if (rosterQuery.length < 3) return;
    const t = setTimeout(() => {
      api.yucgoutreach.listRosters(rosterQuery, 1)
        .then((res) => {
          const top = res.rosters?.[0];
          setClubMemory(top && Number(top.people_count || 0) > 0 ? top : null);
        })
        .catch(() => setClubMemory(null));
    }, 450);
    return () => clearTimeout(t);
  }, [rosterQuery]);
  const shownClubMemory = rosterQuery.length < 3 ? null : clubMemory;

  useEffect(() => {
    const hasActive = runs.some((r) => r.status === 'running' || r.status === 'queued');
    if (!hasActive) return;
    const t = setInterval(loadRuns, 4000);
    return () => clearInterval(t);
  }, [runs, loadRuns]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!companyName.trim()) {
      setError('Company name is required.');
      return;
    }
    if (!titleHints.trim()) {
      setError('Add titles to prioritize (or type “any relevant”) so the live search knows who to collect.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.yucgoutreach.createRun({
        company_name: companyName.trim(),
        company_domain: domain.trim() || undefined,
        title_hints: titleHints.trim(),
        max_prospects: maxProspects,
      });
      setSelectedId(res.id);
      await loadRuns();
      setInfo(`Run #${res.id} started — website, web search, club roster, then inbox checks.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start failed');
    } finally {
      setSubmitting(false);
    }
  };

  const selected = selectedId != null ? runs.find((r) => r.id === selectedId) || null : null;
  const flowLive = activeFlowId != null
    && flows.some((f) => f.id === activeFlowId && f.status !== 'ready' && f.status !== 'failed');

  return (
    <div className="space-y-8" data-section="yucgoutreach-discovery">
      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-deep-navy mb-1">Find people at a company</h2>
          <p className="text-sm text-slate-600">
            Website crawl, web search, and the club roster (SEC + Companies House officers), then inbox checks. A company name is enough — no domain or URL required.
          </p>
        </div>
        <CompanySuggestions onPick={applyCompany} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <form
          onSubmit={onSubmit}
          className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4"
        >
          <h2 className="text-lg font-semibold text-deep-navy">Start a company search</h2>
          <p className="text-sm text-slate-600">Company, titles, and a domain produce the best results. Empty domain is looked up from the company name.</p>
          {shownClubMemory && (
            <p className="text-[13px] rounded-lg bg-pale-sky/40 border border-pale-sky/60 px-3 py-2 text-deep-navy">
              Club memory: {Number(shownClubMemory.people_count)} officer(s) known at {String(shownClubMemory.company_name)}
              {Number(shownClubMemory.current_count || 0) < Number(shownClubMemory.people_count || 0)
                ? ` · ${Number(shownClubMemory.current_count)} still there`
                : ''}
              {Number(shownClubMemory.emails_ready || 0) > 0
                ? ` · ${Number(shownClubMemory.emails_ready)} with derived work email`
                : ''}{' '}
              — they merge into this search automatically.
            </p>
          )}
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
          {info && (
            <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {info}
            </div>
          )}
          <CompanyAutocomplete
            id="discovery-company"
            label="Company"
            value={companyName}
            placeholder="Search pipeline and target-list companies"
            onChange={(name, option) => {
              setCompanyName(name);
              if (option?.domain) setDomain(option.domain);
            }}
            onSelect={applyCompany}
          />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Titles to prioritize</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              aria-label="Titles to prioritize"
              value={titleHints}
              onChange={(e) => setTitleHints(e.target.value)}
              placeholder="VPs, project managers"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company domain</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              aria-label="Company domain" value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="apple.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">People to collect (up to 800)</label>
            <input
              type="number"
              min={1}
              max={800}
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              aria-label="Maximum prospects" value={maxProspects}
              onChange={(e) => setMaxProspects(Math.min(800, Math.max(25, Number(e.target.value) || 250)))}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <button
              type="button"
              disabled={flowStarting || submitting || flowLive}
              onClick={() => void startFlow()}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-deep-navy text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              data-testid="outreach-this-company"
            >
              {flowStarting ? 'Starting…' : 'Outreach this company'}
            </button>
            <button
              type="submit"
              disabled={submitting || flowStarting}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-deep-navy text-deep-navy text-sm font-medium hover:bg-pale-sky/30 disabled:opacity-50"
            >
              {submitting ? 'Starting…' : 'Find people only'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Outreach this company finds people, saves them to your contacts, drafts an email to each, and
            assembles a draft campaign for you to review. Nothing is sent until you release it.
          </p>
        </form>

        <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4">
          {(activeFlowId != null || flows.length > 0) && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-deep-navy">Outreach in progress</h2>
              {activeFlowId != null && <OutreachFlowTracker flowId={activeFlowId} onDone={onFlowDone} />}
              {flows.filter((f) => f.id !== activeFlowId).slice(0, 4).map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-deep-navy truncate">{f.company_name}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {f.status === 'ready'
                        ? `${f.imported_count ?? 0} people · ${f.drafted_count ?? 0} drafts`
                        : f.status === 'failed'
                          ? f.error_message || 'Stopped'
                          : f.progress_message || f.status}
                    </div>
                  </div>
                  {f.status === 'ready' && f.campaign_id ? (
                    <Link to={`/campaigns/${f.campaign_id}`} className="shrink-0 text-xs font-semibold text-deep-navy underline">
                      Review & release
                    </Link>
                  ) : (
                    <button type="button" className="shrink-0 text-xs font-semibold text-slate-600 underline" onClick={() => setActiveFlowId(f.id)}>
                      Open
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <h2 className="text-lg font-semibold text-deep-navy mb-3">Recent runs</h2>
          <div className="max-h-[420px] overflow-auto space-y-2">
            {runs.length === 0 && <p className="text-sm text-slate-500">No runs yet.</p>}
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setSelectedId(r.id);
                  setError(null);
                }}
                className={`w-full text-left rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  selectedId === r.id
                    ? 'border-deep-navy bg-white shadow-sm'
                    : 'border-pale-sky/80 hover:bg-slate-50/80'
                }`}
              >
                <div className="font-medium text-deep-navy truncate">{r.company_name}</div>
                <div className="text-xs text-slate-600 mt-0.5">
                  #{r.id} · {r.status}
                  {typeof r.progress_pct === 'number' ? ` · ${Math.round(r.progress_pct)}%` : ''}
                  {r.prospects_count != null ? ` · ${r.prospects_count} saved` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div>
              <h2 className="text-lg font-semibold text-deep-navy">
                Run #{selected.id}: {selected.company_name}
              </h2>
              <p className="text-sm text-slate-600 mt-1" role="status">
                {selected.progress_message || selected.status}
                {prospects.length ? ` · ${prospects.length} people found so far` : ''}
                {prospects.length && selected.max_prospects ? ` of ${selected.max_prospects}` : ''}
              </p>
              {(selected.status === 'running' || selected.status === 'queued') && (
                <div
                  className="mt-3 h-2.5 rounded-full bg-pale-sky/70 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(selected.progress_pct || 0)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  title={`${Math.round(selected.progress_pct || 0)}%${selected.progress_message ? ` · ${selected.progress_message}` : ''}`}
                >
                  <div className="h-full bg-[var(--btn-primary-bg)] transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(4, selected.progress_pct || 0))}%` }} />
                </div>
              )}
              {selected.error_message && <p className="text-sm text-red-700 mt-2">{selected.error_message}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={exporting || selected.status === 'running'}
                className="px-3 py-2 rounded-lg border border-pale-sky text-sm font-medium text-deep-navy bg-white hover:bg-slate-50 disabled:opacity-50"
                onClick={async () => {
                  setExporting(true);
                  setError(null);
                  try {
                    await api.yucgoutreach.exportExcel(selected.id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Export failed');
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? 'Exporting…' : 'Export Excel'}
              </button>
              <button
                type="button"
                disabled={importing || !prospects.length}
                className="px-3 py-2 rounded-lg border border-emerald-300 text-sm font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                onClick={async () => {
                  if (!confirm(`Import ${prospects.length} prospect(s) into main Contacts?`)) return;
                  setImporting(true);
                  setError(null);
                  try {
                    const res = await api.yucgoutreach.importContacts(selected.id);
                    setInfo(`Imported: ${res.created} new, ${res.updated} updated, ${res.skipped} skipped.`);
                    setImportedCompany(selected.company_name);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Import failed');
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                {importing ? 'Importing…' : 'Import to Contacts'}
              </button>
              {importedCompany === selected.company_name && (
                <Link
                  to={`/studio?q=${encodeURIComponent(selected.company_name)}`}
                  className="px-3 py-2 rounded-lg border border-pale-sky text-sm font-medium text-deep-navy bg-white hover:bg-slate-50"
                >
                  Draft outreach
                </Link>
              )}
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-800 bg-white hover:bg-red-50"
                onClick={async () => {
                  if (!confirm('Delete this run and all prospect rows?')) return;
                  try {
                    await api.yucgoutreach.deleteRun(selected.id);
                    setSelectedId(null);
                    setProspects([]);
                    loadRuns();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Delete failed');
                  }
                }}
              >
                Delete run
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-pale-sky/80">
            <table className="min-w-full text-sm ingestion-table">
              <thead>
                <tr className="bg-[#1F4E79] text-white text-left">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Mailbox assessment</th>
                  <th className="px-3 py-2 font-medium">AI</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Fit</th>
                </tr>
              </thead>
              <tbody>
                {prospects.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      {selected.status === 'running' || selected.status === 'queued'
                        ? 'Discovery in progress…'
                        : (selected.progress_message || 'No people saved for this run.')}
                    </td>
                  </tr>
                )}
                {prospects.map((p) => (
                  <tr key={p.id} className="border-t border-pale-sky/60 bg-white">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{p.email || '—'}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate">{p.title || '—'}</td>
                    <td className="px-3 py-2 text-xs">{p.contact_source || '—'}</td>
                    <td className="px-3 py-2 text-xs">{legacyMailboxLabel(p.email_verification_status)}</td>
                    <td className="px-3 py-2 text-xs" title={p.ai_reason || ''}>
                      {aiLabel(p.ai_verdict)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{p.score != null ? Math.round(p.score) : '—'}</td>
                    <td className="px-3 py-2">{p.fit_status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
