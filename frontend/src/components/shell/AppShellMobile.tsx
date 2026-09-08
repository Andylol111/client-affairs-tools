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
  return (
    <div className="app-mobile-shell">
      <nav className="app-mobile-nav" aria-label="Main navigation">
        <button
          type="button"
          className="app-mobile-nav-menu-btn"
          onClick={onOpenMenu}
          aria-label="Open menu"
        >
          <span className="app-mobile-nav-menu-glyph" aria-hidden />
          <span className="app-mobile-nav-label">Menu</span>
        </button>
        <div className="app-mobile-nav-scroll">
          {items.map((item) => (
            <AppNavLink key={item.id} item={item} variant="mobile" />
          ))}
        </div>
      </nav>
    </div>
  );
}
