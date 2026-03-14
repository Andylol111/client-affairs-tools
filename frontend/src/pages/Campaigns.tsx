import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Campaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.campaigns.list().then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  const createCampaign = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      await api.campaigns.create(newName.trim());
      setNewName('');
      setCampaigns(await api.campaigns.list());
    } finally {
      setLoading(false);
    }
  };

  const sendCampaign = async (id: number) => {
    if (!confirm('Send this campaign?')) return;
    try {
      await api.campaigns.send(id);
      setCampaigns(await api.campaigns.list());
    } catch (e) {
      alert(e);
    }
  };

  const deleteCampaign = async (id: number, name: string) => {
    if (!confirm(`Delete campaign "${name}"? This cannot be undone.`)) return;
    try {
      await api.campaigns.delete(id);
      setCampaigns(await api.campaigns.list());
    } catch (e: any) {
      alert(e?.message || 'Failed to delete campaign');
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-deep-navy">Campaigns</h1>
        <button
          onClick={async () => {
            const name = window.prompt('Campaign name:');
            if (!name?.trim()) return;
            setLoading(true);
            try {
              await api.campaigns.create(name.trim());
              setCampaigns(await api.campaigns.list());
            } catch (e: any) {
              alert(e?.message || 'Failed to create campaign');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] active:scale-[0.98] text-white font-medium whitespace-nowrap transition-all disabled:opacity-50"
        >
          + Create Campaign
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Create Campaign</h2>
          <div className="flex gap-1">
            <input
              id="create-campaign-input"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Campaign name"
              className="flex-1 px-4 py-3 rounded-lg bg-white border border-slate-300 text-slate-800 placeholder-slate-400"
            />
            <button
              onClick={createCampaign}
              disabled={loading}
              className="px-6 py-3 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] active:scale-[0.98] text-white font-medium disabled:opacity-50 transition-all"
            >
              Create
            </button>
          </div>
        </div>
        <div className="lg:col-span-2">
          <h2 className="font-semibold text-deep-navy mb-4">Your Campaigns</h2>
          <div className="space-y-3">
            {campaigns.length === 0 ? (
              <p className="text-slate-500">No campaigns yet.</p>
            ) : (
              campaigns.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-4 bg-white border border-pale-sky shadow-sm rounded-xl"
                >
                  <div>
                    <div className="font-medium text-deep-navy">{c.name}</div>
                    <div className="text-sm text-slate-500">
                      {c.contact_count ?? 0} contacts • {c.sent_count ?? 0} sent • {c.status}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/campaigns/${c.id}`)}
                      className="px-4 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      View
                    </button>
                    {c.status === 'draft' && (
                      <button
                        onClick={() => sendCampaign(c.id)}
                        className="px-4 py-2 rounded-lg text-sm bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white"
                      >
                        Send
                      </button>
                    )}
                    <button
                      onClick={() => deleteCampaign(c.id, c.name)}
                      className="px-4 py-2 rounded-lg text-sm border border-red-200 text-red-600 hover:bg-red-50"
                      title="Delete campaign"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
