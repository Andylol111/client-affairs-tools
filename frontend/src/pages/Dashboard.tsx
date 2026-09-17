import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, type LeaderboardRow, type CompanyReached } from '../api';
import PageHeader from '../components/PageHeader';
import GmailConnection from '../components/GmailConnection';

const DEFAULT_DATA = {
  contacts_discovered_today: 0,
  emails_in_queue: 0,
  active_campaigns: 0,
  total_sent: 0,
  open_rate: 0,
  reply_rate: 0,
};

/** Every work surface, one click each. Mirrors navConfig destinations - the
 * only place tool links live; the nav header groups the same set, nothing
 * here duplicates it. */
const TOOLS = [
  { name: 'Find contacts', what: 'Name a company and collect verified people', to: '/scraper' },
  { name: 'Target lists', what: 'Pick companies and keep the right contacts', to: '/yucgoutreach' },
  { name: 'Drafts', what: 'Write and generate emails per contact', to: '/studio' },
  { name: 'Campaigns', what: 'Review recipients, release, and monitor sends', to: '/campaigns' },
  { name: 'Pipeline', what: 'Track every contact by stage', to: '/outreach' },
  { name: 'Results', what: 'Replies, delivery failures, and rates', to: '/analytics' },
  { name: 'Projects', what: 'Semester projects and assignments', to: '/projects' },
  { name: 'Documents', what: 'Club files the assistant can cite', to: '/documents' },
];

export default function Dashboard() {
  const { user } = useOutletContext<{ user: { id?: number; name?: string; picture?: string } }>();
  const [data, setData] = useState<typeof DEFAULT_DATA>(DEFAULT_DATA);
  const [dueFollowUps, setDueFollowUps] = useState(0);
  const [apiError, setApiError] = useState(false);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [myCompanies, setMyCompanies] = useState<CompanyReached[]>([]);

  useEffect(() => {
    api.analytics
      .dashboard()
      .then((d) => setData({ ...DEFAULT_DATA, ...d }))
      .catch(() => {
        setData(DEFAULT_DATA);
        setApiError(true);
      });
    api.analytics
      .dueFollowUps()
      .then((d) => setDueFollowUps(d?.count ?? 0))
      .catch(() => setDueFollowUps(0));
    api.analytics
      .leaderboard()
      .then((d) => setBoard(d.leaderboard || []))
      .catch(() => setBoard([]));
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    api.analytics
      .companiesReached(user.id)
      .then((d) => setMyCompanies(d.companies || []))
      .catch(() => setMyCompanies([]));
  }, [user?.id]);

  const cards = [
    { label: 'Found today', value: data.contacts_discovered_today ?? 0, to: '/scraper' },
    { label: 'In queue', value: data.emails_in_queue ?? 0, to: '/campaigns' },
    { label: 'Active sends', value: data.active_campaigns ?? 0, to: '/campaigns' },
    { label: 'Follow-ups due', value: dueFollowUps, to: '/campaigns' },
    { label: 'Sent', value: data.total_sent ?? 0, to: '/analytics' },
    { label: 'Reply rate', value: `${data.reply_rate ?? 0}%`, to: '/analytics' },
  ];

  return (
    <div className="app-workspace max-w-[1920px]">
      <PageHeader
        hero
        title="Home"
        subtitle="Your club’s projects, contacts, and outreach activity in one place."
        imageSrc="/yucg-bg/hero-campus.jpg"
        actions={<Link to="/yucgoutreach" className="ui-button ui-button--primary">Open target lists</Link>}
      />
      {apiError && (
        <p className="ui-notice ui-notice--warning mb-4">
          Live metrics are temporarily unavailable. The work pages remain usable.
        </p>
      )}

      <div className="app-stat-grid mb-8">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="app-stat surface-card">
            <div className="app-stat__label">{c.label}</div>
            <div className="app-stat__value">{c.value}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <section className="surface-card p-6" aria-labelledby="tools-title">
            <h2 id="tools-title" className="text-lg font-semibold text-deep-navy mb-4">
              Tools
            </h2>
            <ul className="app-tool-grid">
              {TOOLS.map((tool) => (
                <li key={tool.to}>
                  <Link to={tool.to} className="app-tool surface-card">
                    <span className="app-tool__name">{tool.name}</span>
                    <span className="app-tool__what">{tool.what}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="surface-card p-6" aria-labelledby="leaderboard-title">
            <h2 id="leaderboard-title" className="text-lg font-semibold text-deep-navy mb-1">
              This semester's leaderboard
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Ranked by replies, not volume. Bounces on unverified addresses don't count against
              you.
            </p>
            {board.length === 0 ? (
              <p className="text-sm text-slate-500">No sends recorded yet.</p>
            ) : (
              <ol className="space-y-2">
                {board.map((row, i) => (
                  <li
                    key={row.user_id}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                      row.user_id === user?.id ? 'bg-pale-sky/40' : ''
                    }`}
                  >
                    <span className="w-5 text-sm font-semibold text-slate-500">{i + 1}</span>
                    {row.picture && (
                      <img src={row.picture} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
                    )}
                    <span className="flex-1 text-sm font-medium text-deep-navy truncate">
                      {row.name || 'Member'}
                      {row.user_id === user?.id ? ' (you)' : ''}
                    </span>
                    <span className="text-xs text-slate-500">
                      {row.replied} replied · {row.companies_reached} companies
                      {row.penalized_bounces ? ` · ${row.penalized_bounces} bounced` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-6 min-w-0">
          <GmailConnection />
          <section className="surface-card p-5" aria-labelledby="my-companies-title">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 id="my-companies-title" className="app-section-title">
                Companies you've reached
              </h2>
              <Link to="/outreach" className="text-xs font-semibold text-steel-blue">
                View pipeline
              </Link>
            </div>
            {myCompanies.length === 0 ? (
              <p className="text-sm text-slate-500 mt-2">
                Nothing sent yet. Check here before starting outreach somewhere a teammate
                already covered.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {myCompanies.slice(0, 8).map((c) => (
                  <li key={c.company} className="text-sm">
                    <span className="font-medium text-deep-navy">{c.company}</span>
                    <span className="text-slate-500">
                      {' '}
                      · {c.contacts_reached} contact{c.contacts_reached === 1 ? '' : 's'}
                      {c.replies ? ` · ${c.replies} replied` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
