/**
 * Main app - shown when user IS authenticated.
 * Layout lives in AppShell; this file owns auth-adjacent side effects only.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import AppShell from '../components/shell/AppShell';
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName || '')) {
        e.preventDefault();
        const first = document.querySelector<HTMLInputElement>('[data-search-input]');
        if (first) first.focus();
      }
      if (e.key === 'Escape') {
        (e.target as HTMLElement)?.blur?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  return <AppShell user={user} onLogout={onLogout} pageKey={location.pathname} />;
}
