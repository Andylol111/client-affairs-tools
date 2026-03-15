/**
 * Overlay checklist - floating panel with add/check/remove items. Persists to localStorage.
 */
import { useState, useEffect, useCallback } from 'react';
import { getStoredPreferences } from '../lib/userPreferences';

const STORAGE_KEY = 'yucg_checklist';

export type ChecklistItem = { id: string; text: string; done: boolean; order: number };

function loadItems(): ChecklistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveItems(items: ChecklistItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export default function ChecklistOverlay() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>(loadItems);
  const [newText, setNewText] = useState('');

  useEffect(() => {
    saveItems(items);
  }, [items]);

  const addItem = useCallback(() => {
    const t = newText.trim();
    if (!t) return;
    const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { id, text: t, done: false, order: prev.length }].sort((a, b) => a.order - b.order));
    setNewText('');
  }, [newText]);

  const toggleDone = useCallback((id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full shadow-lg bg-[#1a2f5a] dark:bg-[var(--bg-card)] text-white dark:text-[var(--text-primary)] border border-pale-sky dark:border-slate-600 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        title="Checklist (Ctrl+Shift+L)"
        aria-label="Toggle checklist"
      >
        <span className="text-lg" aria-hidden>✓</span>
        {getStoredPreferences().checklistBadge && items.filter((i) => !i.done).length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-xs flex items-center justify-center">
            {items.filter((i) => !i.done).length}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/20 dark:bg-black/40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-xl shadow-2xl border border-pale-sky dark:border-slate-600 bg-white dark:bg-[var(--bg-card)] overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="px-4 py-3 border-b border-pale-sky dark:border-slate-600 flex items-center justify-between">
              <h3 className="font-semibold text-deep-navy dark:text-[var(--text-primary)]">Checklist</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addItem()}
                  placeholder="Add An Item..."
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-pale-sky dark:border-slate-600 bg-white dark:bg-slate-700 text-deep-navy dark:text-[var(--text-primary)] placeholder-slate-400"
                />
                <button
                  type="button"
                  onClick={addItem}
                  className="px-4 py-2 rounded-lg bg-[#1a2f5a] dark:bg-steel-blue text-white font-medium shrink-0"
                >
                  Add
                </button>
              </div>
              <ul className="space-y-2">
                {items.length === 0 && (
                  <li className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">No items yet. Add one above.</li>
                )}
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-center gap-2 group py-2 px-3 rounded-lg border transition-colors ${
                      item.done
                        ? 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50'
                        : 'border-pale-sky dark:border-slate-600'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleDone(item.id)}
                      className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center text-xs ${
                        item.done
                          ? 'bg-green-500 border-green-600 text-white'
                          : 'border-slate-400 dark:border-slate-500 hover:border-deep-navy dark:hover:border-steel-blue'
                      }`}
                      aria-label={item.done ? 'Mark undone' : 'Mark done'}
                    >
                      {item.done ? '✓' : ''}
                    </button>
                    <span className={`flex-1 min-w-0 text-sm ${item.done ? 'line-through text-slate-500 dark:text-slate-400' : 'text-deep-navy dark:text-[var(--text-primary)]'}`}>
                      {item.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-opacity"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="px-4 py-2 border-t border-pale-sky dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400">
              Ctrl+Shift+L To Toggle · Esc To Close
            </div>
          </div>
        </div>
      )}
    </>
  );
}
