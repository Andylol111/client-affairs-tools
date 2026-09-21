import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Contact } from '../../api';

/**
 * The people found so far, on the page that finds them.
 *
 * Discovery wrote contacts into the database and then showed a run count, so
 * the member had to leave for another page to see who had actually been
 * found. This is that spreadsheet, in place: one row per person, filterable,
 * sitting in the space the search form leaves empty.
 *
 * Company email formats used to be browsable here as a list of templates and
 * percentages, which told a member nothing they could act on. A format is
 * only useful at the moment an address is missing, and only if it is settled
 * enough to trust - so it appears as a suggested address on the row that
 * lacks one, and only when the domain's format has deliveries behind it.
 */

type Props = {
  /** Narrow to one company; empty shows everyone the member can see. */
  company?: string;
};

type Suggestion = { email: string; template: string; verified: number };

function initials(name: string | null | undefined, email: string): string {
  const source = (name || email || '').trim();
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function statusLabel(contact: Contact, hasSuggestion: boolean): { text: string; tone: string } {
  if (contact.last_send_status === 'bounced') return { text: 'bounced', tone: 'bg-red-100 text-red-800' };
  if (contact.last_sent_at) return { text: 'mailed', tone: 'bg-emerald-100 text-emerald-900' };
  if (contact.email_verification_status === 'invalid') return { text: 'no mail route', tone: 'bg-red-100 text-red-800' };
  // The state column has to agree with the email column: a row showing a
  // derived address is not missing one, it is holding an unproven one.
  if (!contact.email) {
    return hasSuggestion
      ? { text: 'suggested', tone: 'bg-sky-100 text-sky-900' }
      : { text: 'no address', tone: 'bg-amber-100 text-amber-900' };
  }
  return { text: 'ready', tone: 'bg-pale-sky/60 text-slate-700' };
}

export default function ContactSheet({ company }: Props) {
  const [rows, setRows] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion | null>>({});

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    api.contacts.list({ company: company || undefined, q: query.trim() || undefined, limit: 200 }, signal)
      .then((res) => {
        setRows(Array.isArray(res?.items) ? res.items : []);
        setTotal(Number.isFinite(res?.total) ? res.total : 0);
        setError('');
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Could not load contacts');
      })
      .finally(() => setLoading(false));
  }, [company, query]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => load(controller.signal), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  // Only domains where somebody is actually missing an address are worth
  // asking about, and only a format with a delivery behind it is worth
  // showing: a guess presented as an answer is how a wrong address gets sent.
  const missingDomains = useMemo(() => {
    const domains = new Set<string>();
    for (const row of rows) {
      if (row.email) continue;
      const domain = (row.company_domain || '').trim().toLowerCase();
      if (domain) domains.add(domain);
    }
    return [...domains];
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    const unknown = missingDomains.filter((d) => !(d in suggestions));
    if (unknown.length === 0) return;
    Promise.all(unknown.map(async (domain) => {
      try {
        const res = await api.contacts.emailPatterns(domain);
        const confirmed = (res.patterns || [])
          .filter((p) => (p.verified_samples || 0) > 0)
          .sort((a, b) => (b.verified_samples || 0) - (a.verified_samples || 0))[0];
        return [domain, confirmed
          ? { email: '', template: confirmed.pattern_template, verified: confirmed.verified_samples }
          : null] as const;
      } catch {
        return [domain, null] as const;
      }
    })).then((pairs) => {
      if (cancelled) return;
      setSuggestions((current) => ({ ...current, ...Object.fromEntries(pairs) }));
    });
    return () => { cancelled = true; };
  }, [missingDomains, suggestions]);

  const applyTemplate = (template: string, name: string | null | undefined, domain: string): string => {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return '';
    const first = parts[0].toLowerCase().replace(/[^a-z]/g, '');
    const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, '');
    if (!first || !last) return '';
    const local = template
      .replace('{first_initial}', first[0])
      .replace('{last_initial}', last[0])
      .replace('{first}', first)
      .replace('{last}', last);
    return local.includes('{') ? '' : `${local}@${domain}`;
  };

  return (
    <div className="surface-card rounded-2xl border border-[var(--border)] shadow-sm flex flex-col min-h-[420px] xl:h-[calc(100vh-14rem)] xl:sticky xl:top-6"
         data-section="contact-sheet">
      <div className="px-5 py-4 border-b border-pale-sky flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-deep-navy">
            People found{company ? ` at ${company}` : ''}
          </h2>
          <p className="text-[13px] text-slate-500">
            {loading ? 'Loading…' : `${total.toLocaleString()} on record`}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name, title or email"
          aria-label="Filter contacts"
          className="w-full sm:w-64 px-3 py-2 rounded-xl border border-pale-sky text-sm"
        />
      </div>

      {error && <p className="px-5 py-3 text-sm text-red-700">{error}</p>}

      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-pale-sky/40 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">Person</th>
              <th scope="col" className="px-4 py-2 font-semibold">Title</th>
              <th scope="col" className="px-4 py-2 font-semibold">Company</th>
              <th scope="col" className="px-4 py-2 font-semibold">Email</th>
              <th scope="col" className="px-4 py-2 font-semibold">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm text-slate-500">
                  Nobody yet. Search a company above and the people found will appear here.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const domain = (row.company_domain || '').trim().toLowerCase();
              const confirmed = domain ? suggestions[domain] : null;
              const derived = !row.email && confirmed
                ? applyTemplate(confirmed.template, row.name, domain)
                : '';
              const state = statusLabel(row, Boolean(derived));
              return (
                <tr key={row.id} className="hover:bg-pale-sky/20 align-top">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-pale-sky/70 text-[10px] font-semibold text-deep-navy">
                        {initials(row.name, row.email)}
                      </span>
                      <span className="font-medium text-deep-navy">{row.name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{row.title || '—'}</td>
                  <td className="px-4 py-2 text-slate-700">{row.company || '—'}</td>
                  <td className="px-4 py-2">
                    {row.email ? (
                      <span className="font-mono text-[12px] text-slate-800">{row.email}</span>
                    ) : derived ? (
                      <span className="text-[12px] text-slate-600">
                        <span className="font-mono text-slate-800">{derived}</span>
                        <span className="ml-1 text-slate-500">
                          · this company's confirmed format, {confirmed?.verified} delivered
                        </span>
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-500">not found</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state.tone}`}>
                      {state.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
