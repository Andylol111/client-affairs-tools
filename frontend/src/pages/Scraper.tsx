import { useState, useRef, useEffect } from 'react';
import { api, type EmailPatternRow, type DiscoveryLogEntry } from '../api';
import AppSubnav from '../components/AppSubnav';
import PageHeader from '../components/PageHeader';

type ScraperTab = 'import' | 'scrape' | 'find';

type ScrapeProgressState = {
  phase: string;
  pct: number;
  message: string;
  detail: string | null;
};

const PHASE_TYPICAL: Record<string, string> = {
  init: 'Startup is usually a few seconds.',
  domain: 'Site crawl: often 30 seconds–2 minutes depending on pages and latency.',
  web: 'Web search: Tavily scans LinkedIn, press, and directories (30–90 seconds).',
  linkedin: 'LinkedIn step: Apify runs about 1–3 minutes; public page fallback is faster but yields fewer people.',
  prepare: 'Inbox + AI agent pools run in parallel (6 threaded Bedrock agents by default).',
  save: 'Database save: quick unless you are upserting hundreds of rows.',
};

function aiVerdictLabel(v?: string | null): string {
  switch (v) {
    case 'real':
      return 'Real name';
    case 'suspicious':
      return 'Suspicious';
    case 'junk':
      return 'Junk';
    case 'unreviewed':
      return 'Unreviewed';
    default:
      return '—';
  }
}

function aiVerdictClass(v?: string | null): string {
  switch (v) {
    case 'real':
      return 'bg-emerald-100 text-emerald-800';
    case 'suspicious':
      return 'bg-amber-100 text-amber-800';
    case 'junk':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-pale-sky/50 text-slate-blue';
  }
}

function formatScrapeSummary(res: {
  count?: number;
  found_total?: number;
  duplicates_skipped?: number;
  ai_junk_skipped?: number;
}): string {
  const found = res.found_total ?? res.count ?? 0;
  const saved = res.count ?? 0;
  const dupes = res.duplicates_skipped ?? 0;
  const junk = res.ai_junk_skipped ?? 0;
  const parts: string[] = [];
  parts.push(`Found ${found} on page`);
  if (saved > 0) parts.push(`${saved} new saved`);
  if (dupes > 0) parts.push(`${dupes} already in database (shown below)`);
  if (junk > 0) parts.push(`${junk} junk removed (not shown)`);
  if (saved === 0 && found > 0 && dupes === found) {
    return `Found ${found} contacts on page — all already in your database. They are listed below with fresh scrape metadata.`;
  }
  return parts.join(' · ');
}

function inboxStatusLabel(status?: string | null): string {
  switch (status) {
    case 'valid':
      return 'Verified inbox';
    case 'likely_valid':
      return 'Likely deliverable';
    case 'invalid':
      return 'Invalid';
    default:
      return 'Unknown';
  }
}

function inboxStatusClass(status?: string | null): string {
  switch (status) {
    case 'valid':
      return 'bg-emerald-100 text-emerald-800';
    case 'likely_valid':
      return 'bg-sky-100 text-sky-800';
    case 'invalid':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-pale-sky/50 text-slate-blue';
  }
}

function formatEtaSeconds(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return 'calculating…';
  if (sec < 90) return `~${Math.max(1, Math.round(sec))} seconds`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `~${m} min ${s} sec`;
}

/** `tick` bumps on an interval so elapsed/ETA refresh while backend progress is sparse (e.g. Apify). */
function elapsedSecondsSince(startedAt: number | null, tick: number): number {
  if (!startedAt) return 0;
  void tick;
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
}

