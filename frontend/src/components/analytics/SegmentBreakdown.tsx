import { useEffect, useState } from 'react';
import { api, type SegmentSummaryRow } from '../../api';
import { Button, Notice } from '../ui/Primitives';

export default function SegmentBreakdown() {
  const [segments, setSegments] = useState<string[]>([]);
  const [summary, setSummary] = useState<SegmentSummaryRow[]>([]);
  const [unclassified, setUnclassified] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [classifying, setClassifying] = useState(false);
  const [info, setInfo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [goalDrafts, setGoalDrafts] = useState<Record<string, string>>({});
  const [savingGoal, setSavingGoal] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<string | null>(null);

  const refresh = () => {
    Promise.all([api.segments.list(), api.segments.summary()])
      .then(([listRes, summaryRes]) => {
        setSegments(listRes.segments);
        setSummary(summaryRes.summary);
        setUnclassified(summaryRes.unclassified_companies);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load segments'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const classify = async () => {
    setClassifying(true);
    setError('');
    setInfo('');
    try {
      const result = await api.segments.classify();
      setInfo(
        result.classified > 0
          ? `Classified ${result.classified} compan${result.classified === 1 ? 'y' : 'ies'}.${result.remaining ? ` ${result.remaining} still unclassified.` : ''}`
          : 'No unclassified companies to process.'
      );
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Classification failed');
    } finally {
      setClassifying(false);
    }
  };

  const saveGoal = async (segment: string) => {
    const raw = goalDrafts[segment];
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    setSavingGoal(segment);
    setError('');
    try {
      await api.segments.goals.set(segment, Math.round(value));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save goal');
    } finally {
      setSavingGoal(null);
    }
  };

  const reassign = async (companyKey: string, segment: string) => {
    setReassigning(companyKey);
    setError('');
    try {
      await api.segments.reassign(companyKey, segment);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reassign company');
    } finally {
      setReassigning(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading segments…</p>;
  }

  const scale = Math.max(1, ...summary.map((s) => Math.max(s.companies, s.target_companies)));
  const totalCompanies = summary.reduce((sum, s) => sum + s.companies, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {totalCompanies} classified compan{totalCompanies === 1 ? 'y' : 'ies'}
          {unclassified > 0 ? ` · ${unclassified} not yet classified` : ''}
        </p>
        {unclassified > 0 && (
          <Button size="sm" variant="secondary" onClick={classify} disabled={classifying}>
            {classifying ? 'Classifying…' : `Classify ${unclassified} with AI`}
          </Button>
        )}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {info && <Notice tone="success">{info}</Notice>}

      {totalCompanies === 0 && unclassified === 0 ? (
        <p className="text-sm text-slate-500">
          No companies to segment yet. Segments are assigned from contacts once they have a company on file.
        </p>
      ) : (
        <ul className="space-y-2">
          {summary
            .filter((s) => s.companies > 0 || s.target_companies > 0)
            .sort((a, b) => b.companies - a.companies)
            .map((s) => {
              const actualPct = (s.companies / scale) * 100;
              const goalPct = s.target_companies > 0 ? (s.target_companies / scale) * 100 : null;
              const isExpanded = expanded === s.segment;
              return (
                <li key={s.segment} className="rounded-lg border border-[var(--border)] p-3">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => setExpanded(isExpanded ? null : s.segment)}
                    title={`${s.companies} companies · ${s.contacts} contacts · ${s.reached_contacts} reached · ${s.replied_contacts} replied${s.target_companies ? ` · goal ${s.target_companies} (${s.progress_pct}%)` : ''}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-medium text-deep-navy">{s.segment}</span>
                      <span className="text-xs text-slate-500">
                        {s.companies} compan{s.companies === 1 ? 'y' : 'ies'}
                        {s.target_companies > 0 ? ` of ${s.target_companies} goal (${s.progress_pct}%)` : ''}
                      </span>
                    </div>
                    <div
                      className="relative h-2.5 rounded-full bg-pale-sky/40 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={s.companies}
                      aria-valuemin={0}
                      aria-valuemax={s.target_companies || scale}
                    >
                      <div
                        className={`h-full transition-[width] duration-300 ${
                          s.target_companies > 0 && s.companies >= s.target_companies ? 'bg-emerald-500' : 'bg-steel-blue'
                        }`}
                        style={{ width: `${Math.min(100, actualPct)}%` }}
                      />
                      {goalPct != null && (
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-deep-navy"
                          style={{ left: `${Math.min(100, goalPct)}%` }}
                          title={`Goal: ${s.target_companies}`}
                        />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
                      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        Goal (companies)
                        <input
                          type="number"
                          min={0}
                          className="w-24"
                          value={goalDrafts[s.segment] ?? String(s.target_companies)}
                          onChange={(e) => setGoalDrafts((prev) => ({ ...prev, [s.segment]: e.target.value }))}
                        />
                        <Button size="sm" variant="secondary" onClick={() => saveGoal(s.segment)} disabled={savingGoal === s.segment}>
                          {savingGoal === s.segment ? 'Saving…' : 'Save goal'}
                        </Button>
                      </label>
                      {s.companies_list.length === 0 ? (
                        <p className="text-xs text-slate-500">No companies in this segment yet.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {s.companies_list.map((c) => (
                            <li key={c.company_key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="text-deep-navy font-medium">
                                {c.company_name} <span className="text-slate-500 font-normal">· {c.contacts} contact{c.contacts === 1 ? '' : 's'}</span>
                              </span>
                              <select
                                value={s.segment}
                                disabled={reassigning === c.company_key}
                                onChange={(e) => reassign(c.company_key, e.target.value)}
                                aria-label={`Segment for ${c.company_name}`}
                              >
                                {segments.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
