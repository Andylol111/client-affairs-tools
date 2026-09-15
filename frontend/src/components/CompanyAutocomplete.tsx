import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, type YucgRecommendation } from '../api';

export type CompanyOption = {
  name: string;
  domain?: string;
  source: 'pipeline' | 'targets';
  contactCount?: number;
  sector?: string;
  angle?: string;
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
    return options.filter((option) =>
      norm(option.name).includes(q) || (option.domain && norm(option.domain).includes(q))
    ).slice(0, 12);
  }, [options, value]);

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
                {option.domain || option.sector || (option.source === 'pipeline' ? 'In pipeline' : 'Target list')}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRules = () => {
    api.yucg.recommend({ n: 12 }).then((res) => {
      setRecs(Array.isArray(res.recommendations) ? res.recommendations : []);
    }).catch(() => setRecs([]));
  };

  useEffect(() => { loadRules(); }, []);

  const refreshAi = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.yucg.aiRecommend({ n: 10 });
      const next = Array.isArray(res.recommendations) ? res.recommendations : [];
      if (next.length) setRecs(next);
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI suggestions are unavailable right now.');
    } finally {
      setBusy(false);
    }
  };

  if (!recs.length && !error) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
        <p>Suggestions appear from the outreach company list as they load.</p>
        <button type="button" className="text-steel-blue font-semibold" onClick={() => void refreshAi()} disabled={busy}>
          {busy ? 'Suggesting…' : 'Ask AI for companies'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-deep-navy">Live company recommendations</h2>
        <button type="button" className="text-sm font-semibold text-steel-blue disabled:opacity-50" onClick={() => void refreshAi()} disabled={busy}>
          {busy ? 'Updating…' : 'Refresh with AI'}
        </button>
      </div>
      {error && <p className="text-xs text-amber-800">{error}</p>}
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
