import { useCallback, useEffect, useState } from 'react';
import { api, type EmailPrediction as Prediction } from '../api';

const TEMPLATES = [
  { template: '{first}.{last}', example: 'jane.doe@' },
  { template: '{first}{last}', example: 'janedoe@' },
  { template: '{first_initial}{last}', example: 'jdoe@' },
  { template: '{first}_{last}', example: 'jane_doe@' },
  { template: '{last}.{first}', example: 'doe.jane@' },
  { template: '{first}', example: 'jane@' },
];

/**
 * Predicted work address for a named person at a company, with the evidence
 * behind the guess and a way to correct the company's format.
 *
 * A guess is never mailbox proof: a learned pattern only means other addresses
 * at that domain matched the same layout. Replies and bounces observed later
 * adjust that format's confidence.
 */
export default function EmailPrediction({
  name,
  company,
  companyDomain,
  onUse,
}: {
  name: string;
  company: string;
  /** Authoritative domain when the company was picked from a known list. */
  companyDomain?: string;
  /** Receives the address and the resolved mail domain behind it. */
  onUse?: (email: string, domain: string) => void;
}) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Both are scoped to the company they were entered for, so switching
  // companies drops them without a state-resetting effect.
  const [manualDomain, setManualDomain] = useState({ company: '', value: '' });
  const [correctingFor, setCorrectingFor] = useState('');

  const person = name.trim();
  const target = company.trim();
  const domainValue = manualDomain.company === target ? manualDomain.value : '';
  // A domain the member typed wins, then one carried by a picked company,
  // then resolving the company name server-side.
  const domain = domainValue.trim() || (companyDomain || '').trim();
  const correcting = !!target && correctingFor === target;
  const lookup = domain || target;

  const load = useCallback(async () => {
    if (!person || !lookup) {
      setPrediction(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setPrediction(
        await api.contacts.predictEmail(
          domain ? { name: person, domain } : { name: person, company: target }
        )
      );
    } catch (err) {
      setPrediction(null);
      setError(err instanceof Error ? err.message : 'Could not predict an address');
    } finally {
      setLoading(false);
    }
  }, [person, target, domain, lookup]);

  useEffect(() => {
    const timer = setTimeout(load, 400);
    return () => clearTimeout(timer);
  }, [load]);

  const saveFormat = async (template: string) => {
    const writeDomain = prediction?.domain?.includes('.') ? prediction.domain : domain;
    if (!writeDomain) {
      setError('Enter the company mail domain first, e.g. bain.com');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.contacts.assertEmailPattern({
        domain: writeDomain,
        pattern_template: template,
        company_name: target || undefined,
      });
      setCorrectingFor('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that format');
    } finally {
      setSaving(false);
    }
  };

  if (!person || !target) return null;

  const unknownDomain = prediction?.basis === 'unknown_domain';

  return (
    <div className="rounded-xl border border-pale-sky/80 bg-pale-sky/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-deep-navy">Likely work address</p>
        {prediction && !unknownDomain && (
          <span className="text-[12px] text-slate-500">
            {prediction.basis === 'learned_pattern'
              ? `${prediction.pattern?.verified_samples ?? 0} verified sample(s) at ${prediction.domain}` +
                (prediction.pattern?.failed_samples
                  ? ` · ${prediction.pattern.failed_samples} bounced`
                  : '')
              : `No stored format for ${prediction.domain}`}
          </span>
        )}
      </div>

      {loading && <p className="text-[12px] text-slate-500 mt-2">Checking company format…</p>}

      {!loading && unknownDomain && (
        <div className="mt-2">
          <p className="text-[12px] text-slate-600">
            No mail domain on record for <span className="font-medium">{target}</span>. Enter it and
            the guess follows.
          </p>
          <input
            type="text"
            value={domainValue}
            onChange={(e) => setManualDomain({ company: target, value: e.target.value })}
            placeholder="company.com"
            aria-label="Company mail domain"
            className="mt-2 w-full max-w-xs px-3 py-2 rounded-lg bg-white text-deep-navy text-[13px] border border-pale-sky/70 focus:ring-2 focus:ring-steel-blue/40 focus:border-steel-blue"
          />
        </div>
      )}

      {!loading && !unknownDomain && prediction?.best && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] font-medium text-deep-navy">{prediction.best}</span>
          {onUse && (
            <button
              type="button"
              onClick={() => onUse(prediction.best as string, prediction.domain)}
              className="px-3 py-1 rounded-lg bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-[12px] font-semibold"
            >
              Use this address
            </button>
          )}
          <button
            type="button"
            onClick={() => setCorrectingFor(correcting ? '' : target)}
            className="px-3 py-1 rounded-lg border border-pale-sky text-[12px] text-slate-700 hover:bg-pale-sky/40"
          >
            {correcting ? 'Cancel' : 'Wrong format?'}
          </button>
        </div>
      )}

      {!loading && !unknownDomain && prediction && !prediction.best && (
        <div className="mt-2">
          <p className="text-[12px] text-slate-500">
            No address could be derived. Record the company's format so future guesses work.
          </p>
          <button
            type="button"
            onClick={() => setCorrectingFor(target)}
            className="mt-2 px-3 py-1 rounded-lg border border-pale-sky text-[12px] text-slate-700 hover:bg-pale-sky/40"
          >
            Set the format
          </button>
        </div>
      )}

      {!correcting && prediction && prediction.candidates.length > 1 && (
        <ul className="mt-2 space-y-1">
          {prediction.candidates.slice(1).map((candidate) => (
            <li key={candidate} className="text-[12px] text-slate-600 font-mono">
              {candidate}
            </li>
          ))}
        </ul>
      )}

      {correcting && (
        <div className="mt-3">
          <p className="text-[12px] text-slate-600 mb-1.5">
            What does <span className="font-medium">{target}</span> actually use?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((option) => (
              <button
                key={option.template}
                type="button"
                disabled={saving}
                onClick={() => saveFormat(option.template)}
                className="px-2.5 py-1 rounded-lg border border-pale-sky bg-white text-[12px] font-mono text-slate-700 hover:border-steel-blue disabled:opacity-40"
              >
                {option.example}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Saved for the whole club. Observed samples still win if they disagree.
          </p>
        </div>
      )}

      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}

      {!unknownDomain && (
        <p className="text-[11px] text-slate-500 mt-2">
          A derived address is a guess, not mailbox proof.
        </p>
      )}
    </div>
  );
}
