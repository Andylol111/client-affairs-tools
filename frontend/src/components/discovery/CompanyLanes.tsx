import { useState } from 'react';
import type { CompanyRun } from '../../lib/useDiscoveryRuns';

/**
 * Where each company stands, drawn the way a commit graph draws branches.
 *
 * A campaign to twelve companies is twelve pieces of work that merge into one
 * message. A list cannot show that: it says which companies were picked but
 * not which of them actually has people, which has anybody ticked, or which is
 * still empty and holding the campaign up. The lanes do - one per company,
 * each node a step it has or has not reached, all of them curving into the one
 * trunk that is the campaign.
 *
 * The lanes are also where a company is acted on: a lane with nobody found
 * offers the search, a lane with a finished search offers its export and
 * deletion. They stay on screen at every step, above the sheet of people,
 * and are kept short so the sheet is never pushed below the fold - beyond
 * six companies the rest fold behind a count.
 */

export type Lane = {
  company: string;
  found: number;
  ticked: number;
  run: CompanyRun;
};

/** Lane colours, in the order a commit graph would assign them. */
const COLOURS = ['#1E3A6E', '#3D5C82', '#5B7FA6', '#7A9CC6', '#C2884B', '#4E7A5E', '#8C5A86'];

const ROW = 34;
/** Rows drawn before the rest fold behind a count. */
const WINDOW = 6;
const TRUNK_X = 10;
const COL_X = [40, 70, 100];
const GRAPH_W = 112;

function stateText(lane: Lane): string {
  switch (lane.run.state) {
    case 'queued': return 'queued';
    case 'searching': return `searching ${Math.round(lane.run.pct)}%`;
    case 'failed': return lane.found > 0 ? `${lane.found} found · search failed` : 'search failed';
    default: return lane.found > 0 ? `${lane.found} found` : 'nobody yet';
  }
}

