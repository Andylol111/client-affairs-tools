import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Contact, type ImportOutcome } from '../../api';
import CompanyAutocomplete from '../CompanyAutocomplete';
import RecipientPicker, { type PickerMode } from './RecipientPicker';
import CompanyLanes, { type Lane } from './CompanyLanes';
import RoleSuggestionBubbles from './RoleSuggestionBubbles';
import { LEVEL_TITLES, companyKey, defaultSelection } from '../../lib/recipients';
import { type ChosenCompany, type CompanyRun, useDiscoveryRuns } from '../../lib/useDiscoveryRuns';

/**
 * Companies to a reviewable campaign, in the order the work is actually done.
 *
 * Every step of this already existed and lived on a different screen: pick
 * companies on one page, run Find people on another, write copy in Studio,
 * assemble a campaign in a fourth, define follow-ups in a fifth. Nobody
 * presses that many buttons, so the later steps went unused.
 *
 * The steps are numbered rather than tabbed because they are ordered: you
 * cannot write to people you have not found. Each one states what it did, so
 * a member can stop after any of them and still have something real - a
 * campaign here is a draft, and nothing is sent without releasing it.
 *
 * The left rail holds the steps; the right surface is the same at every
 * step - the lanes that say where each company stands, then the sheet of
 * people - so the flowchart and the list it describes are never apart. A
 * step's controls sit in its rail body and end in the one button that
 * advances it. Everything that acts on a company (search it, add who was
 * found) is on the surface, next to the company.
 */

type Step = 1 | 2 | 3 | 4;

type Preview = {
  recipients: number;
  ready: number;
  held: { contact_id?: number; email?: string; name?: string; reason: string }[];
  sample: { subject: string; body: string; email?: string } | null;
};

const FIELD_HINTS = ['{first}', '{last}', '{full_name}', '{title}', '{company}', '{date}'];
/** Server-side ceilings, restated so the step can warn before the request. */
const MAX_COMPANIES_PER_CAMPAIGN = 500;
/** Chips drawn before the row collapses to a count. */
const CHIP_WINDOW = 24;
/** People one search collects unless the member says otherwise. Enough for
 *  a team, not the whole payroll. */
const DEFAULT_MAX_PROSPECTS = 60;
const IDLE: CompanyRun = { state: 'idle', pct: 0, message: '' };
const PICKER_MODE: Record<Step, PickerMode> = { 1: 'preview', 2: 'select', 3: 'review', 4: 'review' };

/** A numbered step header that is also the way back to that step. Defined
 *  outside the component so React keeps one instance rather than remounting
 *  every header on each keystroke in the message box. */
