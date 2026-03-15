/**
 * Main app - shown when user IS authenticated.
 * Full app with nav, dashboard, email studio, etc.
 * Tracks cursor position (throttled, batched) for heatmap analytics.
 */
import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import BackButton from '../components/BackButton';
import CommunitySidebar from '../components/CommunitySidebar';
import ChecklistOverlay from '../components/ChecklistOverlay';
import { api } from '../api';
import { applyStoredPreferences } from '../lib/userPreferences';

type MainAppProps = {
  user: { email: string; name?: string; picture?: string; role?: string };
  onLogout: () => void;
};

const CURSOR_THROTTLE_MS = 500;
const CURSOR_BATCH_FLUSH_MS = 4000;
const CURSOR_BATCH_MAX = 40;

export default function MainApp({ user, onLogout }: MainAppProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const cursorBufferRef = useRef<{ event_type: string; resource_type?: string; details?: Record<string, unknown> }[]>([]);
  const lastCursorRef = useRef<number>(0);

  useEffect(() => {
    applyStoredPreferences();
  }, []);

  useEffect(() => {
    const path = location.pathname || '/';
    const resource = path === '/' ? 'dashboard' : path.slice(1).split('/')[0];
    api.telemetry.event({ event_type: 'page_view', resource_type: resource });
  }, [location.pathname]);

  // Keyboard shortcuts: / focus search, Esc clear selection/close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName || '')) {
        e.preventDefault();
        const first = document.querySelector<HTMLInputElement>('[data-search-input]');
        if (first) {
          first.focus();
        }
      }
      if (e.key === 'Escape') {
        (e.target as HTMLElement)?.blur?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Throttled cursor tracking: normalize to 0–100, batch and send periodically
  useEffect(() => {
    const flush = () => {
      const buf = cursorBufferRef.current;
      if (buf.length === 0) return;
      cursorBufferRef.current = [];
      api.telemetry.batch(buf);
    };
    const interval = setInterval(flush, CURSOR_BATCH_FLUSH_MS);
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastCursorRef.current < CURSOR_THROTTLE_MS) return;
      lastCursorRef.current = now;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const x = Math.min(100, Math.max(0, (e.clientX / w) * 100));
      const y = Math.min(100, Math.max(0, (e.clientY / h) * 100));
      let section: string | undefined;
      try {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el?.closest?.('[data-section]')) {
          section = (el.closest('[data-section]') as HTMLElement).dataset.section;
        }
      } catch {
        // ignore
      }
      const path = location.pathname || '/';
      const resource = path === '/' ? 'dashboard' : path.slice(1).split('/')[0];
      cursorBufferRef.current.push({
        event_type: 'cursor',
        resource_type: resource,
        details: { x, y, viewport_w: w, viewport_h: h, ...(section && { section }) },
      });
      if (cursorBufferRef.current.length >= CURSOR_BATCH_MAX) flush();
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      clearInterval(interval);
      flush();
    };
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="bg-white border-b border-pale-sky sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 flex-nowrap gap-2 min-w-0">
            <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
              <div className="bg-white rounded-lg p-1 flex items-center justify-center border border-pale-sky shadow-sm flex-shrink-0">
                <img src="/yucg-logo.png" alt="YUCG" className="h-7 w-auto" />
              </div>
              <span className="text-lg font-bold text-deep-navy whitespace-nowrap">YUCG Outreach</span>
              <span className="text-xs text-slate-500 hidden xl:inline truncate">Yale Undergraduate Consulting Group</span>
            </div>
            <div className="flex items-center gap-1 flex-nowrap flex-shrink-0 min-w-0">
              <div className="flex gap-1 flex-shrink-0">
                {[
                  { to: '/', label: 'Dashboard', icon: '📊' },
                  { to: '/scraper', label: 'Scraper', icon: '🔍' },
                  { to: '/studio', label: 'Studio', icon: '✉️' },
                  { to: '/campaigns', label: 'Campaigns', icon: '📤' },
                  { to: '/analytics', label: 'Analytics', icon: '📈' },
                  { to: '/outreach', label: 'Outreach', icon: '🎯' },
                  ...(user.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: '🔐' }] : []),
                ].map(({ to, label, icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                        isActive ? 'bg-pale-sky/50 text-deep-navy' : 'text-slate-600 hover:text-deep-navy hover:bg-pale-sky/30'
                      }`
                    }
                  >
                    <span className="hidden md:inline">{label}</span>
                    <span className="md:hidden">{icon}</span>
                  </NavLink>
                ))}
              </div>
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-pale-sky flex-shrink-0">
                {user.picture && (
                  <img src={user.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <NavLink
                  to="/profile"
                  className="text-sm font-medium text-slate-700 hidden md:inline truncate max-w-[160px] hover:text-deep-navy"
                >
                  Welcome, {user.name || user.email?.split('@')[0] || 'User'}
                </NavLink>
                <button
                  onClick={() => {
                    onLogout();
                    navigate('/login');
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 whitespace-nowrap"
                >
                  Log out
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 lg:p-8">
          <div key={location.pathname} className="page-enter">
            <BackButton />
            <Outlet context={{ user }} />
          </div>
        </main>
        <div className="hidden xl:flex xl:flex-col xl:min-h-[calc(100vh-3.5rem)] xl:flex-shrink-0">
          <CommunitySidebar />
        </div>
      </div>
      <ChecklistOverlay />
    </div>
  );
}
