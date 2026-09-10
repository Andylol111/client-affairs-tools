import { sanitizeRichText, insertSafeTransfer, safeImageUrl } from '../lib/richText';
import type { Sentiment, Attachment, Release, OneDriveItem, Sequence } from '../api';
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, type Contact, type GeneratedEmail } from '../api';
import AppSubnav from '../components/AppSubnav';
import PageHeader from '../components/PageHeader';
import AiModelSelect from '../components/AiModelSelect';
import AddressCheck from '../components/AddressCheck';
import { useAiModel } from '../contexts/useAiModel';
import { useUrlTab } from '../lib/useUrlTab';

function lastSendHint(c: { last_sent_at?: string | null; last_campaign_name?: string | null }) {
  if (!c.last_sent_at) return '';
  const when = String(c.last_sent_at).slice(0, 10);
  return c.last_campaign_name ? `Last send: ${c.last_campaign_name} · ${when}` : `Last send ${when}`;
}

async function loadCompanyEmployees(companies: string[]): Promise<Contact[]> {
  const items: Contact[] = [];
  let offset = 0;
  while (true) {
    const page = await api.contacts.list({
      companies: companies.join(','),
      employee_only: true,
      limit: 500,
      offset,
    });
    items.push(...page.items);
    offset += page.limit;
    if (offset >= page.total) return items;
  }
}

function groupContactsByCompany(contacts: Contact[]): { company: string; contacts: Contact[] }[] {
  const byCompany = new Map<string, Contact[]>();
  for (const c of contacts) {
    const key = (c.company || '').trim() || 'No company';
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key)!.push(c);
  }
  return Array.from(byCompany.entries())
    .map(([company, contacts]) => ({ company, contacts }))
    .sort((a, b) => (a.company === 'No company' ? 1 : b.company === 'No company' ? -1 : a.company.localeCompare(b.company)));
}

