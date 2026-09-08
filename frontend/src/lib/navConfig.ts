/**
 * Single source of truth for app navigation.
 * Update here when adding routes — shells (desktop + mobile) read from this module.
 */
export type NavItemId =
  | 'dashboard'
  | 'scraper'
  | 'studio'
  | 'campaigns'
  | 'analytics'
  | 'outreach'
  | 'yucgoutreach'
  | 'admin';

export type NavItem = {
  id: NavItemId;
  to: string;
  label: string;
  /** Shown under glyphs on mobile bottom nav */
  shortLabel: string;
};

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', to: '/', label: 'Home', shortLabel: 'Home' },
  { id: 'yucgoutreach', to: '/yucgoutreach', label: 'Week', shortLabel: 'Week' },
  { id: 'studio', to: '/studio', label: 'Studio', shortLabel: 'Write' },
  { id: 'campaigns', to: '/campaigns', label: 'Send', shortLabel: 'Send' },
  { id: 'outreach', to: '/outreach', label: 'Pipeline', shortLabel: 'CRM' },
  { id: 'scraper', to: '/scraper', label: 'Find', shortLabel: 'Find' },
  { id: 'analytics', to: '/analytics', label: 'Stats', shortLabel: 'Stats' },
];

export const ADMIN_NAV_ITEM: NavItem = {
  id: 'admin',
  to: '/admin',
  label: 'Admin',
  shortLabel: 'Admin',
};

export function getNavItems(isAdmin: boolean): NavItem[] {
  return isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
}

/** Match active route for nav highlighting */
export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}
