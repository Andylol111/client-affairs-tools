import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, Notice, StatusBadge } from './ui/Primitives';

type SlackStatus = { connected: boolean; team_name?: string };

export default function SlackIntegration() {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    api.auth.slack.status()
      .then(setStatus)
      .catch((requestError: Error) => setError(requestError.message));
  };

  useEffect(() => {
    refresh();
    window.addEventListener('slack-integration-updated', refresh);
    return () => window.removeEventListener('slack-integration-updated', refresh);
  }, []);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const { redirect_url } = await api.auth.slack.connectUrl();
      window.location.assign(redirect_url);
    } catch (requestError) {
      setError((requestError as Error).message);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await api.auth.slack.disconnect();
      setStatus({ connected: false });
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface-card rounded-xl p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-deep-navy dark:text-[var(--text-primary)]">Slack</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Connect the club workspace for shared notifications.</p>
        </div>
        {status && <StatusBadge tone={status.connected ? 'success' : 'neutral'}>{status.connected ? 'Connected' : 'Not connected'}</StatusBadge>}
      </div>
      {status?.team_name && <p className="text-sm text-slate-600">Workspace: <strong>{status.team_name}</strong></p>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button variant={status?.connected ? 'danger' : 'primary'} onClick={status?.connected ? disconnect : connect} disabled={busy || status == null}>
        {busy ? 'Working…' : status?.connected ? 'Disconnect Slack' : 'Connect Slack'}
      </Button>
    </section>
  );
}
