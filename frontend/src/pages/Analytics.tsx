import OutreachLedger from '../components/OutreachLedger';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Campaign } from '../api';
import PageHeader from '../components/PageHeader';
import { Button, EmptyState, Notice, StatusBadge } from '../components/ui/Primitives';

type DashboardMetrics = {
  total_sent?: number;
  opened?: number;
  open_rate?: number;
  reply_rate?: number;
};

type PipelineMetric = { pipeline_status: string; count: number };
type TimeSeries = { labels: string[]; sent: number[]; opened: number[]; replied: number[] };

export default function Analytics() {
  const [dashboard, setDashboard] = useState<DashboardMetrics>({});
  const [insights, setInsights] = useState<string[]>([]);
  const [pipelineMetrics, setPipelineMetrics] = useState<PipelineMetric[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeries | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.analytics.dashboard(),
      api.analytics.insights(),
      api.analytics.timeSeries(30),
      api.outreach.pipelineMetrics().catch(() => null),
      api.campaigns.list().catch(() => []),
    ])
      .then(([metrics, insightResponse, series, pipeline, campaignRows]) => {
        setDashboard(metrics);
        setInsights(insightResponse.insights || []);
        setTimeSeries(series);
        setPipelineMetrics(pipeline?.by_status || []);
        setCampaigns(campaignRows);
      })
      .catch((requestError) => setError((requestError as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-500">Loading stats…</div>;
  }

  const maxSent = timeSeries?.sent.length ? Math.max(...timeSeries.sent, 1) : 1;
  const cards = [
    ['Total sent', dashboard.total_sent ?? 0],
    ['Opened', dashboard.opened ?? 0],
    ['Open rate', `${dashboard.open_rate ?? 0}%`],
    ['Reply rate', `${dashboard.reply_rate ?? 0}%`],
  ] as const;

  return (
    <div className="app-workspace max-w-6xl">
      <PageHeader
        title="Results"
        subtitle="Delivery, opens, and replies after send. Opens are directional; replies are the stronger outcome."
        imageSrc="/yucg-bg/hero-campus.jpg"
        actions={
          <Button
            onClick={() => api.analytics.exportCsv().catch((requestError) => setError((requestError as Error).message))}
          >
            Export CSV
          </Button>
        }
      />

      {error && <Notice tone="danger" className="mb-5">{error}</Notice>}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="surface-card rounded-xl p-4 sm:p-6">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold text-deep-navy">{value}</div>
          </div>
        ))}
      </div>

      {(dashboard.total_sent ?? 0) === 0 && (
        <EmptyState
          className="mb-8"
          title="No send activity yet"
          body="Release a reviewed campaign. Delivery and reply activity will appear here after the server sends it."
          action={<Link to="/campaigns" className="ui-button ui-button--primary">Open Send</Link>}
        />
      )}

      <section className="surface-card mb-8 rounded-xl p-5 sm:p-6">
        <h2 className="app-section-title mb-4">Sent in the last 30 days</h2>
        {timeSeries?.labels.length ? (
          <>
            <div className="flex h-32 items-end gap-0.5" aria-label="Daily sent email volume">
              {timeSeries.sent.map((sent, index) => (
                <div key={timeSeries.labels[index]} className="group flex min-w-0 flex-1 flex-col items-center" title={`${timeSeries.labels[index]}: ${sent} sent`}>
                  <div className="w-full rounded-t bg-steel-blue/70 transition-colors group-hover:bg-steel-blue" style={{ height: `${(sent / maxSent) * 100}%`, minHeight: sent ? 4 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>{timeSeries.labels[0]}</span>
              <span>{timeSeries.labels.at(-1)}</span>
            </div>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">No activity in this date range.</p>
        )}
      </section>

      <section className="surface-card mb-8 rounded-xl p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="app-section-title">Campaign drilldown</h2>
          <Link to="/campaigns" className="text-sm font-semibold text-[var(--accent)] hover:underline">All campaigns</Link>
        </div>
        {campaigns.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No campaigns to compare.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link to={`/campaigns/${campaign.id}`} className="flex min-h-14 items-center justify-between gap-4 py-3 hover:text-[var(--accent)]">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{campaign.name}</span>
                    <span className="block text-xs text-slate-500">{campaign.sent_count ?? 0} sent · {campaign.pending_count ?? 0} queued · {campaign.failed_count ?? 0} failed</span>
                  </span>
                  <StatusBadge tone={campaign.status === 'sent' ? 'success' : campaign.status === 'needs_attention' ? 'danger' : 'neutral'}>
                    {campaign.status.replace('_', ' ')}
                  </StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pipelineMetrics.length > 0 && (
        <section className="surface-card mb-8 rounded-xl p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="app-section-title">Pipeline</h2>
            <Link to="/outreach" className="text-sm font-semibold text-[var(--accent)] hover:underline">Open board</Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {pipelineMetrics.map((metric) => (
              <div key={metric.pipeline_status} className="rounded-lg bg-pale-sky/30 px-4 py-2">
                <span className="capitalize text-slate-600">{metric.pipeline_status}</span>
                <strong className="ml-2 text-deep-navy">{metric.count}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="surface-card rounded-xl p-5 sm:p-6">
        <h2 className="app-section-title mb-4">Notes from the data</h2>
        {insights.length ? (
          <ul className="space-y-2">
            {insights.map((insight) => <li key={insight} className="text-slate-600">• {insight}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No data-backed notes yet.</p>
        )}
      </section>
      <OutreachLedger />
    </div>
  );
}
