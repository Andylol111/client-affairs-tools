import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

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

function inboxLabel(status?: string | null): string {
  if (status === 'valid') return 'Verified';
  if (status === 'mx') return 'MX available';
  if (status === 'invalid') return 'Invalid';
  if (status === 'risky') return 'Risky';
  return status || 'Unknown';
}

function aiLabel(verdict?: string | null): string {
  if (verdict === 'real') return 'Relevant';
  if (verdict === 'junk') return 'Rejected';
  if (verdict === 'review') return 'Review';
  return verdict || 'Not reviewed';
}

export default function CompanyDiscovery() {
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [maxProspects, setMaxProspects] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prospects, setProspects] = useState<DiscoveryProspectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

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
        api.yucgoutreach.listProspects(selectedId, 500),
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
      api.yucgoutreach.listProspects(selectedId, 500),
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
    setSubmitting(true);
    try {
      const res = await api.yucgoutreach.createRun({
        company_name: companyName.trim(),
        company_domain: domain.trim() || undefined,
        linkedin_company_url: linkedinUrl.trim() || undefined,
        max_prospects: maxProspects,
      });
      setSelectedId(res.id);
      await loadRuns();
      setInfo(`Run #${res.id} started — fetching sources in parallel.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start failed');
    } finally {
      setSubmitting(false);
    }
  };

  const selected = selectedId != null ? runs.find((r) => r.id === selectedId) || null : null;

  return (
    <div className="space-y-8" data-section="yucgoutreach-discovery">
      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-deep-navy mb-3">Company discovery pipeline</h2>
        <ol className="list-decimal list-inside text-sm text-slate-700 space-y-2">
          <li>
            <strong>Parallel sources</strong> — website, LinkedIn (Apify), Tavily search.
          </li>
          <li>
            <strong>Merge + verify</strong> — MX inbox check and Ollama AI verdict.
          </li>
          <li>
            <strong>Export or import</strong> — Excel or main Contacts.
          </li>
        </ol>
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
          {info && (
            <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {info}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company name *</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              aria-label="Company name" value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Apple"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Domain (recommended)</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              aria-label="Company domain" value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="apple.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">LinkedIn company URL (optional)</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              aria-label="LinkedIn company URL" value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Max prospects (up to 500)</label>
            <input
              type="number"
              min={1}
              max={500}
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              aria-label="Maximum prospects" value={maxProspects}
              onChange={(e) => setMaxProspects(Number(e.target.value) || 100)}
            />
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
              <p className="text-sm text-slate-600 mt-1">{selected.progress_message || selected.status}</p>
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
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Import failed');
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                {importing ? 'Importing…' : 'Import to Contacts'}
              </button>
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
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Inbox</th>
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
                    <td className="px-3 py-2 text-xs">{inboxLabel(p.email_verification_status)}</td>
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
