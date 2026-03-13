import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Analytics() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [pipelineMetrics, setPipelineMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.analytics.dashboard(),
      api.analytics.insights(),
      api.outreach.pipelineMetrics().catch(() => null),
    ])
      .then(([d, i, p]) => {
        setDashboard(d);
        setInsights(i.insights);
        setPipelineMetrics(p);
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

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-deep-navy mb-8">Analytics Hub</h1>
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
