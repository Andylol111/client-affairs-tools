/**
 * Outreach Coordinator — spreadsheet prospect board + rules/Ollama recommendations,
 * plus company discovery runs (legacy YUCGoutreach pipeline).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type YucgProspectRow,
  type YucgRecommendation,
  type YucgVerifiability,
} from '../api';
import AppTabMenu from '../components/AppTabMenu';
import PageHeader from '../components/PageHeader';
import { useAiModel } from '../contexts/AiModelContext';

type PageTab = 'coordinator' | 'comb' | 'discovery';

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
  email?: string;
  title?: string;
  score?: number;
  yucgoutreach_score?: number;
  fit_status?: string;
  verified?: number;
  contact_source?: string;
  email_verification_status?: string;
  ai_verdict?: string;
  ai_reason?: string;
  linkedin_url?: string;
};

type RecommendMode = 'rules' | 'ai';

const INCENTIVIZED_CONTACT_TYPES = [
  'Airport ASD',
  'Fleet Planning',
  'Studio Strategy',
  'Head of Client Affairs',
  'Partnerships',
] as const;

const OTHER_CONTACT_TYPE_CHIPS = [
  'VP Business Development',
  'Alumni Relations',
  'Marketing Director',
] as const;

function inboxLabel(s?: string | null): string {
  switch (s) {
    case 'valid':
      return 'Verified';
    case 'likely_valid':
      return 'Likely';
    case 'invalid':
      return 'Invalid';
    default:
      return 'Unknown';
  }
}

function aiLabel(v?: string | null): string {
  switch (v) {
    case 'real':
      return 'Real';
    case 'suspicious':
      return 'Suspicious';
    case 'junk':
      return 'Junk';
    default:
      return '—';
  }
}

function VerifiabilityDrawer({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: YucgRecommendation | null;
}) {
  if (!open || !item) return null;
  const v: YucgVerifiability = item.verifiability;
  const b = v.score_breakdown;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Verifiability details">
      <button type="button" className="absolute inset-0 bg-deep-navy/30" onClick={onClose} aria-label="Close drawer" />
      <aside className="relative w-full max-w-md h-full bg-white border-l border-pale-sky shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-pale-sky bg-white">
          <h3 className="text-base font-semibold text-deep-navy">Verifiability</h3>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-sm text-slate-600 hover:text-deep-navy rounded border border-pale-sky"
          >
            Close
          </button>
        </div>
        <div className="p-4 space-y-4 text-sm">
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Company</div>
            <div className="font-medium text-deep-navy mt-0.5">{v.company}</div>
            <div className="text-xs text-slate-500 mt-0.5">Spreadsheet row {v.row_index}</div>
          </div>

          {item.composite_score != null && (
            <div className="rounded-lg border border-pale-sky px-3 py-2 bg-pale-sky/15">
              <span className="text-xs text-slate-600">Composite score</span>
              <div className="text-lg font-semibold text-deep-navy tabular-nums">{Math.round(item.composite_score)}</div>
            </div>
          )}

          {b && (
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Score breakdown</div>
              <ul className="space-y-1.5 rounded-lg border border-pale-sky/80 divide-y divide-pale-sky/60">
                {[
                  ['Incentive', b.incentive],
                  ['Priority', b.priority],
                  ['Yale hook', b.yale_hook],
                  ['Contact type match', b.contact_type_match],
                  ['Total', b.total],
                ].map(([label, val]) =>
                  val != null ? (
                    <li key={String(label)} className="flex justify-between px-3 py-2">
                      <span className="text-slate-600">{label}</span>
                      <span className="font-medium tabular-nums text-deep-navy">{Math.round(Number(val))}</span>
                    </li>
                  ) : null
                )}
              </ul>
              {b.rationale && <p className="text-xs text-slate-600 mt-2 leading-relaxed">{b.rationale}</p>}
            </div>
          )}

          {v.verification_source_url && (
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Verification source</div>
              <a
                href={v.verification_source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-steel-blue hover:underline break-all"
              >
                {v.verification_source_url}
              </a>
            </div>
          )}

          {v.yucg_service_tags && v.yucg_service_tags.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">YUCG service tags</div>
              <div className="flex flex-wrap gap-1.5">
                {v.yucg_service_tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded border border-pale-sky bg-pale-sky/20 text-deep-navy">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(v.website_citation_url || v.website_citation_excerpt) && (
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">YUCG website citation</div>
              {v.website_citation_url && (
                <a
                  href={v.website_citation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-steel-blue hover:underline break-all text-xs block mb-2"
                >
                  {v.website_citation_url}
                </a>
              )}
              {v.website_citation_excerpt && (
                <blockquote className="text-xs text-slate-700 border-l-2 border-steel-blue pl-3 py-1 bg-slate-50 rounded-r">
                  {v.website_citation_excerpt}
                </blockquote>
              )}
            </div>
          )}

          {v.reasoning_chain && v.reasoning_chain.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Reasoning chain</div>
              <ol className="list-decimal list-inside space-y-1 text-slate-700 text-xs leading-relaxed">
                {v.reasoning_chain.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {item.prospect.recommended_message_angle && (
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Message angle</div>
              <p className="text-slate-700 text-xs leading-relaxed">{item.prospect.recommended_message_angle}</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function CoordinatorPanel() {
  const { modelId } = useAiModel();
  const [sector, setSector] = useState('');
  const [contactType, setContactType] = useState('');
  const [minIncentive, setMinIncentive] = useState(50);
  const [searchQ, setSearchQ] = useState('');
  const [prospects, setProspects] = useState<YucgProspectRow[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [recommendMode, setRecommendMode] = useState<RecommendMode>('rules');
  const [recommendations, setRecommendations] = useState<YucgRecommendation[]>([]);
  const [recommendBusy, setRecommendBusy] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [recommendInfo, setRecommendInfo] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [drawerItem, setDrawerItem] = useState<YucgRecommendation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardTotal, setBoardTotal] = useState<number | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const meta = await api.yucg.prospectsMeta();
      if (meta.sectors?.length) setSectors([...meta.sectors].sort());
    } catch {
      /* meta optional — sectors fall back from board rows */
    }
  }, []);

  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    setBoardError(null);
    try {
      const res = await api.yucg.listProspects({
        sector: sector || undefined,
        contact_type: contactType || undefined,
        min_incentive_score: minIncentive,
        q: searchQ || undefined,
        limit: 200,
      });
      const rows = res.prospects ?? [];
      setProspects(rows);
      setBoardTotal(res.count ?? rows.length);
      if (!sectors.length) {
        const uniq = [...new Set(rows.map((r) => r.sector).filter(Boolean) as string[])].sort();
        if (uniq.length) setSectors(uniq);
      }
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : 'Failed to load prospects');
      setProspects([]);
    } finally {
      setLoadingBoard(false);
    }
  }, [sector, contactType, minIncentive, searchQ]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadBoard();
    }, searchQ ? 350 : 0);
    return () => clearTimeout(t);
  }, [loadBoard, searchQ]);

  const toggleRow = (rowIndex: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const runRecommend = async () => {
    setRecommendBusy(true);
    setRecommendError(null);
    setRecommendInfo(null);
    try {
      const opts = {
        sector: sector || undefined,
        contact_type: contactType || undefined,
        min_incentive_score: minIncentive,
        contact_type_match: contactType || undefined,
        n: 10,
      };
      const res =
        recommendMode === 'rules'
          ? await api.yucg.recommend(opts)
          : await api.yucg.aiRecommend({ ...opts, model: modelId });
      setRecommendations(res.recommendations ?? []);
      if (res.ollama_error) {
        setRecommendInfo(res.ollama_error);
      } else {
        const via = res.mode === 'rules' ? 'rules' : 'AI';
        setRecommendInfo(`${res.count} target(s) via ${via}${res.model ? ` (${res.model})` : ''}.`);
      }
    } catch (e) {
      setRecommendError(e instanceof Error ? e.message : 'Recommendation failed');
      setRecommendations([]);
    } finally {
      setRecommendBusy(false);
    }
  };

  const openVerifiability = (item: YucgRecommendation) => {
    setDrawerItem(item);
    setDrawerOpen(true);
  };

  const createWeekSlate = async () => {
    const indices =
      selectedRows.size > 0
        ? [...selectedRows]
        : recommendations.map((r) => r.verifiability.row_index);
    if (indices.length === 0) {
      setBoardError('Select rows on the board or run Recommend Targets first.');
      return;
    }
    setExporting(true);
    setBoardError(null);
    try {
      const name = `Week slate ${new Date().toISOString().slice(0, 10)}`;
      const res = await api.yucg.createRelease({ name, row_indexes: indices });
      setRecommendInfo(`Created release #${res.id} with ${res.targets} companies (draft). Open Comb to keep or drop people.`);
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : 'Could not create week slate');
    } finally {
      setExporting(false);
    }
  };

  const exportShortlist = async () => {
    const indices =
      selectedRows.size > 0
        ? [...selectedRows]
        : recommendations.map((r) => r.verifiability.row_index);
    if (indices.length === 0) {
      setBoardError('Select rows on the board or run Recommend Targets first.');
      return;
    }
    setExporting(true);
    setBoardError(null);
    try {
      await api.yucg.exportShortlist(indices);
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const contactChipClass = (type: string, emphasized: boolean) => {
    const active = contactType === type;
    const base =
      'text-xs px-2.5 py-1 rounded border transition-colors whitespace-nowrap shrink-0';
    if (emphasized) {
      return `${base} ${
        active
          ? 'border-deep-navy bg-deep-navy text-white'
          : 'border-amber-400/80 bg-amber-50 text-amber-950 hover:bg-amber-100 font-medium'
      }`;
    }
    return `${base} ${
      active ? 'border-deep-navy bg-deep-navy text-white' : 'border-pale-sky bg-white text-slate-700 hover:bg-slate-50'
    }`;
  };

  const filteredProspects = useMemo(() => prospects, [prospects]);

  const allVisibleSelected =
    filteredProspects.length > 0 && filteredProspects.every((p) => selectedRows.has(p.row_index));

  const toggleAllVisible = () => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredProspects.forEach((p) => next.delete(p.row_index));
      } else {
        filteredProspects.forEach((p) => next.add(p.row_index));
      }
      return next;
    });
  };

  const isIncentivizedType = (type?: string | null) =>
    !!type && (INCENTIVIZED_CONTACT_TYPES as readonly string[]).includes(type);

  return (
    <div className="space-y-6" data-section="yucg-coordinator">
      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-deep-navy">Prospect Board</h2>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Filter the synced spreadsheet (`data/YUCG_Prospect_List.xlsx`). Prioritize high-incentive contact types
              for outreach week.
              {boardTotal != null && !loadingBoard && (
                <span className="block mt-1 text-slate-500">
                  Showing {prospects.length} of {boardTotal} matching companies.
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={loadBoard}
            disabled={loadingBoard}
            className="px-3 py-2 rounded-lg border border-pale-sky text-sm font-medium text-deep-navy bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingBoard ? 'Refreshing…' : 'Refresh board'}
          </button>
        </div>

        {boardError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{boardError}</div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[140px] flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Sector</label>
            <select
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm bg-white"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
            >
              <option value="">All sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Min incentive</label>
            <input
              type="number"
              min={0}
              max={100}
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              value={minIncentive}
              onChange={(e) => setMinIncentive(Number(e.target.value) || 0)}
            />
          </div>
          <div className="min-w-[180px] flex-[2]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Search company</label>
            <input
              data-search-input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Embraer, studio, airport…"
            />
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-600 mb-2">Contact type (incentivized)</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={contactChipClass('', false)}
              onClick={() => setContactType('')}
            >
              All types
            </button>
            {INCENTIVIZED_CONTACT_TYPES.map((t) => (
              <button key={t} type="button" className={contactChipClass(t, true)} onClick={() => setContactType(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {OTHER_CONTACT_TYPE_CHIPS.map((t) => (
              <button key={t} type="button" className={contactChipClass(t, false)} onClick={() => setContactType(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-pale-sky/80 max-h-[420px] overflow-y-auto yucg-coordinator-table-wrap">
          <table className="min-w-full text-sm yucg-coordinator-table">
            <thead className="sticky top-0 z-[1]">
              <tr className="bg-[#1F4E79] text-white text-left">
                <th className="px-2 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={filteredProspects.length === 0}
                    className="rounded"
                    aria-label="Select all visible rows"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Sector</th>
                <th className="px-3 py-2 font-medium">Contact type</th>
                <th className="px-3 py-2 font-medium">Incentive</th>
                <th className="px-3 py-2 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {filteredProspects.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    {loadingBoard
                      ? 'Loading prospects…'
                      : boardError
                        ? 'Could not load prospects — see error above.'
                        : 'No rows match filters. Try lowering min incentive or clearing contact type.'}
                  </td>
                </tr>
              )}
              {filteredProspects.map((p) => (
                <tr key={p.row_index} className="border-t border-pale-sky/60 bg-white hover:bg-slate-50/80">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(p.row_index)}
                      onChange={() => toggleRow(p.row_index)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-deep-navy max-w-[200px] truncate">{p.company}</td>
                  <td className="px-3 py-2 text-xs max-w-[140px] truncate">{p.sector || '—'}</td>
                  <td className="px-3 py-2 text-xs max-w-[160px]">
                    {p.contact_type ? (
                      isIncentivizedType(p.contact_type) ? (
                        <span className="inline-block px-2 py-0.5 rounded border border-amber-400/80 bg-amber-50 text-amber-950 font-medium truncate max-w-full">
                          {p.contact_type}
                        </span>
                      ) : (
                        <span className="truncate block max-w-full">{p.contact_type}</span>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {p.incentive_score != null ? Math.round(p.incentive_score) : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{p.outreach_priority ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-deep-navy">Recommend Targets</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-pale-sky overflow-hidden text-sm">
            <button
              type="button"
              className={`px-3 py-2 ${recommendMode === 'rules' ? 'bg-deep-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
              onClick={() => setRecommendMode('rules')}
            >
              Rules-based
            </button>
            <button
              type="button"
              className={`px-3 py-2 border-l border-pale-sky ${recommendMode === 'ai' ? 'bg-deep-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
              onClick={() => setRecommendMode('ai')}
            >
              AI
            </button>
          </div>
          <button
            type="button"
            disabled={recommendBusy}
            onClick={runRecommend}
            className="px-4 py-2 rounded-xl bg-deep-navy text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {recommendBusy ? 'Recommending…' : 'Run recommendation'}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={exportShortlist}
            className="px-3 py-2 rounded-lg border border-pale-sky text-sm font-medium text-deep-navy bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export shortlist'}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={createWeekSlate}
            className="px-3 py-2 rounded-lg border border-pale-sky text-sm font-medium text-deep-navy bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Create week slate
          </button>
        </div>
        {recommendError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{recommendError}</div>
        )}
        {recommendInfo && (
          <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {recommendInfo}
          </div>
        )}
        {recommendations.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-pale-sky/80">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#1F4E79] text-white text-left">
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Contact type</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {recommendations.map((rec) => (
                  <tr key={rec.verifiability.row_index} className="border-t border-pale-sky/60 bg-white">
                    <td className="px-3 py-2 font-medium text-deep-navy">{rec.prospect.company}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {rec.composite_score != null ? Math.round(rec.composite_score) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{rec.prospect.contact_type || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-medium text-steel-blue hover:underline"
                        onClick={() => openVerifiability(rec)}
                      >
                        Verify details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VerifiabilityDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerItem(null);
        }}
        item={drawerItem}
      />
    </div>
  );
}

function DiscoveryPanel() {
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
    loadRuns();
  }, [loadRuns]);

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
    refreshSelected();
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
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Apple"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Domain (recommended)</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="apple.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">LinkedIn company URL (optional)</label>
            <input
              className="w-full rounded-lg border border-pale-sky px-3 py-2 text-sm"
              value={linkedinUrl}
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
              value={maxProspects}
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
            <table className="min-w-full text-sm">
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

function keptLabel(kept: number) {
  if (kept === 1) return 'kept';
  if (kept === -1) return 'dropped';
  return 'pending';
}

function CombPanel() {
  const [releases, setReleases] = useState<any[]>([]);
  const [releaseId, setReleaseId] = useState<number | ''>('');
  const [release, setRelease] = useState<any | null>(null);
  const [inbox, setInbox] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mintName, setMintName] = useState('');
  const [mintTitle, setMintTitle] = useState('');
  const [mintTargetId, setMintTargetId] = useState<number | ''>('');

  const loadReleases = useCallback(() => {
    api.yucg.listReleases().then(setReleases).catch(() => setReleases([]));
  }, []);

  const loadRelease = useCallback(async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      const [rel, box] = await Promise.all([api.yucg.getRelease(id), api.yucg.releaseInbox(id).catch(() => [])]);
      setRelease(rel);
      setInbox(box);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load release');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadReleases();
  }, [loadReleases]);

  useEffect(() => {
    if (releaseId) loadRelease(Number(releaseId));
    else {
      setRelease(null);
      setInbox([]);
    }
  }, [releaseId, loadRelease]);

  useEffect(() => {
    const first = release?.targets?.[0]?.id;
    if (first && mintTargetId === '') setMintTargetId(first);
  }, [release, mintTargetId]);

  const people: any[] = release?.people || [];
  const targets: any[] = release?.targets || [];
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of people) {
      const key = (p.company_domain || p.company || 'unknown').toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [people]);

  const decide = async (personId: number, keep: boolean) => {
    if (!releaseId) return;
    setBusy(true);
    try {
      await api.yucg.keepPerson(Number(releaseId), personId, keep);
      await loadRelease(Number(releaseId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Keep/drop failed');
    } finally {
      setBusy(false);
    }
  };

  const mint = async () => {
    if (!releaseId || !mintTargetId || !mintName.trim()) return;
    setBusy(true);
    try {
      await api.yucg.mintPerson(Number(releaseId), Number(mintTargetId), {
        full_name: mintName.trim(),
        title: mintTitle.trim() || undefined,
      });
      setMintName('');
      await loadRelease(Number(releaseId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mint failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={releaseId}
            onChange={(e) => setReleaseId(e.target.value ? Number(e.target.value) : '')}
            className="px-3 py-2 rounded-lg border border-pale-sky text-sm bg-white"
          >
            <option value="">Select a week slate</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (#{r.id})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!releaseId || busy}
            onClick={() => releaseId && api.yucg.rebuildPack(Number(releaseId)).catch((e) => setError(e.message))}
            className="px-3 py-2 rounded-lg border border-pale-sky text-sm"
          >
            Rebuild Think-Cell pack
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Hunter Chrome is on your laptop (50 credits/mo). Keep may call Verifalia (25/day). No inbox-verified badge.
        </p>
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      </div>

      {release && (
        <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-semibold text-deep-navy">Mint a candidate</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-xs text-slate-600">
              Company
              <select
                value={mintTargetId}
                onChange={(e) => setMintTargetId(e.target.value ? Number(e.target.value) : '')}
                className="block mt-1 px-3 py-2 rounded-lg border border-pale-sky text-sm bg-white"
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.company} {t.company_domain ? `(${t.company_domain})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={mintName}
              onChange={(e) => setMintName(e.target.value)}
              placeholder="Full name"
              className="px-3 py-2 rounded-lg border border-pale-sky text-sm"
            />
            <input
              value={mintTitle}
              onChange={(e) => setMintTitle(e.target.value)}
              placeholder="Title"
              className="px-3 py-2 rounded-lg border border-pale-sky text-sm"
            />
            <button
              type="button"
              disabled={busy || !mintName.trim() || !mintTargetId}
              onClick={mint}
              className="px-3 py-2 rounded-lg bg-deep-navy text-white text-sm disabled:opacity-50"
            >
              Mint inferred email
            </button>
          </div>
        </div>
      )}

      {grouped.map(([domain, rows]) => (
        <div key={domain} className="surface-card rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="px-4 py-3 bg-[#1F4E79] text-white text-sm font-medium">{domain}</div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left bg-slate-50">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-pale-sky/60">
                  <td className="px-3 py-2">{p.full_name || '—'}</td>
                  <td className="px-3 py-2 text-xs">{p.title || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.email || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {keptLabel(Number(p.kept))}
                    {p.email_status ? ` · ${p.email_status}` : ''}
                    {p.vendor_check ? ` · ${p.vendor_check}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button type="button" disabled={busy} onClick={() => decide(p.id, true)} className="text-xs font-medium text-emerald-800 hover:underline">
                      Keep
                    </button>
                    <button type="button" disabled={busy} onClick={() => decide(p.id, false)} className="text-xs font-medium text-red-700 hover:underline">
                      Drop
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {release && (
        <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-deep-navy">Inbox (sent / replied / bounced)</h2>
          {inbox.length === 0 ? (
            <p className="text-sm text-slate-600">No campaign rows for kept people yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left bg-slate-50">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Send status</th>
                </tr>
              </thead>
              <tbody>
                {inbox.map((row) => (
                  <tr key={row.id} className="border-t border-pale-sky/60">
                    <td className="px-3 py-2">{row.name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.email}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.status}
                      {row.email_verification_status === 'dead' ? ' · dead' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function YucgOutreach() {
  const [pageTab, setPageTab] = useState<PageTab>('coordinator');

  return (
    <div className="max-w-6xl mx-auto space-y-6 px-4 pb-12" data-section="yucgoutreach">
      <PageHeader
        title="Outreach week"
        subtitle="Cut a slate, comb people by domain, then send from Studio."
        imageSrc="/yucg-bg/team-banner.jpg"
      />

      <AppTabMenu
        tabs={[
          { id: 'coordinator', label: 'Coordinator' },
          { id: 'comb', label: 'Comb' },
          { id: 'discovery', label: 'Company discovery' },
        ]}
        active={pageTab}
        onChange={(id) => setPageTab(id as PageTab)}
      />

      {pageTab === 'coordinator' ? <CoordinatorPanel /> : pageTab === 'comb' ? <CombPanel /> : <DiscoveryPanel />}
    </div>
  );
}
