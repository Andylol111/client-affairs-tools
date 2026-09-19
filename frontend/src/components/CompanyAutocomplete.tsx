import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, type YucgRecommendation } from '../api';

export type CompanyOption = {
  name: string;
  domain?: string;
  source: 'pipeline' | 'targets' | 'register';
  contactCount?: number;
  sector?: string;
  angle?: string;
  hint?: string;
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function mergeOptions(pipeline: CompanyOption[], targets: CompanyOption[]): CompanyOption[] {
  const byKey = new Map<string, CompanyOption>();
  for (const option of [...pipeline, ...targets]) {
    const key = option.domain ? `d:${norm(option.domain)}` : `n:${norm(option.name)}`;
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, option);
      continue;
    }
    byKey.set(key, {
      ...prior,
      ...option,
      contactCount: option.contactCount ?? prior.contactCount,
      domain: option.domain || prior.domain,
      source: prior.source === 'pipeline' || option.source === 'pipeline' ? 'pipeline' : option.source,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function CompanyAutocomplete({
  id,
  label,
  value,
  onChange,
  onSelect,
  placeholder = 'Company name',
  disabled = false,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (name: string, option?: CompanyOption) => void;
  onSelect?: (option: CompanyOption) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [registerOptions, setRegisterOptions] = useState<CompanyOption[]>([]);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.contacts.companiesSummary().catch(() => []),
      api.yucg.listProspects({ limit: 400 }).catch(() => ({ prospects: [], count: 0 })),
    ]).then(([summary, prospects]) => {
      if (cancelled) return;
      const pipeline = (Array.isArray(summary) ? summary : []).map((row) => ({
        name: row.company,
        domain: row.company_domain || undefined,
        source: 'pipeline' as const,
        contactCount: row.contact_count,
      }));
      const targets = (prospects.prospects || []).map((row) => ({
        name: row.company,
        source: 'targets' as const,
        sector: row.sector,
        angle: row.recommended_message_angle,
      }));
      setOptions(mergeOptions(pipeline, targets));
    });
    return () => { cancelled = true; };
  }, []);

  // The club's own companies live in memory, but the public register holds
  // 100k+ and cannot. Query it as the member types so a company nobody has
  // worked yet is reachable from this field instead of only from the register
  // tab. Debounced, and the in-flight request is aborted on the next keystroke.
  useEffect(() => {
    const q = value.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (q.length < 3) {
        setRegisterOptions([]);
        return;
      }
      api.yucgoutreach.register({ q, limit: 8 }, controller.signal)
        .then((res) => {
          setRegisterOptions((res.items || []).map((row) => ({
            name: row.company_name,
            domain: row.company_domain || undefined,
            source: 'register' as const,
            sector: row.sector_label || undefined,
            hint: [row.region, row.officer_count ? `${row.officer_count} officers on file` : null]
              .filter(Boolean).join(' · ') || undefined,
          })));
        })
        .catch(() => { /* abort or offline: the local lists still answer */ });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  const filtered = useMemo(() => {
    const q = norm(value);
    if (!q) return options.slice(0, 12);
    const local = options.filter((option) =>
      norm(option.name).includes(q) || (option.domain && norm(option.domain).includes(q))
    );
    // Companies the club already works come first and are never displaced by
    // the public register; register rows only fill the remaining slots, minus
    // any the club already has.
    const known = new Set(local.map((option) => norm(option.name)));
    const fromRegister = registerOptions.filter((option) => !known.has(norm(option.name)));
    return [...local, ...fromRegister].slice(0, 12);
  }, [options, registerOptions, value]);

  const pick = (option: CompanyOption) => {
    onChange(option.name, option);
    onSelect?.(option);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      {label && <label htmlFor={inputId} className="block text-xs font-medium text-slate-600 mb-1">{label}</label>}
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && filtered[highlight] ? `${listId}-${highlight}` : undefined}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setHighlight((current) => Math.min(filtered.length - 1, current + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((current) => Math.max(0, current - 1));
          } else if (event.key === 'Enter' && open && filtered[highlight]) {
            event.preventDefault();
            pick(filtered[highlight]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full px-4 py-3 rounded-xl bg-pale-sky/30 text-deep-navy placeholder-slate-blue/70 text-[15px] border border-pale-sky/50 focus:ring-2 focus:ring-steel-blue/40 focus:border-steel-blue"
      />
      {open && filtered.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-pale-sky bg-white shadow-lg">
          {filtered.map((option, index) => (
            <li
              id={`${listId}-${index}`}
              key={`${option.source}-${option.name}-${option.domain || index}`}
              role="option"
              aria-selected={index === highlight}
              className={`px-3 py-2 cursor-pointer text-sm ${index === highlight ? 'bg-pale-sky/50' : 'hover:bg-pale-sky/30'}`}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => { event.preventDefault(); pick(option); }}
            >
              <div className="font-medium text-deep-navy">{option.name}</div>
              <div className="text-xs text-slate-500">
                {option.domain || option.sector
                  || (option.source === 'pipeline' ? 'In pipeline'
                    : option.source === 'register' ? 'Public register' : 'Target list')}
                {option.source === 'register' && option.hint ? ` · ${option.hint}` : ''}
                {option.contactCount != null ? ` · ${option.contactCount} saved` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CompanySuggestions({
  onPick,
}: {
  onPick: (option: CompanyOption) => void;
}) {
  const [recs, setRecs] = useState<YucgRecommendation[]>([]);

  // Deliberately no AI call here. These render as bare name chips, so an
  // LLM ranking pass produced a rationale and reasoning chain that this view
  // threw away - and it asked for more output than the model's reply limit
  // allows, so the call truncated mid-JSON and the button only ever reported
  // "Model returned no parseable JSON". The reasoned, cited version of this
  // list is the Outreach page, which actually renders the reasoning.
  useEffect(() => {
    api.yucg.recommend({ n: 12 })
      .then((res) => setRecs(Array.isArray(res.recommendations) ? res.recommendations : []))
      .catch(() => setRecs([]));
  }, []);

  if (!recs.length) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-deep-navy">Companies on the club target list</h2>
      <div className="flex flex-wrap gap-2">
        {recs.slice(0, 12).map((rec) => {
          const name = rec.prospect?.company;
          if (!name) return null;
          return (
            <button
              key={`${rec.prospect.row_index}-${name}`}
              type="button"
              className="rounded-full border border-pale-sky bg-white px-3 py-1.5 text-sm text-deep-navy hover:border-steel-blue"
              title={rec.verifiability?.score_breakdown?.rationale || rec.prospect.why_attractive || ''}
              onClick={() => onPick({ name, source: 'targets', sector: rec.prospect.sector, angle: rec.prospect.recommended_message_angle })}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
