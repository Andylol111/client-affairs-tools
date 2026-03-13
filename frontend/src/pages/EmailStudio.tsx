import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { loadDrafts, saveDraft, deleteDraft, type EmailDraft } from '../lib/emailDrafts';

export default function EmailStudio() {
  const { user } = useOutletContext<{ user: { email: string; name?: string } }>();
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [email, setEmail] = useState<{ subject: string; body: string } | null>(null);
  const [signature, setSignature] = useState('');
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
  const [emailFont, setEmailFont] = useState('Lato');
  const [emailFontSize, setEmailFontSize] = useState(14);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTargetAudience, setDraftTargetAudience] = useState('');
  const [draftCompany, setDraftCompany] = useState('');
  const [sentimentAnalysis, setSentimentAnalysis] = useState<any>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentIndustry, setSentimentIndustry] = useState('');

  useEffect(() => {
    api.contacts.list().then(setContacts).catch(() => setContacts([]));
    api.settings.get().then((s) => setSignature(s.signature || '')).catch(() => {});
    setDrafts(loadDrafts());
  }, []);

  useEffect(() => {
    api.emails.generated({ sort: sortBy }).then(setGeneratedEmails).catch(() => setGeneratedEmails([]));
  }, [sortBy, email]);

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
    setActiveTab('editor');
    document.getElementById('email-generator-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  const previewBody = email
    ? (signature ? `${email.body.trim()}\n\n--\n\n${signature}` : email.body)
    : '';

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-deep-navy mb-6">Email Studio</h1>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveTab('editor')}
              className={`flex-1 min-w-0 py-1 rounded text-sm font-medium ${activeTab === 'editor' ? 'bg-pale-sky/50 text-deep-navy' : 'text-slate-600'}`}
            >
              Contacts
            </button>
            <button
              onClick={() => setActiveTab('cache')}
              className={`flex-1 min-w-0 py-1 rounded text-sm font-medium ${activeTab === 'cache' ? 'bg-pale-sky/50 text-deep-navy' : 'text-slate-600'}`}
            >
              Generated
            </button>
            <button
              onClick={startNewEmail}
              className="px-3 py-1 rounded text-sm font-medium bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white active:scale-[0.98] transition-all"
            >
              + New
            </button>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {activeTab === 'editor' ? (
              contacts.length === 0 ? (
                <div className="p-4">
                  <p className="text-slate-600 text-sm mb-3">No contacts yet. Use Quick Compose in the generator to create emails.</p>
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
                    className={`w-full text-left px-4 py-3 border-b border-slate-200/50 hover:bg-slate-50 transition-colors ${
                      selected?.id === c.id ? 'bg-pale-sky/50 border-l-4 border-l-deep-navy' : ''
                    }`}
                  >
                    <div className="font-medium text-slate-800">{c.name || c.email}</div>
                    <div className="text-sm text-slate-600">{c.title} • {c.company}</div>
                  </button>
                ))
              )
            ) : (
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-sm text-slate-600">Sort:</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="text-sm px-2 py-1 rounded bg-white border border-slate-300"
                  >
                    <option value="created_desc">Newest first</option>
                    <option value="created_asc">Oldest first</option>
                    <option value="contact">By contact</option>
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
        </div>
        <div className="lg:col-span-2 space-y-4">
          <div id="email-generator-section" className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy mb-4">AI Email Generator</h2>
            <p className="text-sm text-slate-600 mb-4">
              Describe the email, set the audience, and assign a company. Then use Quick Compose or select a contact.
            </p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">What does this email do?</label>
                <input
                  type="text"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="e.g. Cold outreach for consulting services"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 placeholder-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Target audience</label>
                <input
                  type="text"
                  value={draftTargetAudience}
                  onChange={(e) => setDraftTargetAudience(e.target.value)}
                  placeholder="e.g. CTOs at mid-size tech companies"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 placeholder-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Assign company</label>
                <input
                  type="text"
                  value={draftCompany}
                  onChange={(e) => setDraftCompany(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 placeholder-slate-400"
                />
              </div>
            </div>
            <div className="border-t border-pale-sky pt-4 mb-4">
              <h3 className="text-sm font-medium text-slate-blue mb-2">Quick Compose (recipient for AI)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={quickCompose.name}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, name: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm"
                />
                <input
                  type="email"
                  placeholder="Email (for test send)"
                  value={quickCompose.email}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, email: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm"
                />
                <input
                  type="text"
                  placeholder="Company"
                  value={quickCompose.company}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, company: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm"
                />
                <input
                  type="text"
                  placeholder="Title"
                  value={quickCompose.title}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, title: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
                >
                  {['professional', 'conversational', 'bold', 'empathetic', 'authority'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Length</label>
                <select
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
                >
                  {['ultra-short', 'short', 'standard'].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Angle</label>
                <select
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
                >
                  {['pain_point', 'social_proof', 'case_study', 'question_hook', 'compliment'].map((a) => (
                    <option key={a} value={a}>{a.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Value Proposition</label>
                <input
                  type="text"
                  value={valueProp}
                  onChange={(e) => setValueProp(e.target.value)}
                  placeholder="e.g. our solution that helps companies like yours..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 placeholder-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Custom Instructions</label>
                <input
                  type="text"
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g. mention our Series B"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 placeholder-slate-400"
                />
              </div>
            </div>
            <button
              onClick={generateEmail}
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-[#1a2f5a] hover:bg-[#1e3a6e] active:scale-[0.98] text-white font-semibold disabled:opacity-50 transition-all"
            >
              {loading ? 'Generating with Ollama...' : 'Generate Email'}
            </button>
          </div>
          <div id="email-editor-section" className="bg-white border border-pale-sky shadow-sm rounded-xl overflow-hidden">
            <h2 className="font-semibold text-deep-navy p-4 border-b border-pale-sky">
              Email for {selected?.name || quickCompose.name || 'Recipient'} ({selected?.email || quickCompose.email || 'enter email for test send'})
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-pale-sky">
              <div className="p-4">
                <h3 className="text-sm font-medium text-slate-600 mb-2">Live Editor</h3>
                <div className="flex gap-4 mb-4 flex-wrap">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Email font</label>
                    <select
                      value={emailFont}
                      onChange={(e) => setEmailFont(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-white border border-slate-300 text-sm"
                    >
                      {['Lato', 'Open Sans', 'Roboto', 'Georgia', 'Times New Roman', 'Arial', 'Helvetica', 'Verdana', 'Courier New'].map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Font size</label>
                    <select
                      value={emailFontSize}
                      onChange={(e) => setEmailFontSize(Number(e.target.value))}
                      className="px-2 py-1.5 rounded-lg bg-white border border-slate-300 text-sm"
                    >
                      {[12, 14, 16, 18, 20, 24].map((s) => (
                        <option key={s} value={s}>{s}px</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Subject</label>
                    <input
                      type="text"
                      value={email?.subject ?? ''}
                      onChange={(e) => setEmail((prev) => ({ ...(prev || { subject: '', body: '' }), subject: e.target.value }))}
                      placeholder="Enter subject line..."
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Body</label>
                    <textarea
                      value={email?.body ?? ''}
                      onChange={(e) => setEmail((prev) => ({ ...(prev || { subject: '', body: '' }), body: e.target.value }))}
                      rows={10}
                      placeholder="Type your email here or click Generate Email for AI assistance..."
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
                    />
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    <button
                      onClick={saveCurrentAsDraft}
                      disabled={!email?.subject && !email?.body}
                      className="px-4 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      Save Draft
                    </button>
                    <button
                      onClick={analyzeSentiment}
                      disabled={sentimentLoading || (!email?.subject && !email?.body)}
                      className="px-4 py-2 rounded-lg bg-[#1e3a6e] hover:bg-[#1a2f5a] text-white text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      {sentimentLoading ? 'Analyzing...' : 'Analyze Sentiment'}
                    </button>
                    <input
                      type="text"
                      value={sentimentIndustry}
                      onChange={(e) => setSentimentIndustry(e.target.value)}
                      placeholder="Industry (optional)"
                      className="w-32 px-2 py-1.5 rounded-lg border border-pale-sky text-sm"
                    />
                    <button
                      onClick={testSend}
                      disabled={testSending || !email?.body}
                      className="px-4 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      {testSending ? 'Sending...' : 'Email Tester'}
                    </button>
                    <span className="text-xs text-slate-500">
                      Sends to {user?.email || 'your email'} to verify delivery
                    </span>
                  </div>
                  {sentimentAnalysis && (
                    <div className="mt-4 p-4 rounded-lg border border-pale-sky bg-pale-sky/20">
                      <h4 className="font-medium text-deep-navy mb-2">Sentiment Analysis</h4>
                      {sentimentAnalysis.error ? (
                        <p className="text-red-600 text-sm">{sentimentAnalysis.error}</p>
                      ) : (
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-slate-600">Score:</span>{' '}
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
              <div className="p-4 bg-pale-sky/30">
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
                      className="text-slate-700 whitespace-pre-wrap leading-relaxed"
                      style={{
                        fontFamily: emailFont,
                        fontSize: `${emailFontSize}px`,
                      }}
                    >
                      {previewBody || 'Start typing above or generate with AI to see a live preview.'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-1 bg-white border border-pale-sky shadow-sm rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-pale-sky">
            <h2 className="font-semibold text-deep-navy">Saved Drafts</h2>
            <p className="text-xs text-slate-500 mt-0.5">Stored locally in your browser</p>
          </div>
          <div className="max-h-[600px] overflow-y-auto p-4">
            {drafts.length === 0 ? (
              <p className="text-slate-500 text-sm">No drafts yet. Generate an email and click Save Draft.</p>
            ) : (
              <ul className="space-y-2">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedDraftId === d.id
                        ? 'border-deep-navy bg-pale-sky/50'
                        : 'border-pale-sky hover:bg-pale-sky/30'
                    }`}
                  >
                    <button
                      onClick={() => loadDraftIntoEditor(d)}
                      className="w-full text-left"
                    >
                      <div className="font-medium text-sm text-slate-800 truncate">{d.description || 'Untitled'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{d.targetAudience || '—'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Company: {d.company || '—'}</div>
                      <div className="text-xs text-slate-400 mt-1 truncate">{d.subject}</div>
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