function StepHeading({ n, title, hint, step, onSelect }: {
  n: Step; title: string; hint: string; step: Step; onSelect: (n: Step) => void;
}) {
  return (
    <button
      type="button"
      data-step={n}
      onClick={() => onSelect(n)}
      className={`w-full text-left px-5 py-3 flex items-center gap-3 ${
        step === n ? 'bg-pale-sky/40' : 'hover:bg-pale-sky/20'}`}
      aria-current={step === n}
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
        step > n ? 'bg-emerald-600 text-white' : step === n ? 'bg-deep-navy text-white' : 'bg-pale-sky text-slate-600'}`}>
        {step > n ? '✓' : n}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-deep-navy">{title}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  );
}

export type StageState = {
  step: Step;
  built: boolean;
  lanes: { company: string; found: number; ticked: number }[];
};

function clampProspects(raw: number): number {
  return Number.isFinite(raw) ? Math.min(800, Math.max(25, raw)) : DEFAULT_MAX_PROSPECTS;
}

export default function CampaignPipeline({ onStage }: { onStage?: (state: StageState) => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // A link that already carries search terms - the register's "Find people
  // here", the assistant's Fill, a bookmarked search - has made the first
  // choice already, so it opens on the step that acts on it rather than
  // asking again. Titles alone count: the assistant sends those without a
  // company when it has asked what roles to target, and hiding the field
  // behind a step would drop what the member just typed.
  const linkedCompany = (params.get('company') || '').trim();
  const linkedDomain = (params.get('domain') || '').trim();
  // Several companies at once, which is how Studio hands over a ticked
  // selection: there, ticking people only ever offered to delete them.
  const linkedCompanies = (params.get('companies') || '')
    .split(',').map((c) => c.trim()).filter(Boolean);
  const linkedRunId = Number(params.get('run') || '') || undefined;
  const arrivedWithSearch = Boolean(
    linkedCompany || linkedCompanies.length || linkedRunId
    || (params.get('titles') || '').trim() || linkedDomain,
  );
  const [step, setStep] = useState<Step>(arrivedWithSearch ? 2 : 1);

  // A company is a name and, when something already knows it, a domain: the
  // register hands one over so the search does not re-derive a domain it
  // was just given. A typed name has none and the server infers it.
  const [chosen, setChosen] = useState<ChosenCompany[]>(() => (
    linkedCompanies.length
      ? linkedCompanies.map((name) => ({ name }))
      : linkedCompany ? [{ name: linkedCompany, domain: linkedDomain || undefined }] : []
  ));
  const [typed, setTyped] = useState('');

  const [people, setPeople] = useState<Contact[]>([]);
  // Ticked recipients. The old step kept a list of people to *drop*, which
  // meant the default was "write to everyone found" and the member's real
  // choice was invisible.
  const [selected, setSelected] = useState<number[]>([]);
  // Once the member has touched the ticks, a refresh must not re-decide
  // them: only people who have just been added get the default treatment.
  const touchedRef = useRef(false);

  // What the search is told. Shared across companies because it is what the
  // member wants, not what a company calls it; the role bubbles translate it
  // per company and only add to it when clicked.
  const [titleHints, setTitleHints] = useState(() => (params.get('titles') || '').trim());
  const [maxProspects, setMaxProspects] = useState(() => (
    params.get('max') ? clampProspects(Number(params.get('max'))) : DEFAULT_MAX_PROSPECTS
  ));
  // A domain typed for a company that arrived without one, kept apart from
  // the company itself so the field that asks for it does not vanish at the
  // first keystroke.
  const [typedDomains, setTypedDomains] = useState<Record<string, string>>({});
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const [showAllChips, setShowAllChips] = useState(false);
  const [subject, setSubject] = useState('');
  // One message per company, keyed by the company name as chosen. Empty means
  // the campaign is one message for everybody.
  const [perCompany, setPerCompany] = useState(false);
  const [messages, setMessages] = useState<Record<string, { subject: string; body: string }>>({});
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [goal, setGoal] = useState('');
  const [proof, setProof] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [wantFollowUp, setWantFollowUp] = useState(false);
  const [followUpDays, setFollowUpDays] = useState(4);
  const [followUpSubject, setFollowUpSubject] = useState('');
  const [followUpBody, setFollowUpBody] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [built, setBuilt] = useState<{ campaign_id: number; created: number } | null>(null);


  const chosenNames = useMemo(() => chosen.map((c) => c.name), [chosen]);
  const isChosen = (name: string) => chosen.some((c) => companyKey(c.name) === companyKey(name));

  const toggle = (name: string) =>
    setChosen((current) => current.some((c) => companyKey(c.name) === companyKey(name))
      ? current.filter((c) => companyKey(c.name) !== companyKey(name))
      : [...current, { name }]);

  const visibleChips = showAllChips ? chosenNames : chosenNames.slice(0, CHIP_WINDOW);
  const hiddenChips = chosenNames.length - visibleChips.length;

  // The people on file at the chosen companies follow the companies: choose
  // one and its people appear, at whatever step. Debounced so a run of chip
  // clicks is one request, and stamped so a slow answer to an old choice
  // cannot overwrite the current one.
  const requestRef = useRef(0);
  const loadPeople = useCallback(async (names: string[], createdIds: number[] = []) => {
    const requestId = ++requestRef.current;
    if (names.length === 0) {
      setPeople([]);
      setSelected([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.contacts.list({ companies: names.join(','), limit: 800 });
      if (requestId !== requestRef.current) return;
      const items = Array.isArray(res?.items) ? res.items : [];
      setPeople(items);
      setSelected((current) => {
        if (!touchedRef.current) return defaultSelection(items);
        const present = new Set(items.map((p) => p.id));
        const fresh = defaultSelection(items.filter((p) => createdIds.includes(p.id)));
        return [...new Set([...current.filter((id) => present.has(id)), ...fresh])];
      });
    } catch (e) {
      if (requestId !== requestRef.current) return;
      setError(e instanceof Error ? e.message : 'Could not load people');
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPeople(chosenNames); }, 250);
    return () => window.clearTimeout(timer);
  }, [chosenNames, loadPeople]);

  const onImported = useCallback(async (outcomes: ImportOutcome[]) => {
    const createdIds = outcomes
      .flatMap((o) => (o.outcome === 'created' && o.contact_id !== null ? [o.contact_id] : []));
    await loadPeople(chosenNames, createdIds);
  }, [loadPeople, chosenNames]);

  const {
    runs, found, linkedRun, notice: runNotice, error: runError,
    startRun, addFound, exportRun, deleteRun,
  } = useDiscoveryRuns({ chosen, linkedRunId, onImported });

  // A link to a run means that run's company: make sure it has a lane, and
  // put it in focus. Once per run, deferred out of the effect body.
  const linkedApplied = useRef<number | null>(null);
  useEffect(() => {
    if (!linkedRun || linkedApplied.current === linkedRun.id) return;
    const timer = window.setTimeout(() => {
      linkedApplied.current = linkedRun.id;
      const key = companyKey(linkedRun.company_name);
      setChosen((current) => current.some((c) => companyKey(c.name) === key)
        ? current
        : [...current, { name: linkedRun.company_name, domain: linkedRun.company_domain || undefined }]);
      setFocusedKey(key);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [linkedRun]);

  const changeSelection = (ids: number[]) => {
    touchedRef.current = true;
    setSelected(ids);
  };

  // Only what was ticked, and only what can be reached: a selection kept from
  // before an address was removed must not become a silent send failure.
  const recipients = useMemo(
    () => people.filter((p) => p.email && selected.includes(p.id)),
    [people, selected],
  );

  // One lane per company: how many people it has (on file, plus found and
  // not yet on file), how many of them are ticked, and what its search is
  // doing.
  const lanes = useMemo<Lane[]>(() => {
    const byKey: Record<string, Contact[]> = {};
    for (const person of people) (byKey[companyKey(person.company)] ||= []).push(person);
    return chosen.map((company) => {
      const key = companyKey(company.name);
      const rows = byKey[key] || [];
      const onFile = new Set(rows.map((p) => (p.email || '').trim().toLowerCase()).filter(Boolean));
      const extra = (found[key] || []).filter((p) => !onFile.has((p.email || '').trim().toLowerCase())).length;
      return {
        company: company.name,
        found: rows.length + extra,
        ticked: rows.filter((p) => selected.includes(p.id) && p.email).length,
        run: runs[key] || IDLE,
      };
    });
  }, [chosen, people, selected, found, runs]);

  useEffect(() => {
    onStage?.({ step, built: Boolean(built), lanes });
  }, [onStage, step, built, lanes]);

  // Moving to a step scrolls it to the top of the column, so the work is
  // where the eye already is instead of below the fold.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const heading = rootRef.current?.querySelector(`[data-step="${step}"]`);
    if (!heading) return;
    const timer = window.setTimeout(
      () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => window.clearTimeout(timer);
  }, [step]);

  const byCompanyCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const person of recipients) {
      const key = companyKey(person.company);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [recipients]);

  // The company whose vocabulary the search controls are about: the lane
  // last pointed at, else the first chosen.
  const focused = chosen.find((c) => companyKey(c.name) === focusedKey) ?? chosen[0] ?? null;
  const focusedDomain = focused ? (typedDomains[companyKey(focused.name)] || focused.domain || '') : '';

  // One search, from wherever it is asked for: the lane, the group header in
  // the sheet. It takes the titles and settings from the step, and the
  // domain from what is known about the company. With no titles typed it
  // asks for the people who actually answer, so a quick press never comes
  // back with a board.
  const findPeople = useCallback((company: ChosenCompany) => {
    const key = companyKey(company.name);
    setFocusedKey(key);
    void startRun(company, {
      titleHints: titleHints.trim() || LEVEL_TITLES.working,
      maxProspects,
      domain: typedDomains[key] || undefined,
    });
  }, [startRun, titleHints, maxProspects, typedDomains]);

  const findByName = useCallback((name: string) => {
    const company = chosen.find((c) => companyKey(c.name) === companyKey(name));
    if (company) findPeople(company);
  }, [chosen, findPeople]);

  const runPreview = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.campaigns.build({
        companies: chosenNames,
        contact_ids: recipients.map((r) => r.id),
        subject, body, messages, preview_only: true,
      });
      setPreview(res as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not render that message');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [chosenNames, recipients, subject, body, messages]);

  const build = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.campaigns.build({
        name: `${chosenNames.slice(0, 2).join(', ')}${chosen.length > 2 ? ` +${chosen.length - 2}` : ''}`,
        companies: chosenNames,
        contact_ids: recipients.map((r) => r.id),
        subject, body, messages,
      });
      if (wantFollowUp && followUpSubject.trim() && followUpBody.trim()) {
        await api.outreach.sequences.create(
          `Follow-up for ${res.name}`,
          [{ days_after: followUpDays, subject: followUpSubject, body: followUpBody }],
        );
      }
      setBuilt({ campaign_id: res.campaign_id, created: res.created });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the campaign');
    } finally {
      setBusy(false);
    }
  };

  return (
    // 18.25rem is the shell around this grid at xl: header, main padding,
    // page header and subnav above; workspace and main padding below. The
    // grid fills the rest exactly so the page never grows a scrollbar of
    // its own beside the rail's and the surface's.
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 xl:h-[calc(100vh-18.25rem)]"
         data-section="campaign-pipeline">
      <div ref={rootRef}
           data-rail
           className="xl:col-span-2 min-h-0 xl:max-h-full xl:overflow-y-auto surface-card rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden self-start">
      <StepHeading n={1} title="Choose companies" hint={chosen.length ? `${chosen.length} chosen` : 'Type any company name'} step={step} onSelect={setStep} />
      {step === 1 && (
        <div className="px-5 pb-5 space-y-3 border-b border-pale-sky">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <CompanyAutocomplete
                id="pipeline-company"
                label="Company"
                value={typed}
                placeholder="Any company, including the public register"
                onChange={(name) => setTyped(name)}
                onSelect={(option) => {
                  setChosen((current) => current.some((c) => companyKey(c.name) === companyKey(option.name))
                    ? current
                    : [...current, { name: option.name, domain: option.domain || undefined }]);
                  setTyped('');
                }}
              />
            </div>
            <button
              type="button"
              disabled={!typed.trim()}
              onClick={() => { toggle(typed.trim()); setTyped(''); }}
              className="ui-button ui-button--secondary shrink-0"
            >
              Add
            </button>
          </div>

          {chosen.length > 0 && (
            <p className="text-xs text-slate-500" data-testid="chosen-count">
              {chosen.length} compan{chosen.length === 1 ? 'y' : 'ies'} chosen
              {chosen.length > MAX_COMPANIES_PER_CAMPAIGN
                ? ` — a campaign takes at most ${MAX_COMPANIES_PER_CAMPAIGN}; drop some or split the release.`
                : ''}
              {' · '}
              <button type="button" className="underline" onClick={() => setChosen([])}>Clear all</button>
            </p>
          )}

          {/* Only a screenful of chips is drawn: a selection of several hundred
              companies is a count plus the ones being worked on, not eight
              hundred DOM nodes. */}
          {chosenNames.length > 0 && <p className="text-xs font-medium text-slate-500 pt-1">Chosen companies</p>}
          <div className="flex flex-wrap gap-2" data-testid="company-chips">
            {visibleChips.map((name) => {
              const on = isChosen(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggle(name)}
                  title={name}
                  className={`inline-flex h-11 max-w-full items-center rounded-full border px-4 text-sm ${
                    on ? 'border-deep-navy bg-deep-navy text-white' : 'border-pale-sky bg-white text-deep-navy hover:border-steel-blue'}`}
                >
                  <span className="truncate">{on ? '✓ ' : ''}{name}</span>
                </button>
              );
            })}
            {hiddenChips > 0 && (
              <button
                type="button"
                onClick={() => setShowAllChips((v) => !v)}
                className="inline-flex h-11 items-center rounded-full border border-dashed border-steel-blue px-4 text-sm text-deep-navy"
              >
                {showAllChips ? 'Show fewer' : `+${hiddenChips} more`}
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={(chosen.length === 0 && !typed.trim()) || busy}
            onClick={() => {
              // Typed a name and pressed the big button without adding it
              // first: that is the same intent, so take it.
              const pending = typed.trim();
              if (pending && !isChosen(pending)) {
                setChosen((current) => [...current, { name: pending }]);
                setTyped('');
              }
              setStep(2);
            }}
            className="ui-button ui-button--primary w-full py-3 text-[15px]"
          >
            {chosen.length > 1
              ? `Find people at these ${chosen.length} companies`
              : 'Find people'}
          </button>
        </div>
      )}

      <StepHeading n={2} title="Choose who gets it" hint={people.length ? `${recipients.length} of ${people.length} chosen` : 'Tick the people this message goes to'} step={step} onSelect={setStep} />
      {step === 2 && (
        <div className="px-5 pb-5 space-y-3 border-b border-pale-sky">
          <p className="text-sm text-deep-navy">
            <strong>{recipients.length}</strong> of {people.filter((p) => p.email).length} reachable
            people ticked, at {chosen.length} compan{chosen.length === 1 ? 'y' : 'ies'}. Tick them on
            the right.
          </p>
          {people.length === 0 && !busy && (
            <p className="text-sm text-slate-500">
              Nobody on record at these companies yet. Search a company from its lane, or import a
              list.
            </p>
          )}

          {/* What a search is told. The titles are the member's words; the
              bubbles under them are the focused company's own words for
              the same roles, added only when clicked - what one company
              calls a job is never quietly applied to another. */}
          <label className="block text-xs font-medium text-slate-600">
            Titles to prioritise
            <input
              className="mt-1 w-full rounded-lg border border-pale-sky px-3 py-2 text-sm text-deep-navy"
              aria-label="Titles to prioritise"
              value={titleHints}
              onChange={(e) => setTitleHints(e.target.value)}
              placeholder="VPs, project managers"
            />
          </label>
          {focused && (
            <div data-testid="focused-company" data-company={focused.name}>
              <RoleSuggestionBubbles
                company={focused.name}
                domain={focusedDomain}
                hints={titleHints}
                onAdd={(title) => setTitleHints((prev) => {
                  const parts = prev.split(',').map((p) => p.trim()).filter(Boolean);
                  if (parts.some((p) => p.toLowerCase() === title.toLowerCase())) return prev;
                  return [...parts, title].join(', ');
                })}
              />
            </div>
          )}
          <details className="rounded-xl border border-pale-sky">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-deep-navy">
              Search settings
            </summary>
            <div className="space-y-2 border-t border-pale-sky p-3">
              <label className="block text-xs font-medium text-slate-600">
                People to collect (25–800)
                <input
                  type="number"
                  min={25}
                  max={800}
                  className="mt-1 w-full rounded-lg border border-pale-sky px-3 py-2 text-sm text-deep-navy"
                  aria-label="People to collect"
                  value={maxProspects}
                  onChange={(e) => setMaxProspects(clampProspects(Number(e.target.value)))}
                />
              </label>
              {focused && !focused.domain && (
                <label className="block text-xs font-medium text-slate-600">
                  Domain for {focused.name} (optional; looked up from the name if blank)
                  <input
                    className="mt-1 w-full rounded-lg border border-pale-sky px-3 py-2 text-sm text-deep-navy"
                    aria-label="Company domain"
                    value={typedDomains[companyKey(focused.name)] || ''}
                    onChange={(e) => setTypedDomains((prev) => ({ ...prev, [companyKey(focused.name)]: e.target.value }))}
                    placeholder="apple.com"
                  />
                </label>
              )}
            </div>
          </details>

          {/* The other way people arrive: the spreadsheet you already have. */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setImporting(true);
                setError('');
                try {
                  const res = await api.contacts.importFile(file);
                  await loadPeople(chosenNames);
                  setError(res.duplicates_skipped
                    ? `Imported ${res.count}; ${res.duplicates_skipped} already on record.`
                    : '');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not import that file');
                } finally {
                  setImporting(false);
                  event.target.value = '';
                }
              }}
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="ui-button ui-button--ghost ui-button--sm"
            >
              {importing ? 'Importing…' : 'Import a spreadsheet instead'}
            </button>
          </div>

          <button
            type="button"
            disabled={recipients.length === 0}
            onClick={() => setStep(3)}
            className="ui-button ui-button--primary"
          >
            Write to these {recipients.length}
          </button>
        </div>
      )}

      <StepHeading n={3} title="Write the message" hint="One message, personalised per recipient" step={step} onSelect={setStep} />
      {step === 3 && (
        <div className="px-5 pb-5 space-y-3 border-b border-pale-sky">
          {/* Generating and allocating are one act here. Studio drafts to a
              single named person, which is right for a bespoke email and
              wrong for a group: the same message has to reach everyone
              chosen, so the parts that differ are fields rather than a name
              the model invents. */}
          <div className="rounded-xl border border-pale-sky p-3 space-y-2">
            <p className="text-[13px] font-semibold text-deep-navy">Write it with AI, or skip and type it yourself</p>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What should this email achieve?"
              aria-label="Email goal"
              className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm"
            />
            <input
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              placeholder="Anything true the email may cite (optional)"
              aria-label="Verified proof"
              className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm"
            />
            {chosen.length > 1 && (
              <label className="flex items-start gap-2 text-[13px] text-deep-navy">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={perCompany}
                  onChange={(e) => { setPerCompany(e.target.checked); setPreview(null); }}
                />
                <span>
                  Write a different message for each company
                </span>
              </label>
            )}
            <button
              type="button"
              disabled={drafting || !goal.trim()}
              onClick={async () => {
                setDrafting(true);
                setError('');
                try {
                  const roles = [...new Set(recipients.map((r) => r.title).filter(Boolean))].slice(0, 6).join(', ');
                  if (perCompany) {
                    const res = await api.campaigns.draftTemplate({
                      companies: chosenNames, goal, proof, roles, per_company: true,
                    });
                    setMessages(res.messages || {});
                    setSubject('');
                    setBody('');
                  } else {
                    const res = await api.campaigns.draftTemplate({ companies: chosenNames, goal, proof, roles });
                    setMessages({});
                    setSubject(res.subject || '');
                    setBody(res.body || '');
                  }
                  setPreview(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not draft that');
                } finally {
                  setDrafting(false);
                }
              }}
              className="ui-button ui-button--secondary ui-button--sm"
            >
              {drafting
                ? 'Writing…'
                : perCompany
                  ? `Draft a message for each of these ${chosen.length} companies`
                  : `Draft one message for these ${recipients.length}`}
            </button>
          </div>

          {/* One editable message per company, so what the AI wrote is what
              the member corrects rather than something they have to accept. */}
          {Object.keys(messages).length > 0 && (
            <div className="space-y-2" data-testid="per-company-messages">
              {chosenNames.filter((c) => messages[c]).map((company) => (
                <details key={company} className="rounded-xl border border-pale-sky" open={chosen.length <= 3 || chosenNames.indexOf(company) === 0}>
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-deep-navy">
                    {company}
                    <span className="ml-2 font-normal text-xs text-slate-500">
                      {byCompanyCount[companyKey(company)] || 0} recipient(s)
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-pale-sky p-3">
                    <input
                      value={messages[company].subject}
                      aria-label={`Subject for ${company}`}
                      onChange={(e) => setMessages((m) => ({ ...m, [company]: { ...m[company], subject: e.target.value } }))}
                      className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm"
                    />
                    <textarea
                      value={messages[company].body}
                      aria-label={`Message for ${company}`}
                      rows={8}
                      onChange={(e) => setMessages((m) => ({ ...m, [company]: { ...m[company], body: e.target.value } }))}
                      className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm font-mono"
                    />
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* With a message per company written, this is the one used for any
              company that has none - so it is offered, not demanded. */}
          {Object.keys(messages).length > 0 && (
            <p className="text-[13px] font-semibold text-deep-navy">
              Message for any company without one of its own (optional)
            </p>
          )}
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder={'Hi {first},\n\nI am writing from the Yale Undergraduate Consulting Group about {company}…'}
            aria-label="Message"
            className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm font-mono"
          />
          <p className="text-xs text-slate-500">
            Fields: {FIELD_HINTS.join('  ')} — each recipient gets their own. A recipient missing a
            field the message uses is held back rather than sent a blank.
          </p>
          <button
            type="button"
            disabled={busy || (!Object.keys(messages).length && (!subject.trim() || !body.trim()))}
            onClick={() => void runPreview()}
            className="ui-button ui-button--primary"
          >
            {busy ? 'Rendering…' : 'Preview the real message'}
          </button>
        </div>
      )}

      <StepHeading n={4} title="Follow-up, then build" hint={wantFollowUp ? `One follow-up after ${followUpDays} days` : 'Optional'} step={step} onSelect={setStep} />
      {step === 4 && (
        <div className="px-5 pb-5 space-y-3">
          <label className="flex items-center gap-2 text-sm text-deep-navy">
            <input type="checkbox" checked={wantFollowUp} onChange={(e) => setWantFollowUp(e.target.checked)} />
            Send one follow-up to anyone who has not replied
          </label>
          {wantFollowUp && (
            <div className="space-y-2 rounded-xl border border-pale-sky p-3">
              <label className="block text-xs font-medium text-slate-600">
                Days to wait
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={followUpDays}
                  onChange={(e) => setFollowUpDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                  className="ml-2 w-20 px-2 py-1 rounded-lg border border-pale-sky text-sm"
                />
              </label>
              <input
                value={followUpSubject}
                onChange={(e) => setFollowUpSubject(e.target.value)}
                placeholder="Follow-up subject"
                aria-label="Follow-up subject"
                className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm"
              />
              <textarea
                value={followUpBody}
                onChange={(e) => setFollowUpBody(e.target.value)}
                rows={5}
                placeholder={'Hi {first}, following up on my note about {company}.'}
                aria-label="Follow-up message"
                className="w-full px-3 py-2 rounded-xl border border-pale-sky text-sm font-mono"
              />
              <p className="text-xs text-slate-500">
                It stops the moment they reply. You can see it queued under Pipeline → Follow-ups.
              </p>
            </div>
          )}

          {built ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Campaign built with {built.created} draft(s). Nothing has been sent.{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => navigate(`/campaigns/${built.campaign_id}`)}
              >
                Review and release it
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void build()}
              className="ui-button ui-button--primary"
            >
              {busy ? 'Building…' : `Build the campaign (${recipients.length} draft${recipients.length === 1 ? '' : 's'})`}
            </button>
          )}
        </div>
      )}

      {error && <p className="px-5 pb-4 text-sm text-red-700">{error}</p>}
      </div>

      {/* The surface: the same two things at every step, in the same order,
          so the flowchart and the list it describes are never apart. The
          aside is the only thing that scrolls; the lanes stay short and the
          sheet takes whatever is left. */}
      <aside className="xl:col-span-3 min-h-0 xl:overflow-y-auto space-y-4" data-surface>
        {runNotice && (
          <p className="ui-notice ui-notice--info text-sm" role="status">{runNotice}</p>
        )}
        {runError && (
          <p className="ui-notice ui-notice--danger text-sm" role="alert">{runError}</p>
        )}
        <CompanyLanes
          lanes={lanes}
          built={Boolean(built)}
          focused={focused?.name ?? null}
          onFocus={(name) => setFocusedKey(companyKey(name))}
          onFind={findByName}
          onExport={(runId) => void exportRun(runId)}
          onDelete={(runId) => {
            if (window.confirm('Delete this search and everything it found?')) void deleteRun(runId);
          }}
        />

        {step === 3 && (
          <section className="surface-card rounded-2xl border border-pale-sky px-4 py-3 max-h-[40vh] overflow-y-auto" aria-label="Preview">
            <h2 className="text-[15px] font-semibold text-deep-navy mb-1">What they will read</h2>
            {preview ? (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-deep-navy">
                  {preview.ready} of {preview.recipients} ready
                  {preview.held.length ? ` · ${preview.held.length} held` : ''}
                </p>
                {preview.sample && (
                  <div className="rounded-xl border border-pale-sky p-3">
                    <p className="text-xs text-slate-500">To {preview.sample.email}</p>
                    <p className="text-sm font-semibold text-deep-navy">{preview.sample.subject}</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{preview.sample.body}</p>
                  </div>
                )}
                {preview.held.map((h) => (
                  <p key={h.contact_id} className="text-xs text-amber-900">{h.reason}</p>
                ))}
                <button
                  type="button"
                  disabled={preview.ready === 0}
                  onClick={() => setStep(4)}
                  className="ui-button ui-button--primary"
                >
                  Looks right
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Write the message, then press Preview: the real rendered email the first
                recipient receives, not the template.
              </p>
            )}
          </section>
        )}

        {chosen.length > 0 ? (
          <section className="surface-card rounded-2xl border border-pale-sky px-4 pb-4" aria-label="People" data-testid="sheet">
            <RecipientPicker
              mode={PICKER_MODE[step]}
              companies={chosen}
              people={people}
              selected={selected}
              onSelectedChange={changeSelection}
              found={found}
              runs={runs}
              onFind={findPeople}
              onAddFound={addFound}
              busy={busy}
            />
          </section>
        ) : (
          <section className="surface-card rounded-2xl border border-pale-sky p-4 text-sm text-slate-500" aria-label="People">
            Choose a company and the people on file there appear here.
          </section>
        )}
      </aside>
    </div>
  );
}
