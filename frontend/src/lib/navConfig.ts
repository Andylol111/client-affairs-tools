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
  | 'admin'
  | 'documents'
  | 'projects';

export type NavItem = {
  id: NavItemId;
  to: string;
  label: string;
  /** Shown under glyphs on mobile bottom nav */
  shortLabel: string;
};

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', to: '/', label: 'Home', shortLabel: 'Home' },
  { id: 'projects', to: '/projects', label: 'Projects', shortLabel: 'Projects' },
  { id: 'documents', to: '/documents', label: 'Documents', shortLabel: 'Documents' },
  { id: 'yucgoutreach', to: '/yucgoutreach', label: 'Target lists', shortLabel: 'Targets' },
  { id: 'studio', to: '/studio', label: 'Drafts', shortLabel: 'Drafts' },
  { id: 'campaigns', to: '/campaigns', label: 'Campaigns', shortLabel: 'Campaigns' },
  { id: 'outreach', to: '/outreach', label: 'Pipeline', shortLabel: 'Pipeline' },
  { id: 'scraper', to: '/scraper', label: 'Find contacts', shortLabel: 'Contacts' },
  { id: 'analytics', to: '/analytics', label: 'Results', shortLabel: 'Results' },
];

export const ADMIN_NAV_ITEM: NavItem = {
  id: 'admin',
  to: '/admin',
  label: 'Admin',
  shortLabel: 'Admin',
};

/**
 * Header layout. The Home screen lists every tool, so the header carries only
 * the frequent doors plus two short dropdowns; four-item dropdowns made the
 * menu the primary way to find anything.
 *
 * Both shells read this: desktop renders TOP_LEVEL_IDS then NAV_GROUPS, mobile
 * renders MOBILE_PRIMARY_IDS with the drawer covering the rest.
 */
export const TOP_LEVEL_IDS: NavItemId[] = ['dashboard', 'scraper', 'campaigns'];

export const NAV_GROUPS: { label: string; ids: NavItemId[] }[] = [
  { label: 'Outreach', ids: ['studio', 'outreach', 'analytics'] },
  { label: 'Club', ids: ['yucgoutreach', 'projects', 'documents'] },
];

export const MOBILE_PRIMARY_IDS: NavItemId[] = ['dashboard', 'scraper', 'studio', 'campaigns'];

export function getNavItems(isAdmin: boolean): NavItem[] {
  return isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
}

/** Match active route for nav highlighting */
export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}
