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
    title: 'Choose companies',
    body: 'Choose this week’s companies from the prospect list.',
    to: '/yucgoutreach',
  },
  {
    n: '2',
    door: 'Week',
    title: 'Review contacts',
    body: 'Review suggested addresses and keep relevant contacts. A working domain does not confirm a mailbox exists.',
    to: '/yucgoutreach?view=comb',
  },
  {
    n: '3',
    door: 'Studio',
    title: 'Write',
    body: 'Select a contact, prepare an email, and save your draft.',
    to: '/studio',
  },
  {
    n: '4',
    door: 'Campaigns',
    title: 'Review and send',
    body: 'Review your sender account and recipients in Campaigns. Monitor replies and delivery failures after sending.',
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
        actions={<Link to="/yucgoutreach" className="ui-button ui-button--primary">Open this week</Link>}
      />
      {apiError && (
        <p className="ui-notice ui-notice--warning mb-4">
          Live metrics are temporarily unavailable. The work pages remain usable.
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
