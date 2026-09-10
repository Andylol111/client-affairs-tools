import type { NavItem } from '../../lib/navConfig';
import AppNavLink from './AppNavLink';

type AppShellMobileProps = {
  items: NavItem[];
  onOpenMenu: () => void;
};

/**
 * Mobile shell chrome: bottom nav + menu button (drawer trigger).
 * Hidden on lg+ via CSS in index.css — do not render a duplicate menu in the header.
 */
export default function AppShellMobile({ items, onOpenMenu }: AppShellMobileProps) {
  const primaryItems = items.filter((item) =>
    ['dashboard', 'projects', 'documents', 'campaigns'].includes(item.id),
  );
  return (
    <div className="app-mobile-shell">
      <nav className="app-mobile-nav" aria-label="Main navigation">
        <div className="app-mobile-nav-scroll">
          {primaryItems.map((item) => (
            <AppNavLink key={item.id} item={item} variant="mobile" />
          ))}
        </div>
        <button
          type="button"
          className="app-mobile-nav-menu-btn"
          onClick={onOpenMenu}
          aria-label="Open all sections"
        >
          <span className="app-mobile-nav-menu-glyph" aria-hidden />
          <span className="app-mobile-nav-label">More</span>
        </button>
      </nav>
    </div>
  );
}
