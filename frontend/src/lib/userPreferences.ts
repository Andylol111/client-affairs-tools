/**
 * User preferences for appearance (accent, compact, font size, etc.).
 * Persisted to localStorage and applied to document.
 */

const KEY_ACCENT = 'yucg_accent';
const KEY_COMPACT = 'yucg_compact';
const KEY_FONT_SIZE = 'yucg_font_size';
const KEY_SIDEBAR_COLLAPSED = 'yucg_sidebar_collapsed';
const KEY_REDUCE_MOTION = 'yucg_reduce_motion';
const KEY_BORDER_RADIUS = 'yucg_border_radius';
const KEY_CHECKLIST_BADGE = 'yucg_checklist_badge';

const DEFAULT_ACCENT = '#1a2f5a';
const DEFAULT_ACCENT_HOVER = '#1e3a6e';

function lightenHex(hex: string, pct: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + (0xff - ((num >> 16) & 0xff)) * pct);
  const g = Math.min(255, ((num >> 8) & 0xff) + (0xff - ((num >> 8) & 0xff)) * pct);
  const b = Math.min(255, (num & 0xff) + (0xff - (num & 0xff)) * pct);
  return '#' + (0x1000000 + Math.round(r) * 0x10000 + Math.round(g) * 0x100 + Math.round(b)).toString(16).slice(1);
}

export type UserPreferences = {
  accent: string;
  compact: boolean;
  fontSize: 'small' | 'medium' | 'large';
  sidebarCollapsed: boolean;
  reduceMotion: boolean;
  borderRadius: 'sharp' | 'medium' | 'round';
  checklistBadge: boolean;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  accent: DEFAULT_ACCENT,
  compact: false,
  fontSize: 'medium',
  sidebarCollapsed: false,
  reduceMotion: false,
  borderRadius: 'medium',
  checklistBadge: true,
};

export function getStoredPreferences(): UserPreferences {
  try {
    const accent = localStorage.getItem(KEY_ACCENT) || DEFAULT_ACCENT;
    const compact = localStorage.getItem(KEY_COMPACT) === '1';
    const fontSize = (localStorage.getItem(KEY_FONT_SIZE) || 'medium') as UserPreferences['fontSize'];
    const sidebarCollapsed = localStorage.getItem(KEY_SIDEBAR_COLLAPSED) === '1';
    const reduceMotion = localStorage.getItem(KEY_REDUCE_MOTION) === '1';
    const borderRadius = (localStorage.getItem(KEY_BORDER_RADIUS) || 'medium') as UserPreferences['borderRadius'];
    const checklistBadge = localStorage.getItem(KEY_CHECKLIST_BADGE) !== '0';
    return {
      accent,
      compact,
      fontSize: ['small', 'medium', 'large'].includes(fontSize) ? fontSize : 'medium',
      sidebarCollapsed,
      reduceMotion,
      borderRadius: ['sharp', 'medium', 'round'].includes(borderRadius) ? borderRadius : 'medium',
      checklistBadge,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: Partial<UserPreferences>) {
  try {
    if (prefs.accent != null) localStorage.setItem(KEY_ACCENT, prefs.accent);
    if (prefs.compact != null) localStorage.setItem(KEY_COMPACT, prefs.compact ? '1' : '0');
    if (prefs.fontSize != null) localStorage.setItem(KEY_FONT_SIZE, prefs.fontSize);
    if (prefs.sidebarCollapsed != null) localStorage.setItem(KEY_SIDEBAR_COLLAPSED, prefs.sidebarCollapsed ? '1' : '0');
    if (prefs.reduceMotion != null) localStorage.setItem(KEY_REDUCE_MOTION, prefs.reduceMotion ? '1' : '0');
    if (prefs.borderRadius != null) localStorage.setItem(KEY_BORDER_RADIUS, prefs.borderRadius);
    if (prefs.checklistBadge != null) localStorage.setItem(KEY_CHECKLIST_BADGE, prefs.checklistBadge ? '1' : '0');
  } catch {}
}

export function resetPreferencesToDefault(): UserPreferences {
  try {
    localStorage.removeItem(KEY_ACCENT);
    localStorage.removeItem(KEY_COMPACT);
    localStorage.removeItem(KEY_FONT_SIZE);
    localStorage.removeItem(KEY_SIDEBAR_COLLAPSED);
    localStorage.removeItem(KEY_REDUCE_MOTION);
    localStorage.removeItem(KEY_BORDER_RADIUS);
    localStorage.removeItem(KEY_CHECKLIST_BADGE);
  } catch {}
  const def = { ...DEFAULT_PREFERENCES };
  applyUserPreferences(def);
  return def;
}

export function applyUserPreferences(prefs: UserPreferences) {
  const root = document.documentElement;
  root.style.setProperty('--accent', prefs.accent);
  root.style.setProperty('--accent-hover', lightenHex(prefs.accent, 0.15));
  document.body.classList.toggle('yucg-compact', prefs.compact);
  document.body.setAttribute('data-ui-font', prefs.fontSize);
  document.body.classList.toggle('yucg-reduce-motion', prefs.reduceMotion);
  document.body.setAttribute('data-border-radius', prefs.borderRadius);
}

export function applyStoredPreferences() {
  applyUserPreferences(getStoredPreferences());
}
