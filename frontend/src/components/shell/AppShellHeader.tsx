import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { NavItem } from '../../lib/navConfig';
import AppNavLink from './AppNavLink';

type AppShellHeaderProps = {
  user: { email: string; name?: string; picture?: string };
  navItems: NavItem[];
  onLogout: () => void;
};

export default function AppShellHeader({ user, navItems, onLogout }: AppShellHeaderProps) {
  const dropdown = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (dropdown.current && event.target instanceof Node && !dropdown.current.contains(event.target)) dropdown.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  const outreachIds = ['yucgoutreach', 'studio', 'campaigns', 'outreach', 'scraper', 'analytics'];
  const outreach = navItems.filter(item => outreachIds.includes(item.id));
  const primary = navItems.filter(item => !outreachIds.includes(item.id) && item.id !== 'admin').sort((a, b) => ['dashboard', 'projects', 'documents'].indexOf(a.id) - ['dashboard', 'projects', 'documents'].indexOf(b.id));
  return (
    <header className="app-shell-header app-top-nav sticky top-0 z-50">
      <div className="app-shell-header-inner">
        <div className="app-shell-brand">
          <img src="/yucg-logo.png" alt="YUCG" className="app-shell-logo" decoding="async" />
          <div className="min-w-0">
            <div className="app-shell-title">YUCG Outreach</div>
            <div className="app-shell-subtitle hidden xl:block">Yale Undergraduate Consulting Group</div>
          </div>
        </div>

        <nav className="app-nav-menu app-shell-desktop-nav" aria-label="Main navigation">
          {primary.map((item) => (
            <AppNavLink key={item.id} item={item} variant="desktop" />
          ))}
          <details key={pathname} ref={dropdown} className="app-nav-group" onKeyDown={event => { if (event.key === 'Escape' && dropdown.current) { dropdown.current.open = false; dropdown.current.querySelector('summary')?.focus(); } }}>
            <summary className={`app-nav-link ${outreach.some(item => pathname === item.to || pathname.startsWith(item.to + '/')) ? 'app-nav-link--active' : ''}`}>Outreach ▾</summary>
            <div className="app-nav-group-panel" onClick={() => { if (dropdown.current) dropdown.current.open = false; }}>
              {outreach.map(item => <AppNavLink key={item.id} item={item} variant="desktop" />)}
            </div>
          </details>
          {navItems.filter(item => item.id === 'admin').map(item => <AppNavLink key={item.id} item={item} variant="desktop" />)}
        </nav>

        <div className="app-shell-header-actions">
          {user.picture && (
            <img
              src={user.picture}
              alt=""
              className="app-avatar app-shell-header-avatar"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <NavLink to="/profile" className="app-shell-profile-link app-shell-header-profile">
            {user.name || user.email?.split('@')[0] || 'User'}
          </NavLink>
          <button type="button" onClick={onLogout} className="app-nav-util-btn app-shell-header-logout">
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
