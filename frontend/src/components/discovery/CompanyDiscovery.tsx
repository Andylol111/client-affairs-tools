import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import CompanyAutocomplete, { CompanySuggestions, type CompanyOption } from '../CompanyAutocomplete';
import { legacyMailboxLabel } from '../../lib/contactEvidence';

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
  useEffect(() => {
    const name = companyName.trim();
    if (name.length < 3) {
      setClubMemory(null);
      return;
    }
    const t = setTimeout(() => {
      api.yucgoutreach.listRosters(name, 1)
        .then((res) => {
          const top = res.rosters?.[0];
          setClubMemory(top && Number(top.people_count || 0) > 0 ? top : null);
        })
        .catch(() => setClubMemory(null));
    }, 450);
    return () => clearTimeout(t);
  }, [companyName]);

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

  return (
    <div className="space-y-8" data-section="yucgoutreach-discovery">
      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-deep-navy mb-1">Find people at a company</h2>
          <p className="text-sm text-slate-600">
            Company-wide live search: website crawl, web search, and the club roster (SEC + Companies House officers), then inbox checks. Person lookup (the next tab) is only for one named person. Research is audience briefs, not this search.
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
          {clubMemory && (
            <p className="text-[13px] rounded-lg bg-pale-sky/40 border border-pale-sky/60 px-3 py-2 text-deep-navy">
              Club memory: {Number(clubMemory.people_count)} officer(s) known at {String(clubMemory.company_name)}
              {Number(clubMemory.current_count || 0) < Number(clubMemory.people_count || 0)
                ? ` · ${Number(clubMemory.current_count)} still there`
                : ''}
              {Number(clubMemory.emails_ready || 0) > 0
                ? ` · ${Number(clubMemory.emails_ready)} with derived work email`
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
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-deep-navy text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Find people'}
          </button>
        </form>

        <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm">
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
                {selected.max_prospects ? ` of ${selected.max_prospects}` : ''}
              </p>
              {(selected.status === 'running' || selected.status === 'queued') && (
                <div className="mt-3 h-2.5 rounded-full bg-pale-sky/70 overflow-hidden" aria-hidden>
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
                        : 'No verified prospects (junk filtered).'}
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
