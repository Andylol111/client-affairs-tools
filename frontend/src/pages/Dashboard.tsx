import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, type LeaderboardRow, type CompanyReached, type Campaign, type PipelineMetrics } from '../api';
import PageHeader from '../components/PageHeader';
import GmailConnection from '../components/GmailConnection';
import SlackIntegration from '../components/SlackIntegration';
import { canManageCampaign } from '../lib/campaignAccess';

const DEFAULT_DATA = {
  contacts_discovered_today: 0,
  emails_in_queue: 0,
  active_campaigns: 0,
  total_sent: 0,
  open_rate: 0,
  reply_rate: 0,
};

export default function Dashboard() {
  const { user } = useOutletContext<{ user: { id?: number; name?: string; picture?: string } }>();
  const [data, setData] = useState<typeof DEFAULT_DATA>(DEFAULT_DATA);
  const [dueFollowUps, setDueFollowUps] = useState(0);
  const [apiError, setApiError] = useState(false);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [myCompanies, setMyCompanies] = useState<CompanyReached[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pipeline, setPipeline] = useState<PipelineMetrics['by_status']>([]);

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
    api.campaigns
      .list()
      .then(setCampaigns)
      .catch(() => setCampaigns([]));
    api.outreach
      .pipelineMetrics()
      .then((d) => setPipeline(d.by_status || []))
      .catch(() => setPipeline([]));
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    api.analytics
      .companiesReached(user.id)
      .then((d) => setMyCompanies(d.companies || []))
      .catch(() => setMyCompanies([]));
  }, [user?.id]);

  const needsAttention = campaigns.filter(
    (c) => canManageCampaign(c, user?.id) && (c.status === 'needs_attention' || c.status === 'paused')
  );
  const pipelineTotal = pipeline.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="app-workspace max-w-[1920px]">
      <PageHeader
        title="Home"
        actions={<Link to="/yucgoutreach" className="ui-button ui-button--primary">Open target lists</Link>}
      />
      {apiError && (
        <p className="ui-notice ui-notice--warning mb-4">
          Live metrics are temporarily unavailable. The work pages remain usable.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {needsAttention.length > 0 && (
            <section className="surface-card p-5" aria-label="Needs your attention">
              <h2 className="app-section-title mb-3">Needs your attention</h2>
              <ul className="space-y-1">
                {needsAttention.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/campaigns/${c.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-pale-sky/30"
                    >
                      <span className="font-medium text-deep-navy truncate">{c.name}</span>
                      <span className="text-xs font-semibold text-red-700 whitespace-nowrap">
                        {c.status === 'needs_attention' ? `${c.failed_count || 0} failed` : 'Paused'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link to="/campaigns" className="surface-card p-4 block hover:bg-pale-sky/10">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Sending</div>
              <div className="mt-1 text-2xl font-bold text-deep-navy">{data.active_campaigns}</div>
              <div className="text-xs text-slate-500">active · {data.emails_in_queue} queued</div>
            </Link>
            <Link to="/outreach" className="surface-card p-4 block hover:bg-pale-sky/10">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Follow-ups due</div>
              <div className="mt-1 text-2xl font-bold text-deep-navy">{dueFollowUps}</div>
              <div className="text-xs text-slate-500">in the pipeline</div>
            </Link>
            <Link to="/analytics" className="surface-card p-4 block hover:bg-pale-sky/10">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Reply rate</div>
              <div className="mt-1 text-2xl font-bold text-deep-navy">{data.reply_rate}%</div>
              <div className="text-xs text-slate-500">{data.total_sent} sent</div>
            </Link>
          </div>

          <section className="surface-card p-5" aria-label="Pipeline">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="app-section-title">Pipeline</h2>
              <Link to="/outreach" className="text-xs font-semibold text-steel-blue">
                Open board
              </Link>
            </div>
            {pipelineTotal === 0 ? (
              <p className="text-sm text-slate-500">No contacts in the pipeline yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {pipeline.map((p) => (
                  <Link
                    key={p.pipeline_status}
                    to="/outreach"
                    className="rounded-lg bg-pale-sky/30 px-3 py-2 hover:bg-pale-sky/50 min-w-[5.5rem]"
                    title={`${p.count} of ${pipelineTotal} contacts (${Math.round((p.count / pipelineTotal) * 100)}%) are ${p.pipeline_status}`}
                  >
                    <span className="block text-xs text-slate-600 capitalize">{p.pipeline_status}</span>
                    <span className="block text-lg font-bold text-deep-navy">{p.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="surface-card p-6" aria-label="Leaderboard">
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
          <SlackIntegration />
          <section className="surface-card p-5" aria-labelledby="my-companies-title">
            <div className="mb-1">
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
