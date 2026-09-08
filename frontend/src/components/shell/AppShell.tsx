import { useState, type ReactNode } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import BackButton from '../BackButton';
import ChecklistOverlay from '../ChecklistOverlay';
import CommunitySidebar from '../CommunitySidebar';
import { getNavItems } from '../../lib/navConfig';
import AppShellHeader from './AppShellHeader';
import AppShellMobile from './AppShellMobile';
import AppShellDrawer from './AppShellDrawer';

type AppShellProps = {
  user: { email: string; name?: string; picture?: string; role?: string };
  onLogout: () => void;
  pageKey?: string;
  headerExtra?: ReactNode;
};

export default function AppShell({ user, onLogout, pageKey, headerExtra }: AppShellProps) {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navItems = getNavItems(user.role === 'admin');

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  return (
    <div className="app-shell min-h-screen flex flex-col">
      <AppShellHeader user={user} navItems={navItems} onLogout={handleLogout} />
      {headerExtra}
      <div className="app-shell-body flex flex-1 min-h-0">
        <main className="app-shell-main flex-1 min-w-0 min-h-0 overflow-auto">
          <div key={pageKey} className="page-enter app-shell-main-inner">
            <BackButton />
            <Outlet context={{ user }} />
          </div>
        </main>
        <div className="app-shell-aside hidden xl:flex xl:flex-col xl:min-h-0 xl:flex-shrink-0">
          <CommunitySidebar />
        </div>
      </div>
      <AppShellMobile items={navItems} onOpenMenu={() => setDrawerOpen(true)} />
      <AppShellDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
        onLogout={handleLogout}
      />
      <ChecklistOverlay />
    </div>
  );
}
