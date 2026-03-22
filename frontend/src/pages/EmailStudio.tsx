import { useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { loadDrafts, saveDraft, deleteDraft, type EmailDraft } from '../lib/emailDrafts';

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

function CompanyFolder({ company, contacts, selected, onSelect }: {
  company: string; contacts: any[]; selected: any; onSelect: (c: any) => void;
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
        <div className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors ${
                selected?.id === c.id ? 'bg-pale-sky/50 border-l-4 border-l-deep-navy' : ''
              }`}
            >
              <div className="font-medium text-slate-800 text-xs truncate">{c.name || c.email}</div>
              <div className="text-xs text-slate-600 truncate">{c.title}{c.company ? ` • ${c.company}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EmailStudio() {
  const { user } = useOutletContext<{ user: { email: string; name?: string } }>();
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [email, setEmail] = useState<{ subject: string; body: string } | null>(null);
  const [signature, setSignature] = useState('');
  const [signatureImageUrl, setSignatureImageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [tone, setTone] = useState('professional');
  const [length, setLength] = useState('short');
  const [angle, setAngle] = useState('pain_point');
  const [valueProp, setValueProp] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [generatedEmails, setGeneratedEmails] = useState<any[]>([]);
  const [sortBy, setSortBy] = useState('created_desc');
  const [activeTab, setActiveTab] = useState<'editor' | 'cache'>('editor');
  const [quickCompose, setQuickCompose] = useState({ name: '', company: '', title: '', email: '' });
  const [emailFontSize, setEmailFontSize] = useState(14);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTargetAudience, setDraftTargetAudience] = useState('');
  const [draftCompany, setDraftCompany] = useState('');
  const [sentimentAnalysis, setSentimentAnalysis] = useState<any>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentIndustry, setSentimentIndustry] = useState('');
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [attachmentLibrary, setAttachmentLibrary] = useState<any[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<number>>(new Set());
  const [groupByCompany, setGroupByCompany] = useState(false);
  const [contactsPanelExpanded, setContactsPanelExpanded] = useState(true);
  const [aiGeneratorExpanded, setAiGeneratorExpanded] = useState(true);
  const [contactSearch, setContactSearch] = useState('');

  useEffect(() => {
    api.settings.get().then((s: any) => {
      setSignature(s.signature || '');
      setSignatureImageUrl(s.signature_image_url || '');
      setAttachmentsEnabled(s.attachments_enabled === '1' || s.attachments_enabled === true);
    }).catch(() => {});
    setDrafts(loadDrafts());
  }, []);

  useEffect(() => {
    const params = contactSearch.trim() ? { q: contactSearch.trim() } : {};
    api.contacts.list(params).then(setContacts).catch(() => setContacts([]));
  }, [contactSearch]);

  useEffect(() => {
    if (attachmentsEnabled) {
      api.attachments.list().then(setAttachmentLibrary).catch(() => setAttachmentLibrary([]));
    } else {
      setAttachmentLibrary([]);
      setSelectedAttachmentIds(new Set());
    }
  }, [attachmentsEnabled]);

  useEffect(() => {
    api.emails.generated({ sort: sortBy }).then(setGeneratedEmails).catch(() => setGeneratedEmails([]));
  }, [sortBy, email]);

  // Sync contentEditable body when email.body is set externally (e.g. Generate, Load Draft)
  useEffect(() => {
    if (bodyRef.current != null && email?.body !== undefined && bodyRef.current.innerHTML !== email.body) {
      bodyRef.current.innerHTML = email.body;
    }
  }, [email?.body]);

  const refreshDrafts = () => setDrafts(loadDrafts());

  const generateEmail = async () => {
    setLoading(true);
    setEmail(null);
    try {
      if (selected?.id) {
        const instructions = [
          draftDescription && `Email purpose: ${draftDescription}`,
          draftTargetAudience && `Target audience: ${draftTargetAudience}`,
          customInstructions,
        ].filter(Boolean).join('. ');
        const res = await api.emails.generate({
          contact_id: selected.id,
          tone,
          length,
          angle,
          value_proposition: valueProp || undefined,
          custom_instructions: instructions || customInstructions || undefined,
        });
        setEmail({ subject: res.subject, body: res.body });
        api.emails.generated({ sort: sortBy }).then(setGeneratedEmails).catch(() => []);
      } else {
        const instructions = [
          draftDescription && `Email purpose: ${draftDescription}`,
          draftTargetAudience && `Target audience: ${draftTargetAudience}`,
          customInstructions,
        ].filter(Boolean).join('. ');
        const res = await api.emails.generateTemplate({
          name: quickCompose.name || undefined,
          company: draftCompany || quickCompose.company || undefined,
          title: quickCompose.title || undefined,
          email: quickCompose.email || undefined,
          tone,
          length,
          angle,
          value_proposition: valueProp || undefined,
          custom_instructions: instructions || customInstructions || undefined,
        });
        setEmail({ subject: res.subject, body: res.body });
        setSelected({
          id: null,
          name: quickCompose.name || 'Recipient',
          email: quickCompose.email || '',
          company: draftCompany || quickCompose.company,
        });
      }
    } catch (e) {
      console.error(e);
      setEmail({ subject: 'Error', body: 'Failed to generate. Is Ollama running? Try: ollama run llama3.2' });
    } finally {
      setLoading(false);
    }
  };

  const saveCurrentAsDraft = () => {
    if (!email?.subject && !email?.body) return;
    saveDraft({
      description: draftDescription || 'Untitled draft',
      targetAudience: draftTargetAudience,
      company: draftCompany || (selected?.company ?? quickCompose.company),
      subject: email.subject,
      body: email.body,
      recipientName: selected?.name ?? quickCompose.name,
      recipientEmail: selected?.email ?? quickCompose.email,
      recipientTitle: selected?.title ?? quickCompose.title,
    });
    refreshDrafts();
    setSelectedDraftId(null);
  };

  const loadDraftIntoEditor = (d: EmailDraft) => {
    setSelectedDraftId(d.id);
    setEmail({ subject: d.subject, body: d.body });
    setDraftDescription(d.description);
    setDraftTargetAudience(d.targetAudience);
    setDraftCompany(d.company);
    setQuickCompose({
      name: d.recipientName,
      company: d.company,
      title: d.recipientTitle,
      email: d.recipientEmail,
    });
    setSelected(d.recipientEmail ? { id: null, name: d.recipientName, email: d.recipientEmail, company: d.company } : null);
  };

  const analyzeSentiment = async () => {
    if (!email?.subject && !email?.body) return;
    setSentimentLoading(true);
    setSentimentAnalysis(null);
    try {
      const res = await api.outreach.sentiment.analyze({
        subject: email?.subject || '',
        body: email?.body || '',
        industry: sentimentIndustry || undefined,
        target_role: selected?.title || undefined,
      });
      setSentimentAnalysis(res);
    } catch (e) {
      setSentimentAnalysis({ error: (e as Error)?.message || 'Analysis failed' });
    } finally {
      setSentimentLoading(false);
    }
  };

  const testSend = async () => {
    if (!email?.body) return;
    const toEmail = user?.email;
    if (!toEmail) return;
    setTestSending(true);
    try {
      await api.emails.testSend({
        to_email: toEmail,
        subject: email.subject,
        body: email.body,
        attachment_ids: selectedAttachmentIds.size > 0 ? Array.from(selectedAttachmentIds) : undefined,
      });
      alert(`Test email sent to ${toEmail}. Check your inbox to verify delivery.`);
    } catch (e: any) {
      alert(e?.message || 'Failed to send. Try signing out and back in to re-authorize Gmail.');
    } finally {
      setTestSending(false);
    }
  };

  const startNewEmail = () => {
    setSelected(null);
    setEmail({ subject: '', body: '' });
    setQuickCompose({ name: '', company: '', title: '', email: '' });
    setDraftDescription('');
    setDraftTargetAudience('');
    setDraftCompany('');
    setSelectedDraftId(null);
    setSelectedAttachmentIds(new Set());
    setActiveTab('editor');
    document.getElementById('email-generator-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleAttachment = (id: number) => {
    setSelectedAttachmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const previewBody = email
    ? (signature ? `${email.body.trim()}\n\n--\n\n${signature}` : email.body)
    : '';
  const signatureHtmlPart = !signature
    ? ''
    : signature.includes('<') && signature.includes('>')
      ? `<br><br>--<br><br>${signature}`
      : `<br><br>--<br><br>${signature.replace(/\n/g, '<br>')}`;
  const previewBodyHtml = email?.body
    ? email.body + signatureHtmlPart + (signatureImageUrl ? `<br><img src="${signatureImageUrl}" alt="" style="max-width:200px;height:auto;" />` : '')
    : '';
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div className="w-full max-w-[1920px] mx-auto">
      <h1 className="text-2xl font-bold text-deep-navy mb-6">Email Studio</h1>
      <div className="flex flex-col xl:flex-row gap-4">
        <div className={`bg-white dark:bg-[var(--bg-card)] border border-slate-200 dark:border-slate-600 shadow-sm rounded-xl overflow-hidden flex-shrink-0 transition-[width] duration-200 ${contactsPanelExpanded ? 'w-full xl:w-[260px]' : 'w-full xl:w-14'}`}>
          {contactsPanelExpanded ? (
            <>
              <div className="px-4 py-3 border-b border-slate-200 flex gap-2 flex-wrap items-center">
                <button
                  onClick={() => setContactsPanelExpanded(false)}
                  className="p-1.5 rounded text-slate-500 hover:bg-pale-sky/30 hover:text-deep-navy shrink-0"
                  title="Collapse panel"
                  aria-label="Collapse contacts panel"
                >
                  ◀
                </button>
                <button
                  onClick={() => setActiveTab('editor')}
                  className={`flex-1 min-w-0 py-2 rounded text-sm font-medium ${activeTab === 'editor' ? 'bg-pale-sky/50 text-deep-navy' : 'text-slate-600'}`}
                >
                  Contacts
                </button>
                <button
                  onClick={() => setActiveTab('cache')}
                  className={`flex-1 min-w-0 py-2 rounded text-sm font-medium ${activeTab === 'cache' ? 'bg-pale-sky/50 text-deep-navy' : 'text-slate-600'}`}
                >
                  Generated
                </button>
                <button
                  onClick={startNewEmail}
                  className="px-3 py-2 rounded text-sm font-medium bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white active:scale-[0.98] transition-all shrink-0"
                >
                  + New
                </button>
              </div>
              <div className="max-h-[calc(100vh-14rem)] overflow-y-auto">
            {activeTab === 'editor' ? (
              <>
                <div className="px-4 py-2 border-b border-slate-200">
                  <input
                    type="search"
                    placeholder="Search contacts... (press /)"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-200 text-sm"
                    aria-label="Search contacts"
                    data-search-input
                  />
                </div>
              {contacts.length === 0 ? (
                <div className="p-4">
                  <p className="text-slate-600 text-sm mb-3">{contactSearch.trim() ? 'No contacts match your search.' : 'No contacts yet. Use Quick Compose in the generator to create emails.'}</p>
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                    <label className="text-xs text-slate-600">Group By Company</label>
                    <input
                      type="checkbox"
                      checked={groupByCompany}
                      onChange={(e) => setGroupByCompany(e.target.checked)}
                      className="rounded"
                    />
                  </div>
                  {groupByCompany ? (
                    <div className="p-2 space-y-2">
                      {groupContactsByCompany(contacts).map(({ company, contacts: companyContacts }) => (
                        <CompanyFolder
                          key={company}
                          company={company}
                          contacts={companyContacts}
                          selected={selected}
                          onSelect={(c) => {
                            setSelected(c);
                            setEmail(null);
                            setSelectedDraftId(null);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelected(c);
                          setEmail(null);
                          setSelectedDraftId(null);
                        }}
                        className={`w-full text-left px-3 py-2 border-b border-slate-200/50 hover:bg-slate-50 transition-colors ${
                          selected?.id === c.id ? 'bg-pale-sky/50 border-l-4 border-l-deep-navy' : ''
                        }`}
                      >
                        <div className="font-medium text-slate-800 text-xs truncate">{c.name || c.email}</div>
                        <div className="text-xs text-slate-600 truncate">{c.title}{c.company ? ` • ${c.company}` : ''}</div>
                      </button>
                    ))
                  )}
                </>
              )}
              </>
            ) : (
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-sm text-slate-600">Sort:</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="text-sm px-2 py-1 rounded bg-white border border-slate-300"
                  >
                    <option value="created_desc">Newest First</option>
                    <option value="created_asc">Oldest First</option>
                    <option value="contact">By Contact</option>
                  </select>
                </div>
                {generatedEmails.length === 0 ? (
                  <p className="text-slate-600 text-sm">No cached emails yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {generatedEmails.map((ge) => (
                      <li
                        key={ge.id}
                        className="p-2 rounded border border-pale-sky hover:bg-pale-sky/30 cursor-pointer"
                        onClick={() => {
                          setSelected({ id: ge.contact_id, name: ge.name, email: ge.email, company: ge.company });
                          setEmail({ subject: ge.subject, body: ge.body });
                          setActiveTab('editor');
                        }}
                      >
                        <div className="font-medium text-sm">{ge.name || ge.email}</div>
                        <div className="text-xs text-slate-500 truncate">{ge.subject}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center py-4 xl:py-6 gap-2">
              <button
                onClick={() => setContactsPanelExpanded(true)}
                className="p-2 rounded text-slate-500 hover:bg-pale-sky/30 hover:text-deep-navy"
                title="Expand panel"
                aria-label="Expand contacts panel"
              >
                ▶
              </button>
              <span className="text-xs text-slate-500 hidden xl:block" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                Contacts
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 flex min-w-0 gap-4">
          <div
            id="email-generator-section"
            className={`bg-white dark:bg-[var(--bg-card)] border border-pale-sky dark:border-slate-600 shadow-sm rounded-xl overflow-hidden flex-shrink-0 flex flex-col transition-[width] duration-200 ${aiGeneratorExpanded ? 'w-full xl:min-w-[380px] xl:w-[42%]' : 'w-full xl:w-14'}`}
          >
            {aiGeneratorExpanded ? (
            <>
            <div className="email-generator-header px-4 py-3 border-b border-pale-sky dark:border-slate-600 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setAiGeneratorExpanded(false)}
                className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-600 shrink-0"
                title="Collapse panel"
                aria-label="Collapse AI generator panel"
              >
                ◀
              </button>
              <h2 className="font-semibold text-deep-navy dark:text-[var(--text-primary)]">AI Email Generator</h2>
            </div>
            <div className="p-6 overflow-y-auto flex-1 min-h-0 max-h-[calc(100vh-16rem)]">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Describe the email, set the audience, and assign a company. Then use Quick Compose or select a contact.
            </p>
            <div className="space-y-3 mb-4">
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">What Does This Email Do?</label>
                <input
                  type="text"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="e.g. Cold outreach for consulting services"
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Target Audience</label>
                <input
                  type="text"
                  value={draftTargetAudience}
                  onChange={(e) => setDraftTargetAudience(e.target.value)}
                  placeholder="e.g. CTOs at mid-size tech companies"
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Assign Company</label>
                <input
                  type="text"
                  value={draftCompany}
                  onChange={(e) => setDraftCompany(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
            </div>
            <div className="border-t border-pale-sky dark:border-slate-600 pt-4 mb-4">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Quick Compose (Recipient for AI)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Name"
                  value={quickCompose.name}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, name: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-sm placeholder-slate-400 dark:placeholder-slate-500"
                />
                <input
                  type="email"
                  placeholder="Email (for test send)"
                  value={quickCompose.email}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, email: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-sm placeholder-slate-400 dark:placeholder-slate-500"
                />
                <input
                  type="text"
                  placeholder="Company"
                  value={quickCompose.company}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, company: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-sm placeholder-slate-400 dark:placeholder-slate-500"
                />
                <input
                  type="text"
                  placeholder="Title"
                  value={quickCompose.title}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, title: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-sm placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200"
                >
                  {['professional', 'conversational', 'bold', 'empathetic', 'authority'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Length</label>
                <select
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200"
                >
                  {['ultra-short', 'short', 'standard'].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Angle</label>
                <select
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200"
                >
                  {['pain_point', 'social_proof', 'case_study', 'question_hook', 'compliment'].map((a) => (
                    <option key={a} value={a}>{a.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Value Proposition</label>
                <input
                  type="text"
                  value={valueProp}
                  onChange={(e) => setValueProp(e.target.value)}
                  placeholder="e.g. our solution that helps companies like yours..."
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Custom Instructions</label>
                <input
                  type="text"
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g. mention our Series B"
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
            </div>
            <button
              onClick={generateEmail}
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-[#1a2f5a] hover:bg-[#1e3a6e] dark:bg-[var(--accent)] dark:hover:bg-[var(--accent-hover)] active:scale-[0.98] text-white font-semibold disabled:opacity-50 transition-all"
            >
              {loading ? 'Generating With Ollama...' : 'Generate Email'}
            </button>
            </div>
            </>
            ) : (
            <div className="flex flex-col items-center py-4 xl:py-6 gap-2">
              <button
                type="button"
                onClick={() => setAiGeneratorExpanded(true)}
                className="p-2 rounded text-slate-500 hover:bg-pale-sky/30 dark:hover:bg-slate-600/50"
                title="Expand panel"
                aria-label="Expand AI generator panel"
              >
                ▶
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400 hidden xl:block" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                AI Generator
              </span>
            </div>
            )}
          </div>
          <div id="email-editor-section" className="flex-1 min-w-0 bg-white dark:bg-[var(--bg-card)] border border-pale-sky dark:border-slate-600 shadow-sm rounded-xl overflow-hidden overflow-y-auto max-h-[calc(100vh-12rem)]">
            <h2 className="font-semibold text-deep-navy dark:text-[var(--text-primary)] p-4 border-b border-pale-sky dark:border-slate-600 truncate" title={`Email for ${selected?.name || quickCompose.name || 'Recipient'} (${selected?.email || quickCompose.email || 'enter email for test send'})`}>
              Email for {selected?.name || quickCompose.name || 'Recipient'} ({selected?.email || quickCompose.email || 'enter email for test send'})
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-pale-sky dark:divide-slate-600 min-w-0">
              <div className="p-4 min-w-0 email-studio-editor-column bg-white dark:bg-[var(--bg-card)]">
                <h3 className="text-sm font-medium text-deep-navy dark:text-slate-400 mb-2">Live Editor</h3>
                {/* Text formatting toolbar - white in light mode */}
                <div className="email-studio-block flex flex-wrap items-center gap-1 mb-2 p-2 rounded-lg border dark:bg-slate-700/50 dark:border-slate-600">
                  <button type="button" onClick={() => document.execCommand('bold')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] font-bold text-sm" title="Bold">B</button>
                  <button type="button" onClick={() => document.execCommand('italic')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] italic text-sm" title="Italic">I</button>
                  <button type="button" onClick={() => document.execCommand('underline')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] underline text-sm" title="Underline">U</button>
                  <button type="button" onClick={() => document.execCommand('strikeThrough')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] line-through text-sm" title="Strikethrough">S</button>
                  <span className="w-px h-5 bg-slate-300 dark:bg-slate-500 mx-1" />
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'h2')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm font-semibold" title="Heading 2">H2</button>
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'h3')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm font-semibold" title="Heading 3">H3</button>
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'blockquote')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm border-l-2 border-slate-400 dark:border-slate-500 pl-1" title="Blockquote">"</button>
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'pre')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-xs" title="Code block">{"</>"}</button>
                  <button type="button" onClick={() => document.execCommand('insertUnorderedList')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm" title="Bullet list">• List</button>
                  <button type="button" onClick={() => document.execCommand('insertOrderedList')} className="px-2 py-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm" title="Numbered list">1. List</button>
                  <span className="w-px h-5 bg-slate-300 dark:bg-slate-500 mx-1" />
                  <input type="color" defaultValue="#000000" onInput={(e) => { document.execCommand('foreColor', false, (e.target as HTMLInputElement).value); }} className="w-7 h-7 rounded border border-slate-300 dark:border-slate-500 cursor-pointer p-0" title="Text color" />
                  <input type="color" defaultValue="#ffff00" onInput={(e) => { document.execCommand('backColor', false, (e.target as HTMLInputElement).value); }} className="w-7 h-7 rounded border border-slate-300 dark:border-slate-500 cursor-pointer p-0" title="Highlight" />
                  <span className="w-px h-5 bg-slate-300 dark:bg-slate-500 mx-1" />
                  <select
                    value={emailFontSize}
                    onChange={(e) => { const s = Number(e.target.value); setEmailFontSize(s); if (bodyRef.current) bodyRef.current.style.fontSize = s + 'px'; }}
                    className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-sm bg-white dark:bg-slate-700 text-deep-navy dark:text-[var(--text-primary)]"
                  >
                    {[12, 14, 16, 18, 20, 24].map((s) => (
                      <option key={s} value={s}>{s}px</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-4">
                  <div className="min-w-0">
                    <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Subject</label>
                    <input
                      type="text"
                      value={email?.subject ?? ''}
                      onChange={(e) => setEmail((prev) => ({ ...(prev || { subject: '', body: '' }), subject: e.target.value }))}
                      placeholder="Enter subject line..."
                      className="email-studio-input w-full min-w-0 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-500"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Body</label>
                    <div className="relative min-w-0">
                    <div
                      ref={bodyRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(e) => setEmail((prev) => ({ ...(prev || { subject: '', body: '' }), body: (e.target as HTMLDivElement).innerHTML }))}
                      style={{ fontFamily: "'Lato', system-ui, sans-serif", fontSize: emailFontSize }}
                      className="email-studio-body min-h-[280px] w-full px-3 py-2 rounded-lg border border-slate-300 resize-y overflow-auto focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-0 dark:border-slate-600 dark:focus:ring-offset-transparent"
                    />
                    {(!email?.body || email.body === '' || (email.body.replace(/<[^>]*>/g, '').trim() === '')) && (
                      <span className="absolute left-3 top-2 text-deep-navy/50 dark:text-slate-500 pointer-events-none text-sm">
                        Type your email here or click Generate Email for AI assistance.
                      </span>
                    )}
                  </div>
                  </div>
                  {attachmentsEnabled && (
                    <div className="email-studio-block w-full p-3 rounded-lg border dark:border-slate-600">
                      <h4 className="text-sm font-medium text-deep-navy dark:text-[var(--text-primary)] mb-2">Attachments</h4>
                      <p className="text-xs text-deep-navy/80 dark:text-slate-400 mb-2">Select files to include with this email (intro PDFs, past workstreams, etc.)</p>
                      {attachmentLibrary.length === 0 ? (
                        <p className="text-xs text-deep-navy/70 dark:text-slate-400">No attachments in library. Admins can upload in Profile → Settings.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {attachmentLibrary.map((a) => (
                            <label
                              key={a.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                                selectedAttachmentIds.has(a.id)
                                  ? 'border-deep-navy dark:border-[var(--accent)] bg-pale-sky/30 dark:bg-slate-600/50 text-deep-navy dark:text-[var(--text-primary)]'
                                  : 'border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600/50 text-deep-navy dark:text-slate-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedAttachmentIds.has(a.id)}
                                onChange={() => toggleAttachment(a.id)}
                                className="rounded"
                              />
                              <span className="truncate max-w-[180px]" title={a.display_name || a.filename}>
                                {a.display_name || a.filename}
                              </span>
                              {a.file_size && (
                                <span className="text-xs text-slate-500">
                                  ({(a.file_size / 1024).toFixed(1)} KB)
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                      {selectedAttachmentIds.size > 0 && (
                        <p className="text-xs text-deep-navy/80 dark:text-slate-400 mt-2">{selectedAttachmentIds.size} file(s) will be attached</p>
                      )}
                      <div className="mt-3 pt-3 border-t border-pale-sky/50 dark:border-slate-600 flex flex-wrap gap-2 items-center">
                        <span className="text-xs text-deep-navy dark:text-slate-400">Cloud:</span>
                        <button type="button" disabled className="text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600 text-deep-navy/70 dark:text-slate-400 cursor-not-allowed" title="Coming Soon">Insert From Google Drive</button>
                        <button type="button" disabled className="text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600 text-deep-navy/70 dark:text-slate-400 cursor-not-allowed" title="Coming Soon">Insert From OneDrive</button>
                        <span className="text-xs text-deep-navy/60 dark:text-slate-400">(Coming Soon)</span>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap items-center">
                    <button
                      onClick={saveCurrentAsDraft}
                      disabled={!email?.subject && !email?.body}
                      className="px-4 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] dark:bg-[var(--accent)] dark:hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      Save Draft
                    </button>
                    <button
                      onClick={analyzeSentiment}
                      disabled={sentimentLoading || (!email?.subject && !email?.body)}
                      className="px-4 py-2 rounded-lg bg-[#1e3a6e] hover:bg-[#1a2f5a] dark:bg-[var(--accent-hover)] dark:hover:bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      {sentimentLoading ? 'Analyzing...' : 'Analyze Sentiment'}
                    </button>
                    <input
                      type="text"
                      value={sentimentIndustry}
                      onChange={(e) => setSentimentIndustry(e.target.value)}
                      placeholder="Industry (optional)"
                      className="w-32 px-2 py-1.5 rounded-lg border border-pale-sky dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm placeholder-slate-400 dark:placeholder-slate-500"
                    />
                    <button
                      onClick={testSend}
                      disabled={testSending || !email?.body}
                      className="px-4 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] dark:bg-[var(--accent)] dark:hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      {testSending ? 'Sending...' : 'Email Tester'}
                    </button>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Sends to {user?.email || 'your email'} to verify delivery
                    </span>
                  </div>
                  {sentimentAnalysis && (
                    <div className="mt-4 p-4 rounded-lg border border-pale-sky dark:border-slate-600 bg-pale-sky/20 dark:bg-slate-700/30">
                      <h4 className="font-medium text-deep-navy dark:text-[var(--text-primary)] mb-2">Sentiment Analysis</h4>
                      {sentimentAnalysis.error ? (
                        <p className="text-red-600 dark:text-red-400 text-sm">{sentimentAnalysis.error}</p>
                      ) : (
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-slate-600 dark:text-slate-400">Score:</span>{' '}
                            <span className="font-medium">{(sentimentAnalysis.sentiment_score ?? 0).toFixed(2)}</span>
                            <span className="text-slate-500 ml-2">({sentimentAnalysis.sentiment_label})</span>
                          </div>
                          {sentimentAnalysis.industry_fit && (
                            <div>
                              <span className="text-slate-600">Industry fit:</span>{' '}
                              <span className="text-slate-800">{sentimentAnalysis.industry_fit}</span>
                            </div>
                          )}
                          {sentimentAnalysis.suggested_improvements && (
                            <div>
                              <span className="text-slate-600">Suggestions:</span>
                              <p className="text-slate-800 whitespace-pre-wrap mt-1">{sentimentAnalysis.suggested_improvements}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="p-4 bg-pale-sky/30 min-w-0">
                <h3 className="text-sm font-medium text-slate-600 mb-2 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-steel-blue animate-pulse" />
                  Live Gmail Preview
                </h3>
                <div className="bg-white rounded-lg shadow-sm border border-pale-sky overflow-hidden min-h-[280px]">
                  <div className="bg-white px-4 py-2 border-b border-pale-sky flex items-center gap-2">
                    <span className="text-slate-400 text-xs">←</span>
                    <span className="text-slate-400 text-xs">Archive</span>
                    <span className="text-slate-400 text-xs">Report spam</span>
                    <span className="text-slate-400 text-xs">Delete</span>
                    <span className="text-slate-400 text-xs ml-auto">Mark as read</span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-pale-sky flex items-center justify-center text-deep-navy font-bold text-sm shrink-0">
                        Y
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800">YUCG Outreach</span>
                          <span className="text-slate-500 text-sm">&lt;you@gmail.com&gt;</span>
                        </div>
                        <div className="text-slate-500 text-sm mt-0.5">to me</div>
                      </div>
                      <div className="text-slate-400 text-xs shrink-0">
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="text-lg font-medium text-slate-800 mb-3 border-b border-slate-100 pb-2">
                      {email?.subject || 'No subject'}
                    </div>
                    <div
                      className="text-slate-700 leading-relaxed prose prose-sm max-w-none"
                      style={{
                        fontFamily: "'Lato', system-ui, sans-serif",
                        fontSize: `${emailFontSize}px`,
                      }}
                    >
                      {email?.body && /<[a-z][\s\S]*>/i.test(email.body) ? (
                        <div dangerouslySetInnerHTML={{ __html: previewBodyHtml || '' }} />
                      ) : (
                        <span className="whitespace-pre-wrap">{previewBody || 'Start typing above or generate with AI to see a live preview.'}</span>
                      )}
                    </div>
                    {signatureImageUrl && (
                      <img src={signatureImageUrl} alt="" className="mt-2 max-h-16 object-contain" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 w-full">
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-pale-sky">
            <h2 className="font-semibold text-deep-navy">Saved Drafts</h2>
            <p className="text-xs text-slate-500 mt-0.5">Stored locally in your browser</p>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-4">
            {drafts.length === 0 ? (
              <p className="text-slate-500 text-sm">No drafts yet. Generate an email and click Save Draft.</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    className={`p-4 rounded-lg border cursor-pointer transition-colors min-w-0 ${
                      selectedDraftId === d.id
                        ? 'border-deep-navy bg-pale-sky/50'
                        : 'border-pale-sky hover:bg-pale-sky/30'
                    }`}
                  >
                    <button
                      onClick={() => loadDraftIntoEditor(d)}
                      className="w-full text-left min-w-0"
                    >
                      <div className="font-medium text-sm text-slate-800 break-words">{d.description || 'Untitled'}</div>
                      <div className="text-xs text-slate-500 mt-1">{d.targetAudience || '—'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Company: {d.company || '—'}</div>
                      <div className="text-xs text-slate-400 mt-1 break-words">{d.subject}</div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Delete this draft?')) {
                          deleteDraft(d.id);
                          refreshDrafts();
                          if (selectedDraftId === d.id) startNewEmail();
                        }
                      }}
                      className="mt-2 text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
