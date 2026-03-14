/**
 * Community sidebar - who's online, roles, integrations (Slack, Drive, Office)
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

export default function CommunitySidebar() {
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [slackStatus, setSlackStatus] = useState<{ connected: boolean; team_name?: string } | null>(null);

  useEffect(() => {
    api.auth.team()
      .then(setTeam)
      .catch(() => setTeam([]))
      .finally(() => setLoading(false));
  }, []);

  const refreshSlackStatus = () => {
    api.auth.slack.status()
      .then(setSlackStatus)
      .catch(() => setSlackStatus({ connected: false }));
  };
  useEffect(() => {
    refreshSlackStatus();
    const handler = () => refreshSlackStatus();
    window.addEventListener('slack-integration-updated', handler);
    return () => window.removeEventListener('slack-integration-updated', handler);
  }, []);

  const formatLastSeen = (d: string | null) => {
    if (!d) return null;
    const date = new Date(d);
    const now = new Date();
    const diff = (now.getTime() - date.getTime()) / 60000;
    if (diff < 5) return 'Online';
    if (diff < 60) return `${Math.floor(diff)}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <aside className="w-64 flex-shrink-0 border-l border-pale-sky dark:border-slate-600 bg-white/50 dark:bg-[var(--bg-card)] flex flex-col min-h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <h3 className="font-semibold text-deep-navy dark:text-[var(--text-primary)] mb-3">Team</h3>
          {loading ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm">Loading...</p>
          ) : (
            <ul className="space-y-2">
              {team.map((u) => (
                <li key={u.id} className="flex items-center gap-2 py-1.5">
                  <div className="relative w-8 h-8 flex-shrink-0">
                    {u.picture && (
                      <img
                        src={u.picture}
                        alt=""
                        className="relative z-10 w-8 h-8 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className="absolute inset-0 rounded-full bg-pale-sky flex items-center justify-center text-deep-navy text-xs font-medium">
                      {(u.name || u.email || '?')[0]}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{u.name || u.email?.split('@')[0] || 'User'}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 capitalize">{u.role || 'standard'}</span>
                      {u.last_seen && (
                        <span className="text-xs text-slate-400">{formatLastSeen(u.last_seen)}</span>
                      )}
                    </div>
                    {u.project_assignments?.length > 0 && (
                      <div className="text-xs text-slate-500 mt-0.5 truncate" title={u.project_assignments.map((p: any) => `${p.semester || ''} ${p.name}`).join(', ')}>
                        {u.project_assignments.slice(0, 2).map((p: any) => p.semester ? `${p.semester} — ${p.name}` : p.name).join(', ')}
                        {u.project_assignments.length > 2 && '…'}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pt-4 border-t border-pale-sky dark:border-slate-600">
          <h3 className="font-semibold text-deep-navy dark:text-[var(--text-primary)] mb-3">Integrations</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-2 rounded-lg border border-pale-sky dark:border-slate-600 text-sm text-slate-500 dark:text-slate-400">
              <img src="/slack-logo.png" alt="" className="w-5 h-5 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span className="flex-1">Slack</span>
              {slackStatus?.connected ? (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">Connected</span>
                  {slackStatus.team_name && <span className="text-xs text-slate-500 dark:text-slate-400">({slackStatus.team_name})</span>}
                  <button
                    onClick={async () => {
                      try {
                        await api.auth.slack.disconnect();
                        setSlackStatus({ connected: false });
                      } catch {}
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Disconnect
                  </button>
                </span>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      const { redirect_url } = await api.auth.slack.connectUrl();
                      window.location.href = redirect_url;
                    } catch (e) {
                      alert('Slack not configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to backend/.env');
                    }
                  }}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-deep-navy dark:hover:text-[var(--text-primary)] hover:underline"
                >
                  Connect
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg border border-pale-sky/50 dark:border-slate-600 text-sm text-slate-500 dark:text-slate-400">
              <img src="/google-drive-logo.png" alt="" className="w-5 h-5 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span>Google Drive</span>
              <span className="text-xs ml-auto">Coming soon</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg border border-pale-sky/50 dark:border-slate-600 text-sm text-slate-500 dark:text-slate-400">
              <img src="/microsoft-365-logo.png" alt="" className="w-5 h-5 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span>Microsoft 365</span>
              <span className="text-xs ml-auto">Coming soon</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
