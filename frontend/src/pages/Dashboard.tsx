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
    n: '1',
    door: 'Week',
    title: 'Cut the slate',
    body: 'Open Week. Tick this week’s companies from the prospect list.',
    to: '/yucgoutreach',
  },
  {
    n: '2',
    door: 'Week',
    title: 'Comb addresses',
    body: 'Mint inferred inboxes, then Keep or Drop. Do not treat MX as a verified-inbox badge.',
    to: '/yucgoutreach',
  },
  {
    n: '3',
    door: 'Studio',
    title: 'Write',
    body: 'Open a kept person. Generate, edit, save. Pick Opus, Sonnet, or Haiku next to Generate.',
    to: '/studio',
  },
  {
    n: '4',
    door: 'Send',
    title: 'Release',
    body: 'Pace Gmail from Campaigns. Pause lives in Send. Bounces are the ground truth.',
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
        subtitle="Slate, comb, write, release. One club week — not a generic CRM."
        imageSrc="/yucg-bg/hero-campus.jpg"
      />
      {apiError && (
        <p className="text-amber-800 text-sm mb-4">
          API not responding. From the project folder run <code className="px-1 border border-pale-sky">./start-all.sh</code>
        </p>
      )}

      <section className="app-week-guide mb-8" aria-labelledby="week-guide-title">
        <h2 id="week-guide-title" className="app-week-guide__title">
          How a week works
        </h2>
        <ol className="app-week-guide__list">
          {WEEK.map((step) => (
            <li key={step.n} className="app-week-guide__item">
              <Link to={step.to} className="app-week-guide__link">
                <span className="app-week-guide__n" aria-hidden="true">
                  {step.n}
                </span>
                <span className="app-week-guide__copy">
                  <span className="app-week-guide__door">{step.door}</span>
                  <span className="app-week-guide__name">{step.title}</span>
                  <span className="app-week-guide__how">{step.body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

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
