import { useState, useRef } from 'react';
import { api } from '../api';

type ScraperTab = 'import' | 'scrape' | 'find';

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

  const handleScrape = async () => {
    if (!companyName && !domain && !linkedinUrl) {
      setError('Enter company name, domain, or LinkedIn URL');
      return;
    }
    setLoading(true);
    setError('');
    setInfoMessage('');
    setContacts([]);
    try {
      const res = await api.contacts.scrape({
        company_name: companyName || undefined,
        domain: domain || undefined,
        linkedin_url: linkedinUrl || undefined,
        linkedin_max_employees: linkedinUrl ? linkedinMaxEmployees : undefined,
      });
      setContacts(res.contacts);
      if (res.duplicates_skipped && res.duplicates_skipped > 0) {
        setInfoMessage(`Found ${res.count} new contacts. ${res.duplicates_skipped} duplicate(s) skipped (existing email).`);
      } else if (res.count > 0) {
        setInfoMessage(`Scraped ${res.count} contact(s).`);
      } else {
        setInfoMessage('');
      }
    } catch (e: any) {
      setError(e.message || 'Scrape failed');
    } finally {
      setLoading(false);
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
      <h1 className="text-2xl font-semibold text-deep-navy mb-8 pt-2">Contact Scraper</h1>

      {/* Segmented control (pill box) */}
      <div className="inline-flex p-1 rounded-xl bg-pale-sky/60 mb-8">
        <button
          onClick={() => { setActiveTab('scrape'); setError(''); setFindResult(null); }}
          className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'scrape'
              ? 'bg-[#1a2f5a] text-white shadow-sm'
              : 'text-[#3d5c82] hover:bg-[#1e3a6e] hover:text-white'
          }`}
        >
          Scrape Website
        </button>
        <button
          onClick={() => { setActiveTab('find'); setError(''); }}
          className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'find'
              ? 'bg-[#1a2f5a] text-white shadow-sm'
              : 'text-[#3d5c82] hover:bg-[#1e3a6e] hover:text-white'
          }`}
        >
          Find Contact
        </button>
        <button
          onClick={() => { setActiveTab('import'); setError(''); setFindResult(null); }}
          className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'import'
              ? 'bg-[#1a2f5a] text-white shadow-sm'
              : 'text-[#3d5c82] hover:bg-[#1e3a6e] hover:text-white'
          }`}
        >
          Import Spreadsheet
        </button>
      </div>

      {activeTab === 'scrape' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-pale-sky">
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
            </div>
            <div className="p-4 pt-0">
              <button
                onClick={handleScrape}
                disabled={loading || (!companyName && !domain && !linkedinUrl)}
                className="w-full py-3.5 rounded-xl bg-[#1a2f5a] hover:bg-[#1e3a6e] active:scale-[0.99] text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all"
              >
                {loading ? 'Scraping...' : 'Start Scraping'}
              </button>
            </div>
          </div>
          {error && <p className="text-[#ff3b30] text-[13px] px-1 mt-2">{error}</p>}
          {infoMessage && <p className="text-emerald-600 text-[13px] px-1 mt-2">{infoMessage}</p>}
        </div>
      )}

      {activeTab === 'find' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[var(--bg-card)] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-pale-sky">
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
                className="w-full py-3.5 rounded-xl bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {findLoading ? 'Searching...' : 'Search for Contact'}
              </button>
            </div>
          </div>
          {findResult && (
            <div className="bg-white dark:bg-[var(--bg-card)] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-pale-sky p-5">
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
          <div className="bg-white rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-pale-sky">
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
                className="w-full py-3.5 rounded-xl bg-[#1a2f5a] hover:bg-[#1e3a6e] active:scale-[0.99] text-white text-[15px] font-semibold disabled:opacity-50 transition-all"
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
        <div className="mt-8 bg-white rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-pale-sky">
          <div className="px-5 py-4 border-b border-pale-sky">
            <h2 className="text-[15px] font-semibold text-deep-navy">Discovered ({contacts.length})</h2>
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
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t border-pale-sky/50 hover:bg-pale-sky/20">
                    <td className="px-4 py-3 text-[14px] text-deep-navy">{c.name}</td>
                    <td className="px-4 py-3 text-[14px] text-steel-blue">{c.email}</td>
                    <td className="px-4 py-3 text-[14px] text-deep-navy">{c.title || '—'}</td>
                    <td className="px-4 py-3 text-[14px] text-deep-navy">{c.company || '—'}</td>
                    <td className="px-4 py-3">
                      {c.linkedin_url ? (
                        <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[14px] text-steel-blue hover:text-deep-navy">Profile</a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
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
        </div>
      )}
    </div>
  );
}
