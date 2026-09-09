import { useState } from 'react';
import { Button, EmptyState, StatusBadge } from '../ui/Primitives';
import { trackingTime } from '../../lib/trackingTime';
import { eventLabels, hasEvent, matchesTracking, type CampaignRecipient, type TrackingFilter } from '../../lib/campaignTracking';

const filters: { key: TrackingFilter; label: string }[] = [
  { key: 'all', label: 'All recipients' }, { key: 'sent', label: 'Sent' },
  { key: 'opened', label: 'Open detected' }, { key: 'replied', label: 'Replied' },
  { key: 'bounced', label: 'Bounced' }, { key: 'waiting', label: 'Awaiting reply' },
];

export default function CampaignRecipients({ contacts, onMarkReplied, readOnly = false }: {
  readOnly?: boolean; contacts: CampaignRecipient[]; onMarkReplied: (id: number) => Promise<void>;
}) {
  const [filter, setFilter] = useState<TrackingFilter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const query = search.trim().toLowerCase();
  const visible = contacts.filter(contact => matchesTracking(contact, filter) &&
    (!query || [contact.name, contact.email, contact.company].some(value => value?.toLowerCase().includes(query))));
  return <section aria-labelledby="recipients-title" className="space-y-4">
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-label="Filter recipients by activity">
      {filters.map(item => <button key={item.key} type="button" aria-pressed={filter === item.key}
        onClick={() => setFilter(item.key)}
        className={`surface-card rounded-xl p-4 text-left border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel-blue ${filter === item.key ? 'border-steel-blue bg-pale-sky/20' : 'border-transparent hover:border-pale-sky'}`}>
        <span className="block text-xs text-slate-600">{item.label}</span>
        <span className="block mt-1 text-2xl font-semibold text-deep-navy tabular-nums">{contacts.filter(contact => matchesTracking(contact, item.key)).length}</span>
      </button>)}
    </div>
    <div className="surface-card rounded-xl overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-pale-sky flex flex-wrap justify-between items-center gap-4">
        <div><h2 id="recipients-title" className="font-semibold text-deep-navy">Recipient activity</h2>
          <p className="text-xs text-slate-500 mt-1" aria-live="polite">Showing {visible.length} of {contacts.length} recipients. Activity counts can overlap.</p></div>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          aria-label="Search campaign recipients" placeholder="Search name, email, or company"
          className="w-full sm:w-72 rounded-lg border border-pale-sky px-3 py-2 text-sm" />
      </div>
      {visible.length === 0 ? <EmptyState title={contacts.length ? 'No matching recipients' : 'Build your recipient list'}
        body={contacts.length ? 'Try another activity filter or search.' : 'Add contacts below to prepare this campaign.'}
        action={contacts.length ? <Button variant="secondary" onClick={() => { setFilter('all'); setSearch(''); }}>Clear filters</Button> : undefined} />
        : <ul className="divide-y divide-pale-sky/50">
          {visible.map(contact => <li key={contact.id} className="p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-deep-navy break-words">{contact.name || contact.email}</p>
                <p className="text-sm text-slate-500 break-all">{contact.name && contact.email}{contact.company && ` · ${contact.company}`}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {matchesTracking(contact, 'sent')
                    ? <StatusBadge>Sent</StatusBadge>
                    : <StatusBadge tone={contact.status === 'failed' ? 'danger' : 'neutral'}>{contact.status === 'pending' ? 'Queued' : contact.status}</StatusBadge>}
                  {matchesTracking(contact, 'opened') && <StatusBadge tone="info">Open detected</StatusBadge>}
                  {matchesTracking(contact, 'replied') && <StatusBadge tone="success">Replied</StatusBadge>}
                  {matchesTracking(contact, 'bounced') && <StatusBadge tone="danger">Delivery failed</StatusBadge>}
                  {hasEvent(contact, 'delayed') && <StatusBadge tone="warning">Delay reported</StatusBadge>}
                  {hasEvent(contact, 'auto_reply') && <StatusBadge tone="info">Automatic reply</StatusBadge>}
                </div>
                {contact.email_subject && <p className="text-sm text-slate-600 mt-2 break-words">{contact.email_subject}</p>}
                {contact.sent_at && <p className="text-xs text-slate-500 mt-1">Sent {trackingTime(contact.sent_at)}</p>}
                {contact.last_error && <p className="mt-1 text-xs text-red-700 break-words">Last error: {contact.last_error}</p>}
              </div>
              {!readOnly && matchesTracking(contact, 'waiting') && <Button size="sm" variant="secondary" disabled={busy !== null}
                onClick={async () => { setBusy(contact.id); try { await onMarkReplied(contact.id); } finally { setBusy(null); } }}>
                {busy === contact.id ? 'Saving…' : 'Mark replied'}
              </Button>}
            </div>
            {!!contact.messages?.length && <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-steel-blue py-1">Message history ({contact.messages.length})</summary>
              <ol className="mt-3 ml-1 border-l border-pale-sky pl-4 space-y-4">
                {contact.messages.map((message, index) => <li key={message.id}>
                  <p className="font-medium text-deep-navy">Email {index + 1} · {message.sent_at ? trackingTime(message.sent_at) : 'Send not confirmed'}</p>
                  {message.events.length ? <ul className="mt-1 space-y-1 text-slate-600">
                    {message.events.map((event, eventIndex) => <li key={eventIndex}>
                      <span>{eventLabels[event.kind] || event.kind} · {trackingTime(event.occurred_at)}</span>
                      {event.detail && <p className="text-xs text-slate-500 mt-1 break-words">{event.detail}</p>}
                    </li>)}
                  </ul> : <p className="text-xs text-slate-500 mt-1">No activity detected yet.</p>}
                </li>)}
              </ol>
            </details>}
          </li>)}
        </ul>}
    </div>
  </section>;
}
