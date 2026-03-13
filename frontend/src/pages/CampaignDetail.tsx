import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const cid = parseInt(id, 10);
    Promise.all([api.campaigns.get(cid), api.contacts.list()])
      .then(([c, contacts]) => {
        setCampaign(c);
        setContacts(contacts);
      })
      .catch(() => navigate('/campaigns'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const [generating, setGenerating] = useState(false);

  const addSelected = async (generateEmails = false) => {
    if (!id || selectedIds.size === 0) return;
    setGenerating(true);
    try {
      const ids = Array.from(selectedIds);
      let subjects: Record<string, string> = {};
      let bodies: Record<string, string> = {};
      if (generateEmails) {
        for (const cid of ids) {
          try {
            const res = await api.emails.generate({ contact_id: cid });
            subjects[String(cid)] = res.subject;
            bodies[String(cid)] = res.body;
          } catch {
            // fallback empty
          }
        }
      }
      await api.campaigns.addContacts(parseInt(id, 10), {
        contact_ids: ids,
        email_subjects: Object.keys(subjects).length ? subjects : undefined,
        email_bodies: Object.keys(bodies).length ? bodies : undefined,
      });
      setSelectedIds(new Set());
      setCampaign(await api.campaigns.get(parseInt(id, 10)));
    } catch (e) {
      alert(e);
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelect = (contactId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  if (loading || !campaign) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-slate-500">Loading...</div>
      </div>
    );
  }

  const existingIds = new Set((campaign.contacts || []).map((c: any) => c.contact_id));

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/campaigns')}
          className="text-slate-500 hover:text-deep-navy"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-deep-navy">{campaign.name}</h1>
        <span className="px-2 py-1 rounded text-sm bg-slate-100 text-slate-600">{campaign.status}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-pale-sky rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-deep-navy mb-4">Add Contacts</h2>
          <p className="text-slate-500 text-sm mb-4">Select contacts to add. Generate emails in Email Studio first, then add them here.</p>
          <div className="max-h-[300px] overflow-y-auto space-y-2 mb-4">
            {contacts.filter((c) => !existingIds.has(c.id)).map((c) => (
              <label key={c.id} className="flex items-center gap-2 p-2 rounded bg-white hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleSelect(c.id)}
                />
                <span className="text-slate-800">{c.name || c.email}</span>
                <span className="text-slate-500 text-sm">{c.company}</span>
              </label>
            ))}
            {contacts.filter((c) => !existingIds.has(c.id)).length === 0 && (
              <p className="text-slate-500 text-sm">All contacts already in campaign.</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => addSelected(false)}
              disabled={selectedIds.size === 0 || generating}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium disabled:opacity-50"
            >
              Add {selectedIds.size} contact(s)
            </button>
            <button
              onClick={() => addSelected(true)}
              disabled={selectedIds.size === 0 || generating}
              className="px-4 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white font-medium disabled:opacity-50"
            >
              {generating ? 'Generating with Ollama...' : 'Generate & Add'}
            </button>
          </div>
        </div>
        <div className="bg-white border border-pale-sky rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-pale-sky">
            <h2 className="font-semibold text-deep-navy">Campaign Contacts ({campaign.contacts?.length ?? 0})</h2>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {(campaign.contacts || []).length === 0 ? (
              <p className="p-4 text-slate-500 text-sm">No contacts yet. Add some above.</p>
            ) : (
              (campaign.contacts || []).map((cc: any) => (
                <div
                  key={cc.id}
                  className="px-6 py-3 border-b border-pale-sky/50 flex items-center justify-between gap-4"
                >
                  <div>
                    <div className="font-medium text-slate-800">{cc.name} ({cc.email})</div>
                    <div className="text-sm text-slate-500">
                      {cc.status}
                      {cc.opened_at && <span className="ml-2 text-green-600">• Opened</span>}
                      {cc.replied_at && <span className="ml-2 text-steel-blue">• Replied</span>}
                    </div>
                    {cc.email_subject && (
                      <div className="text-xs text-slate-500 mt-1">Subject: {cc.email_subject}</div>
                    )}
                  </div>
                  {cc.status === 'sent' && !cc.replied_at && (
                    <button
                      onClick={async () => {
                        try {
                          await api.outreach.markReplied(cc.id);
                          setCampaign(await api.campaigns.get(parseInt(id!, 10)));
                        } catch (e) {
                          alert((e as Error)?.message);
                        }
                      }}
                      className="px-3 py-1 rounded text-sm bg-pale-sky/50 hover:bg-pale-sky text-deep-navy"
                    >
                      Mark replied
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
