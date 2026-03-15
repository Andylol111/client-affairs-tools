import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Analytics() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [pipelineMetrics, setPipelineMetrics] = useState<any>(null);
  const [timeSeries, setTimeSeries] = useState<{ labels: string[]; sent: number[]; opened: number[]; replied: number[] } | null>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.analytics.dashboard(),
      api.analytics.insights(),
      api.analytics.timeSeries(30),
      api.outreach.pipelineMetrics().catch(() => null),
      api.campaigns.list().catch(() => []),
    ])
      .then(([d, i, ts, p, c]) => {
        setDashboard(d);
        setInsights(i.insights);
        setTimeSeries(ts);
        setPipelineMetrics(p);
        setCampaigns(c || []);
      })
      .catch(() => setDashboard({}))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-slate-500">Loading...</div>
      </div>
    );
  }

  const maxSent = timeSeries?.sent?.length ? Math.max(...timeSeries.sent, 1) : 1;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-8">
        <h1 className="text-2xl font-bold text-deep-navy">Analytics Hub</h1>
        <button
          onClick={() => api.analytics.exportCsv().catch((e) => alert((e as Error)?.message))}
          className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white text-sm font-medium hover:bg-[#1e3a6e]"
        >
          Export to CSV
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="p-6 bg-white border border-pale-sky shadow-sm rounded-xl">
          <div className="text-slate-500 text-sm mb-1">Total Sent</div>
          <div className="text-2xl font-bold text-deep-navy">{dashboard?.total_sent ?? 0}</div>
        </div>
        <div className="p-6 bg-white border border-pale-sky shadow-sm rounded-xl">
          <div className="text-slate-500 text-sm mb-1">Opened</div>
          <div className="text-2xl font-bold text-deep-navy">{dashboard?.opened ?? 0}</div>
        </div>
        <div className="p-6 bg-white border border-pale-sky shadow-sm rounded-xl">
          <div className="text-slate-500 text-sm mb-1">Open Rate</div>
          <div className="text-2xl font-bold text-steel-blue">{dashboard?.open_rate ?? 0}%</div>
        </div>
        <div className="p-6 bg-white border border-pale-sky shadow-sm rounded-xl">
          <div className="text-slate-500 text-sm mb-1">Reply Rate</div>
          <div className="text-2xl font-bold text-steel-blue">{dashboard?.reply_rate ?? 0}%</div>
        </div>
      </div>

      {timeSeries && timeSeries.labels?.length > 0 && (
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-deep-navy mb-4">Activity (last 30 days)</h2>
          <div className="flex items-end gap-0.5 h-32">
            {timeSeries.sent.map((s, i) => (
              <div
                key={i}
                className="flex-1 min-w-0 flex flex-col items-center group"
                title={`${timeSeries.labels[i]}: ${s} sent`}
              >
                <div
                  className="w-full bg-steel-blue/70 rounded-t hover:bg-steel-blue transition-colors"
                  style={{ height: `${(s / maxSent) * 100}%`, minHeight: s ? 4 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-2">
            <span>{timeSeries.labels[0]}</span>
            <span>{timeSeries.labels[timeSeries.labels.length - 1]}</span>
          </div>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-deep-navy mb-4">Per-campaign breakdown</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pale-sky">
                  <th className="text-left py-2 font-semibold text-deep-navy">Campaign</th>
                  <th className="text-right py-2 font-semibold text-deep-navy">Sent</th>
                  <th className="text-right py-2 font-semibold text-deep-navy">Opened</th>
                  <th className="text-right py-2 font-semibold text-deep-navy">Replied</th>
                  <th className="text-right py-2 font-semibold text-deep-navy">Open rate</th>
                  <th className="text-right py-2 font-semibold text-deep-navy">Reply rate</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-pale-sky/50">
                    <td className="py-2 text-slate-800">{c.name}</td>
                    <td className="py-2 text-right text-slate-600">{c.sent_count ?? 0}</td>
                    <td className="py-2 text-right text-slate-600">—</td>
                    <td className="py-2 text-right text-slate-600">—</td>
                    <td className="py-2 text-right text-slate-600">—</td>
                    <td className="py-2 text-right text-slate-600">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pipelineMetrics?.by_status?.length > 0 && (
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-deep-navy mb-4">Pipeline Overview</h2>
          <div className="flex flex-wrap gap-4">
            {pipelineMetrics.by_status.map((s: any) => (
              <div key={s.pipeline_status} className="px-4 py-2 rounded-lg bg-pale-sky/30">
                <span className="capitalize text-slate-600">{s.pipeline_status}</span>
                <span className="ml-2 font-bold text-deep-navy">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
        <h2 className="text-lg font-semibold text-deep-navy mb-4">AI Insights</h2>
        <ul className="space-y-2">
          {insights.map((s, i) => (
            <li key={i} className="text-slate-600 flex items-start gap-2">
              <span className="text-steel-blue">•</span>
              {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
