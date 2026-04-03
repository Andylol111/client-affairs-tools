/**
 * YUCGoutreach company discovery: per-company email pattern research, named employees
 * (LinkedIn / web), parallel enrichment (default 4 workers), SQL storage, Excel export.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type RunRow = {
  id: number;
  company_name: string;
  status: string;
  progress_pct?: number;
  progress_message?: string;
  prospects_count?: number;
  worker_concurrency?: number;
  max_prospects?: number;
  error_message?: string;
  created_at?: string;
};

function secondaryScore(p: Record<string, unknown>): number | string | null {
  const y = p.yucgoutreach_score;
  if (y != null && y !== '') return y as number | string;
  const a = p.apollo_score;
  if (a != null && a !== '') return a as number | string;
  return null;
}

export default function YucgOutreach() {
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [maxProspects, setMaxProspects] = useState(25);
  const [workers, setWorkers] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prospects, setProspects] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const list = await api.yucgoutreach.listRuns(40);
      setRuns(list as RunRow[]);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const refreshSelected = useCallback(async () => {
    if (selectedId == null) return;
    try {
      const [run, pros] = await Promise.all([
        api.yucgoutreach.getRun(selectedId),
        api.yucgoutreach.listProspects(selectedId, 300),
      ]);
      setRuns((prev) => {
        const others = prev.filter((r) => r.id !== selectedId);
        return [run as RunRow, ...others].sort((a, b) => b.id - a.id);
      });
      setProspects(pros);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run');
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    refreshSelected();
    const t = setInterval(refreshSelected, 3500);
    return () => clearInterval(t);
  }, [selectedId, refreshSelected]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!companyName.trim()) {
      setError('Company name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.yucgoutreach.createRun({
        company_name: companyName.trim(),
        company_domain: domain.trim() || undefined,
        linkedin_company_url: linkedinUrl.trim() || undefined,
        max_prospects: maxProspects,
        worker_concurrency: workers,
      });
      setSelectedId(res.id);
      await loadRuns();
      setCompanyName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start failed');
    } finally {
      setSubmitting(false);
    }
  };

  const selected =
    selectedId != null ? runs.find((r) => r.id === selectedId) || null : null;

  return (
    <div className="max-w-6xl mx-auto space-y-8" data-section="yucgoutreach">
      <div>
        <h1 className="text-2xl font-bold text-deep-navy">YUCGoutreach</h1>
        <p className="text-slate-600 mt-1 text-sm max-w-3xl">
          In-house company discovery: infer <strong>company-specific</strong> email patterns (not one
          template for everyone), find <strong>named people</strong> via LinkedIn (Apify) or web search
          (Tavily), score with a local LLM (Ollama), and store rows in SQLite for queries and Excel export.
        </p>
      </div>

      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-deep-navy mb-3">Flow</h2>
        <ol className="list-decimal list-inside text-sm text-slate-700 space-y-2">
          <li>
            <strong>Company research</strong> — snippets on email formats, press contacts, and domain hints.
          </li>
          <li>
            <strong>Pattern inference</strong> — Ollama proposes local-part templates (e.g.{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">{`{first}.{last}`}</code>) tailored to this
            company.
          </li>
          <li>
            <strong>Named employees</strong> — LinkedIn company URL + <code className="text-xs">APIFY_API_TOKEN</code>{' '}
            preferred; otherwise Tavily extracts names from public results.
          </li>
          <li>
            <strong>Parallel enrichment</strong> — default <strong>4 concurrent workers</strong>: person web
            evidence, predicted non-generic emails (filters <code className="text-xs">contact@</code>, etc.),
            primary score plus <strong>YUCGoutreach score</strong> (secondary lead-quality signal).
          </li>
          <li>
            <strong>Persist & export</strong> — SQL tables <code className="text-xs">yucgoutreach_prospects</code> /{' '}
            <code className="text-xs">yucgoutreach_discovery_runs</code>; download Excel with your column layout.
          </li>
        </ol>
        <p className="text-xs text-slate-500 mt-4">
          Configure <code className="bg-slate-100 px-1 rounded">TAVILY_API_KEY</code>,{' '}
          <code className="bg-slate-100 px-1 rounded">APIFY_API_TOKEN</code>, and{' '}
          <code className="bg-slate-100 px-1 rounded">OLLAMA_URL</code> / Ollama running for best results.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <form
          onSubmit={onSubmit}
          className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4"
        >
          <h2 className="text-lg font-semibold text-deep-navy">Start a run</h2>
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company name *</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              data-search-input=""
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company domain (optional)</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="acme.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">LinkedIn company URL (optional)</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://www.linkedin.com/company/acme"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Max prospects</label>
              <input
                type="number"
                min={1}
                max={200}
                className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
                value={maxProspects}
                onChange={(e) => setMaxProspects(Number(e.target.value) || 25)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Parallel workers (1–16)</label>
              <input
                type="number"
                min={1}
                max={16}
                className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
                value={workers}
                onChange={(e) => setWorkers(Number(e.target.value) || 4)}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-deep-navy text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Run discovery'}
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
                  {r.prospects_count != null ? ` · ${r.prospects_count} rows` : ''}
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
              <p className="text-sm text-slate-600 mt-1">{selected.progress_message || selected.status}</p>
              {selected.error_message && (
                <p className="text-sm text-red-700 mt-2">{selected.error_message}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-pale-sky text-sm font-medium text-deep-navy bg-white hover:bg-slate-50"
                onClick={() => api.yucgoutreach.exportExcel(selected.id)}
              >
                Export Excel
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-800 bg-white hover:bg-red-50"
                onClick={async () => {
                  if (!confirm('Delete this run and all prospect rows?')) return;
                  await api.yucgoutreach.deleteRun(selected.id);
                  setSelectedId(null);
                  setProspects([]);
                  loadRuns();
                }}
              >
                Delete run
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-pale-sky/80">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#1F4E79] text-white text-left">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">YUCGoutreach</th>
                  <th className="px-3 py-2 font-medium">Fit</th>
                  <th className="px-3 py-2 font-medium">Verified</th>
                </tr>
              </thead>
              <tbody>
                {prospects.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      {selected.status === 'running' || selected.status === 'queued'
                        ? 'Enrichment in progress…'
                        : 'No prospect rows.'}
                    </td>
                  </tr>
                )}
                {prospects.map((p) => (
                  <tr key={p.id} className="border-t border-pale-sky/60 bg-white">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{p.email || '—'}</td>
                    <td className="px-3 py-2 max-w-[220px] truncate">{p.title || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{p.score ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{secondaryScore(p) ?? '—'}</td>
                    <td className="px-3 py-2">{p.fit_status || '—'}</td>
                    <td className="px-3 py-2">{p.verified ? 'Yes' : 'No'}</td>
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
