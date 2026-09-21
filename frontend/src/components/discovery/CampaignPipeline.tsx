import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { api, type Contact, type YucgRecommendation } from '../../api';
import CompanyDiscovery from './CompanyDiscovery';
import CompanyAutocomplete from '../CompanyAutocomplete';

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

/** A numbered step header that is also the way back to that step. Defined
 *  outside the component so React keeps one instance rather than remounting
 *  every header on each keystroke in the message box. */
function StepHeading({ n, title, hint, step, onSelect }: {
  n: Step; title: string; hint: string; step: Step; onSelect: (n: Step) => void;
}) {
  return (
    <button
      type="button"
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

export default function CampaignPipeline() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // A link that already carries search terms - the register's "Find people
  // here", the assistant's Fill, a bookmarked search - has made the first
  // choice already, so it opens on the step that acts on it rather than
  // asking again. Titles alone count: the assistant sends those without a
  // company when it has asked what roles to target, and hiding the field
  // behind a step would drop what the member just typed.
  const linkedCompany = (params.get('company') || '').trim();
  // Several companies at once, which is how Studio hands over a ticked
  // selection: there, ticking people only ever offered to delete them.
  const linkedCompanies = (params.get('companies') || '')
    .split(',').map((c) => c.trim()).filter(Boolean);
  const arrivedWithSearch = Boolean(
    linkedCompany || linkedCompanies.length
    || (params.get('titles') || '').trim() || (params.get('domain') || '').trim(),
  );
  const [step, setStep] = useState<Step>(arrivedWithSearch ? 2 : 1);

  const [suggested, setSuggested] = useState<YucgRecommendation[]>([]);
  const [chosen, setChosen] = useState<string[]>(
    linkedCompanies.length ? linkedCompanies : linkedCompany ? [linkedCompany] : [],
  );
  const [typed, setTyped] = useState('');

  const [people, setPeople] = useState<Contact[]>([]);
  const [dropped, setDropped] = useState<number[]>([]);

  const [showAllChips, setShowAllChips] = useState(false);
  const [subject, setSubject] = useState('');
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

  useEffect(() => {
    api.yucg.recommend({ n: 12 })
      .then((res) => setSuggested(Array.isArray(res.recommendations) ? res.recommendations : []))
      .catch(() => setSuggested([]));
  }, []);

  const toggle = (name: string) =>
    setChosen((current) => current.includes(name)
      ? current.filter((c) => c !== name)
      : [...current, name]);

  // Step 2 reads the people already found at the chosen companies. Discovery
  // itself stays where it is - this shows what it produced and offers to run
  // it again for a company that came back thin.
  const chipNames = useMemo(() => Array.from(new Set([
    ...suggested.map((rec) => rec.prospect?.company).filter((n): n is string => !!n),
    ...chosen,
  ])), [suggested, chosen]);
  const visibleChips = showAllChips ? chipNames : chipNames.slice(0, CHIP_WINDOW);
  const hiddenChips = chipNames.length - visibleChips.length;

  const loadPeople = useCallback(async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.contacts.list({ companies: chosen.join(','), limit: 400 });
      setPeople(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load people');
    } finally {
      setBusy(false);
    }
  }, [chosen]);

  useEffect(() => {
    if (!arrivedWithSearch || chosen.length === 0) return;
    // Deferred so the fetch is not a synchronous setState inside the effect,
    // which would cascade a render on mount.
    const timer = window.setTimeout(() => { void loadPeople(); }, 0);
    return () => window.clearTimeout(timer);
    // Arrival only: afterwards the member advances the steps themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recipients = useMemo(
    () => people.filter((p) => p.email && !dropped.includes(p.id)),
    [people, dropped],
  );

  const byCompany = useMemo(() => {
    const map = new Map<string, Contact[]>();
    // Every company the member chose gets a row, including the ones with
    // nobody on file yet. Dropping them would make a company typed in by hand
    // disappear at step 2 with no explanation and no way to act on it.
    for (const company of chosen) map.set(company.trim(), []);
    for (const person of people) {
      const key = (person.company || 'No company').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(person);
    }
    return [...map.entries()];
  }, [people, chosen]);

  const runPreview = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.campaigns.build({
        companies: chosen,
        contact_ids: recipients.map((r) => r.id),
        subject, body, preview_only: true,
      });
      setPreview(res as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not render that message');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [chosen, recipients, subject, body]);

  const build = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.campaigns.build({
        name: `${chosen.slice(0, 2).join(', ')}${chosen.length > 2 ? ` +${chosen.length - 2}` : ''}`,
        companies: chosen,
        contact_ids: recipients.map((r) => r.id),
        subject, body,
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
    <div className="surface-card rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden"
         data-section="campaign-pipeline">
      <StepHeading n={1} title="Choose companies" hint={chosen.length ? `${chosen.length} chosen` : 'From the club list, or type any name'} step={step} onSelect={setStep} />
      {step === 1 && (
        <div className="px-5 pb-5 space-y-3 border-b border-pale-sky">
          {/* Chips cover the club suggestions and anything typed in. A company
              the club list and the register have never heard of is still a
              company: without a chip it would be silently selected, with no way
              to see it or take it back. Only a screenful is drawn: a selection
              of several hundred companies is a count plus the ones you are
              working on, not eight hundred DOM nodes. */}
          <div className="flex flex-wrap gap-2">
            {visibleChips.map((name) => {
              const on = chosen.includes(name);
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
          {chosen.length > 0 && (
            <p className="text-xs text-slate-500">
              {chosen.length} compan{chosen.length === 1 ? 'y' : 'ies'} chosen
              {chosen.length > MAX_COMPANIES_PER_CAMPAIGN
                ? ` — a campaign takes at most ${MAX_COMPANIES_PER_CAMPAIGN}; drop some or split the release.`
                : ''}
              {' · '}
              <button type="button" className="underline" onClick={() => setChosen([])}>Clear all</button>
            </p>
          )}
          {/* The same field as everywhere else, so the 214k-company public
              register is reachable from the first step rather than only from
              the Companies tab. */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <CompanyAutocomplete
                id="pipeline-company"
                label="Company"
                value={typed}
                placeholder="Any company, including the public register"
                onChange={(name) => setTyped(name)}
                onSelect={(option) => { toggle(option.name); setTyped(''); }}
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
          <button
            type="button"
            disabled={chosen.length === 0 || busy}
            onClick={() => { setStep(2); void loadPeople(); }}
            className="ui-button ui-button--primary"
          >
            Find people at {chosen.length || 'these'} compan{chosen.length === 1 ? 'y' : 'ies'}
          </button>
        </div>
      )}

      <StepHeading n={2} title="Check the people" hint={people.length ? `${recipients.length} will be written to` : 'Who was found, and who to drop'} step={step} onSelect={setStep} />
      {step === 2 && (
        <div className="px-5 pb-5 space-y-3 border-b border-pale-sky">
          {busy && <p className="text-sm text-slate-500">Loading…</p>}
          {byCompany.map(([company, rows]) => (
            <div key={company} className="rounded-xl border border-pale-sky">
              <div className="flex items-center justify-between px-3 py-2 bg-pale-sky/30">
                <span className="text-sm font-semibold text-deep-navy">{company}</span>
                <span className="text-xs text-slate-500">{rows.length} found</span>
              </div>
              {rows.length === 0 && (
                <p className="px-3 py-2 text-sm text-slate-500">
                  Nobody on file here yet. Use Search for people below, or import a list.
                </p>
              )}
              <ul className="divide-y divide-pale-sky">
                {rows.map((person) => (
                  <li key={person.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-deep-navy">{person.name || person.email}</span>
                      <span className="text-slate-500"> · {person.title || 'no title'}</span>
                      {!person.email && <span className="text-amber-800"> · no address, cannot be written to</span>}
                    </span>
                    {person.email && (
                      <button
                        type="button"
                        onClick={() => setDropped((d) => d.includes(person.id) ? d.filter((x) => x !== person.id) : [...d, person.id])}
                        className="shrink-0 text-xs font-semibold text-slate-500 hover:underline"
                      >
                        {dropped.includes(person.id) ? 'Put back' : 'Drop'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {people.length === 0 && !busy && (
            <p className="text-sm text-slate-500">
              Nobody on record at these companies yet. Search for more below.
            </p>
          )}

          {/* Every way people get into the club is the same step of the same
              job, so they live here rather than as separate destinations
              competing with the workflow. Searching is the usual one; a
              spreadsheet you already have is quicker; deep research is the
              slow, evidence-reviewed route for a batch. */}
          <details className="rounded-xl border border-pale-sky" open={people.length === 0}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-deep-navy">
              Search for more people
            </summary>
            <div className="border-t border-pale-sky p-3">
              <CompanyDiscovery />
            </div>
          </details>

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
                  await loadPeople();
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
            <button
              type="button"
              onClick={() => navigate('/scraper?view=research')}
              className="ui-button ui-button--ghost ui-button--sm"
            >
              Queue deep research for a batch →
            </button>
          </div>

          <button
            type="button"
            onClick={() => void loadPeople()}
            className="ui-button ui-button--ghost ui-button--sm"
          >
            Refresh who was found
          </button>
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
            <button
              type="button"
              disabled={drafting || !goal.trim()}
              onClick={async () => {
                setDrafting(true);
                setError('');
                try {
                  const res = await api.campaigns.draftTemplate({
                    companies: chosen,
                    goal,
                    proof,
                    roles: [...new Set(recipients.map((r) => r.title).filter(Boolean))].slice(0, 6).join(', '),
                  });
                  setSubject(res.subject);
                  setBody(res.body);
                  setPreview(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not draft that');
                } finally {
                  setDrafting(false);
                }
              }}
              className="ui-button ui-button--secondary ui-button--sm"
            >
              {drafting ? 'Writing…' : `Draft one message for these ${recipients.length}`}
            </button>
          </div>

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
            disabled={busy || !subject.trim() || !body.trim()}
            onClick={() => void runPreview()}
            className="ui-button ui-button--secondary"
          >
            {busy ? 'Rendering…' : 'Preview the real message'}
          </button>

          {preview && (
            <div className="rounded-xl border border-pale-sky bg-pale-sky/20 p-3 space-y-2">
              <p className="text-[13px] font-semibold text-deep-navy">
                {preview.ready} of {preview.recipients} ready
                {preview.held.length ? ` · ${preview.held.length} held` : ''}
              </p>
              {preview.sample && (
                <div className="rounded-lg bg-white border border-pale-sky p-3">
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
          )}
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
  );
}
