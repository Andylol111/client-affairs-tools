import DispatchRecovery from '../components/campaigns/DispatchRecovery';
import { canManageCampaign } from '../lib/campaignAccess';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { api, type Campaign, type Contact } from '../api';
import TrackingSync from '../components/TrackingSync';
import CampaignRecipients from '../components/campaigns/CampaignRecipients';
import { Button, ConfirmDialog, Notice, StatusBadge } from '../components/ui/Primitives';

type FollowUpSequence = { id: number; name: string };

function statusTone(status: string): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  if (status === 'sent') return 'success';
  if (status === 'releasing') return 'info';
  if (status === 'needs_attention') return 'danger';
  if (status === 'paused') return 'warning';
  return 'neutral';
}

export default function CampaignDetail() {
  const { id } = useParams();
  const { user } = useOutletContext<{ user: { id: number } }>();
  const navigate = useNavigate();
  const campaignId = Number(id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addContactSearch, setAddContactSearch] = useState('');
  const [sequences, setSequences] = useState<FollowUpSequence[]>([]);
  const [error, setError] = useState('');
  const [contactOffset, setContactOffset] = useState(0);
  const [contactTotal, setContactTotal] = useState(0);
  const [contactLoading, setContactLoading] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isInteger(campaignId)) return;
    setCampaign(await api.campaigns.get(campaignId));
  }, [campaignId]);

  useEffect(() => {
    if (!Number.isInteger(campaignId)) {
      navigate('/campaigns', { replace: true });
      return;
    }
    Promise.all([refresh(), api.outreach.sequences.list().then(setSequences)])
      .catch((requestError) => setError((requestError as Error).message))
      .finally(() => setLoading(false));
  }, [campaignId, navigate, refresh]);

  useEffect(() => {
    if (campaign?.status !== 'releasing') return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [campaign?.status, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setContactLoading(true);
      api.contacts.list({ q: addContactSearch, limit: 50, offset: contactOffset }, controller.signal)
        .then((page) => {
          setContacts(page.items);
          setContactTotal(page.total);
        })
        .catch((requestError) => {
          if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
            setError((requestError as Error).message);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setContactLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [addContactSearch, contactOffset]);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addSelected = async () => {
    if (selectedIds.size === 0) return;
    await runAction(() => api.campaigns.addContacts(campaignId, { contact_ids: [...selectedIds] }));
    setSelectedIds(new Set());
  };

  if (!loading && !campaign) return <div className="app-workspace"><Notice tone="danger">{error || 'Campaign unavailable.'}</Notice><Link to="/campaigns" className="ui-button mt-4">Back to campaigns</Link></div>;
  if (loading || !campaign) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-500">Loading campaign…</div>;
  }

  const existingIds = new Set((campaign.contacts || []).map((contact) => contact.contact_id));
  const contactsToAdd = contacts.filter((contact) => !existingIds.has(contact.id));
  const readiness = campaign.readiness || { ready: false, issues: ['Loading readiness…'] };
  const counts = campaign.counts || {};
  const canManage = canManageCampaign(campaign, user.id);
  const canEdit = canManage && !['releasing', 'sent'].includes(campaign.status);

  return (
    <div className="app-workspace max-w-6xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to="/campaigns" className="text-sm font-semibold text-[var(--accent)] hover:underline">← All campaigns</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-deep-navy">{campaign.name}</h1>
            <StatusBadge tone={statusTone(campaign.status)}>{campaign.status.replace('_', ' ')}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {counts.sent || 0} sent · {counts.pending || 0} queued · {counts.failed || 0} failed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && campaign.status === 'releasing' && (
            <Button variant="secondary" disabled={busy} onClick={() => runAction(() => api.campaigns.pause(campaignId))}>Pause</Button>
          )}
          {canManage && campaign.status === 'needs_attention' && (
            <Button variant="secondary" disabled={busy} onClick={() => runAction(() => api.campaigns.retryFailed(campaignId))}>Retry failed</Button>
          )}
          {canManage && ['draft', 'paused'].includes(campaign.status) && (
            <Button disabled={busy || !readiness.ready} onClick={() => setConfirmRelease(true)}>Review & release</Button>
          )}
          {canManage && campaign.status !== 'releasing' && (
            <Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</Button>
          )}
        </div>
      </header>

      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!readiness.ready && (
        <Notice tone="warning" className="mb-4">
          <strong>Not ready to release.</strong>
          <ul className="mt-1 list-disc pl-5">
            {readiness.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </Notice>
      )}
      {canManage && campaign.status === 'releasing' && (
        <Notice tone="info" className="mb-4">The server is sending this campaign in paced batches. You can leave this page.</Notice>
      )}

      {canEdit && sequences.length > 0 && (
        <label className="mb-5 block max-w-sm text-sm font-semibold text-deep-navy">
          Follow-up sequence
          <select
            value={campaign.sequence_id ?? ''}
            onChange={(event) => {
              const sequenceId = event.target.value ? Number(event.target.value) : null;
              void runAction(() => api.campaigns.update(campaignId, { sequence_id: sequenceId }));
            }}
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
          >
            <option value="">No follow-up sequence</option>
            {sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}
          </select>
        </label>
      )}

      {canManage && <DispatchRecovery campaignId={campaignId} onReconciled={refresh} />}
      {canManage && <TrackingSync onSynced={refresh} />}
      <CampaignRecipients
        readOnly={!canManage}
        contacts={campaign.contacts || []}
        onMarkReplied={async (campaignContactId) => {
          await api.outreach.markReplied(campaignContactId);
          await refresh();
        }}
      />

      {canEdit && (
        <details className="surface-card mt-6 rounded-xl p-4 sm:p-6" open={(campaign.contacts?.length || 0) === 0}>
          <summary className="cursor-pointer font-semibold text-deep-navy">Add recipients</summary>
          <div className="mt-4">
            <p className="mb-4 text-sm text-slate-600">Your latest drafts are attached automatically. Complete each email before sending.</p>
            <input
              type="search"
              placeholder="Search contacts by name, email, or company"
              value={addContactSearch}
              onChange={(event) => {
                setAddContactSearch(event.target.value);
                setContactOffset(0);
              }}
              className="mb-3 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
              data-search-input
            />
            <div className="mb-4 max-h-80 space-y-1 overflow-y-auto">
              {contactsToAdd.map((contact) => (
                <label key={contact.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(contact.id)}
                    onChange={() => setSelectedIds((previous) => {
                      const next = new Set(previous);
                      if (next.has(contact.id)) next.delete(contact.id);
                      else next.add(contact.id);
                      return next;
                    })}
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-800">{contact.name || contact.email}</span>
                  <span className="hidden truncate text-sm text-slate-500 sm:block">{contact.company}</span>
                </label>
              ))}
              {!contactLoading && contactsToAdd.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No available contacts on this page.</p>}
              {contactLoading && <p className="py-6 text-center text-sm text-slate-500">Loading contacts…</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-600">{contactTotal} contacts in results</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={contactLoading || contactOffset === 0} onClick={() => setContactOffset(Math.max(0, contactOffset - 50))}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={contactLoading || contactOffset + 50 >= contactTotal} onClick={() => setContactOffset(contactOffset + 50)}>Next</Button>
                <Button size="sm" disabled={busy || selectedIds.size === 0} onClick={addSelected}>Add {selectedIds.size || ''} recipient{selectedIds.size === 1 ? '' : 's'}</Button>
              </div>
            </div>
          </div>
        </details>
      )}

      <ConfirmDialog
        open={confirmRelease}
        title="Release this campaign?"
        body={`${campaign.contacts?.length || 0} recipients will enter the paced send queue. You can pause future batches from this page.`}
        confirmLabel="Release campaign"
        busy={busy}
        onClose={() => setConfirmRelease(false)}
        onConfirm={async () => {
          await runAction(() => api.campaigns.release(campaignId));
          setConfirmRelease(false);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete campaign?"
        body="This permanently removes the campaign and its recipient queue."
        confirmLabel="Delete campaign"
        danger
        busy={busy}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.campaigns.delete(campaignId);
            navigate('/campaigns');
          } catch (requestError) {
            setError((requestError as Error).message);
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
