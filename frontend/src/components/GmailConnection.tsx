import { useEffect, useState } from 'react';
import { fetchApi } from '../api';
import { Button, ConfirmDialog, Notice, StatusBadge } from './ui/Primitives';

export default function GmailConnection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => {
    let active = true;
    fetchApi<{ connected: boolean }>('/api/auth/gmail/status')
      .then(status => { if (active) setConnected(status.connected); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to check Gmail connection.'); });
    return () => { active = false; };
  }, []);
  const connect = async () => {
    setBusy(true); setError('');
    try {
      const result = await fetchApi<{ redirect_url: string }>('/api/auth/gmail/connect');
      window.location.assign(result.redirect_url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect Gmail.'); setBusy(false); }
  };
  return <section className="surface-card p-5 mb-6" aria-labelledby="gmail-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="gmail-heading" className="app-section-title">Your Gmail account</h2>
      <StatusBadge tone={connected ? 'success' : 'neutral'}>{connected === null ? 'Checking connection' : connected ? 'Connected' : 'Not connected'}</StatusBadge>
    </div>
    <p className="text-sm text-slate-600 my-3">Connect your own Gmail to send outreach and track replies and bounces. Signing into the club website does not grant mailbox access. Shared reports never authorize another member to send from your account.</p>
    {error && <Notice tone="danger" className="mb-3">{error}</Notice>}
    {connected ? <Button variant="secondary" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect Gmail</Button> : <Button disabled={busy || connected === null} onClick={connect}>Connect Gmail</Button>}
    <ConfirmDialog open={confirmDisconnect} title="Disconnect your Gmail?" body="Sending and mailbox synchronization for your account will stop. Queued work must not switch to another member's account." confirmLabel="Disconnect Gmail" busy={busy} onClose={() => setConfirmDisconnect(false)} onConfirm={async () => {
      setBusy(true); setError('');
      try { await fetchApi<unknown>('/api/auth/gmail/disconnect', { method: 'DELETE' }); setConnected(false); setConfirmDisconnect(false); }
      catch (e) { setError(e instanceof Error ? e.message : 'Unable to disconnect Gmail.'); }
      finally { setBusy(false); }
    }} />
  </section>;
}
