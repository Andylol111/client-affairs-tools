import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import PageHeader from '../components/PageHeader';

const DEFAULT_DATA = {
  contacts_discovered_today: 0,
  emails_in_queue: 0,
  active_campaigns: 0,
  total_sent: 0,
  open_rate: 0,
  reply_rate: 0,
};

const WEEK = [
  {
    n: '01',
    title: 'Cut the slate',
    body: 'Pick this week’s companies from the prospect list.',
    to: '/yucgoutreach',
  },
  {
    n: '02',
    title: 'Comb addresses',
    body: 'Mint inferred inboxes, Keep or Drop. Never a verified-inbox badge.',
    to: '/yucgoutreach',
  },
  {
    n: '03',
    title: 'Write',
    body: 'Draft in Studio against kept people. Pick Opus → Haiku in the header.',
    to: '/studio',
  },
  {
    n: '04',
    title: 'Release',
    body: 'Pace Gmail. Pause lives in Send. Bounces are the ground truth.',
    to: '/campaigns',
  },
];

export default function Dashboard() {
  const [data, setData] = useState<typeof DEFAULT_DATA>(DEFAULT_DATA);
  const [insights, setInsights] = useState<string[]>([]);
  const [dueFollowUps, setDueFollowUps] = useState(0);
  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    api.analytics
      .dashboard()
      .then((d) => setData({ ...DEFAULT_DATA, ...d }))
      .catch(() => {
        setData(DEFAULT_DATA);
        setApiError(true);
      });
    api.analytics
      .insights()
      .then((i) => setInsights(i?.insights || []))
      .catch(() => setInsights([]));
    api.analytics
      .dueFollowUps()
      .then((d) => setDueFollowUps(d?.count ?? 0))
      .catch(() => setDueFollowUps(0));
  }, []);

  const cards = [
    { label: 'Found today', value: data.contacts_discovered_today ?? 0, to: '/scraper' },
    { label: 'In queue', value: data.emails_in_queue ?? 0, to: '/studio' },
    { label: 'Active sends', value: data.active_campaigns ?? 0, to: '/campaigns' },
    { label: 'Follow-ups due', value: dueFollowUps, to: '/campaigns' },
    { label: 'Sent', value: data.total_sent ?? 0, to: '/analytics' },
    { label: 'Reply rate', value: `${data.reply_rate ?? 0}%`, to: '/analytics' },
  ];

  return (
    <div className="max-w-[1920px] mx-auto">
      <PageHeader
        title="Client affairs"
        subtitle="One week: slate, comb, write, release. Yale undergraduate consulting — not a generic CRM."
        imageSrc="/yucg-bg/hero-campus.jpg"
      />
      {apiError && (
        <p className="text-amber-800 text-sm mb-4">
          API not responding. From the project folder run <code className="px-1 border border-pale-sky">./start-all.sh</code>
        </p>
      )}

      <div className="app-week-steps mb-8">
        {WEEK.map((step) => (
          <Link key={step.n} to={step.to} className="app-week-step">
            <div className="app-week-step__n">Step {step.n}</div>
            <h2 className="app-week-step__title">{step.title}</h2>
            <p className="app-week-step__body">{step.body}</p>
          </Link>
        ))}
      </div>

      <div className="app-stat-grid mb-8">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="app-stat surface-card">
            <div className="app-stat__label">{c.label}</div>
            <div className="app-stat__value">{c.value}</div>
          </Link>
        ))}
      </div>

      <div className="surface-card p-6">
        <h2 className="text-lg font-semibold text-deep-navy mb-3">Notes from the numbers</h2>
        <ul className="space-y-2">
          {insights.length === 0 ? (
            <li className="text-sm text-deep-navy/70">No insights yet.</li>
          ) : (
            insights.map((s, i) => (
              <li key={i} className="text-deep-navy flex items-start gap-2">
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