function CompanyFolder({ company, contacts, selected, onSelect, bulkSelectedIds, onToggleBulk, onToggleAllInCompany }: {
  company: string;
  contacts: Contact[];
  selected: Contact | null;
  onSelect: (c: Contact) => void;
  bulkSelectedIds: Set<number>;
  onToggleBulk: (id: number) => void;
  onToggleAllInCompany: (companyContacts: Contact[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const numericIds = useMemo(
    () => contacts.map((c) => c.id).filter((id): id is number => typeof id === 'number'),
    [contacts]
  );
  const selectedInCompany = useMemo(
    () => numericIds.filter((id) => bulkSelectedIds.has(id)).length,
    [numericIds, bulkSelectedIds]
  );
  const allSelected = numericIds.length > 0 && selectedInCompany === numericIds.length;
  const someSelected = selectedInCompany > 0 && !allSelected;

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="rounded-lg border border-pale-sky dark:border-slate-600 overflow-hidden">
      <div className="flex items-stretch gap-0 bg-white border-b border-[var(--border)] dark:bg-slate-700/40">
        {numericIds.length > 0 ? (
          <label
            className="flex items-center pl-2 pr-1 shrink-0 cursor-pointer self-center"
            title={`Select all contacts in ${company}`}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={() => onToggleAllInCompany(contacts)}
              aria-label={`Select all contacts in ${company}`}
              className="rounded border-slate-400 dark:border-slate-500 text-[var(--accent)] focus:ring-[var(--accent)]"
            />
          </label>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 min-w-0 px-3 py-2 flex items-center gap-2 hover:bg-pale-sky/15 dark:hover:bg-slate-600/50 text-left text-sm font-medium text-deep-navy dark:text-[var(--text-primary)]"
        >
          <span className="truncate min-w-0">{company}</span>
          <span className="text-[var(--text-muted)] text-xs shrink-0">({contacts.length})</span>
          <span className={`inline-block text-[var(--text-muted)] transition-transform duration-300 ease-out motion-reduce:transition-none shrink-0 ml-auto ${expanded ? 'rotate-0' : '-rotate-90'}`} aria-hidden>▼</span>
        </button>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="divide-y divide-slate-100 dark:divide-slate-600">
          {contacts.map((c) => (
            <div
              key={c.id}
              className={`flex items-stretch gap-1 px-1 py-0.5 hover:bg-pale-sky/[0.08] dark:hover:bg-slate-700/40 ${
                selected?.id === c.id ? 'bg-white dark:bg-slate-600/50 border-l-4 border-l-[var(--accent)] shadow-sm' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={bulkSelectedIds.has(c.id)}
                onChange={() => onToggleBulk(c.id)}
                aria-label={`Select ${c.name || c.email}`}
                className="mt-2.5 ml-1 rounded border-slate-400 dark:border-slate-500 text-[var(--accent)] focus:ring-[var(--accent)] shrink-0"
              />
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="flex-1 min-w-0 text-left py-2 pr-2"
              >
                <div className="font-medium text-deep-navy dark:text-[var(--text-primary)] text-xs truncate">{c.name || c.email}</div>
                <div className="text-xs text-[var(--text-muted)] truncate">{c.title}{c.company ? ` • ${c.company}` : ''}</div>
                {lastSendHint(c) && <div className="text-[11px] text-[var(--text-muted)] truncate">{lastSendHint(c)}</div>}
              </button>
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmailStudio() {
  const { user } = useOutletContext<{ user: { email: string; name?: string } }>();
  const { modelId } = useAiModel();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact | null>(null);
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
  const [generatedEmails, setGeneratedEmails] = useState<GeneratedEmail[]>([]);
  const [sortBy, setSortBy] = useState('created_desc');
  const [activeTab, setActiveTab] = useUrlTab<'editor' | 'cache'>(['editor', 'cache'], 'editor', 'panel');
  const [quickCompose, setQuickCompose] = useState({ name: '', company: '', title: '', email: '' });
  const [emailFontSize, setEmailFontSize] = useState(14);
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [mobileStep, setMobileStep] = useState<'contacts' | 'generate' | 'edit'>(() => activeTab === 'cache' ? 'contacts' : 'edit');
  const [focusWriting, setFocusWriting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTargetAudience, setDraftTargetAudience] = useState('');
  const [draftCompany, setDraftCompany] = useState('');
  const [sentimentAnalysis, setSentimentAnalysis] = useState<Sentiment | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentIndustry, setSentimentIndustry] = useState('');
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [attachmentLibrary, setAttachmentLibrary] = useState<Attachment[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<number>>(new Set());
  const [groupByCompany, setGroupByCompany] = useState(false);
  const [contactsPanelExpanded, setContactsPanelExpanded] = useState(true);
  const [aiGeneratorExpanded, setAiGeneratorExpanded] = useState(true);
  const [contactSearch, setContactSearch] = useState('');
  const [releaseFilter, setReleaseFilter] = useState('');
  const [releases, setReleases] = useState<Release[]>([]);
  const [onedriveOpen, setOnedriveOpen] = useState(false);
  const [onedriveConfigured, setOnedriveConfigured] = useState(false);
  const [onedriveItems, setOnedriveItems] = useState<OneDriveItem[]>([]);
  const [onedriveBusy, setOnedriveBusy] = useState(false);
  const [companiesSummary, setCompaniesSummary] = useState<{ company: string; company_domain?: string; contact_count: number }[]>([]);
  const [selectedCompanyNames, setSelectedCompanyNames] = useState<Set<string>>(new Set());
  const [studioCampaignContacts, setStudioCampaignContacts] = useState<Contact[]>([]);
  const [selectedCampaignContactIds, setSelectedCampaignContactIds] = useState<Set<number>>(new Set());
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [campaignSequenceId, setCampaignSequenceId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignMessage, setCampaignMessage] = useState<string | null>(null);
  const [campaignPanelOpen, setCampaignPanelOpen] = useState(false);
  const [studioContactsListOpen, setStudioContactsListOpen] = useState(true);
  const [studioCompanyListOpen, setStudioCompanyListOpen] = useState(false);
  const [studioListDeleting, setStudioListDeleting] = useState(false);
  const [sidebarBulkIds, setSidebarBulkIds] = useState<Set<number>>(new Set());
  const [sidebarDeleting, setSidebarDeleting] = useState(false);
  const [generatedClearBusy, setGeneratedClearBusy] = useState(false);

  useEffect(() => {
    api.settings.get().then((s) => {
      setSignature(s.signature || '');
      setSignatureImageUrl(s.signature_image_url || '');
      setAttachmentsEnabled(s.attachments_enabled === '1' || s.attachments_enabled === true);
    }).catch(() => {});
  }, []);

  const contactListParams = useCallback(() => ({
    ...(contactSearch.trim() ? { q: contactSearch.trim() } : {}),
    ...(releaseFilter ? { release_id: Number(releaseFilter) } : {}),
    limit: 100,
  }), [contactSearch, releaseFilter]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.contacts.list(contactListParams(), controller.signal)
        .then((page) => setContacts(page.items))
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) setContacts([]);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [contactListParams]);

  useEffect(() => {
    api.yucg.listReleases().then(setReleases).catch(() => setReleases([]));
  }, []);

  useEffect(() => {
    setSidebarBulkIds((prev) => {
      const allowed = new Set(contacts.map((c) => c.id));
      const next = new Set<number>();
      prev.forEach((id) => {
        if (allowed.has(id)) next.add(id);
      });
      return next;
    });
  }, [contacts]);

  useEffect(() => {
    api.contacts.companiesSummary().then(setCompaniesSummary).catch(() => setCompaniesSummary([]));
    api.outreach.sequences.list().then(setSequences).catch(() => setSequences([]));
  }, []);

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
  }, [sortBy]);

  // Sync contentEditable body when email.body is set externally (e.g. Generate, Load Draft)
  useEffect(() => {
    if (bodyRef.current != null && email?.body !== undefined && bodyRef.current.innerHTML !== email.body) {
      bodyRef.current.innerHTML = sanitizeRichText(email.body);
    }
  }, [email?.body]);


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
          model: modelId,
        });
        setEmail({ subject: res.subject, body: res.body });
        setMobileStep('edit');
        const savedDrafts = await api.emails.generated({ sort: sortBy });
        setGeneratedEmails(savedDrafts);
        setSelectedDraftId(savedDrafts.find((draft) => draft.contact_id === selected.id && draft.subject === res.subject)?.id ?? null);
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
          model: modelId,
        });
        setEmail({ subject: res.subject, body: res.body });
        setMobileStep('edit');
        setSelected({
          id: res.contact_id ?? 0,
          name: quickCompose.name || 'Recipient',
          email: quickCompose.email || '',
          company: draftCompany || quickCompose.company,
        });
        const savedDrafts = await api.emails.generated({ sort: sortBy });
        setGeneratedEmails(savedDrafts);
        setSelectedDraftId(savedDrafts.find((draft) => draft.contact_id === res.contact_id && draft.subject === res.subject)?.id ?? null);
      }
    } catch (e) {
      console.error(e);
      setEmail({ subject: 'Error', body: 'Failed to generate. Check Bedrock model access for the selected Claude model.' });
    } finally {
      setLoading(false);
    }
  };

  const saveCurrentAsDraft = async () => {
    if (!email?.subject && !email?.body) return;
    if (!selected?.id) {
      setDraftMessage('Choose a contact, or add a recipient email and generate once, before saving.');
      return;
    }
    setDraftSaving(true);
    setDraftMessage('');
    try {
      if (selectedDraftId) {
        await api.emails.updateDraft(selectedDraftId, email);
      } else {
        const saved = await api.emails.saveDraft({ contact_id: selected.id, ...email });
        setSelectedDraftId(saved.id);
      }
      setGeneratedEmails(await api.emails.generated({ sort: sortBy }));
      setDraftMessage('Draft saved to your account.');
    } catch (requestError) {
      setDraftMessage((requestError as Error).message);
    } finally {
      setDraftSaving(false);
    }
  };

  const loadDraftIntoEditor = (draft: GeneratedEmail) => {
    setMobileStep('edit');
    setSelectedDraftId(draft.id);
    setEmail({ subject: draft.subject, body: draft.body });
    setDraftCompany(draft.company || '');
    setQuickCompose({
      name: draft.name || '',
      company: draft.company || '',
      title: '',
      email: draft.email || '',
    });
    setSelected({ id: draft.contact_id, name: draft.name, email: draft.email || '', company: draft.company });
    setActiveTab('editor');
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
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      alert(eMessage || 'Failed to send. Try signing out and back in to re-authorize Gmail.');
    } finally {
      setTestSending(false);
    }
  };

  const toggleCompanyPick = (name: string) => {
    setSelectedCompanyNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const loadStudioContactsForCompanies = async () => {
    const names = [...selectedCompanyNames];
    setCampaignMessage(null);
    if (!names.length) {
      setStudioCampaignContacts([]);
      setSelectedCampaignContactIds(new Set());
      setCampaignMessage('Select at least one company.');
      return;
    }
    try {
      const items = await loadCompanyEmployees(names);
      setStudioCampaignContacts(items);
      setSelectedCampaignContactIds(new Set(items.map((contact) => contact.id)));
    } catch (requestError) {
      setStudioCampaignContacts([]);
      setCampaignMessage((requestError as Error).message || 'Failed to load contacts');
    }
  };

  const refreshStudioCampaignContacts = async () => {
    const names = [...selectedCompanyNames];
    if (!names.length) {
      setStudioCampaignContacts([]);
      setSelectedCampaignContactIds(new Set());
      return;
    }
    try {
      const items = await loadCompanyEmployees(names);
      setStudioCampaignContacts(items);
      setSelectedCampaignContactIds((prev) => {
        const allowed = new Set(items.map((contact) => contact.id));
        const next = new Set<number>();
        prev.forEach((id) => {
          if (allowed.has(id)) next.add(id);
        });
        return next;
      });
    } catch {
      /* keep existing loaded list */
    }
  };

  const deleteSelectedStudioContactsFromDb = async () => {
    const ids = [...selectedCampaignContactIds].filter((id) => typeof id === 'number');
    if (!ids.length) {
      setCampaignMessage('Select at least one loaded contact to remove from the database.');
      return;
    }
    if (
      !window.confirm(
        `Permanently delete ${ids.length} contact(s) from the database? Related campaign rows and notes are removed too. This cannot be undone.`
      )
    ) {
      return;
    }
    setStudioListDeleting(true);
    setCampaignMessage(null);
    try {
      const res = await api.contacts.bulkDelete(ids);
      const page = await api.contacts.list(contactListParams());
      setContacts(page.items);
      api.contacts.companiesSummary().then(setCompaniesSummary).catch(() => setCompaniesSummary([]));
      await refreshStudioCampaignContacts();
      if (res.skipped > 0) {
        window.alert(
          `Deleted ${res.deleted}. ${res.skipped} could not be removed (permission or not found).`
        );
      } else {
        setCampaignMessage(`Deleted ${res.deleted} contact(s) from the database.`);
      }
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      setCampaignMessage(eMessage || 'Delete failed');
    } finally {
      setStudioListDeleting(false);
    }
  };

  const buildCampaignFromStudio = async () => {
    if (!email?.subject?.trim() || !email?.body?.trim()) {
      setCampaignMessage('Compose subject and body in the editor first.');
      return;
    }
    const ids = [...selectedCampaignContactIds];
    if (!ids.length) {
      setCampaignMessage('Load contacts and keep at least one selected.');
      return;
    }
    const name = campaignName.trim() || `Studio ${new Date().toLocaleDateString()}`;
    setCampaignBusy(true);
    setCampaignMessage(null);
    try {
      const subjects: Record<string, string> = {};
      const bodies: Record<string, string> = {};
      for (const id of ids) {
        subjects[String(id)] = email.subject;
        bodies[String(id)] = email.body;
      }
      const camp = await api.campaigns.create(name);
      await api.campaigns.addContacts(camp.id, {
        contact_ids: ids,
        email_subjects: subjects,
        email_bodies: bodies,
      });
      if (campaignSequenceId) {
        await api.campaigns.update(camp.id, { sequence_id: Number(campaignSequenceId) });
      }
      setCampaignMessage(`Draft campaign #${camp.id} saved. Review and release it from Send.`);
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      setCampaignMessage(eMessage || 'Campaign failed');
    } finally {
      setCampaignBusy(false);
    }
  };

  const startNewEmail = () => {
    setSelected(null);
    setEmail({ subject: '', body: '' });
    setMobileStep('contacts');
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

  const toggleSidebarBulk = (id: number) => {
    setSidebarBulkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSidebarBulkForCompany = (companyContacts: Contact[]) => {
    const ids = companyContacts.map((c) => c.id).filter((id): id is number => typeof id === 'number');
    if (!ids.length) return;
    setSidebarBulkIds((prev) => {
      const allOn = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectAllSidebarContacts = () => {
    setSidebarBulkIds(new Set(contacts.map((c) => c.id)));
  };

  const bulkDeleteSidebarContacts = async () => {
    const ids = [...sidebarBulkIds];
    if (!ids.length) return;
    if (!window.confirm(`Are you sure? Delete ${ids.length} contact(s) from the database? This cannot be undone.`)) return;
    setSidebarDeleting(true);
    try {
      const res = await api.contacts.bulkDelete(ids);
      setSidebarBulkIds(new Set());
      if (selected?.id && ids.includes(selected.id)) {
        setSelected(null);
        setEmail(null);
      }
      setCompaniesSummary([]);
      const page = await api.contacts.list(contactListParams());
      setContacts(page.items);
      api.contacts.companiesSummary().then(setCompaniesSummary).catch(() => setCompaniesSummary([]));
      if (res.skipped > 0) {
        window.alert(`Deleted ${res.deleted}. ${res.skipped} could not be removed (permission or not found).`);
      }
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      window.alert(eMessage || 'Bulk delete failed');
    } finally {
      setSidebarDeleting(false);
    }
  };

  const clearGeneratedEmailCache = async () => {
    if (!window.confirm('Clear all generated email history from the studio list? Contacts are not deleted.')) return;
    setGeneratedClearBusy(true);
    try {
      const res = await api.emails.clearGeneratedCache();
      api.emails.generated({ sort: sortBy }).then(setGeneratedEmails).catch(() => setGeneratedEmails([]));
      if (res.deleted === 0) {
        window.alert('No cached generated emails to clear.');
      }
    } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
      window.alert(eMessage || 'Failed to clear cache');
    } finally {
      setGeneratedClearBusy(false);
    }
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
    ? email.body + signatureHtmlPart + (signatureImageUrl ? `<br><img src="${signatureImageUrl}" alt="" width="200" />` : '')
    : '';
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div className={`email-studio app-workspace w-full max-w-[1920px] ${focusWriting ? 'studio-focus' : ''} ${previewOpen ? 'studio-preview-open' : ''}`}>
      <PageHeader
        title="Email studio"
        subtitle="Write, review, and save your outreach. AI assistance is optional."
      />
      <div className="studio-workbench-bar">
        <span>Writing as <strong>{user?.email}</strong></span>
        <div>
          <button type="button" aria-pressed={focusWriting} onClick={() => setFocusWriting(value => !value)}>Focus on writing</button>
          <button type="button" aria-pressed={previewOpen} onClick={() => { setPreviewOpen(value => !value); setMobileStep('edit'); }}>Preview email</button>
        </div>
      </div>
      <nav className="studio-mobile-steps" aria-label="Studio workflow">
        {([
          ['contacts', '1. Contact'],
          ['generate', '2. AI assistance'],
          ['edit', '3. Write'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={mobileStep === id ? 'step' : undefined}
            onClick={() => setMobileStep(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="email-studio-layout">
        <div className={`studio-step ${mobileStep === 'contacts' ? 'is-active' : ''} surface-card shadow-sm rounded-xl flex-shrink-0 transition-[width] duration-300 ease-out motion-reduce:transition-none ${contactsPanelExpanded ? 'w-full xl:w-[280px] email-studio-contacts' : 'w-full xl:w-14'}`}>
          {contactsPanelExpanded ? (
            <>
              <div className="px-4 py-3 border-b border-[var(--border)] flex gap-2 flex-wrap items-stretch bg-white dark:bg-[var(--bg-card)]">
                <button
                  onClick={() => setContactsPanelExpanded(false)}
                  className="app-nav-util-btn px-2 shrink-0"
                  title="Collapse panel"
                  aria-label="Collapse contacts panel"
                >
                  ◀
                </button>
                <AppSubnav
                  className="app-subnav--stretch min-w-0"
                  items={[
                    { id: 'editor', label: 'Contacts' },
                    { id: 'cache', label: 'Drafts' },
                  ]}
                  active={activeTab}
                  onChange={(id) => setActiveTab(id as 'editor' | 'cache')}
                  label="Studio contact sources"
                />
                <button
                  onClick={startNewEmail}
                  className="app-nav-util-btn shrink-0 font-bold uppercase tracking-wide text-[var(--btn-primary-text)] bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] border-[var(--deep-navy)]"
                >
                  + New
                </button>
              </div>
              <div className="min-w-0 email-studio-contacts-body">
            {activeTab === 'editor' ? (
              <>
                <div className="px-4 py-2 border-b border-slate-200 space-y-2">
                  <select aria-label="Outreach week"
                    value={releaseFilter}
                    onChange={(e) => setReleaseFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-200 dark:border-slate-600 text-sm bg-white dark:bg-slate-700 text-deep-navy dark:text-slate-200"
                  >
                    <option value="">All contacts</option>
                    {releases.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} (#{r.id})
                      </option>
                    ))}
                  </select>
                  <input
                    type="search"
                    placeholder="Search contacts... (press /)"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-200 dark:border-slate-600 text-sm bg-white dark:bg-slate-700 text-deep-navy dark:text-slate-200 placeholder:text-slate-500 caret-deep-navy dark:caret-slate-200"
                    aria-label="Search contacts"
                    data-search-input
                  />
                </div>
                {contacts.length > 0 && (
                  <div className="px-4 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-2 bg-white dark:bg-[var(--bg-card)]">
                    <span className="text-xs font-medium text-deep-navy dark:text-[var(--text-primary)]">
                      {sidebarBulkIds.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={selectAllSidebarContacts}
                      className="text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSidebarBulkIds(new Set())}
                      className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
                    >
                      Clear ticks
                    </button>
                    <button
                      type="button"
                      disabled={sidebarBulkIds.size === 0 || sidebarDeleting}
                      onClick={bulkDeleteSidebarContacts}
                      className="btn-danger-solid text-xs px-2 py-1.5"
                    >
                      {sidebarDeleting ? 'Deleting…' : 'Delete selected'}
                    </button>
                  </div>
                )}
              {contacts.length === 0 ? (
                <div className="p-4">
                  <p className="text-slate-600 text-sm mb-3">{contactSearch.trim() ? 'No contacts match your search.' : 'No contacts yet. Use Quick Compose in the generator to create emails.'}</p>
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-2 bg-white dark:bg-[var(--bg-card)]">
                    <label className="text-xs text-[var(--text-muted)]">Group By Company</label>
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
                          bulkSelectedIds={sidebarBulkIds}
                          onToggleBulk={toggleSidebarBulk}
                          onToggleAllInCompany={toggleSidebarBulkForCompany}
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
                      <div
                        key={c.id}
                        className={`flex items-stretch gap-1 px-1 border-b border-slate-200/50 dark:border-slate-600/50 hover:bg-pale-sky/[0.08] dark:hover:bg-slate-700/40 ${
                          selected?.id === c.id ? 'bg-white dark:bg-slate-600/50 border-l-4 border-l-[var(--accent)] shadow-sm' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={sidebarBulkIds.has(c.id)}
                          onChange={() => toggleSidebarBulk(c.id)}
                          aria-label={`Select ${c.name || c.email}`}
                          className="mt-2.5 ml-1 rounded border-slate-400 dark:border-slate-500 text-[var(--accent)] shrink-0"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(c);
                            setEmail(null);
                            setSelectedDraftId(null);
                          }}
                          className="flex-1 min-w-0 text-left py-2 pr-2"
                        >
                          <div className="font-medium text-deep-navy dark:text-[var(--text-primary)] text-xs truncate">{c.name || c.email}</div>
                          <div className="text-xs text-[var(--text-muted)] truncate">{c.title}{c.company ? ` • ${c.company}` : ''}</div>
                          {lastSendHint(c) && <div className="text-[11px] text-[var(--text-muted)] truncate">{lastSendHint(c)}</div>}
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}
              </>
            ) : (
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <label className="text-sm text-[var(--text-muted)]">Sort:</label>
                  <select aria-label="Draft order"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="text-sm px-2 py-1 rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-100"
                  >
                    <option value="created_desc">Newest First</option>
                    <option value="created_asc">Oldest First</option>
                    <option value="contact">By Contact</option>
                  </select>
                  <button
                    type="button"
                    onClick={clearGeneratedEmailCache}
                    disabled={generatedClearBusy}
                    className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-pale-sky/20 dark:hover:bg-slate-600 disabled:opacity-50"
                  >
                    {generatedClearBusy ? 'Clearing…' : 'Delete all drafts'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                  Drafts are stored in the shared app database and remain private to your account.
                </p>
                {generatedEmails.length === 0 ? (
                  <p className="text-slate-600 text-sm">No saved drafts yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {generatedEmails.map((ge) => (
                      <li
                        key={ge.id}
                        className="p-2 rounded border border-pale-sky bg-white dark:bg-transparent hover:bg-pale-sky/15 dark:hover:bg-slate-700/50 cursor-pointer"
                        onClick={() => loadDraftIntoEditor(ge)}
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
        <div className="email-studio-main">
          <div
            id="email-generator-section"
            className={`studio-step ${mobileStep === 'generate' ? 'is-active' : ''} surface-card shadow-sm rounded-xl flex flex-col min-w-0 ${aiGeneratorExpanded ? 'w-full email-studio-generator' : 'w-full xl:w-14 flex-shrink-0'}`}
          >
            {aiGeneratorExpanded ? (
            <>
            <div className="email-generator-header px-4 py-3 border-b border-pale-sky dark:border-slate-600 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setAiGeneratorExpanded(false)}
                className="p-1.5 rounded text-slate-500 hover:bg-pale-sky/20 dark:hover:bg-slate-600 shrink-0"
                title="Collapse panel"
                aria-label="Collapse AI generator panel"
              >
                ◀
              </button>
              <h2 className="font-semibold text-deep-navy dark:text-[var(--text-primary)]">AI assistance</h2>
            </div>
            <div className="email-studio-generator-body">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Optionally describe your goal and audience to generate a starting draft. You can also write directly in the editor.
            </p>
            <div className="email-studio-field email-studio-field--grow">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Email goal</label>
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="e.g. Cold outreach for consulting services"
                  rows={3}
                  className="email-studio-grow-field w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
            </div>
            <div className="email-studio-brief-grid">
            <div className="email-studio-field">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Target Audience</label>
                <textarea
                  value={draftTargetAudience}
                  onChange={(e) => setDraftTargetAudience(e.target.value)}
                  placeholder="e.g. CTOs at mid-size tech companies"
                  rows={2}
                  className="email-studio-grow-field w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
            </div>
            <div className="email-studio-field">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Assign Company</label>
                <input
                  type="text"
                  value={draftCompany}
                  onChange={(e) => setDraftCompany(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
            </div>
            <div className="email-studio-field">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Value Proposition</label>
                <textarea
                  value={valueProp}
                  onChange={(e) => setValueProp(e.target.value)}
                  placeholder="e.g. our solution that helps companies like yours..."
                  rows={2}
                  className="email-studio-grow-field w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
            </div>
            <div className="email-studio-field">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Custom Instructions</label>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g. mention our Series B"
                  rows={2}
                  className="email-studio-grow-field w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
            </div>
            </div>
            <div className="border-t border-pale-sky dark:border-slate-600 pt-3">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Recipient details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Name"
                  value={quickCompose.name}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, name: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 text-sm placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
                <input
                  type="email"
                  placeholder="Email (for test send)"
                  value={quickCompose.email}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, email: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 text-sm placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
                <input
                  type="text"
                  placeholder="Company"
                  value={quickCompose.company}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, company: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 text-sm placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
                <input
                  type="text"
                  placeholder="Title"
                  value={quickCompose.title}
                  onChange={(e) => setQuickCompose((p) => ({ ...p, title: e.target.value }))}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200 text-sm placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Tone</label>
                <select aria-label="Tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200"
                >
                  {['professional', 'conversational', 'bold', 'empathetic', 'authority'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Length</label>
                <select aria-label="Email length"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200"
                >
                  {['ultra-short', 'short', 'standard'].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Angle</label>
                <select aria-label="Message angle"
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-deep-navy dark:text-slate-200"
                >
                  {['pain_point', 'social_proof', 'case_study', 'question_hook', 'compliment'].map((a) => (
                    <option key={a} value={a}>{a.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            </div>
            <div className="studio-generate-row">
              <AiModelSelect id="studio-ai-model" compact />
              <button
                onClick={generateEmail}
                disabled={loading}
                className="studio-generate-row__go py-3.5 px-4 bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] active:scale-[0.98] text-[var(--btn-primary-text)] font-semibold disabled:opacity-50 transition-all"
              >
                {loading ? 'Generating…' : 'Generate email'}
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
          <div id="email-editor-section" className={`studio-step ${mobileStep === 'edit' ? 'is-active' : ''} flex-1 min-w-0 surface-card shadow-sm rounded-xl min-h-0 flex flex-col`}>
            <h2 className="font-semibold text-deep-navy dark:text-[var(--text-primary)] p-4 border-b border-pale-sky dark:border-slate-600 truncate" title={`Email for ${selected?.name || quickCompose.name || 'Recipient'} (${selected?.email || quickCompose.email || 'enter email for test send'})`}>
              Email for {selected?.name || quickCompose.name || 'Recipient'} ({selected?.email || quickCompose.email || 'enter email for test send'})
            </h2>
            <AddressCheck email={selected?.email || quickCompose.email || ''} />
            <div className="email-studio-campaign border-b border-[var(--border)]">
              <button
                type="button"
                onClick={() => setCampaignPanelOpen((v) => !v)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left text-sm font-semibold text-deep-navy dark:text-[var(--text-primary)] bg-white dark:bg-[var(--bg-card)] hover:bg-pale-sky/10 dark:hover:bg-slate-700/40"
              >
                <span>Add this draft to a campaign</span>
                <span className={`inline-block text-[var(--text-muted)] transition-transform duration-300 ease-out motion-reduce:transition-none ${campaignPanelOpen ? 'rotate-0' : '-rotate-90'}`} aria-hidden>▼</span>
              </button>
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${campaignPanelOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
              >
                <div className="overflow-hidden min-h-0">
                <div className="px-4 py-3 space-y-2 text-sm border-t border-[var(--border)] bg-white dark:bg-[var(--bg-card)]">
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    Load employees for the companies you tick (generic inboxes like info@ are skipped). Write below, then save or send. Follow-ups run on the daily job only for people who have not replied — sync Gmail on Pipeline.
                  </p>
                  {companiesSummary.length === 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">No companies in the database yet — scrape or import contacts first.</p>
                  ) : (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden bg-white dark:bg-[var(--bg-card)]">
                      <button
                        type="button"
                        onClick={() => setStudioCompanyListOpen((v) => !v)}
                        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left bg-white dark:bg-[var(--bg-card)] border-b border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                        aria-expanded={studioCompanyListOpen}
                      >
                        <span className="text-sm font-semibold text-deep-navy dark:text-[var(--text-primary)] min-w-0">
                          Companies to include{' '}
                          <span className="font-normal text-[var(--text-muted)]">
                            ({companiesSummary.length})
                            {selectedCompanyNames.size > 0 ? ` · ${selectedCompanyNames.size} selected` : ''}
                          </span>
                        </span>
                        <span
                          className={`inline-block text-[var(--text-muted)] transition-transform duration-300 ease-out motion-reduce:transition-none shrink-0 ${studioCompanyListOpen ? 'rotate-0' : '-rotate-90'}`}
                          aria-hidden
                        >
                          ▼
                        </span>
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                          studioCompanyListOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                        }`}
                      >
                        <div className="overflow-hidden min-h-0">
                          <div className="max-h-48 overflow-y-auto p-2 space-y-1.5 bg-white dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60">
                            {companiesSummary.map((row) => (
                              <label
                                key={`${row.company}-${row.company_domain || ''}`}
                                className="flex items-center gap-2 cursor-pointer text-deep-navy dark:text-[var(--text-primary)] rounded-md px-1 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedCompanyNames.has(row.company)}
                                  onChange={() => toggleCompanyPick(row.company)}
                                  className="rounded border-slate-400 dark:border-slate-500 text-[var(--accent)] focus:ring-[var(--accent)] shrink-0"
                                />
                                <span className="truncate min-w-0">{row.company}</span>
                                <span className="text-xs text-[var(--text-muted)] shrink-0">({row.contact_count})</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      type="button"
                      onClick={loadStudioContactsForCompanies}
                      disabled={campaignBusy}
                      className="px-3 py-2 rounded-lg bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-xs font-medium disabled:opacity-50"
                    >
                      Load employee contacts
                    </button>
                    <span className="text-xs text-[var(--text-muted)]">{studioCampaignContacts.length} loaded</span>
                    {studioCampaignContacts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                          type="button"
                          onClick={() => setSelectedCampaignContactIds(new Set(studioCampaignContacts.map((c) => c.id)))}
                          className="text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          title="Clear ticked selection for this loaded list only"
                          onClick={() => setSelectedCampaignContactIds(new Set())}
                          className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] underline underline-offset-2"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          disabled={studioListDeleting || selectedCampaignContactIds.size === 0}
                          title="Permanently remove selected contacts from the database"
                          onClick={deleteSelectedStudioContactsFromDb}
                          className="btn-danger-solid text-xs px-2.5 py-1 rounded-md disabled:opacity-45 disabled:pointer-events-none"
                        >
                          {studioListDeleting ? 'Deleting…' : 'Delete from database'}
                        </button>
                      </div>
                    )}
                  </div>
                  {studioCampaignContacts.length > 0 && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden bg-white dark:bg-[var(--bg-card)]">
                      <button
                        type="button"
                        onClick={() => setStudioContactsListOpen((v) => !v)}
                        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left bg-white border-b border-slate-200 hover:bg-slate-50"
                        aria-expanded={studioContactsListOpen}
                      >
                        <span className="text-sm font-semibold text-deep-navy">
                          Loaded contacts{' '}
                          <span className="font-normal text-slate-600">({studioCampaignContacts.length})</span>
                        </span>
                        <span
                          className={`inline-block text-slate-500 transition-transform duration-300 ease-out motion-reduce:transition-none shrink-0 ${studioContactsListOpen ? 'rotate-0' : '-rotate-90'}`}
                          aria-hidden
                        >
                          ▼
                        </span>
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                          studioContactsListOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                        }`}
                      >
                        <div className="overflow-hidden min-h-0">
                          <div className="max-h-64 overflow-y-auto bg-white divide-y divide-slate-100">
                            {studioCampaignContacts.map((c) => (
                              <label
                                key={c.id}
                                className="flex items-center gap-2 px-3 py-2 cursor-pointer bg-white hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedCampaignContactIds.has(c.id)}
                                  onChange={() => {
                                    setSelectedCampaignContactIds((prev) => {
                                      const n = new Set(prev);
                                      if (n.has(c.id)) n.delete(c.id);
                                      else n.add(c.id);
                                      return n;
                                    });
                                  }}
                                  className="rounded border-slate-400 text-[var(--accent)] focus:ring-[var(--accent)] shrink-0"
                                  aria-label={`Select ${c.name || c.email}`}
                                />
                                <span className="truncate text-sm font-medium text-deep-navy min-w-0">
                                  {c.name || c.email}
                                </span>
                                <span className="text-xs text-slate-600 truncate min-w-0">{c.title}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-deep-navy dark:text-slate-400 mb-1">Campaign name</label>
                      <input
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="e.g. Spring outreach — Acme"
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-deep-navy dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-500 caret-deep-navy dark:caret-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-deep-navy dark:text-slate-400 mb-1">Follow-up sequence (optional)</label>
                      <select aria-label="Follow-up sequence"
                        value={campaignSequenceId}
                        onChange={(e) => setCampaignSequenceId(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-deep-navy dark:text-slate-100"
                      >
                        <option value="">None</option>
                        {sequences.map((s) => (
                          <option key={s.id} value={String(s.id)}>{s.name} ({(s.steps || []).length} steps)</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-snug">
                        After the campaign is sent, the daily job emails the next step when due. Recipients marked as replied are skipped.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={campaignBusy}
                      onClick={buildCampaignFromStudio}
                      className="px-4 py-2 rounded-lg bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-semibold disabled:opacity-50"
                    >
                      Save campaign draft
                    </button>
                    <Link
                      to="/campaigns"
                      className="inline-flex items-center px-3 py-2 text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
                    >
                      Open Campaigns
                    </Link>
                  </div>
                  {campaignMessage && (
                    <p className="text-xs text-deep-navy dark:text-slate-300 whitespace-pre-wrap">{campaignMessage}</p>
                  )}
                </div>
                </div>
              </div>
            </div>
            <div className="email-studio-compose divide-x divide-pale-sky dark:divide-slate-600">
              <div className="p-4 min-w-0 email-studio-editor-column">
                <h3 className="text-sm font-medium text-deep-navy dark:text-slate-400 mb-2">Your draft</h3>
                {/* Text formatting toolbar - white in light mode */}
                <div className="email-studio-block flex flex-wrap items-center gap-1 mb-2 p-2 rounded-lg border dark:bg-slate-700/50 dark:border-slate-600">
                  <button type="button" onClick={() => document.execCommand('bold')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] font-bold text-sm" title="Bold">B</button>
                  <button type="button" onClick={() => document.execCommand('italic')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] italic text-sm" title="Italic">I</button>
                  <button type="button" onClick={() => document.execCommand('underline')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] underline text-sm" title="Underline">U</button>
                  <button type="button" onClick={() => document.execCommand('strikeThrough')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] line-through text-sm" title="Strikethrough">S</button>
                  <span className="w-px h-5 bg-slate-300 dark:bg-slate-500 mx-1" />
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'h2')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm font-semibold" title="Heading 2">H2</button>
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'h3')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm font-semibold" title="Heading 3">H3</button>
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'blockquote')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm border-l-2 border-slate-400 dark:border-slate-500 pl-1" title="Blockquote">"</button>
                  <button type="button" onClick={() => document.execCommand('formatBlock', false, 'pre')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-xs" title="Code block">{"</>"}</button>
                  <button type="button" onClick={() => document.execCommand('insertUnorderedList')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm" title="Bullet list">• List</button>
                  <button type="button" onClick={() => document.execCommand('insertOrderedList')} className="px-2 py-1.5 rounded hover:bg-pale-sky/35 dark:hover:bg-slate-600 text-deep-navy dark:text-[var(--text-primary)] text-sm" title="Numbered list">1. List</button>
                  <span className="w-px h-5 bg-slate-300 dark:bg-slate-500 mx-1" />
                  <input type="color" defaultValue="#000000" onInput={(e) => { document.execCommand('foreColor', false, (e.target as HTMLInputElement).value); }} className="w-7 h-7 rounded border border-slate-300 dark:border-slate-500 cursor-pointer p-0" title="Text color" />
                  <input type="color" defaultValue="#ffff00" onInput={(e) => { document.execCommand('backColor', false, (e.target as HTMLInputElement).value); }} className="w-7 h-7 rounded border border-slate-300 dark:border-slate-500 cursor-pointer p-0" title="Highlight" />
                  <span className="w-px h-5 bg-slate-300 dark:bg-slate-500 mx-1" />
                  <select aria-label="Email font size"
                    value={emailFontSize}
                    onChange={(e) => { const s = Number(e.target.value); setEmailFontSize(s); if (bodyRef.current) bodyRef.current.style.fontSize = s + 'px'; }}
                    className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-sm bg-white dark:bg-slate-700 text-deep-navy dark:text-[var(--text-primary)]"
                  >
                    {[12, 14, 16, 18, 20, 24].map((s) => (
                      <option key={s} value={s}>{s}px</option>
                    ))}
                  </select>
                </div>
                <div className="email-studio-editor-stack">
                  <div className="min-w-0">
                    <label htmlFor="studio-subject" className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Subject</label>
                    <input
                      id="studio-subject"
                      type="text"
                      value={email?.subject ?? ''}
                      onChange={(e) => setEmail((prev) => ({ ...(prev || { subject: '', body: '' }), subject: e.target.value }))}
                      placeholder="Enter subject line..."
                      className="email-studio-input w-full min-w-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-deep-navy placeholder:text-slate-500 caret-deep-navy dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-500 dark:caret-slate-200"
                    />
                  </div>
                  <div className="email-studio-body-wrap">
                    <label id="studio-body-label" className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Message</label>
                    <div className="relative min-w-0 flex-1 min-h-0">
                    <div
                      ref={bodyRef}
                      contentEditable
                      role="textbox"
                      aria-labelledby="studio-body-label"
                      aria-multiline="true"
                      suppressContentEditableWarning
                      onPaste={event => { event.preventDefault(); insertSafeTransfer(event.clipboardData); }}
                      onDrop={event => { event.preventDefault(); insertSafeTransfer(event.dataTransfer); }}
                      onInput={(e) => setEmail((prev) => ({ ...(prev || { subject: '', body: '' }), body: sanitizeRichText((e.target as HTMLDivElement).innerHTML) }))}
                      style={{ fontFamily: "'Lato', system-ui, sans-serif", fontSize: emailFontSize }}
                      className="email-studio-body min-h-[280px] h-full w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-deep-navy caret-deep-navy resize-y overflow-auto focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-0 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:caret-slate-200 dark:focus:ring-offset-transparent"
                    />
                    {(!email?.body || email.body === '' || (email.body.replace(/<[^>]*>/g, '').trim() === '')) && (
                      <span className="absolute left-3 top-2 text-slate-600 dark:text-slate-300 pointer-events-none text-sm">
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
                                  ? 'border-deep-navy dark:border-[var(--accent)] bg-white dark:bg-slate-600/50 ring-1 ring-[var(--border)] text-deep-navy dark:text-[var(--text-primary)]'
                                  : 'border-slate-200 dark:border-slate-600 hover:bg-pale-sky/[0.08] dark:hover:bg-slate-600/50 text-deep-navy dark:text-slate-300 bg-white dark:bg-transparent'
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
                        <button
                          type="button"
                          disabled={!attachmentsEnabled || onedriveBusy}
                          onClick={async () => {
                            setOnedriveBusy(true);
                            try {
                              const res = await api.attachments.onedrive.list();
                              setOnedriveConfigured(res.configured);
                              setOnedriveItems(res.items || []);
                              setOnedriveOpen(true);
                            } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
                              setCampaignMessage(eMessage || 'OneDrive list failed');
                            } finally {
                              setOnedriveBusy(false);
                            }
                          }}
                          className="text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600 text-deep-navy dark:text-slate-200 disabled:opacity-50"
                        >
                          Insert From OneDrive
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="studio-draft-actions flex gap-2 flex-wrap items-center">
                    <button
                      onClick={saveCurrentAsDraft}
                      disabled={draftSaving || (!email?.subject && !email?.body)}
                      className="px-4 py-2 rounded-lg bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      {draftSaving ? 'Saving…' : selectedDraftId ? 'Update Draft' : 'Save Draft'}
                    </button>
                    <button
                      onClick={analyzeSentiment}
                      disabled={sentimentLoading || (!email?.subject && !email?.body)}
                      className="px-4 py-2 rounded-lg bg-[var(--btn-primary-hover)] hover:bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      {sentimentLoading ? 'Analyzing...' : 'Analyze Sentiment'}
                    </button>
                    <input
                      type="text"
                      value={sentimentIndustry}
                      onChange={(e) => setSentimentIndustry(e.target.value)}
                      placeholder="Industry (optional)"
                      className="w-32 px-2 py-1.5 rounded-lg border border-pale-sky dark:border-slate-600 bg-white dark:bg-slate-700 text-deep-navy dark:text-slate-200 text-sm placeholder:text-slate-500 dark:placeholder-slate-500 caret-deep-navy dark:caret-slate-200"
                    />
                    <button
                      onClick={testSend}
                      disabled={testSending || !email?.body}
                      className="px-4 py-2 rounded-lg bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-medium disabled:opacity-50 transition-all"
                    >
                      {testSending ? 'Sending...' : 'Send test to myself'}
                    </button>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Sends to {user?.email || 'your email'} to verify delivery
                    </span>
                  </div>
                  {draftMessage && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{draftMessage}</p>}
                  {sentimentAnalysis && (
                    <div className="mt-4 p-4 rounded-lg border border-pale-sky dark:border-slate-600 bg-white dark:bg-slate-700/30">
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
                              <span className="text-deep-navy dark:text-slate-200">{sentimentAnalysis.industry_fit}</span>
                            </div>
                          )}
                          {sentimentAnalysis.suggested_improvements && (
                            <div>
                              <span className="text-slate-600">Suggestions:</span>
                              <p className="text-deep-navy dark:text-slate-200 whitespace-pre-wrap mt-1">{sentimentAnalysis.suggested_improvements}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="email-studio-gmail-rail p-4 min-w-0 border-l border-[var(--border)]">
                <h3 className="text-sm font-medium text-deep-navy dark:text-[var(--text-primary)] mb-2 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-steel-blue animate-pulse" />
                  Email preview
                </h3>
                <div className="email-studio-gmail-card rounded-lg overflow-hidden min-h-[280px]">
                  <div className="email-studio-gmail-toolbar px-4 py-2 flex items-center gap-3 flex-wrap">
                    <span>Recipient view · appearance varies by email app</span>
                  </div>
                  <div className="email-studio-gmail-body p-4">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-pale-sky flex items-center justify-center text-deep-navy font-bold text-sm shrink-0">
                        Y
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-deep-navy dark:text-slate-800">{user.name || user.email}</span>
                          <span className="text-slate-500 text-sm">&lt;{user.email}&gt;</span>
                        </div>
                        <div className="text-slate-500 text-sm mt-0.5">To: {selected?.email || quickCompose.email || 'Choose a recipient'}</div>
                      </div>
                      <div className="text-slate-400 text-xs shrink-0">
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="text-lg font-medium text-deep-navy dark:text-slate-800 mb-3 border-b border-slate-100 pb-2">
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
                        <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(previewBodyHtml || '') }} />
                      ) : (
                        <span className="whitespace-pre-wrap">{previewBody || 'Start typing above or generate with AI to see a live preview.'}</span>
                      )}
                    </div>
                    {signatureImageUrl && (
                      <img src={safeImageUrl(signatureImageUrl) || undefined} alt="" className="mt-2 max-h-16 object-contain" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {onedriveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label="OneDrive files">
          <div className="surface-card w-full max-w-lg rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-deep-navy">OneDrive</h2>
              <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => setOnedriveOpen(false)}>
                Close
              </button>
            </div>
            {!onedriveConfigured ? (
              <p className="text-sm text-slate-600">Set GRAPH_ACCESS_TOKEN on the API to list the club folder.</p>
            ) : onedriveItems.length === 0 ? (
              <p className="text-sm text-slate-600">No files in GRAPH_DRIVE_FOLDER.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto divide-y divide-pale-sky">
                {onedriveItems.filter((i) => !i.folder).map((item) => (
                  <li key={item.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="text-sm truncate" title={item.name}>{item.name}</span>
                    <button
                      type="button"
                      disabled={onedriveBusy}
                      className="text-xs px-2 py-1 rounded border border-pale-sky"
                      onClick={async () => {
                        setOnedriveBusy(true);
                        try {
                          await api.attachments.onedrive.attach(item.id);
                          const lib = await api.attachments.list();
                          setAttachmentLibrary(lib);
                          setOnedriveOpen(false);
                        } catch (e) {
      const eMessage = e instanceof Error ? e.message : 'Request failed';
                          setCampaignMessage(eMessage || 'Attach failed');
                        } finally {
                          setOnedriveBusy(false);
                        }
                      }}
                    >
                      Attach
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
