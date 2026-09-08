import { NavLink } from 'react-router-dom';
import CommunitySidebar from '../CommunitySidebar';
import AiModelSelect from '../AiModelSelect';

type AppShellDrawerProps = {
  open: boolean;
  onClose: () => void;
  user: { email: string; name?: string; picture?: string };
  onLogout: () => void;
};

export default function AppShellDrawer({ open, onClose, user, onLogout }: AppShellDrawerProps) {
  if (!open) return null;

  return (
    <div className="app-shell-drawer-root" role="dialog" aria-modal="true" aria-label="Menu">
      <button type="button" className="app-shell-drawer-backdrop" onClick={onClose} aria-label="Close menu" />
      <aside className="app-shell-drawer">
        <div className="app-shell-drawer-header">
          <div className="flex items-center gap-2 min-w-0">
            {user.picture && (
              <img src={user.picture} alt="" className="app-avatar" referrerPolicy="no-referrer" />
            )}
            <div className="min-w-0">
              <div className="font-bold text-sm truncate">{user.name || 'User'}</div>
              <div className="text-xs text-slate-500 truncate">{user.email}</div>
            </div>
          </div>
          <button type="button" className="app-nav-util-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="app-shell-drawer-body">
          <NavLink to="/profile" onClick={onClose} className="app-sidebar-link mb-3">
            Profile &amp; Settings
          </NavLink>
          <div className="mb-4">
            <AiModelSelect id="drawer-ai-model" />
          </div>
          <button
            type="button"
            className="app-sidebar-link w-full text-left mb-4"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            Log out
          </button>
          <CommunitySidebar embedded />
        </div>
      </aside>
    </div>
  );
}
