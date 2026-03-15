import { useEffect, useState } from 'react';
import { api } from '../api';

const PIPELINE_STATUSES = ['cold', 'contacted', 'replied', 'meeting', 'closed'];

function groupContactsByCompany(contacts: any[]): { company: string; contacts: any[] }[] {
  const byCompany = new Map<string, any[]>();
  for (const c of contacts) {
    const key = (c.company || '').trim() || 'No company';
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key)!.push(c);
  }
  return Array.from(byCompany.entries())
    .map(([company, contacts]) => ({ company, contacts }))
    .sort((a, b) => (a.company === 'No company' ? 1 : b.company === 'No company' ? -1 : a.company.localeCompare(b.company)));
}

function ContactCard({ c, selectedContact, selectedIds, onSelect, onToggleSelect, onUpdatePipeline, draggable }: {
  c: any; selectedContact: any; selectedIds: Set<number>; onSelect: (c: any) => void; onToggleSelect: (id: number) => void; onUpdatePipeline: (id: number, status: string) => void; draggable: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('contactId', String(c.id)); e.dataTransfer.setData('currentStatus', c.pipeline_status || 'cold'); }}
      onClick={() => onSelect(c)}
      className={`p-3 rounded-lg cursor-pointer border transition-colors ${
        selectedContact?.id === c.id
          ? 'border-[#1a2f5a] bg-[#1a2f5a]/5 ring-1 ring-[#1a2f5a]'
          : 'border-pale-sky hover:border-[#1e3a6e] hover:bg-pale-sky/10'
      } ${selectedIds.has(c.id) ? 'ring-2 ring-amber-500' : ''}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selectedIds.has(c.id)}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(c.id); }}
          onClick={(e) => e.stopPropagation()}
          className="rounded shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-800 truncate text-sm">{c.name || c.email}</div>
          <div className="text-xs text-slate-500 truncate mt-0.5">{c.company || c.email}</div>
        </div>
      </div>
      <select
        value={c.pipeline_status || 'cold'}
        onChange={(e) => { e.stopPropagation(); onUpdatePipeline(c.id, e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        className="mt-2 w-full text-xs px-2 py-1.5 rounded border border-pale-sky bg-white"
      >
        {PIPELINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function CompanyFolder({ company, contacts, selectedContact, selectedIds, onSelect, onToggleSelect, onUpdatePipeline, draggable }: {
  company: string; contacts: any[]; selectedContact: any; selectedIds: Set<number>; onSelect: (c: any) => void; onToggleSelect: (id: number) => void; onUpdatePipeline: (id: number, status: string) => void; draggable: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border border-pale-sky overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-3 py-2 flex items-center justify-between bg-pale-sky/20 hover:bg-pale-sky/30 text-left text-sm font-medium text-deep-navy"
      >
        <span className="truncate">{company}</span>
        <span className="text-slate-500 text-xs shrink-0 ml-2">({contacts.length})</span>
        <span className="text-slate-500">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="p-2 space-y-1 bg-white">
          {contacts.map((c) => (
            <ContactCard key={c.id} c={c} selectedContact={selectedContact} selectedIds={selectedIds} onSelect={onSelect} onToggleSelect={onToggleSelect} onUpdatePipeline={onUpdatePipeline} draggable={draggable} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Outreach() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'campaigns' | 'priorities' | 'templates' | 'sequences'>('pipeline');
  const [groupByCompany, setGroupByCompany] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [pipelineMetrics, setPipelineMetrics] = useState<any>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [newNote, setNewNote] = useState('');
  const [newActivityType, setNewActivityType] = useState('email_sent');
  const [newActivityDetails, setNewActivityDetails] = useState('');
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: '', subject: '', body: '', industry: '', use_case: '' });
  const [sequenceForm, setSequenceForm] = useState({ name: '', steps: [{ days_after: 3, subject: '', body: '' }] });
  const [loading, setLoading] = useState(false);
  const [outreachCampaigns, setOutreachCampaigns] = useState<any[]>([]);
  const [campaignForm, setCampaignForm] = useState({ name: '', type: 'individual' as 'community' | 'individual', description: '' });
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [campaignContacts, setCampaignContacts] = useState<any[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactPipelineFilter, setContactPipelineFilter] = useState<string>('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const params: { q?: string; pipeline_status?: string } = {};
    if (contactSearch.trim()) params.q = contactSearch.trim();
    if (contactPipelineFilter) params.pipeline_status = contactPipelineFilter;
    api.contacts.list(params).then(setContacts).catch(() => setContacts([]));
  }, [contactSearch, contactPipelineFilter]);

  useEffect(() => {
    api.outreach.templates.list().then(setTemplates).catch(() => setTemplates([]));
    api.outreach.sequences.list().then(setSequences).catch(() => setSequences([]));
    api.outreach.pipelineMetrics().then(setPipelineMetrics).catch(() => setPipelineMetrics(null));
    api.outreach.campaigns.list().then(setOutreachCampaigns).catch(() => setOutreachCampaigns([]));
  }, []);

  useEffect(() => {
    if (selectedCampaign?.id) {
      api.outreach.campaigns.get(selectedCampaign.id).then((c) => {
        setCampaignContacts(c.contacts || []);
      }).catch(() => setCampaignContacts([]));
    } else {
      setCampaignContacts([]);
    }
  }, [selectedCampaign?.id]);

  useEffect(() => {
    if (selectedContact?.id) {
      setEmailVerified(null);
      api.outreach.notes.list(selectedContact.id).then(setNotes).catch(() => setNotes([]));
      api.outreach.activities.list(selectedContact.id).then(setActivities).catch(() => setActivities([]));
      api.outreach.profile.get(selectedContact.id).then(setProfile).catch(() => setProfile(null));
    } else {
      setNotes([]);
      setActivities([]);
      setProfile(null);
      setEmailVerified(null);
    }
  }, [selectedContact?.id]);

  const updatePipeline = async (contactId: number, status: string) => {
    try {
      await api.outreach.updatePipeline(contactId, status);
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, pipeline_status: status } : c))
      );
      if (selectedContact?.id === contactId) setSelectedContact((p: any) => (p ? { ...p, pipeline_status: status } : null));
    } catch (e) {
      alert((e as Error)?.message || 'Failed');
    }
  };

  const toggleContactSelection = (id: number) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleColumnDrop = (newStatus: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const contactId = e.dataTransfer.getData('contactId');
    if (contactId) updatePipeline(parseInt(contactId, 10), newStatus);
  };

  const handleBulkMove = async (newStatus: string) => {
    if (selectedContactIds.size === 0) return;
    for (const id of selectedContactIds) {
      await updatePipeline(id, newStatus);
    }
    setSelectedContactIds(new Set());
  };

  const handleBulkAddToCampaign = async (campaignId: number) => {
    if (selectedContactIds.size === 0) return;
    try {
      await api.outreach.campaigns.addContacts(campaignId, Array.from(selectedContactIds));
      setSelectedContactIds(new Set());
      api.outreach.campaigns.list().then(setOutreachCampaigns).catch(() => {});
      if (selectedCampaign?.id === campaignId) {
        api.outreach.campaigns.get(campaignId).then((c) => setCampaignContacts(c.contacts || [])).catch(() => {});
      }
      alert(`Added ${selectedContactIds.size} contact(s) to campaign.`);
    } catch (e) {
      alert((e as Error)?.message || 'Failed');
    }
  };

  const addNote = async () => {
    if (!selectedContact?.id || !newNote.trim()) return;
    try {
      await api.outreach.notes.create(selectedContact.id, newNote.trim());
      setNewNote('');
      api.outreach.notes.list(selectedContact.id).then(setNotes).catch(() => {});
    } catch (e) {
      alert((e as Error)?.message || 'Failed');
    }
  };

  const addActivity = async () => {
    if (!selectedContact?.id) return;
    try {
      await api.outreach.activities.create(selectedContact.id, newActivityType, newActivityDetails || undefined);
      setNewActivityDetails('');
      api.outreach.activities.list(selectedContact.id).then(setActivities).catch(() => {});
    } catch (e) {
      alert((e as Error)?.message || 'Failed');
    }
  };

  const saveTemplate = async () => {
    if (!templateForm.name || !templateForm.subject || !templateForm.body) return;
    setLoading(true);
    try {
      await api.outreach.templates.create({
        name: templateForm.name,
        subject: templateForm.subject,
        body: templateForm.body,
        industry: templateForm.industry || undefined,
        use_case: templateForm.use_case || undefined,
      });
      setTemplateForm({ name: '', subject: '', body: '', industry: '', use_case: '' });
      api.outreach.templates.list().then(setTemplates).catch(() => {});
    } catch (e) {
      alert((e as Error)?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const saveSequence = async () => {
    if (!sequenceForm.name || !sequenceForm.steps.length) return;
    setLoading(true);
    try {
      await api.outreach.sequences.create(
        sequenceForm.name,
        sequenceForm.steps.filter((s) => s.subject || s.body)
      );
      setSequenceForm({ name: '', steps: [{ days_after: 3, subject: '', body: '' }] });
      api.outreach.sequences.list().then(setSequences).catch(() => {});
    } catch (e) {
      alert((e as Error)?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const verifyEmail = async () => {
    if (!selectedContact?.email) return;
    try {
      const r = await api.outreach.verifyEmail(selectedContact.email);
      setEmailVerified(r.valid);
    } catch {
      setEmailVerified(false);
    }
  };

  const refreshProfile = async () => {
    if (!selectedContact?.id) return;
    setLoading(true);
    try {
      const p = await api.outreach.profile.refresh(selectedContact.id);
      setProfile(p);
    } catch (e) {
      alert((e as Error)?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto">
      <h1 className="text-2xl font-bold text-deep-navy mb-6">Outreach Hub</h1>

      <div className="flex gap-2 mb-6 border-b border-pale-sky flex-wrap">
        {(['pipeline', 'campaigns', 'priorities', 'templates', 'sequences'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg font-medium ${
              activeTab === tab ? 'bg-[#1a2f5a] text-white' : 'bg-pale-sky/30 text-slate-600 hover:bg-pale-sky/50'
            }`}
          >
            {tab === 'priorities' ? 'Club Priorities' : tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: List (or full-width pipeline/priorities board) */}
        <div className={activeTab === 'pipeline' || activeTab === 'priorities' ? 'lg:col-span-3' : activeTab === 'campaigns' ? 'lg:col-span-2 space-y-4' : 'lg:col-span-1 space-y-4'}>
          {activeTab === 'pipeline' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="search"
                  placeholder="Search name, email, company... (press /)"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-pale-sky text-sm w-56 max-w-full"
                  aria-label="Search contacts"
                  data-search-input
                />
                <select
                  value={contactPipelineFilter}
                  onChange={(e) => setContactPipelineFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-pale-sky text-sm bg-white"
                  aria-label="Filter by pipeline status"
                >
                  <option value="">All statuses</option>
                  {PIPELINE_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={groupByCompany}
                    onChange={(e) => setGroupByCompany(e.target.checked)}
                  />
                  Group by company
                </label>
                <span className="text-xs text-slate-500 hidden sm:inline">Merge contacts into company folders</span>
              </div>
              {selectedContactIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <span className="text-sm font-medium text-amber-800">{selectedContactIds.size} selected</span>
                  <select
                    onChange={(e) => { const v = e.target.value; if (v) handleBulkMove(v); e.target.value = ''; }}
                    className="text-sm px-2 py-1.5 rounded border border-amber-300 bg-white"
                  >
                    <option value="">Move to...</option>
                    {PIPELINE_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <select
                    onChange={(e) => { const v = e.target.value; if (v) handleBulkAddToCampaign(parseInt(v, 10)); e.target.value = ''; }}
                    className="text-sm px-2 py-1.5 rounded border border-amber-300 bg-white"
                  >
                    <option value="">Add to campaign...</option>
                    {outreachCampaigns.map((oc) => (
                      <option key={oc.id} value={oc.id}>{oc.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setSelectedContactIds(new Set())} className="text-sm text-amber-700 hover:underline">Clear</button>
                </div>
              )}
              {/* Full-width Kanban-style pipeline board */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 min-h-[420px]">
                {PIPELINE_STATUSES.map((status) => {
                  const inStatus = contacts.filter((c) => (c.pipeline_status || 'cold') === status);
                  const count = pipelineMetrics?.by_status?.find((s: any) => s.pipeline_status === status)?.count ?? inStatus.length;
                  return (
                    <div
                      key={status}
                      className="bg-white border border-pale-sky rounded-xl flex flex-col overflow-hidden shadow-sm"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleColumnDrop(status)}
                    >
                      <div className="px-4 py-3 border-b border-pale-sky bg-pale-sky/20 flex justify-between items-center">
                        <h3 className="font-semibold text-deep-navy capitalize">{status}</h3>
                        <span className="text-sm font-medium text-slate-600 bg-white px-2 py-0.5 rounded">
                          {count}
                        </span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[320px]">
                        {groupByCompany ? (
                          groupContactsByCompany(inStatus).map(({ company, contacts: companyContacts }) => (
                            <CompanyFolder
                              key={company}
                              company={company}
                              contacts={companyContacts}
                              selectedContact={selectedContact}
                              selectedIds={selectedContactIds}
                              onSelect={setSelectedContact}
                              onToggleSelect={toggleContactSelection}
                              onUpdatePipeline={updatePipeline}
                              draggable={!groupByCompany}
                            />
                          ))
                        ) : (
                          inStatus.map((c) => (
                            <ContactCard
                              key={c.id}
                              c={c}
                              selectedContact={selectedContact}
                              selectedIds={selectedContactIds}
                              onSelect={setSelectedContact}
                              onToggleSelect={toggleContactSelection}
                              onUpdatePipeline={updatePipeline}
                              draggable={true}
                            />
                          ))
                        )}
                        {inStatus.length === 0 && (
                          <div className="text-center text-slate-400 text-sm py-8">No contacts</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {activeTab === 'campaigns' && (
            <div className="bg-white border border-pale-sky rounded-xl p-4 max-h-[500px] overflow-y-auto space-y-4 w-full">
              <h3 className="font-semibold text-deep-navy">Outreach Campaigns</h3>
              <p className="text-sm text-slate-600">
                Community = institution priorities. Individual = your outreach. Track what each person is working on.
              </p>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Campaign name"
                  className="px-3 py-2 rounded-lg border border-pale-sky text-sm flex-1 min-w-[140px]"
                />
                <select
                  value={campaignForm.type}
                  onChange={(e) => setCampaignForm((p) => ({ ...p, type: e.target.value as 'community' | 'individual' }))}
                  className="px-3 py-2 rounded-lg border border-pale-sky text-sm"
                >
                  <option value="community">Community</option>
                  <option value="individual">Individual</option>
                </select>
                <button
                  onClick={async () => {
                    if (!campaignForm.name.trim()) return;
                    try {
                      await api.outreach.campaigns.create({
                        name: campaignForm.name.trim(),
                        type: campaignForm.type,
                        description: campaignForm.description || undefined,
                      });
                      setCampaignForm({ name: '', type: 'individual', description: '' });
                      api.outreach.campaigns.list().then(setOutreachCampaigns).catch(() => {});
                    } catch (e) {
                      alert((e as Error)?.message);
                    }
                  }}
                  disabled={!campaignForm.name.trim()}
                  className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white text-sm font-medium disabled:opacity-50"
                >
                  Create
                </button>
              </div>
              <div className="space-y-2">
                {outreachCampaigns.map((oc) => (
                  <div
                    key={oc.id}
                    onClick={() => setSelectedCampaign(oc)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedCampaign?.id === oc.id ? 'border-[#1a2f5a] bg-[#1a2f5a]/5' : 'border-pale-sky hover:bg-pale-sky/10'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-slate-800">{oc.name}</span>
                        <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${oc.type === 'community' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {oc.type}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">{oc.contact_count ?? 0} contacts</span>
                    </div>
                    {(oc.owner_email || oc.owner_name) && (
                      <div className="text-xs text-slate-500 mt-0.5">Author: {oc.owner_email || oc.owner_name}</div>
                    )}
                    {oc.type === 'community' && !oc.owner_email && !oc.owner_name && (
                      <div className="text-xs text-slate-500 mt-0.5">Community initiative</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeTab === 'priorities' && (
            <div className="bg-white border border-pale-sky rounded-xl p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-deep-navy mb-2">Club Priorities & Communities</h2>
              <p className="text-sm text-slate-600 mb-6">
                What everyone is working on. Author = Google account. Community = institution focus; Individual = member outreach.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-pale-sky">
                      <th className="text-left py-3 px-3 font-semibold text-deep-navy">Campaign</th>
                      <th className="text-left py-3 px-3 font-semibold text-deep-navy">Author</th>
                      <th className="text-left py-3 px-3 font-semibold text-deep-navy">Focus</th>
                      <th className="text-left py-3 px-3 font-semibold text-deep-navy">Type</th>
                      <th className="text-left py-3 px-3 font-semibold text-deep-navy">Contacts</th>
                      <th className="text-left py-3 px-3 font-semibold text-deep-navy"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {outreachCampaigns.map((oc) => (
                      <tr
                        key={oc.id}
                        className="border-b border-pale-sky/50 hover:bg-pale-sky/5"
                      >
                        <td className="py-3 px-3 font-medium text-slate-800">{oc.name}</td>
                        <td className="py-3 px-3 text-slate-600">
                          {oc.type === 'community'
                            ? 'Community'
                            : (oc.owner_email || oc.owner_name || '—')}
                        </td>
                        <td className="py-3 px-3 text-slate-600 max-w-[280px]" title={oc.description || ''}>
                          {oc.description || '—'}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${oc.type === 'community' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                            {oc.type}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-500">{oc.contact_count ?? 0}</td>
                        <td className="py-3 px-3">
                          <button
                            onClick={() => { setSelectedCampaign(oc); setActiveTab('campaigns'); }}
                            className="text-xs text-[#1a2f5a] hover:underline font-medium"
                          >
                            View →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {outreachCampaigns.length === 0 && (
                  <p className="text-slate-500 text-sm py-8 text-center">No campaigns yet. Create one in the Campaigns tab.</p>
                )}
              </div>
            </div>
          )}
          {activeTab === 'templates' && (
            <div className="bg-white border border-pale-sky rounded-xl p-4 max-h-96 overflow-y-auto">
              <h3 className="font-semibold text-deep-navy mb-3">Templates</h3>
              {templates.map((t) => (
                <div key={t.id} className="p-3 border-b border-pale-sky last:border-0 flex justify-between items-center">
                  <div>
                    <div className="font-medium text-slate-800">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.industry || 'General'}</div>
                  </div>
                  <button
                    onClick={async () => {
                      if (confirm('Delete this template?')) {
                        try {
                          await api.outreach.templates.delete(t.id);
                          setTemplates((prev) => prev.filter((x) => x.id !== t.id));
                        } catch (e) {
                          alert((e as Error)?.message);
                        }
                      }
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'sequences' && (
            <div className="bg-white border border-pale-sky rounded-xl p-4 max-h-96 overflow-y-auto">
              <h3 className="font-semibold text-deep-navy mb-3">Sequences</h3>
              {sequences.map((s) => (
                <div key={s.id} className="p-3 border-b border-pale-sky last:border-0">
                  <div className="font-medium text-slate-800">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.steps?.length || 0} steps</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Detail / Form */}
        <div className={`${activeTab === 'pipeline' || activeTab === 'priorities' ? 'lg:col-span-3' : activeTab === 'campaigns' ? 'lg:col-span-1' : 'lg:col-span-2'} space-y-6`}>
          {activeTab === 'campaigns' && selectedCampaign && (
            <div className="bg-white border border-pale-sky rounded-xl p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-deep-navy">{selectedCampaign.name}</h3>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${selectedCampaign.type === 'community' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                    {selectedCampaign.type}
                  </span>
                  <p className="text-sm text-slate-500 mt-1">
                    Author: {selectedCampaign.type === 'community'
                      ? 'Community'
                      : (selectedCampaign.owner_email || selectedCampaign.owner_name || '—')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!confirm('Delete this campaign?')) return;
                      try {
                        await api.outreach.campaigns.delete(selectedCampaign.id);
                        setSelectedCampaign(null);
                        api.outreach.campaigns.list().then(setOutreachCampaigns).catch(() => {});
                      } catch (e) {
                        alert((e as Error)?.message);
                      }
                    }}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                  <button onClick={() => setSelectedCampaign(null)} className="text-sm text-slate-500 hover:text-slate-700">✕ Close</button>
                </div>
              </div>
              <h4 className="text-sm font-medium text-slate-600 mb-2">Contacts in campaign</h4>
              {campaignContacts.length === 0 ? (
                <p className="text-slate-500 text-sm">No contacts yet. Add from the pipeline or contact list.</p>
              ) : (
                <ul className="space-y-2 max-h-60 overflow-y-auto mb-4">
                  {campaignContacts.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                      <span>{c.name || c.email} ({c.company || '—'})</span>
                      <button
                        onClick={async () => {
                          try {
                            await api.outreach.campaigns.removeContact(selectedCampaign.id, c.id);
                            setCampaignContacts((prev) => prev.filter((x) => x.id !== c.id));
                          } catch (e) {
                            alert((e as Error)?.message);
                          }
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="pt-4 border-t border-pale-sky">
                <p className="text-xs text-slate-600 mb-2">Add contacts: select from pipeline, then use the &quot;Add to campaign&quot; action (or add bulk from Contacts page).</p>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-pale-sky text-sm"
                  onChange={async (e) => {
                    const cid = parseInt(e.target.value, 10);
                    if (!cid) return;
                    try {
                      await api.outreach.campaigns.addContacts(selectedCampaign.id, [cid]);
                      const added = contacts.find((c) => c.id === cid);
                      if (added) setCampaignContacts((prev) => [...prev, added]);
                      e.target.value = '';
                    } catch (err) {
                      alert((err as Error)?.message);
                    }
                  }}
                >
                  <option value="">Add contact...</option>
                  {contacts
                    .filter((c) => !campaignContacts.some((cc) => cc.id === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name || c.email} — {c.company || '—'}</option>
                    ))}
                </select>
              </div>
            </div>
          )}
          {activeTab === 'campaigns' && !selectedCampaign && (
            <div className="bg-white border border-pale-sky rounded-xl p-12 text-center">
              <p className="text-slate-500">Select a campaign to view contacts and add more.</p>
            </div>
          )}
          {activeTab === 'pipeline' && (
            selectedContact ? (
            <>
              <div className="bg-white border border-pale-sky rounded-xl p-6">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-deep-navy">Contact: {selectedContact.name || selectedContact.email}</h3>
                  <button
                    onClick={() => setSelectedContact(null)}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    ✕ Clear selection
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center mb-4">
                  <span className="text-sm text-slate-600">{selectedContact.email}</span>
                  <select
                    className="px-2 py-1 rounded text-xs border border-pale-sky bg-white"
                    onChange={async (e) => {
                      const cid = parseInt(e.target.value, 10);
                      if (!cid || !selectedContact?.id) return;
                      try {
                        await api.outreach.campaigns.addContacts(cid, [selectedContact.id]);
                        api.outreach.campaigns.list().then(setOutreachCampaigns).catch(() => {});
                        e.target.value = '';
                        alert('Added to campaign');
                      } catch (err) {
                        alert((err as Error)?.message);
                      }
                    }}
                  >
                    <option value="">+ Add to campaign</option>
                    {outreachCampaigns.map((oc) => (
                      <option key={oc.id} value={oc.id}>{oc.name} ({oc.type})</option>
                    ))}
                  </select>
                  <button
                    onClick={verifyEmail}
                    className="px-2 py-1 rounded text-xs bg-pale-sky/50 hover:bg-pale-sky"
                  >
                    Verify email
                  </button>
                  {emailVerified !== null && (
                    <span className={`text-xs ${emailVerified ? 'text-green-600' : 'text-red-600'}`}>
                      {emailVerified ? 'Valid' : 'Invalid'}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-white border border-pale-sky rounded-xl p-6">
                <h3 className="font-semibold text-deep-navy mb-4">Profile Analysis</h3>
                {profile ? (
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="font-medium text-slate-600">Value proposition:</span>
                      <p className="text-slate-800">{profile.value_proposition}</p>
                    </div>
                    <div>
                      <span className="font-medium text-slate-600">Role summary:</span>
                      <p className="text-slate-800">{profile.role_summary}</p>
                    </div>
                    <div>
                      <span className="font-medium text-slate-600">Online sentiment:</span>
                      <p className="text-slate-800">{profile.online_sentiment}</p>
                    </div>
                    <div>
                      <span className="font-medium text-slate-600">Receptiveness:</span>
                      <p className="text-slate-800 whitespace-pre-wrap">{profile.receptiveness_notes}</p>
                    </div>
                    <button
                      onClick={refreshProfile}
                      disabled={loading}
                      className="mt-2 px-3 py-1 rounded bg-pale-sky/50 text-sm hover:bg-pale-sky"
                    >
                      {loading ? 'Refreshing...' : 'Refresh analysis'}
                    </button>
                  </div>
                ) : (
                  <p className="text-slate-500">Loading profile...</p>
                )}
              </div>
              <div className="space-y-6">
              <div className="bg-white border border-pale-sky rounded-xl p-6">
                <h3 className="font-semibold text-deep-navy mb-4">Notes</h3>
                <div className="flex gap-2 mb-4">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add a note..."
                    className="flex-1 px-3 py-2 rounded-lg border border-pale-sky text-sm"
                    rows={2}
                  />
                  <button
                    onClick={addNote}
                    disabled={!newNote.trim()}
                    className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white text-sm font-medium disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <ul className="space-y-2 max-h-40 overflow-y-auto">
                  {notes.map((n) => (
                    <li key={n.id} className="text-sm py-2 border-b border-pale-sky last:border-0">
                      {n.note}
                      <span className="text-xs text-slate-400 ml-2">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white border border-pale-sky rounded-xl p-6">
                <h3 className="font-semibold text-deep-navy mb-4">Activity Log</h3>
                <div className="flex gap-2 mb-4 flex-wrap">
                  <select
                    value={newActivityType}
                    onChange={(e) => setNewActivityType(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-pale-sky text-sm"
                  >
                    <option value="email_sent">Email sent</option>
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                    <option value="replied">Replied</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    value={newActivityDetails}
                    onChange={(e) => setNewActivityDetails(e.target.value)}
                    placeholder="Details (optional)"
                    className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border border-pale-sky text-sm"
                  />
                  <button
                    onClick={addActivity}
                    className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white text-sm font-medium"
                  >
                    Log
                  </button>
                </div>
                <ul className="space-y-2 max-h-32 overflow-y-auto">
                  {activities.map((a) => (
                    <li key={a.id} className="text-sm py-2 border-b border-pale-sky last:border-0">
                      <span className="font-medium capitalize">{a.activity_type.replace('_', ' ')}</span>
                      {a.details && ` — ${a.details}`}
                      <span className="text-xs text-slate-400 ml-2">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              </div>
              </div>
            </>
            ) : (
              <div className="bg-white border border-pale-sky rounded-xl p-12 text-center">
                <p className="text-slate-500">Select a contact from the pipeline board above to view profile, notes, and activity.</p>
              </div>
            )
          )}
          {activeTab === 'templates' && (
            <div className="bg-white border border-pale-sky rounded-xl p-6">
              <h3 className="font-semibold text-deep-navy mb-4">New Template</h3>
              <p className="text-sm text-slate-600 mb-4">
                Use {'{first}'}, {'{last}'}, {'{company}'}, {'{title}'} for merge fields.
              </p>
              <div className="space-y-3">
                <input
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Template name"
                  className="w-full px-3 py-2 rounded-lg border border-pale-sky"
                />
                <input
                  value={templateForm.industry}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, industry: e.target.value }))}
                  placeholder="Industry (optional)"
                  className="w-full px-3 py-2 rounded-lg border border-pale-sky"
                />
                <input
                  value={templateForm.subject}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, subject: e.target.value }))}
                  placeholder="Subject"
                  className="w-full px-3 py-2 rounded-lg border border-pale-sky"
                />
                <textarea
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, body: e.target.value }))}
                  placeholder="Body"
                  className="w-full px-3 py-2 rounded-lg border border-pale-sky"
                  rows={6}
                />
                <button
                  onClick={saveTemplate}
                  disabled={loading || !templateForm.name || !templateForm.subject || !templateForm.body}
                  className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>
          )}
          {activeTab === 'sequences' && (
            <div className="bg-white border border-pale-sky rounded-xl p-6">
              <h3 className="font-semibold text-deep-navy mb-4">New Follow-up Sequence</h3>
              <p className="text-sm text-slate-600 mb-4">
                Define automated follow-ups (e.g. Day 3, Day 7). Use with campaigns.
              </p>
              <div className="space-y-4">
                <input
                  value={sequenceForm.name}
                  onChange={(e) => setSequenceForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Sequence name"
                  className="w-full px-3 py-2 rounded-lg border border-pale-sky"
                />
                {sequenceForm.steps.map((step, i) => (
                  <div key={i} className="p-4 border border-pale-sky rounded-lg space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={step.days_after}
                        onChange={(e) =>
                          setSequenceForm((p) => ({
                            ...p,
                            steps: p.steps.map((s, j) =>
                              j === i ? { ...s, days_after: parseInt(e.target.value) || 0 } : s
                            ),
                          }))
                        }
                        placeholder="Days after"
                        className="w-24 px-3 py-2 rounded-lg border border-pale-sky"
                      />
                      <input
                        value={step.subject}
                        onChange={(e) =>
                          setSequenceForm((p) => ({
                            ...p,
                            steps: p.steps.map((s, j) => (j === i ? { ...s, subject: e.target.value } : s)),
                          }))
                        }
                        placeholder="Subject"
                        className="flex-1 px-3 py-2 rounded-lg border border-pale-sky"
                      />
                    </div>
                    <textarea
                      value={step.body}
                      onChange={(e) =>
                        setSequenceForm((p) => ({
                          ...p,
                          steps: p.steps.map((s, j) => (j === i ? { ...s, body: e.target.value } : s)),
                        }))
                      }
                      placeholder="Body"
                      className="w-full px-3 py-2 rounded-lg border border-pale-sky"
                      rows={3}
                    />
                  </div>
                ))}
                <button
                  onClick={() =>
                    setSequenceForm((p) => ({
                      ...p,
                      steps: [...p.steps, { days_after: 7, subject: '', body: '' }],
                    }))
                  }
                  className="text-sm text-[#1a2f5a] hover:underline"
                >
                  + Add step
                </button>
                <button
                  onClick={saveSequence}
                  disabled={loading || !sequenceForm.name}
                  className="block px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Sequence'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
