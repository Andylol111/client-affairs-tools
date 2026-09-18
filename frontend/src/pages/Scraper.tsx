import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Contact, type EmailPatternRow, type DiscoveryLogEntry } from '../api';
import AppSubnav from '../components/AppSubnav';
import PageHeader from '../components/PageHeader';
import CompanyDiscovery from '../components/discovery/CompanyDiscovery';
import CompanyAutocomplete from '../components/CompanyAutocomplete';
import EmailPrediction from '../components/EmailPrediction';
import { Notice } from '../components/ui/Primitives';
import ResearchWorkspace from '../components/discovery/ResearchWorkspace';
import { useProjects } from '../lib/useProjects';
import { useUrlTab } from '../lib/useUrlTab';
type ScraperTab = 'research' | 'company' | 'formats' | 'find' | 'import';


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

function aiVerdictLabel(v?: string | null): string {
  switch (v) {
    case 'real':
      return 'Looks like a person';
    case 'suspicious':
      return 'Needs review';
    case 'junk':
      return 'Not a person';
    case 'unreviewed':
      return 'Unreviewed';
    default:
      return '—';
  }
}


function inboxStatusLabel(status?: string | null): string {
  switch (status) {
    case 'valid':
      return 'Mail domain available';
    case 'likely_valid':
      return 'Mail domain available';
    case 'invalid':
      return 'No mail domain route';
    case 'mail_route_available':
      return 'Mail domain available';
    case 'inferred_from_published_pattern':
      return 'Address inferred';
    default:
      return 'Mailbox not checked';
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



function ResearchTab() {
  const { projects, error } = useProjects();
  if (error) return <Notice tone="danger">{error}</Notice>;
  return (
    <div className="space-y-6">
      <div className="surface-card rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-deep-navy mb-1">Research many companies at once</h2>
        <p className="text-sm text-slate-600">
          Define an audience once, then let research run across a batch of companies over time.
          Results land in a review queue instead of returning immediately - use Find people when
          you already know the one company to search.
        </p>
      </div>
      <ResearchWorkspace projects={projects} />
    </div>
  );
}

export default function Scraper() {
  const [params] = useSearchParams();
  // Default to the crawl: it is the one door that turns a company name into people.
  const [activeTab, setActiveTab] = useUrlTab<ScraperTab>(['research', 'company', 'formats', 'find', 'import'], 'company');
  const discoveryKey = [
    params.get('company') || '',
    params.get('domain') || '',
    params.get('titles') || '',
    params.get('max') || '',
    params.get('run') || '',
  ].join('|');
  const [domain, setDomain] = useState('');
  const [importing, setImporting] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [findName, setFindName] = useState('');
  const [findCompany, setFindCompany] = useState('');
  // Carried when the company is picked from the known list; the domain there
  // is authoritative, unlike resolving a typed display name.
  const [findCompanyDomain, setFindCompanyDomain] = useState('');
  const [findLoading, setFindLoading] = useState(false);
  const [findResult, setFindResult] = useState<{
    query: string;
    results: { title?: string; url?: string; content?: string }[];
    summary: string | null;
    message: string | null;
  } | null>(null);
  const [emailPatterns, setEmailPatterns] = useState<(EmailPatternRow & { member_asserted?: boolean })[]>([]);
  const [patternsTotal, setPatternsTotal] = useState(0);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [purging, setPurging] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [discoveryLog, setDiscoveryLog] = useState<DiscoveryLogEntry[]>([]);
  const [scrapeRunId, setScrapeRunId] = useState<string | null>(null);
  const [showDiscoveryLog, setShowDiscoveryLog] = useState(false);


  useEffect(() => {
    const raw = domain.trim();
    const t = window.setTimeout(async () => {
      setPatternsLoading(true);
      try {
        // One search path: the filter accepts a company name or a domain, and
        // an empty filter lists the whole registry instead of a dead end.
        const res = await api.contacts.emailPatternRegistry({
          ...(raw ? { q: raw } : {}),
          limit: 25,
        });
        setEmailPatterns(res.items || []);
        setPatternsTotal(res.total || 0);
      } catch {
        setEmailPatterns([]);
        setPatternsTotal(0);
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
      setInfoMessage(`Identity pass: ${res.fixed} fixed, ${res.removed} removed, ${res.unchanged} unchanged.`);
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      setError(eMessage || 'Reconcile failed');
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
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      setError(eMessage || 'Purge failed');
    } finally {
      setPurging(false);
    }
  };

  const handleClearContactsCache = async () => {
    const dom = domain.trim();
    const scope = dom ? `contacts matching ${dom}` : 'ALL contacts in the database';
    if (!window.confirm(`Clear ${scope}?\n\nThis permanently deletes those contacts plus related campaign rows, notes, and generated emails. Email pattern cache and AI discovery logs can be cleared too on the next step.`)) return;
    const alsoCaches = window.confirm('Also clear email pattern cache and AI discovery logs?\n\nOK = yes, clear everything listed above.\nCancel = delete contacts only (keep learned email patterns).');
    if (!window.confirm(`Last chance: permanently delete ${scope}${alsoCaches ? ', email patterns, and discovery logs' : ''}.\n\nThis cannot be undone.`)) return;
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
          (alsoCaches ? `, ${res.patterns_deleted} email pattern(s), ${res.discovery_logs_deleted} discovery log row(s).` : '.')
      );
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      setError(eMessage || 'Clear failed');
    } finally {
      setClearing(false);
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
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      setError(eMessage || 'Search failed');
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
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      setError(eMessage || 'Import failed');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="app-workspace pb-12">
      <PageHeader
        title="Find contacts"
        subtitle="Name a company to collect people, or search for one person by name."
      />

      <AppSubnav
        className="mb-8"
        items={[
          { id: 'company', label: 'Find people' },
          { id: 'find', label: 'One person' },
          { id: 'formats', label: 'Email formats' },
        ]}
        active={activeTab === 'import' || activeTab === 'research' ? 'company' : activeTab}
        onChange={(id) => {
          setActiveTab(id as ScraperTab);
          setError('');
          if (id !== 'find') setFindResult(null);
        }}
      />

      {activeTab === 'company' && (
        <>
          <CompanyDiscovery key={discoveryKey} />
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <button type="button" onClick={() => setActiveTab('import')} className="font-semibold text-steel-blue hover:underline">
              Have a spreadsheet already? Import it →
            </button>
            <button type="button" onClick={() => setActiveTab('research')} className="font-semibold text-steel-blue hover:underline">
              Researching many companies at once? →
            </button>
          </div>
        </>
      )}

      {(activeTab === 'import' || activeTab === 'research') && (
        <button
          type="button"
          onClick={() => setActiveTab('company')}
          className="mb-4 text-[13px] font-semibold text-steel-blue hover:underline"
        >
          ← Back to Find people
        </button>
      )}

      {activeTab === 'research' && <ResearchTab />}

      {activeTab === 'find' && (
      <>
      <div className="mt-8 surface-card rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-pale-sky">
          <h2 className="text-[15px] font-semibold text-deep-navy">Find one person</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">Search the web for one named person. To collect a company roster with inbox checks, use Find people.</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Full name"
              aria-label="Full name"
              value={findName}
              onChange={(e) => setFindName(e.target.value)}
            />
            <CompanyAutocomplete
              id="find-company"
              label="Company (optional)"
              value={findCompany}
              placeholder="Company (optional)"
              onChange={(name, option) => {
                setFindCompany(name);
                setFindCompanyDomain(option?.domain || '');
              }}
            />
          </div>
          <EmailPrediction
            name={findName}
            company={findCompany}
            companyDomain={findCompanyDomain}
            onUse={async (email, predictedDomain) => {
              setError('');
              setInfoMessage('');
              try {
                await api.contacts.create({
                  email,
                  name: findName.trim() || undefined,
                  company: findCompany.trim() || undefined,
                  // The resolved domain is what later pattern learning keys on.
                  company_domain: predictedDomain || undefined,
                  confidence: 'low',
                });
                setInfoMessage(`Saved ${email} to Contacts. It stays a derived guess until a send proves it.`);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not save that contact');
              }
            }}
          />
          <button
            type="button"
            onClick={handleFindContact}
            disabled={findLoading || !findName.trim()}
            className="w-full py-3.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-[15px] font-semibold disabled:opacity-40"
          >
            {findLoading ? 'Searching…' : 'Search for this person'}
          </button>
        </div>
      </div>
      {findResult && (
        <div className="mt-6 surface-card rounded-2xl overflow-hidden shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-deep-navy mb-3">Results for “{findResult.query}”</h3>
          {findResult.message && !findResult.results?.length && <p className="text-[13px] text-slate-500 mb-3">{findResult.message}</p>}
          {findResult.summary && (
            <div className="p-4 rounded-xl bg-pale-sky/20 border border-pale-sky/50 mb-4">
              <p className="text-sm font-medium text-deep-navy mb-1">Summary</p>
              <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{findResult.summary}</p>
            </div>
          )}
          {findResult.results && findResult.results.length > 0 && (
            <ul className="space-y-2">
              {findResult.results.map((r, i) => (
                <li key={i} className="border-b border-pale-sky/50 pb-2 last:border-0">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-steel-blue hover:underline">{r.title || r.url}</a>
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
      </>
      )}

      {activeTab === 'formats' && (
      <details className="mt-0 surface-card rounded-2xl border border-pale-sky overflow-hidden" open>
        <summary className="px-5 py-4 cursor-pointer text-[15px] font-semibold text-deep-navy">Company email formats</summary>
        <div className="px-5 pb-5 space-y-4 border-t border-pale-sky">
          <p className="text-[13px] text-slate-500 pt-3">
            Used to derive addresses when a roster does not publish them.
          </p>
          <input
            type="text"
            placeholder="Filter by company or domain"
            aria-label="Filter company formats"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full max-w-sm px-4 py-3 rounded-xl bg-pale-sky/30 text-deep-navy placeholder-slate-blue/70 text-[15px] border border-pale-sky/50"
          />
          <div className="rounded-xl border border-pale-sky/80 bg-pale-sky/20 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-[13px] font-medium text-deep-navy">
                {domain.trim()
                  ? `Formats · ${domain.trim()}`
                  : `Known company formats${patternsTotal ? ` · ${patternsTotal}` : ''}`}
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={handleReconcileIdentity} disabled={reconciling} className="text-[12px] font-semibold text-steel-blue hover:text-deep-navy disabled:opacity-50">{reconciling ? 'Reconciling…' : 'Fix identity mismatches'}</button>
                <button type="button" onClick={handlePurgeJunk} disabled={purging} className="text-[12px] font-semibold text-red-700 hover:text-red-900 disabled:opacity-50">{purging ? 'Purging…' : 'Remove nav junk contacts'}</button>
              </div>
            </div>
            {patternsLoading ? (
              <p className="text-[12px] text-slate-500">Loading patterns…</p>
            ) : emailPatterns.length === 0 ? (
              <p className="text-[12px] text-slate-500">
                {domain.trim()
                  ? 'No format on record for that company.'
                  : 'No company formats recorded yet.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {emailPatterns.map((p) => (
                  <li key={`${p.company_domain}:${p.pattern_key}`} className="text-[12px] text-slate-700 flex flex-wrap gap-x-2">
                    <span className="font-medium text-deep-navy">{p.company_name || p.company_domain}</span>
                    <span className="font-mono font-medium text-deep-navy">{p.pattern_template}</span>
                    <span className="text-slate-500">
                      {Math.round((p.confidence || 0) * 100)}% · {p.verified_samples} verified
                      {p.failed_samples ? ` · ${p.failed_samples} bounced` : ''}
                      {p.member_asserted ? ' · set by a member' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" onClick={handleClearContactsCache} disabled={clearing} className="text-[12px] font-semibold text-red-800 disabled:opacity-50">
            {clearing ? 'Clearing…' : 'Clear contacts & cache…'}
          </button>
        </div>
      </details>
      )}

      {activeTab === 'import' && (
      <details className="mt-0 surface-card rounded-2xl border border-pale-sky overflow-hidden" open>
        <summary className="px-5 py-4 cursor-pointer text-[15px] font-semibold text-deep-navy">Import a spreadsheet</summary>
        <div className="px-5 pb-5 border-t border-pale-sky">
          <p className="text-[13px] text-slate-500 py-3">CSV or Excel with name, email, title, company.</p>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx" onChange={handleImport} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing} className="w-full py-3.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-[15px] font-semibold disabled:opacity-50">
            {importing ? 'Importing…' : 'Import file'}
          </button>
        </div>
      </details>

      )}

      {error && <p className="text-[#ff3b30] text-[13px] px-1 mt-4" role="alert">{error}</p>}
      {infoMessage && <p className="text-emerald-600 text-[13px] px-1 mt-2">{infoMessage}</p>}

      {contacts.length > 0 && (
        <div className="mt-8 bg-white rounded-2xl overflow-hidden shadow-sm border border-pale-sky">
          <div className="px-5 py-4 border-b border-pale-sky flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-deep-navy">Discovered ({contacts.length})</h2>
            {discoveryLog.length > 0 && (
              <button type="button" onClick={() => setShowDiscoveryLog((v) => !v)} className="text-[12px] font-semibold text-steel-blue hover:text-deep-navy">
                {showDiscoveryLog ? 'Hide' : 'Show'} AI audit log ({discoveryLog.length})
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full ingestion-table">
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
                  <tr key={c.id ?? c.email} className={`border-t border-pale-sky/50 hover:bg-pale-sky/20 ${c.ai_rejected ? 'opacity-70' : ''}`}>
                    <td className="px-4 py-3 text-[14px] text-deep-navy">{c.name}</td>
                    <td className="px-4 py-3 text-[14px] text-steel-blue">{c.email}</td>
                    <td className="px-4 py-3 text-[14px] text-deep-navy max-w-[12rem] truncate" title={c.title || undefined}>{c.title || '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-600 max-w-[10rem]">
                      <div>{c.contact_source || c.scrape_source || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${aiVerdictClass(c.ai_verdict)}`}>{aiVerdictLabel(c.ai_verdict)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {c.ai_rejected ? <span className="text-[11px] text-red-700 font-medium">Not saved</span> : c.already_exists ? <span className="text-[11px] text-slate-600 font-medium">In database</span> : <span className="text-[11px] text-emerald-700 font-medium">New</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${inboxStatusClass(c.email_verification_status)}`}>{inboxStatusLabel(c.email_verification_status)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-[12px] font-medium ${c.confidence === 'high' ? 'bg-pale-sky/60 text-steel-blue' : c.confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-pale-sky/40 text-slate-blue'}`}>{c.confidence}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showDiscoveryLog && discoveryLog.length > 0 && (
            <div className="border-t border-pale-sky px-5 py-4 bg-pale-sky/15 max-h-80 overflow-y-auto">
              <p className="text-[12px] font-semibold text-deep-navy mb-2">AI audit log{scrapeRunId ? ` · run ${scrapeRunId.slice(0, 8)}…` : ''}</p>
              <ul className="space-y-2">
                {discoveryLog.map((e, i) => (
                  <li key={`${e.email}-${i}`} className="text-[12px] text-slate-700 border border-pale-sky/60 rounded-lg px-3 py-2 bg-white/80">
                    <span className="font-medium text-deep-navy">{e.name || '—'}</span> <span className="text-steel-blue">{e.email}</span>
                    {e.ai_reason && <p className="mt-1 text-slate-600">{e.ai_reason}</p>}
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
