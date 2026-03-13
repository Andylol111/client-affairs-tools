/**
 * Main app - shown when user IS authenticated.
 * Full app with nav, dashboard, email studio, etc.
 */
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import BackButton from '../components/BackButton';

type MainAppProps = {
  user: { email: string; name?: string; picture?: string; role?: string };
  onLogout: () => void;
};

export default function MainApp({ user, onLogout }: MainAppProps) {
  const location = useLocation();
  const navigate = useNavigate();

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
                  { to: '/settings', label: 'Settings', icon: '⚙️' },
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
                  <img src={user.picture} alt="" className="w-8 h-8 rounded-full" />
                )}
                <span className="text-sm font-medium text-slate-700 hidden md:inline truncate max-w-[160px]">
                  Welcome, {user.name || user.email?.split('@')[0] || 'User'}
                </span>
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
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div key={location.pathname} className="page-enter">
          <BackButton />
          <Outlet context={{ user }} />
        </div>
      </main>
    </div>
  );
}
