import { useEffect, useState } from 'react';
import { workspaceRequest } from '../lib/workspaceApi';
type Ledger = { days: number; items: { id: number; sender_name: string; sender_email: string; recipient: string; sent_at: string; campaign_name?: string; message_kind: string; replied: number; opened: number }[]; by_sender: { sender_id: number; sender_name: string; sender_email: string; messages: number; unique_recipients: number; follow_ups: number }[] };
export default function OutreachLedger() {
  const [data, setData] = useState<Ledger | null>(null);
  const [days, setDays] = useState(30);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    workspaceRequest<Ledger>(`/api/activity/outreach?days=${days}&offset=${offset}`).then(value => { if (active) { setData(value); setError(''); } }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [days, offset]);
  return <section className="surface-card p-5 mt-5"><h2 className="app-section-title">Club outreach activity</h2>
    <p className="text-sm my-2">Confirmed sends attributed to the sending member. Shared reporting does not grant access to another member’s mailbox or outgoing queue.</p>
    <label>Period <select value={days} onChange={e => { setDays(Number(e.target.value)); setOffset(0); }}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
    {error && <p role="alert">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left my-4"><thead><tr><th>Member</th><th>Messages</th><th>Unique recipients</th><th>Follow-ups</th></tr></thead><tbody>{data?.by_sender.map(row => <tr key={row.sender_id}><td>{row.sender_name || row.sender_email}</td><td>{row.messages}</td><td>{row.unique_recipients}</td><td>{row.follow_ups}</td></tr>)}</tbody></table></div>
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Sender</th><th>Recipient</th><th>Campaign</th><th>Type</th><th>Sent</th></tr></thead><tbody>{data?.items.map(row => <tr key={row.id}><td>{row.sender_email}</td><td>{row.recipient}</td><td>{row.campaign_name || '—'}</td><td>{row.message_kind === 'initial' ? 'Initial email' : 'Follow-up'}</td><td>{row.sent_at}</td></tr>)}</tbody></table></div>
    {data?.items.length === 0 && <p>No confirmed sends in this period.</p>}
    <button className="ui-button ui-button--secondary mt-3" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
    <button className="ui-button ui-button--secondary mt-3" disabled={!data || data.items.length < 50} onClick={() => setOffset(offset + 50)}>Next</button>
  </section>;
}