function ScrapeProgressPanel({
  progress,
  startedAt,
  tick,
}: {
  progress: ScrapeProgressState | null;
  startedAt: number | null;
  tick: number;
}) {
  const pct = progress?.pct ?? 0;
  let etaSec: number | null = null;
  if (startedAt && pct >= 4 && pct < 98) {
    const el = (Date.now() - startedAt) / 1000;
    if (el >= 1.2) {
      etaSec = el * (100 / pct - 1);
    }
  }
  const phaseKey = progress?.phase ?? 'init';
  const typical = PHASE_TYPICAL[phaseKey] ?? PHASE_TYPICAL.init;
  const detailLine = progress?.detail;
  const tooltipTitle = [
    progress?.message,
    detailLine || '',
    `Typical: ${typical}`,
    etaSec != null ? `ETA: ${formatEtaSeconds(etaSec)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mt-5 space-y-2">
      <div className="rounded-xl border border-pale-sky bg-white/90 px-4 py-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between mb-2">
          <p className="text-[13px] font-medium text-deep-navy">{progress?.message || 'Working…'}</p>
          <span className="text-[12px] tabular-nums text-slate-600">{Math.round(pct)}%</span>
        </div>
        <div className="relative group">
          <div
            className="relative h-2.5 rounded-full bg-pale-sky/70 overflow-hidden outline-none cursor-help"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-valuetext={tooltipTitle}
            title={tooltipTitle}
          >
            <div
              className="h-full rounded-full bg-[var(--btn-primary-bg)] transition-[width] duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <div
            className="pointer-events-none absolute left-0 right-0 bottom-full mb-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150 z-20"
            role="tooltip"
          >
            <div className="rounded-lg border border-pale-sky bg-white shadow-lg px-3 py-2.5 text-[12px] text-slate-700 leading-snug space-y-1.5">
              <p>
                <span className="font-semibold text-deep-navy">ETA (trend): </span>
                {etaSec != null
                  ? formatEtaSeconds(etaSec)
                  : 'Not enough progress yet—estimate appears after ~4% and a couple of seconds.'}
              </p>
              <p>
                <span className="font-semibold text-deep-navy">Typical for this phase: </span>
                {typical}
              </p>
              {detailLine && (
                <p className="text-slate-600 border-t border-pale-sky/60 pt-1.5 mt-1">
                  <span className="font-medium text-deep-navy">Detail: </span>
                  {detailLine}
                </p>
              )}
              <p className="text-[11px] text-slate-500">
                Elapsed {startedAt ? `${elapsedSecondsSince(startedAt, tick)} s` : '—'} · Estimates assume current pace;
                LinkedIn/Apify steps can stall then finish quickly.
              </p>
            </div>
          </div>
        </div>
        {detailLine && (
          <p className="mt-2 text-[11px] text-slate-500 truncate" title={detailLine}>
            {detailLine}
          </p>
        )}
      </div>
      <p className="text-[11px] text-slate-500 px-1">
        Hover the progress bar for ETA and phase notes. The table preview below matches the columns of your results.
      </p>
    </div>
  );
}

function ScrapeResultsSkeleton() {
  const rows = 8;
  return (
    <div className="mt-6 bg-white rounded-2xl overflow-hidden shadow-sm border border-pale-sky" aria-busy="true" aria-label="Loading contacts preview">
      <div className="px-5 py-4 border-b border-pale-sky flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="h-4 w-44 rounded-md bg-slate-200/90 animate-pulse" />
        <span className="text-xs text-slate-500">Rows below mirror the table that will fill in when scraping completes</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[12px] text-slate-blue font-medium bg-pale-sky/40">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">LinkedIn</th>
              <th className="px-4 py-3">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-t border-pale-sky/50">
                <td className="px-4 py-3">
                  <div className="h-3.5 rounded bg-slate-200/80 animate-pulse w-[72%] max-w-[12rem]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-3.5 rounded bg-slate-200/70 animate-pulse w-[85%] max-w-[14rem]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-3.5 rounded bg-slate-200/70 animate-pulse w-[55%] max-w-[10rem]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-3.5 rounded bg-slate-200/70 animate-pulse w-[60%] max-w-[9rem]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-3.5 rounded bg-slate-200/65 animate-pulse w-16" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 rounded-md bg-slate-200/75 animate-pulse w-14" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Scraper() {
  const [activeTab, setActiveTab] = useState<ScraperTab>('scrape');
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [linkedinMaxEmployees, setLinkedinMaxEmployees] = useState(50);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [findName, setFindName] = useState('');
  const [findCompany, setFindCompany] = useState('');
  const [findLoading, setFindLoading] = useState(false);
  const [findResult, setFindResult] = useState<{
    query: string;
    results: { title?: string; url?: string; content?: string }[];
    summary: string | null;
    message: string | null;
  } | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgressState | null>(null);
  const [scrapeTick, setScrapeTick] = useState(0);
  const scrapeStartedAtRef = useRef<number | null>(null);
  const scrapeAbortRef = useRef<AbortController | null>(null);
  const [scrapeCancelArmed, setScrapeCancelArmed] = useState(false);
  const scrapeCancelArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emailPatterns, setEmailPatterns] = useState<EmailPatternRow[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [purging, setPurging] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [discoveryLog, setDiscoveryLog] = useState<DiscoveryLogEntry[]>([]);
  const [scrapeRunId, setScrapeRunId] = useState<string | null>(null);
  const [showDiscoveryLog, setShowDiscoveryLog] = useState(false);

  useEffect(() => {
    if (!loading || activeTab !== 'scrape') return;
    const id = window.setInterval(() => setScrapeTick((t) => t + 1), 450);
    return () => clearInterval(id);
  }, [loading, activeTab]);

  useEffect(() => {
    return () => {
      if (scrapeCancelArmTimeoutRef.current) clearTimeout(scrapeCancelArmTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const raw = domain.trim();
    if (!raw) {
      setEmailPatterns([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setPatternsLoading(true);
      try {
        const res = await api.contacts.emailPatterns(raw);
        setEmailPatterns(res.patterns || []);
      } catch {
        setEmailPatterns([]);
      } finally {
        setPatternsLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [domain]);

  const handleReconcileIdentity = async () => {
    setReconciling(true);
    setError('');
    setInfoMessage('');
    try {
      const res = await api.contacts.reconcileIdentity(domain.trim() || undefined);
      setInfoMessage(
        `Identity pass: ${res.fixed} fixed, ${res.removed} removed, ${res.unchanged} unchanged.`
      );
    } catch (e: any) {
      setError(e.message || 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  };

  const handlePurgeJunk = async () => {
    if (!window.confirm('Delete saved contacts that look like nav/product labels (Gift Cards, Mac Studio, etc.)?')) return;
    setPurging(true);
    setError('');
    setInfoMessage('');
    try {
      const res = await api.contacts.purgeJunkContacts(domain.trim() || undefined);
      setInfoMessage(`Removed ${res.removed} junk contact(s) from the database.`);
    } catch (e: any) {
      setError(e.message || 'Purge failed');
    } finally {
      setPurging(false);
    }
  };

  const handleClearContactsCache = async () => {
    const dom = domain.trim();
    const scope = dom ? `contacts matching ${dom}` : 'ALL contacts in the database';
    if (
      !window.confirm(
        `Clear ${scope}?\n\nThis permanently deletes those contacts plus related campaign rows, notes, and generated emails. Email pattern cache and AI discovery logs can be cleared too on the next step.`
      )
    ) {
      return;
    }
    const alsoCaches = window.confirm(
      'Also clear email pattern cache and AI discovery logs?\n\nOK = yes, clear everything listed above.\nCancel = delete contacts only (keep learned email patterns).'
    );
    if (
      !window.confirm(
        `Last chance: permanently delete ${scope}${alsoCaches ? ', email patterns, and discovery logs' : ''}.\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setClearing(true);
    setError('');
    setInfoMessage('');
    try {
      const res = await api.contacts.clearAll({
        confirm: true,
        domain: dom || undefined,
        clear_pattern_cache: alsoCaches,
        clear_discovery_logs: alsoCaches,
      });
      setContacts([]);
      setDiscoveryLog([]);
      setScrapeRunId(null);
      if (alsoCaches) setEmailPatterns([]);
      setInfoMessage(
        `Cleared ${res.contacts_deleted} contact(s)` +
          (alsoCaches
            ? `, ${res.patterns_deleted} email pattern(s), ${res.discovery_logs_deleted} discovery log row(s).`
            : '.')
      );
    } catch (e: any) {
      setError(e.message || 'Clear failed');
    } finally {
      setClearing(false);
    }
  };

  const disarmScrapeCancel = () => {
    setScrapeCancelArmed(false);
    if (scrapeCancelArmTimeoutRef.current) {
      clearTimeout(scrapeCancelArmTimeoutRef.current);
      scrapeCancelArmTimeoutRef.current = null;
    }
  };

  const handleScrapeCancelClick = () => {
    if (!loading) return;
    if (!scrapeCancelArmed) {
      setScrapeCancelArmed(true);
      if (scrapeCancelArmTimeoutRef.current) clearTimeout(scrapeCancelArmTimeoutRef.current);
      scrapeCancelArmTimeoutRef.current = setTimeout(() => {
        setScrapeCancelArmed(false);
        scrapeCancelArmTimeoutRef.current = null;
      }, 6000);
      return;
    }
    if (
      !window.confirm(
        'Stop this scrape?\n\nThe request will disconnect. Any Apify actor run will be aborted when possible, and no further contacts will be saved. Rows already written stay in the database.'
      )
    ) {
      disarmScrapeCancel();
      return;
    }
    scrapeAbortRef.current?.abort();
    disarmScrapeCancel();
  };

  const handleScrape = async () => {
    if (!companyName && !domain && !linkedinUrl) {
      setError('Enter company name, domain, or LinkedIn URL');
      return;
    }
    disarmScrapeCancel();
    setLoading(true);
    setError('');
    setInfoMessage('');
    setContacts([]);
    setDiscoveryLog([]);
    setScrapeRunId(null);
    scrapeStartedAtRef.current = Date.now();
    setScrapeProgress({
      phase: 'init',
      pct: 0,
      message: 'Connecting to scraper…',
      detail: null,
    });
    const ac = new AbortController();
    scrapeAbortRef.current = ac;
    try {
      const res = await api.contacts.scrapeStream(
        {
          company_name: companyName || undefined,
          domain: domain || undefined,
          linkedin_url: linkedinUrl || undefined,
          linkedin_max_employees: linkedinUrl ? linkedinMaxEmployees : undefined,
        },
        (ev) => {
          if (ev.type === 'progress') {
            setScrapeProgress({
              phase: String(ev.phase ?? ''),
              pct: typeof ev.pct === 'number' ? ev.pct : Number(ev.pct) || 0,
              message: String(ev.message ?? ''),
              detail: ev.detail != null ? String(ev.detail) : null,
            });
          }
        },
        { signal: ac.signal }
      );
      if (res.cancelled) {
        setContacts(res.contacts || []);
        setDiscoveryLog(res.discovery_log || []);
        setScrapeRunId(res.scrape_run_id || null);
        if ((res.contacts?.length || 0) > 0) {
          setInfoMessage(formatScrapeSummary(res));
        } else {
          setInfoMessage('Scrape stopped. Any in-flight Apify run was aborted when possible.');
        }
        return;
      }
      setContacts(res.contacts || []);
      setDiscoveryLog(res.discovery_log || []);
      setScrapeRunId(res.scrape_run_id || null);
      if ((res.found_total || res.count || 0) > 0) {
        setInfoMessage(formatScrapeSummary(res));
      } else {
        setInfoMessage('');
      }
    } catch (e: any) {
      setError(e.message || 'Scrape failed');
    } finally {
      scrapeAbortRef.current = null;
      setLoading(false);
      setScrapeProgress(null);
      scrapeStartedAtRef.current = null;
      disarmScrapeCancel();
    }
  };

  const handleFindContact = async () => {
    const name = findName.trim();
    if (!name) {
      setError('Enter a name to search for.');
      return;
    }
    setFindLoading(true);
    setError('');
    setFindResult(null);
    try {
      const res = await api.contacts.searchPerson({ name, company: findCompany.trim() || undefined });
      setFindResult(res);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Search failed');
    } finally {
      setFindLoading(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setInfoMessage('');
    setContacts([]);
    try {
      const res = await api.contacts.importFile(file);
      setContacts(res.contacts);
      if (res.duplicates_skipped && res.duplicates_skipped > 0) {
        setInfoMessage(`Imported ${res.count} contacts. ${res.duplicates_skipped} duplicate(s) skipped (existing email).`);
      } else if (res.count > 0) {
        setInfoMessage(`Imported ${res.count} contact(s).`);
      } else {
        setInfoMessage('');
      }
    } catch (e: any) {
      setError(e.message || 'Import failed');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 pb-12">
      <PageHeader
        title="Find"
        subtitle="Crawl, LinkedIn, Tavily. Rank uses Haiku on Bedrock."
        imageSrc="/yucg-bg/texture-panel.jpg"
      />

      <AppSubnav
        className="mb-8"
        items={[
          { id: 'scrape', label: 'Scrape Website' },
          { id: 'find', label: 'Find Contact' },
          { id: 'import', label: 'Import Spreadsheet' },
        ]}
        active={activeTab}
        onChange={(id) => {
          setActiveTab(id as ScraperTab);
          setError('');
          if (id !== 'find') setFindResult(null);
        }}
      />

      {activeTab === 'scrape' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-pale-sky">
            <div className="px-5 py-4 border-b border-pale-sky">
              <h2 className="text-[15px] font-semibold text-deep-navy">Scrape from Web</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Enter company name, domain, or LinkedIn URL. We check the company website (about, team, contact, leadership pages), LinkedIn company employees (via Apify), and merge results.
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Company name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-pale-sky/30 text-deep-navy placeholder-slate-blue/70 text-[15px] border border-pale-sky/50 focus:ring-2 focus:ring-steel-blue/40 focus:ring-offset-0 focus:border-steel-blue transition-shadow"
                />
                <input
                  type="text"
                  placeholder="Domain (e.g. acme.com)"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-pale-sky/30 text-deep-navy placeholder-slate-blue/70 text-[15px] border border-pale-sky/50 focus:ring-2 focus:ring-steel-blue/40 focus:ring-offset-0 focus:border-steel-blue transition-shadow"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <input
                  type="url"
                  placeholder="LinkedIn company URL"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  className="flex-1 w-full px-4 py-3 rounded-xl bg-pale-sky/30 text-deep-navy placeholder-slate-blue/70 text-[15px] border border-pale-sky/50 focus:ring-2 focus:ring-steel-blue/40 focus:ring-offset-0 focus:border-steel-blue transition-shadow"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <label htmlFor="max-employees" className="text-[15px] text-slate-blue whitespace-nowrap">Max Employees</label>
                  <input
                    id="max-employees"
                    type="number"
                    min={5}
                    max={100}
                    value={linkedinMaxEmployees}
                    onChange={(e) => setLinkedinMaxEmployees(parseInt(e.target.value, 10) || 50)}
                    className="w-20 px-3 py-2 rounded-lg bg-pale-sky/30 text-deep-navy text-[15px] text-right border border-pale-sky/50"
                  />
                </div>
              </div>
              {(domain.trim() || patternsLoading || emailPatterns.length > 0) && (
                <div className="rounded-xl border border-pale-sky/80 bg-pale-sky/20 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-[13px] font-medium text-deep-navy">
                      Email layout cache {domain.trim() ? `· ${domain.trim()}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleReconcileIdentity}
                        disabled={reconciling}
                        className="text-[12px] font-semibold text-steel-blue hover:text-deep-navy disabled:opacity-50"
                      >
                        {reconciling ? 'Reconciling…' : 'Fix identity mismatches'}
                      </button>
                      <button
                        type="button"
                        onClick={handlePurgeJunk}
                        disabled={purging}
                        className="text-[12px] font-semibold text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        {purging ? 'Purging…' : 'Remove nav junk contacts'}
                      </button>
                    </div>
                  </div>
                  {patternsLoading ? (
                    <p className="text-[12px] text-slate-500">Loading patterns…</p>
                  ) : emailPatterns.length === 0 ? (
                    <p className="text-[12px] text-slate-500">
                      No learned patterns yet for this domain. Verified scrapes will populate{' '}
                      <span className="font-mono">first.last</span>, <span className="font-mono">flast</span>, etc.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {emailPatterns.map((p) => (
                        <li key={p.pattern_key} className="text-[12px] text-slate-700 flex flex-wrap gap-x-2 gap-y-0.5">
                          <span className="font-mono font-medium text-deep-navy">{p.pattern_template}</span>
                          <span className="text-slate-500">
                            {Math.round((p.confidence || 0) * 100)}% · {p.verified_samples} verified · {p.sample_count} samples
                          </span>
                          {p.sources && p.sources.length > 0 && (
                            <span className="text-slate-400">({p.sources.join(', ')})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="p-4 pt-0">
              <div className="flex gap-2 w-full items-stretch">
                <button
                  type="button"
                  onClick={handleScrape}
                  disabled={loading || (!companyName && !domain && !linkedinUrl)}
                  className="flex-1 min-w-0 py-3.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] active:scale-[0.99] text-[var(--btn-primary-text)] text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all"
                >
                  {loading ? 'Scraping…' : 'Start Scraping'}
                </button>
                <button
                  type="button"
                  onClick={handleScrapeCancelClick}
                  disabled={!loading}
                  title={
                    loading
                      ? scrapeCancelArmed
                        ? 'Click again to confirm stop'
                        : 'First click arms stop; click again, then confirm'
                      : undefined
                  }
                  className={`shrink-0 rounded-xl text-[14px] font-semibold transition-all duration-300 ease-out border-2 whitespace-nowrap ${
                    loading
                      ? 'max-w-[min(100%,13rem)] opacity-100 px-3 sm:px-4 py-3 border-red-300 bg-red-50 text-red-800 hover:bg-red-100 shadow-sm translate-x-0'
                      : 'max-w-0 min-w-0 opacity-0 px-0 py-3 border-transparent bg-transparent text-transparent pointer-events-none overflow-hidden -translate-x-1'
                  } ${scrapeCancelArmed ? 'ring-2 ring-amber-400 ring-offset-1' : ''} disabled:pointer-events-none`}
                >
                  {scrapeCancelArmed ? 'Confirm stop' : 'Stop scrape'}
                </button>
              </div>
              {loading && (
                <p className="text-[11px] text-slate-500 mt-2 px-0.5">
                  <strong className="text-slate-600">Stop scrape</strong> slides out next to Start. Tap it once to arm, again—then confirm—to disconnect and abort Apify.
                </p>
              )}
              <div className="mt-4 pt-4 border-t border-pale-sky/80 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-slate-600">
                  Reset saved contacts{domain.trim() ? ` for ${domain.trim()}` : ''} before a fresh scrape.
                </p>
                <button
                  type="button"
                  onClick={handleClearContactsCache}
                  disabled={clearing || loading}
                  className="text-[12px] font-semibold text-red-800 hover:text-red-950 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50/80"
                >
                  {clearing ? 'Clearing…' : 'Clear contacts & cache…'}
                </button>
              </div>
            </div>
          </div>

          {(loading || scrapeProgress) && (
            <ScrapeProgressPanel
              progress={scrapeProgress}
              startedAt={scrapeStartedAtRef.current}
              tick={scrapeTick}
            />
          )}

          {loading && activeTab === 'scrape' && <ScrapeResultsSkeleton />}

          {error && <p className="text-[#ff3b30] text-[13px] px-1 mt-2">{error}</p>}
          {infoMessage && <p className="text-emerald-600 text-[13px] px-1 mt-2">{infoMessage}</p>}
        </div>
      )}

      {activeTab === 'find' && (
        <div className="space-y-6">
          <div className="surface-card rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-pale-sky">
              <h2 className="text-[15px] font-semibold text-deep-navy">Find A Contact</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Search the web for a person by name (and optional company). We use web search and optional LLM to summarize contact-relevant info.
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Full name"
                  value={findName}
                  onChange={(e) => setFindName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-pale-sky/30 text-deep-navy placeholder-slate-blue/70 text-[15px] border border-pale-sky/50 focus:ring-2 focus:ring-steel-blue/40 focus:ring-offset-0 focus:border-steel-blue transition-shadow"
                />
                <input
                  type="text"
                  placeholder="Company (optional)"
                  value={findCompany}
                  onChange={(e) => setFindCompany(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-pale-sky/30 text-deep-navy placeholder-slate-blue/70 text-[15px] border border-pale-sky/50 focus:ring-2 focus:ring-steel-blue/40 focus:ring-offset-0 focus:border-steel-blue transition-shadow"
                />
              </div>
              <button
                onClick={handleFindContact}
                disabled={findLoading || !findName.trim()}
                className="w-full py-3.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {findLoading ? 'Searching...' : 'Search for Contact'}
              </button>
            </div>
          </div>
          {findResult && (
            <div className="surface-card rounded-2xl overflow-hidden shadow-sm p-5">
              <h3 className="text-[15px] font-semibold text-deep-navy mb-3">Results for “{findResult.query}”</h3>
              {findResult.message && !findResult.results?.length && (
                <p className="text-[13px] text-slate-500 mb-3">{findResult.message}</p>
              )}
              {findResult.summary && (
                <div className="p-4 rounded-xl bg-pale-sky/20 border border-pale-sky/50 mb-4">
                  <p className="text-sm font-medium text-deep-navy mb-1">Summary</p>
                  <p className="text-[13px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{findResult.summary}</p>
                </div>
              )}
              {findResult.results && findResult.results.length > 0 && (
                <ul className="space-y-2">
                  {findResult.results.map((r, i) => (
                    <li key={i} className="border-b border-pale-sky/50 pb-2 last:border-0">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-steel-blue hover:underline">
                          {r.title || r.url}
                        </a>
                      ) : (
                        <span className="text-[13px] font-medium text-deep-navy">{r.title || 'Result'}</span>
                      )}
                      {r.content && <p className="text-[12px] text-slate-500 mt-0.5 line-clamp-2">{r.content}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && activeTab === 'find' && <p className="text-[#ff3b30] text-[13px] px-1 mt-2">{error}</p>}
        </div>
      )}

      {activeTab === 'import' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-pale-sky">
            <div className="px-5 py-4 border-b border-pale-sky">
              <h2 className="text-[15px] font-semibold text-deep-navy">Import from Spreadsheet</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">
                CSV or Excel with name, email, title, company
              </p>
            </div>
            <div className="p-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                onChange={handleImport}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="w-full py-3.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] active:scale-[0.99] text-[var(--btn-primary-text)] text-[15px] font-semibold disabled:opacity-50 transition-all"
              >
                {importing ? 'Importing...' : 'Import File'}
              </button>
            </div>
          </div>
          {error && <p className="text-[#ff3b30] text-[13px] px-1">{error}</p>}
          {infoMessage && activeTab === 'import' && <p className="text-emerald-600 text-[13px] px-1 mt-2">{infoMessage}</p>}
        </div>
      )}

      {contacts.length > 0 && (
        <div className="mt-8 bg-white rounded-2xl overflow-hidden shadow-sm border border-pale-sky">
          <div className="px-5 py-4 border-b border-pale-sky flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-deep-navy">Discovered ({contacts.length})</h2>
            {discoveryLog.length > 0 && (
              <button
                type="button"
                onClick={() => setShowDiscoveryLog((v) => !v)}
                className="text-[12px] font-semibold text-steel-blue hover:text-deep-navy"
              >
                {showDiscoveryLog ? 'Hide' : 'Show'} AI audit log ({discoveryLog.length})
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[12px] text-slate-blue font-medium bg-pale-sky/40">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">AI</th>
                  <th className="px-4 py-3">DB</th>
                  <th className="px-4 py-3">Inbox</th>
                  <th className="px-4 py-3">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr
                    key={c.id ?? c.email}
                    className={`border-t border-pale-sky/50 hover:bg-pale-sky/20 ${c.ai_rejected ? 'opacity-70' : ''}`}
                  >
                    <td className="px-4 py-3 text-[14px] text-deep-navy">{c.name}</td>
                    <td className="px-4 py-3 text-[14px] text-steel-blue">{c.email}</td>
                    <td className="px-4 py-3 text-[14px] text-deep-navy max-w-[12rem] truncate" title={c.title}>{c.title || '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-600 max-w-[10rem]">
                      <div>{c.contact_source || c.scrape_source || '—'}</div>
                      {(c.source_url || c.scrape_source_url) && (
                        <a
                          href={c.source_url || c.scrape_source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-steel-blue hover:text-deep-navy truncate block max-w-[10rem]"
                          title={c.source_url || c.scrape_source_url}
                        >
                          page
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${aiVerdictClass(c.ai_verdict)}`}
                        title={[c.ai_reason, c.ai_source_note].filter(Boolean).join(' · ')}
                      >
                        {aiVerdictLabel(c.ai_verdict)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.ai_rejected ? (
                        <span className="text-[11px] text-red-700 font-medium">Not saved</span>
                      ) : c.already_exists ? (
                        <span className="text-[11px] text-slate-600 font-medium">In database</span>
                      ) : (
                        <span className="text-[11px] text-emerald-700 font-medium">New</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${inboxStatusClass(c.email_verification_status)}`}
                        title={c.email_verification_status || 'unknown'}
                      >
                        {inboxStatusLabel(c.email_verification_status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[12px] font-medium ${
                          c.confidence === 'high'
                            ? 'bg-pale-sky/60 text-steel-blue'
                            : c.confidence === 'medium'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-pale-sky/40 text-slate-blue'
                        }`}
                      >
                        {c.confidence}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showDiscoveryLog && discoveryLog.length > 0 && (
            <div className="border-t border-pale-sky px-5 py-4 bg-pale-sky/15 max-h-80 overflow-y-auto">
              <p className="text-[12px] font-semibold text-deep-navy mb-2">
                AI audit log {scrapeRunId ? `· run ${scrapeRunId.slice(0, 8)}…` : ''}
              </p>
              <ul className="space-y-2">
                {discoveryLog.map((e, i) => (
                  <li key={`${e.email}-${i}`} className="text-[12px] text-slate-700 border border-pale-sky/60 rounded-lg px-3 py-2 bg-white/80">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-medium text-deep-navy">
                      <span>{e.name || '—'}</span>
                      <span className="text-steel-blue">{e.email}</span>
                      <span className={`px-1.5 rounded ${aiVerdictClass(e.ai_verdict)}`}>{aiVerdictLabel(e.ai_verdict)}</span>
                    </div>
                    {e.ai_reason && <p className="mt-1 text-slate-600">{e.ai_reason}</p>}
                    {e.ai_source_note && <p className="text-slate-500">{e.ai_source_note}</p>}
                    {e.source_url && (
                      <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-steel-blue hover:underline block truncate mt-0.5">
                        {e.source_url}
                      </a>
                    )}
                    {e.discovery_context && (
                      <p className="text-slate-400 mt-1 italic truncate" title={e.discovery_context}>
                        “{e.discovery_context}”
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
