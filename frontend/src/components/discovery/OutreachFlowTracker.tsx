import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OutreachFlow, type OutreachFlowStatus } from '../../api';

const STAGES: { key: OutreachFlowStatus; label: string }[] = [
  { key: 'discovering', label: 'Find people' },
  { key: 'importing', label: 'Save contacts' },
  { key: 'drafting', label: 'Draft emails' },
  { key: 'ready', label: 'Review & release' },
];

const ORDER: Record<OutreachFlowStatus, number> = {
  discovering: 0,
  importing: 1,
  drafting: 2,
  ready: 3,
  failed: 3,
};

/**
 * The second click of the two-click flow lives on the campaign page; this
 * card shows one flow moving through its stages and hands off there. It
 * polls while the flow is live and stops when it is terminal.
 */
export default function OutreachFlowTracker({ flowId, onDone }: { flowId: number; onDone?: (flow: OutreachFlow) => void }) {
  const [flow, setFlow] = useState<OutreachFlow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const next = await api.outreach.flows.get(flowId);
        if (cancelled) return;
        setFlow(next);
        setError(null);
        if (next.status === 'ready' || next.status === 'failed') {
          onDone?.(next);
          return;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load flow');
      }
      timer = window.setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [flowId, onDone]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!flow) return <p className="text-sm text-slate-500">Starting…</p>;

  const current = ORDER[flow.status];
  const failed = flow.status === 'failed';

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-4 space-y-3" data-testid="outreach-flow">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-semibold text-deep-navy">{flow.company_name}</div>
          <div className="text-xs text-slate-500">
            {flow.title_hints ? `${flow.title_hints} · ` : ''}up to {flow.max_contacts} people
          </div>
        </div>
        <div className="text-xs text-slate-500">{Math.round(flow.progress_pct)}%</div>
      </div>

      <ol className="grid grid-cols-4 gap-2 text-center">
        {STAGES.map((stage, index) => {
          const done = index < current || flow.status === 'ready';
          const active = index === current && !failed && flow.status !== 'ready';
          const bad = failed && index === current;
          const tone = bad
            ? 'bg-red-50 border-red-200 text-red-800'
            : done
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : active
                ? 'bg-pale-sky/40 border-pale-sky text-deep-navy'
                : 'bg-white border-[var(--border)] text-slate-400';
          return (
            <li key={stage.key} className={`rounded-lg border px-2 py-2 text-xs font-medium ${tone}`} aria-current={active ? 'step' : undefined}>
              {stage.label}
            </li>
          );
        })}
      </ol>

      <p className={`text-sm ${failed ? 'text-red-700' : 'text-slate-700'}`}>
        {failed ? flow.error_message || 'Stopped' : flow.progress_message || '…'}
      </p>

      {flow.status === 'ready' && flow.campaign_id && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
          <div className="text-sm text-emerald-900">
            {flow.imported_count} people saved · {flow.drafted_count} draft(s) ready. Nothing has been sent.
          </div>
          <Link
            to={`/campaigns/${flow.campaign_id}`}
            className="px-4 py-2 rounded-xl bg-deep-navy text-white text-sm font-medium hover:opacity-90"
          >
            Review & release
          </Link>
        </div>
      )}
      {flow.status === 'ready' && !flow.campaign_id && (
        <p className="text-sm text-slate-600">Finished, but no campaign was created.</p>
      )}
    </div>
  );
}
