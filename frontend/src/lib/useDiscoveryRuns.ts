import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError, api,
  type DiscoveryProspect, type DiscoveryRun, type ImportOutcome,
} from '../api';
import { companyKey } from './recipients';

/**
 * The durable Find people searches behind the campaign pipeline, one per
 * company, kept where every step can see them.
 *
 * A search used to live inside the picker of one step and be forgotten when
 * the member moved on or reloaded: a run still working on the server had no
 * lane to report to, and its people, once found, were imported wholesale
 * whether or not anybody wanted them. Here the runs are read back from the
 * server on arrival, so a reload resumes the progress bar, and what a run
 * found stays "found" - visible, but not on file - until the member adds the
 * people they actually want.
 *
 * The server allows one search per member at a time. Asking for a second
 * one is not a mistake, so it is queued here and started when the first
 * finishes, rather than refused.
 */

export type ChosenCompany = { name: string; domain?: string };

export type LaneState = 'idle' | 'queued' | 'searching' | 'done' | 'failed';

export type CompanyRun = {
  state: LaneState;
  runId?: number;
  pct: number;
  message: string;
};

/** A person a run found, with the reason the last Add left them behind. */
export type FoundPerson = DiscoveryProspect & { skippedReason?: string };

export type SearchOptions = { titleHints: string; maxProspects: number; domain?: string };

type Queued = { company: ChosenCompany; options: SearchOptions };

const POLL_MS = 2500;
const ACTIVE: Record<string, true> = { queued: true, running: true };

/** Prospects a member could actually add: junk and address-less rows are
 *  what the import refuses, so they are not offered. */
function usable(rows: DiscoveryProspect[]): FoundPerson[] {
  const seen = new Set<string>();
  const out: FoundPerson[] = [];
  for (const row of rows) {
    const email = (row.email || '').trim().toLowerCase();
    if (!email || row.ai_verdict === 'junk' || seen.has(email)) continue;
    seen.add(email);
    out.push(row);
  }
  return out;
}

