import { useEffect, useState, useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api, type Contact, type DiscoveryLogEntry, type TargetListStatus } from '../api';
import AppSubnav from '../components/AppSubnav';
import PageHeader from '../components/PageHeader';
import CompanyRegister from '../components/discovery/CompanyRegister';
import ContactSheet from '../components/discovery/ContactSheet';
import CampaignPipeline from '../components/discovery/CampaignPipeline';
import { Notice } from '../components/ui/Primitives';
import ResearchWorkspace from '../components/discovery/ResearchWorkspace';
import { useProjects } from '../lib/useProjects';
import { useUrlTab } from '../lib/useUrlTab';
type ScraperTab = 'research' | 'company' | 'import' | 'register';


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

type ImportKind = 'contacts' | 'club_targets';

export default function Scraper() {
  const [params] = useSearchParams();
  const { user } = useOutletContext<{ user: { role?: string } }>();
  const isAdmin = user?.role === 'admin';
  // Default to the crawl: it is the one door that turns a company name into people.
  const [activeTab, setActiveTab] = useUrlTab<ScraperTab>(['research', 'company', 'import', 'register'], 'register');
  const [importing, setImporting] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind>('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetList, setTargetList] = useState<TargetListStatus | null>(null);

  const [discoveryLog] = useState<DiscoveryLogEntry[]>([]);
  const [scrapeRunId] = useState<string | null>(null);
  const [showDiscoveryLog, setShowDiscoveryLog] = useState(false);

  // Only an admin may see or replace the club list, so only an admin asks.
  useEffect(() => {
    if (!isAdmin || activeTab !== 'import') return;
    api.admin.targetList.status().then(setTargetList).catch(() => setTargetList(null));
  }, [isAdmin, activeTab]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setInfoMessage('');
    setContacts([]);
    try {
      if (importKind === 'club_targets') {
        const res = await api.admin.targetList.replace(file);
        const dropped = res.register_rows_dropped || 0;
        const folded = res.folded_duplicates || [];
        setInfoMessage(
          `Club target list replaced: ${res.companies} sheet lines (was ${res.companies_before})`
          + `${dropped > 0 ? `, ${dropped} removed from Companies` : ''}. `
          + 'Everyone sees these targets now.'
          // A line that repeats a company and segment already listed is
          // merged, keeping both write-ups. Said out loud, because otherwise
          // the sheet and the Companies tab disagree with no explanation.
          + (folded.length > 0
            ? ` ${folded.length} repeated ${folded.length === 1 ? 'company was' : 'companies were'} merged`
              + ` into one target each, keeping both write-ups: ${folded.slice(0, 5).join(', ')}`
              + `${folded.length > 5 ? ` and ${folded.length - 5} more` : ''}.`
            : ''),
        );
        setTargetList(await api.admin.targetList.status().catch(() => null));
      } else {
        const res = await api.contacts.importFile(file);
        setContacts(res.contacts);
        if (res.duplicates_skipped && res.duplicates_skipped > 0) {
          setInfoMessage(`Imported ${res.count} contacts. ${res.duplicates_skipped} duplicate(s) skipped (existing email).`);
        } else if (res.count > 0) {
          setInfoMessage(`Imported ${res.count} contact(s).`);
        } else {
          setInfoMessage('');
        }
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
    <div className="app-workspace w-full max-w-[1920px] pb-12">
      <PageHeader title="Find contacts" />

      <AppSubnav
        className="mb-6"
        items={[
          { id: 'register', label: 'Companies' },
          { id: 'company', label: 'Find people' },
          { id: 'import', label: 'Import a file' },
        ]}
        active={activeTab}
        onChange={(id) => {
          setActiveTab(id as ScraperTab);
          setError('');
        }}
      />

      {activeTab === 'register' && <CompanyRegister />}

      {activeTab === 'company' && (
        <>
          {/* Finding people and seeing who was found are one task. The search
              form is a fixed-width column; the rest of the page is the sheet,
              which used to be empty space that sent the member to another
              page to read their own results. */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
            <div className="xl:col-span-2 space-y-4">
              <CampaignPipeline />
            </div>
            <div className="xl:col-span-3">
              <ContactSheet company={params.get('company') || ''} />
            </div>
          </div>
        </>
      )}

      {activeTab === 'research' && <ResearchTab />}



      {activeTab === 'import' && (
      <div className="surface-card rounded-2xl border border-pale-sky overflow-hidden max-w-3xl">
        <div className="px-5 py-4 border-b border-pale-sky">
          <h2 className="text-[15px] font-semibold text-deep-navy">Import a spreadsheet</h2>
        </div>
        <div className="px-5 pb-5 space-y-3">
          {/* One door, and the file says which pipeline it feeds. The club
              list is the only choice that rewrites what everybody works
              from, so only an admin is offered it - and the server enforces
              that too, this select is a courtesy. */}
          <label className="block text-[13px] font-medium text-deep-navy pt-3">
            What is in this file?
            <select
              className="block w-full mt-1 border border-pale-sky rounded-xl px-3 py-2 bg-white text-[14px] text-deep-navy"
              value={importKind}
              onChange={(e) => {
                setImportKind(e.target.value === 'club_targets' ? 'club_targets' : 'contacts');
                setError('');
                setInfoMessage('');
              }}
            >
              <option value="contacts">People to add to contacts</option>
              {isAdmin && <option value="club_targets">Club target list (admins only)</option>}
            </select>
          </label>

          {importKind === 'contacts' ? (
            <p className="text-[13px] text-slate-500">CSV or Excel with name, email, title, company.</p>
          ) : (
            <div className="text-[13px] text-slate-500 space-y-1">
              <p>
                Excel workbook, sheet <strong>YUCG Prospects</strong>: company, sector, why it fits,
                engagement theme, Yale hook, priority and the role to aim at. It replaces the club
                target list for everyone, and the Companies tab updates as soon as it uploads.
              </p>
              <p>
                A company you delete from the sheet stops being a club target. The list it replaces
                is archived, and a workbook that cannot be read changes nothing.
              </p>
              {targetList && (
                <p data-testid="target-list-status">
                  On file now: <strong>{targetList.row_count}</strong> companies
                  {targetList.last_upload?.name
                    ? `, last uploaded by ${targetList.last_upload.name}`
                    : ''}
                  {targetList.last_upload?.created_at ? ` on ${targetList.last_upload.created_at.slice(0, 10)}` : ''}.
                </p>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={importKind === 'club_targets' ? '.xlsx,.xlsm' : '.csv,.xlsx'}
            onChange={handleImport}
            className="hidden"
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing} className="w-full py-3.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-[15px] font-semibold disabled:opacity-50">
            {importing
              ? 'Uploading…'
              : importKind === 'club_targets' ? 'Replace club target list' : 'Import file'}
          </button>
        </div>
      </div>
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
