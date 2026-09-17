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
    door: 'Target lists',
    title: 'Choose companies',
    body: 'Choose companies for a defined outreach effort.',
    to: '/yucgoutreach',
  },
  {
    n: '2',
    door: 'Target lists',
    title: 'Review contacts',
    body: 'Review suggested addresses and keep relevant contacts. A working domain does not confirm a mailbox exists.',
    to: '/yucgoutreach?view=comb',
  },
  {
    n: '3',
    door: 'Drafts',
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

/** Every work surface, with what it is for. Mirrors navConfig destinations. */
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
  const [data, setData] = useState<typeof DEFAULT_DATA>(DEFAULT_DATA);
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
        actions={<Link to="/yucgoutreach" className="ui-button ui-button--primary">Open target lists</Link>}
      />
      {apiError && (
        <p className="ui-notice ui-notice--warning mb-4">
          Live metrics are temporarily unavailable. The work pages remain usable.
        </p>
      )}

      <section className="app-week-guide mb-8" aria-labelledby="week-guide-title">
        <h2 id="week-guide-title" className="app-week-guide__title">
          How outreach works
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

      <section className="surface-card p-6" aria-labelledby="tools-title">
        <h2 id="tools-title" className="text-lg font-semibold text-deep-navy mb-1">
          Tools
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Every door, openable in any order. Nothing here waits on another step.
        </p>
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
    </div>
  );
}
