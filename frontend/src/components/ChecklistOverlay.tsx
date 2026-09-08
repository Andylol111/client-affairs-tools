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
        className="app-fab app-fab--above-mobile-nav"
        title="Checklist (Ctrl+Shift+L)"
        aria-label="Toggle checklist"
      >
        <span className="text-lg" aria-hidden>✓</span>
        {getStoredPreferences().checklistBadge && items.filter((i) => !i.done).length > 0 && (
          <span className="app-fab-badge">
            {items.filter((i) => !i.done).length}
          </span>
        )}
      </button>
      {open && (
        <div className="checklist-overlay" role="presentation">
          <button
            type="button"
            className="checklist-overlay-backdrop"
            aria-label="Close checklist"
            onClick={() => setOpen(false)}
          />
          <div className="checklist-panel" role="dialog" aria-labelledby="checklist-title">
            <div className="checklist-panel-header">
              <h3 id="checklist-title" className="checklist-panel-title">Checklist</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="checklist-panel-close"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="checklist-panel-body">
              <div className="checklist-add-row">
                <input
                  type="text"
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addItem()}
                  placeholder="Add an item..."
                  className="checklist-add-input"
                />
                <button type="button" onClick={addItem} className="checklist-add-btn">
                  Add
                </button>
              </div>
              <ul className="checklist-items">
                {items.length === 0 && (
                  <li className="checklist-empty">No items yet. Add one above.</li>
                )}
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`checklist-item${item.done ? ' checklist-item--done' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleDone(item.id)}
                      className={`checklist-item-check${item.done ? ' checklist-item-check--done' : ''}`}
                      aria-label={item.done ? 'Mark undone' : 'Mark done'}
                    >
                      {item.done ? '✓' : ''}
                    </button>
                    <span className="checklist-item-text">{item.text}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="checklist-item-remove"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="checklist-panel-footer">
              Ctrl+Shift+L to toggle · Esc to close
            </div>
          </div>
        </div>
      )}
    </>
  );
}