export function useDiscoveryRuns({ chosen, linkedRunId, onImported }: {
  chosen: ChosenCompany[];
  /** `?run=<id>` from a link: the run whose lane should be in focus. */
  linkedRunId?: number;
  /** The people that landed on file, so the caller can reload and tick them. */
  onImported: (outcomes: ImportOutcome[]) => Promise<void> | void;
}) {
  const [runsById, setRunsById] = useState<Record<number, DiscoveryRun>>({});
  const [found, setFound] = useState<Record<string, FoundPerson[]>>({});
  const [queue, setQueue] = useState<Queued[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const queueRef = useRef<Queued[]>([]);
  const loadedProspects = useRef<Set<number>>(new Set());
  const onImportedRef = useRef(onImported);
  useEffect(() => { onImportedRef.current = onImported; }, [onImported]);

  const chosenKeys = useMemo(() => new Set(chosen.map((c) => companyKey(c.name))), [chosen]);
  const chosenKeyList = [...chosenKeys].sort().join('\n');

  // Latest run per company: an older completed run says nothing once a newer
  // one has been asked for.
  const latestByKey = useMemo(() => {
    const map: Record<string, DiscoveryRun> = {};
    for (const run of Object.values(runsById)) {
      const key = companyKey(run.company_name);
      if (!map[key] || map[key].id < run.id) map[key] = run;
    }
    return map;
  }, [runsById]);

  const loadFound = useCallback(async (run: DiscoveryRun) => {
    if (loadedProspects.current.has(run.id)) return;
    loadedProspects.current.add(run.id);
    try {
      const rows = await api.yucgoutreach.listProspects(run.id, 800);
      setFound((prev) => ({ ...prev, [companyKey(run.company_name)]: usable(rows) }));
    } catch (e) {
      loadedProspects.current.delete(run.id);
      setError(e instanceof Error ? e.message : 'Could not read what that search found');
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      const list = await api.yucgoutreach.listRuns(40);
      setRunsById(Object.fromEntries(list.map((run) => [run.id, run])));
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read earlier searches');
      return [];
    }
  }, []);

  // Arrival, and every change of companies: what the server already knows.
  // Deferred so the fetch is not a synchronous setState inside the effect,
  // which would cascade a render on mount.
  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshRuns(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshRuns, chosenKeyList]);

  const linkedRun = linkedRunId ? runsById[linkedRunId] ?? null : null;

  // Finished runs for chosen companies show what they found. A failed run
  // keeps its partial results: they are real people, and the lane says the
  // search did not finish.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const run of Object.values(latestByKey)) {
        if (!chosenKeys.has(companyKey(run.company_name))) continue;
        if (run.status === 'completed' || run.status === 'failed') void loadFound(run);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [latestByKey, chosenKeys, loadFound]);

  const startNow = useCallback(async (item: Queued): Promise<'started' | 'busy' | 'failed'> => {
    try {
      const res = await api.yucgoutreach.createRun({
        company_name: item.company.name,
        company_domain: item.options.domain || item.company.domain || undefined,
        title_hints: item.options.titleHints.trim() || undefined,
        max_prospects: item.options.maxProspects,
      });
      loadedProspects.current.delete(res.id);
      setRunsById((prev) => ({
        ...prev,
        [res.id]: {
          id: res.id, company_name: item.company.name,
          company_domain: item.company.domain, status: 'queued', progress_pct: 0,
          progress_message: 'Starting…',
        },
      }));
      return 'started';
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Not a failure: the server is already busy for this member, and
        // this request waits its turn.
        const list = await refreshRuns();
        const busy = list.find((run) => ACTIVE[run.status]);
        setNotice(`Already searching ${busy ? busy.company_name : 'another company'}; ${item.company.name} is queued behind it.`);
        return 'busy';
      }
      setError(e instanceof Error ? e.message : 'Could not start that search');
      return 'failed';
    }
  }, [refreshRuns]);

  const startNext = useCallback(async () => {
    const next = queueRef.current[0];
    if (!next) return;
    if (await startNow(next) !== 'busy') {
      queueRef.current = queueRef.current.slice(1);
      setQueue(queueRef.current);
    }
  }, [startNow]);

  // One poll for every active run this member has, whether it was started
  // here or before a reload. When a run finishes, its people are read and
  // the next queued company starts.
  const activeIds = Object.values(runsById).filter((run) => ACTIVE[run.status]).map((run) => run.id).join(',');
  useEffect(() => {
    if (!activeIds) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      let finished = false;
      for (const id of activeIds.split(',').map(Number)) {
        try {
          const run = await api.yucgoutreach.getRun(id);
          if (cancelled) return;
          setRunsById((prev) => ({ ...prev, [run.id]: run }));
          if (run.status === 'completed' || run.status === 'failed') {
            finished = true;
            if (chosenKeys.has(companyKey(run.company_name))) void loadFound(run);
          }
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Lost track of that search');
          return;
        }
      }
      if (finished) {
        setNotice('');
        void startNext();
        return;
      }
      timer = window.setTimeout(() => { void tick(); }, POLL_MS);
    };
    timer = window.setTimeout(() => { void tick(); }, POLL_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeIds, chosenKeys, loadFound, startNext]);

  const startRun = useCallback(async (company: ChosenCompany, options: SearchOptions) => {
    setError('');
    const key = companyKey(company.name);
    if (queueRef.current.some((q) => companyKey(q.company.name) === key)) return;
    const item: Queued = { company, options };
    const busyRun = Object.values(runsById).find((run) => ACTIVE[run.status]);
    if (!busyRun && queueRef.current.length === 0) {
      if (await startNow(item) !== 'busy') return;
    } else {
      // Same words whether the page knew the server was busy or the server
      // had to say so: this search waits its turn.
      setNotice(busyRun
        ? `Already searching ${busyRun.company_name}; ${company.name} is queued behind it.`
        : `${company.name} is queued behind ${queueRef.current[0].company.name}.`);
    }
    if (queueRef.current.some((q) => companyKey(q.company.name) === key)) return;
    queueRef.current = [...queueRef.current, item];
    setQueue(queueRef.current);
  }, [runsById, startNow]);

  const addFound = useCallback(async (key: string, ids: number[] | 'all') => {
    const run = latestByKey[key];
    const rows = found[key] || [];
    const wanted = ids === 'all' ? rows.filter((p) => !p.skippedReason).map((p) => p.id) : ids;
    if (!run || wanted.length === 0) return;
    setError('');
    try {
      const res = await api.yucgoutreach.importContacts(run.id, wanted);
      const landed = new Set(res.results.filter((r) => r.outcome !== 'skipped').map((r) => r.prospect_id));
      const reasons = new Map(res.results.filter((r) => r.outcome === 'skipped').map((r) => [r.prospect_id, r.reason || 'skipped']));
      setFound((prev) => ({
        ...prev,
        [key]: (prev[key] || [])
          .filter((p) => !landed.has(p.id))
          .map((p) => (reasons.has(p.id) ? { ...p, skippedReason: reasons.get(p.id) } : p)),
      }));
      await onImportedRef.current(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add those people');
    }
  }, [latestByKey, found]);

  const exportRun = useCallback(async (runId: number) => {
    setError('');
    try {
      await api.yucgoutreach.exportExcel(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  }, []);

  const deleteRun = useCallback(async (runId: number) => {
    setError('');
    try {
      await api.yucgoutreach.deleteRun(runId);
      const run = runsById[runId];
      setRunsById((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      if (run) {
        setFound((prev) => {
          const next = { ...prev };
          delete next[companyKey(run.company_name)];
          return next;
        });
      }
      loadedProspects.current.delete(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [runsById]);

  // What each chosen company's lane shows.
  const runs = useMemo(() => {
    const map: Record<string, CompanyRun> = {};
    for (const key of chosenKeys) {
      const run = latestByKey[key];
      if (queue.some((q) => companyKey(q.company.name) === key)) {
        map[key] = { state: 'queued', pct: 0, message: 'Queued' };
      } else if (!run) {
        map[key] = { state: 'idle', pct: 0, message: '' };
      } else if (ACTIVE[run.status]) {
        map[key] = {
          state: 'searching', runId: run.id,
          pct: Number(run.progress_pct) || 0,
          message: run.progress_message || 'Searching…',
        };
      } else if (run.status === 'failed') {
        map[key] = { state: 'failed', runId: run.id, pct: 100, message: run.error_message || 'Search failed' };
      } else {
        map[key] = { state: 'done', runId: run.id, pct: 100, message: run.progress_message || 'Search finished' };
      }
    }
    return map;
  }, [chosenKeys, latestByKey, queue]);

  return { runs, found, linkedRun, error, notice, startRun, addFound, exportRun, deleteRun };
}