export default function CompanyLanes({ lanes, built, focused, onFocus, onFind, onExport, onDelete }: {
  lanes: Lane[];
  built: boolean;
  /** The lane whose vocabulary the step's search controls are about. */
  focused: string | null;
  onFocus: (company: string) => void;
  onFind: (company: string) => void;
  onExport: (runId: number) => void;
  onDelete: (runId: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (lanes.length === 0) return null;
  const shown = showAll ? lanes : lanes.slice(0, WINDOW);
  const hidden = lanes.length - shown.length;

  return (
    <section className="surface-card rounded-2xl border border-pale-sky px-4 py-3" aria-label="Company progress"
             data-testid="company-lanes">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-[15px] font-semibold text-deep-navy">Where each company stands</h2>
        <span className="text-xs text-slate-500">
          {lanes.length} compan{lanes.length === 1 ? 'y' : 'ies'} · {lanes.reduce((n, l) => n + l.ticked, 0)} people ticked
        </span>
      </div>

      <ul className="m-0 list-none p-0">
        {shown.map((lane, index) => {
          const colour = COLOURS[index % COLOURS.length];
          const reached = [true, lane.found > 0, lane.ticked > 0];
          const lastX = COL_X[reached.lastIndexOf(true)];
          const active = lane.run.state === 'searching' || lane.run.state === 'queued';
          const runId = active ? undefined : lane.run.runId;
          const isFocused = focused !== null && focused === lane.company;
          return (
            <li
              key={lane.company}
              data-lane={lane.company}
              data-state={lane.run.state}
              onMouseEnter={() => onFocus(lane.company)}
              onFocus={() => onFocus(lane.company)}
              onClick={() => onFocus(lane.company)}
              className={`group flex items-center gap-2 rounded-lg px-1 -mx-1 ${
                isFocused ? 'bg-pale-sky/40' : 'hover:bg-pale-sky/20'}`}
              style={{ height: ROW }}
            >
              <svg width={GRAPH_W} height={ROW} viewBox={`0 0 ${GRAPH_W} ${ROW}`} aria-hidden="true" className="shrink-0">
                {/* The campaign itself: every lane leaves it and returns to it. */}
                <line x1={TRUNK_X} y1={0} x2={TRUNK_X} y2={ROW} stroke="#1A2F5A" strokeWidth={2} />
                <path
                  d={`M ${TRUNK_X} ${ROW / 2 - 10} C ${TRUNK_X} ${ROW / 2}, ${TRUNK_X + 8} ${ROW / 2}, ${TRUNK_X + 18} ${ROW / 2} L ${lastX} ${ROW / 2}`}
                  fill="none" stroke={colour} strokeWidth={2}
                  strokeDasharray={lane.found > 0 ? undefined : '4 4'}
                />
                {lane.ticked > 0 && (
                  <path
                    d={`M ${lastX} ${ROW / 2} C ${lastX - 24} ${ROW / 2 + 10}, ${TRUNK_X} ${ROW / 2 + 12}, ${TRUNK_X} ${ROW}`}
                    fill="none" stroke={colour} strokeWidth={1.5} opacity={0.45}
                  />
                )}
                {COL_X.map((x, step) => (
                  <circle
                    key={step} cx={x} cy={ROW / 2} r={step === 0 ? 4 : 5}
                    fill={reached[step] ? colour : '#FFFFFF'}
                    stroke={colour} strokeWidth={2}
                    opacity={reached[step] || step <= 1 ? 1 : 0.5}
                  />
                ))}
              </svg>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-deep-navy" title={lane.company}>
                {lane.company}
              </span>
              <span className={`shrink-0 text-xs tabular-nums ${
                lane.run.state === 'failed' ? 'text-amber-800' : active ? 'text-deep-navy' : 'text-slate-500'}`}
                    data-testid="lane-state">
                {stateText(lane)}
                {lane.ticked > 0 ? ` · ${lane.ticked} ticked` : ''}
              </span>
              {/* Actions show on hover or keyboard focus, so a screenful of
                  lanes is not a screenful of buttons; they are in the tab
                  order regardless. */}
              <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  disabled={active}
                  onClick={(e) => { e.stopPropagation(); onFind(lane.company); }}
                  className="ui-button ui-button--ghost ui-button--sm"
                >
                  {active ? 'Searching' : lane.found > 0 ? 'Find more' : 'Find people'}
                </button>
                {runId !== undefined && (
                  <details className="relative" onClick={(e) => e.stopPropagation()}>
                    <summary
                      className="list-none cursor-pointer rounded-md px-2 py-0.5 text-sm leading-none text-slate-600 hover:bg-pale-sky/60 [&::-webkit-details-marker]:hidden"
                      aria-label={`More for ${lane.company}`}
                    >
                      ⋯
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-pale-sky bg-white p-1 shadow-md">
                      <button
                        type="button"
                        onClick={() => onExport(runId)}
                        className="block w-full rounded-md px-2 py-1 text-left text-xs text-deep-navy hover:bg-pale-sky/40"
                      >
                        Export .xlsx
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(runId)}
                        className="block w-full rounded-md px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50"
                      >
                        Delete run
                      </button>
                    </div>
                  </details>
                )}
              </span>
            </li>
          );
        })}
        {/* The merge node and the fold share a row: the panel's height is
            the sheet's headroom, so nothing here takes a row of its own
            that does not need one. A dashed trunk says lanes are hidden. */}
        <li className="flex items-center gap-2" style={{ height: ROW }}>
          <svg width={GRAPH_W} height={ROW} aria-hidden="true" className="shrink-0">
            <line x1={TRUNK_X} y1={0} x2={TRUNK_X} y2={ROW / 2} stroke="#1A2F5A" strokeWidth={2}
                  strokeDasharray={hidden > 0 ? '2 3' : undefined} />
            <circle cx={TRUNK_X} cy={ROW / 2} r={6} fill={built ? '#1A2F5A' : '#FFFFFF'}
                    stroke="#1A2F5A" strokeWidth={2} />
          </svg>
          <span className="text-[13px] font-semibold text-deep-navy">{built ? 'Campaign built' : 'One campaign'}</span>
          {(hidden > 0 || showAll) && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="ml-2 text-xs font-medium text-deep-navy underline"
            >
              {showAll ? 'Show fewer' : `${hidden} more`}
            </button>
          )}
        </li>
      </ul>
    </section>
  );
}
