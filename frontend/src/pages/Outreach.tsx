import { useEffect, useState } from 'react';
import { api } from '../api';

const PIPELINE_STATUSES = ['cold', 'contacted', 'replied', 'meeting', 'closed'];

export default function Outreach() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'templates' | 'sequences'>('pipeline');
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

  useEffect(() => {
    api.contacts.list().then(setContacts).catch(() => setContacts([]));
    api.outreach.templates.list().then(setTemplates).catch(() => setTemplates([]));
    api.outreach.sequences.list().then(setSequences).catch(() => setSequences([]));
    api.outreach.pipelineMetrics().then(setPipelineMetrics).catch(() => setPipelineMetrics(null));
  }, []);

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
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-deep-navy mb-6">Outreach Hub</h1>

      <div className="flex gap-2 mb-6 border-b border-pale-sky">
        {(['pipeline', 'templates', 'sequences'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg font-medium capitalize ${
              activeTab === tab ? 'bg-[#1a2f5a] text-white' : 'bg-pale-sky/30 text-slate-600 hover:bg-pale-sky/50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: List (or full-width pipeline board) */}
        <div className={activeTab === 'pipeline' ? 'lg:col-span-3' : 'lg:col-span-1 space-y-4'}>
          {activeTab === 'pipeline' && (
            <div className="space-y-6">
              {/* Full-width Kanban-style pipeline board */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 min-h-[420px]">
                {PIPELINE_STATUSES.map((status) => {
                  const count = pipelineMetrics?.by_status?.find((s: any) => s.pipeline_status === status)?.count ?? 0;
                  const inStatus = contacts.filter((c) => (c.pipeline_status || 'cold') === status);
                  return (
                    <div
                      key={status}
                      className="bg-white border border-pale-sky rounded-xl flex flex-col overflow-hidden shadow-sm"
                    >
                      <div className="px-4 py-3 border-b border-pale-sky bg-pale-sky/20 flex justify-between items-center">
                        <h3 className="font-semibold text-deep-navy capitalize">{status}</h3>
                        <span className="text-sm font-medium text-slate-600 bg-white px-2 py-0.5 rounded">
                          {inStatus.length}
                        </span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[320px]">
                        {inStatus.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => setSelectedContact(c)}
                            className={`p-3 rounded-lg cursor-pointer border transition-colors ${
                              selectedContact?.id === c.id
                                ? 'border-[#1a2f5a] bg-[#1a2f5a]/5 ring-1 ring-[#1a2f5a]'
                                : 'border-pale-sky hover:border-[#1e3a6e] hover:bg-pale-sky/10'
                            }`}
                          >
                            <div className="font-medium text-slate-800 truncate text-sm">{c.name || c.email}</div>
                            <div className="text-xs text-slate-500 truncate mt-0.5">{c.company || c.email}</div>
                            <select
                              value={c.pipeline_status || 'cold'}
                              onChange={(e) => {
                                e.stopPropagation();
                                updatePipeline(c.id, e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-2 w-full text-xs px-2 py-1.5 rounded border border-pale-sky bg-white"
                            >
                              {PIPELINE_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                        ))}
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
        <div className={`${activeTab === 'pipeline' ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-6`}>
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
                <div className="flex gap-2 items-center mb-4">
                  <span className="text-sm text-slate-600">{selectedContact.email}</span>
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
                  {loading ? 'Saving...' : 'Save template'}
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
                  {loading ? 'Saving...' : 'Save sequence'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
