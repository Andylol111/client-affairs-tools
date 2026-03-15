import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = typeof window !== 'undefined' && window.location.protocol === 'https:'
  ? 'https://localhost:8000'
  : (import.meta.env.VITE_API_URL || 'http://localhost:8000');

const DEFAULT_DATA = {
  contacts_discovered_today: 0,
  emails_in_queue: 0,
  active_campaigns: 0,
  total_sent: 0,
  open_rate: 0,
  reply_rate: 0,
};

function fetchWithTimeout(url: string, ms = 5000) {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export default function Dashboard() {
  const [data, setData] = useState<any>(DEFAULT_DATA);
  const [insights, setInsights] = useState<string[]>([]);
  const [dueFollowUps, setDueFollowUps] = useState<number>(0);
  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    fetchWithTimeout(`${API_BASE}/api/analytics/dashboard`)
      .then((r: unknown) => (r as Response).json())
      .then((d: unknown) => setData({ ...DEFAULT_DATA, ...(d as object || {}) }))
      .catch(() => {
        setData(DEFAULT_DATA);
        setApiError(true);
      });
  }, []);

  useEffect(() => {
    fetchWithTimeout(`${API_BASE}/api/analytics/insights`)
      .then((r: unknown) => (r as Response).json())
      .then((i: { insights?: string[] }) => setInsights(i?.insights || []))
      .catch(() => setInsights([]));
  }, []);

  useEffect(() => {
    fetchWithTimeout(`${API_BASE}/api/analytics/due-follow-ups`)
      .then((r: unknown) => (r as Response).json())
      .then((d: { count?: number }) => setDueFollowUps(d?.count ?? 0))
      .catch(() => setDueFollowUps(0));
  }, []);

  const cards = [
    { label: 'Contacts Discovered Today', value: data.contacts_discovered_today ?? 0, link: '/scraper', color: 'cyan' },
    { label: 'Emails in Queue', value: data.emails_in_queue ?? 0, link: '/studio', color: 'teal' },
    { label: 'Active Campaigns', value: data.active_campaigns ?? 0, link: '/campaigns', color: 'cyan' },
    { label: 'Due Follow-ups', value: dueFollowUps, link: '/campaigns', color: 'amber' },
    { label: 'Total Sent', value: data.total_sent ?? 0, color: 'slate' },
    { label: 'Open Rate', value: `${data.open_rate ?? 0}%`, color: 'emerald' },
    { label: 'Reply Rate', value: `${data.reply_rate ?? 0}%`, color: 'emerald' },
  ];

  return (
    <div className="max-w-[1920px] mx-auto">
      <div className="flex items-center gap-6 flex-wrap mb-6">
        <h1 className="text-2xl font-bold text-deep-navy">Dashboard</h1>
        {apiError && (
          <p className="text-amber-600 text-sm">Backend not responding. Run: <code className="bg-slate-100 px-1 rounded text-xs">./start-all.sh</code></p>
        )}
      </div>

      {/* Usage Guide */}
      <div className="bg-white border border-pale-sky rounded-xl p-6 mb-8 shadow-sm">
        <h2 className="text-lg font-semibold text-deep-navy mb-4">How to Use YUCG Outreach</h2>
        <ol className="space-y-4 text-slate-600 list-decimal list-inside">
          <li>
            <strong className="text-slate-800">Get contacts</strong> — Go to <Link to="/scraper" className="text-steel-blue hover:text-deep-navy hover:underline">Scraper</Link> and either:
            <ul className="ml-6 mt-2 space-y-1 list-disc text-sm">
              <li>Import a CSV or Excel file with columns: name, email, title, company</li>
              <li>Enter a company name, domain (e.g. acme.com), or LinkedIn company URL and click Scrape</li>
            </ul>
          </li>
          <li>
            <strong className="text-slate-800">Generate emails</strong> — Go to <Link to="/studio" className="text-steel-blue hover:text-deep-navy hover:underline">Email Studio</Link>, select a contact, choose tone/length/angle, and click Generate Email. Requires Ollama running locally (<code className="bg-slate-100 px-1 rounded text-sm">ollama run llama3.2</code>).
          </li>
          <li>
            <strong className="text-slate-800">Create a campaign</strong> — Go to <Link to="/campaigns" className="text-steel-blue hover:text-deep-navy hover:underline">Campaigns</Link>, create a campaign, add contacts (with optional &quot;Generate &amp; Add&quot; to create emails on the fly), then send.
          </li>
          <li>
            <strong className="text-slate-800">Track results</strong> — Use <Link to="/analytics" className="text-steel-blue hover:text-deep-navy hover:underline">Analytics</Link> to view open rates, reply rates, and AI insights.
          </li>
        </ol>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.link || '#'}
            className={`block p-4 rounded-xl bg-white border border-pale-sky shadow-sm hover:border-steel-blue/50 hover:shadow transition-colors ${
              !c.link ? 'cursor-default' : ''
            }`}
          >
            <div className="text-slate-500 text-xs mb-0.5 truncate">{c.label}</div>
            <div className="text-xl font-bold text-deep-navy">{c.value}</div>
          </Link>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-deep-navy mb-4">AI Insights</h2>
        <ul className="space-y-2">
          {insights.length === 0 ? (
            <li className="text-slate-500 text-sm">Loading insights...</li>
          ) : (
            insights.map((s, i) => (
              <li key={i} className="text-slate-600 flex items-start gap-2">
                <span className="text-steel-blue">•</span>
                {s}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
