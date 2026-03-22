/**
 * Profile page - projects, experience, role, handles + Settings (moved from nav)
 */
import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { SignatureEditor } from '../components/SignatureEditor';
import { getStoredPreferences, savePreferences, applyUserPreferences, resetPreferencesToDefault, type UserPreferences } from '../lib/userPreferences';

export default function Profile() {
  const { user } = useOutletContext<{ user: { email: string; name?: string; picture?: string; role?: string } }>();
  const { theme, toggleDark } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'profile' | 'settings'>(
    tabParam === 'settings' ? 'settings' : 'profile'
  );

  useEffect(() => {
    if (tabParam === 'settings') setActiveTab('settings');
    else if (tabParam === 'profile' || !tabParam) setActiveTab('profile');
  }, [tabParam]);

  useEffect(() => {
    const slack = searchParams.get('slack');
    if (slack === 'connected') {
      const next = new URLSearchParams(searchParams);
      next.delete('slack');
      setSearchParams(next, { replace: true });
      window.dispatchEvent(new CustomEvent('slack-integration-updated'));
    }
  }, [searchParams]);
  const [, setProfile] = useState<any>({});
  const [assignedProjects, setAssignedProjects] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);

  // Profile fields
  const [projects, setProjects] = useState('');
  const [experience, setExperience] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [slackHandle, setSlackHandle] = useState('');
  const [otherHandles, setOtherHandles] = useState('');

  // Settings state (for Settings tab)
  const isAdmin = user?.role === 'admin';
  const [signature, setSignature] = useState('');
  const [signatureImageUrl, setSignatureImageUrl] = useState('');
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [customFormats, setCustomFormats] = useState<any[]>([]);
  const [loginLog, setLoginLog] = useState<any[]>([]);
  const [notifPrefs, setNotifPrefs] = useState({ admin_digest: true, campaign_summary: false });
  const [newFormatName, setNewFormatName] = useState('');
  const [newFormatPattern, setNewFormatPattern] = useState('');
  const [attachmentLibrary, setAttachmentLibrary] = useState<any[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [formatAdded, setFormatAdded] = useState(false);
  const [error, setError] = useState('');
  const [accentColor, setAccentColor] = useState(() => getStoredPreferences().accent);
  const [compactMode, setCompactMode] = useState(() => getStoredPreferences().compact);
  const [uiFontSize, setUiFontSize] = useState<UserPreferences['fontSize']>(() => getStoredPreferences().fontSize);
  const [, setSidebarCollapsed] = useState(() => getStoredPreferences().sidebarCollapsed);
  const [reduceMotion, setReduceMotion] = useState(() => getStoredPreferences().reduceMotion);
  const [borderRadius, setBorderRadius] = useState<UserPreferences['borderRadius']>(() => getStoredPreferences().borderRadius);
  const [checklistBadge, setChecklistBadge] = useState(() => getStoredPreferences().checklistBadge);

  useEffect(() => {
    api.auth.profile.get().then((p) => {
      setProfile(p);
      setProjects(p.projects || '');
      setExperience(p.experience || '');
      setRoleTitle(p.role_title || user?.role || '');
      setLinkedinUrl(p.linkedin_url || '');
      setSlackHandle(p.slack_handle || '');
      setOtherHandles(p.other_handles || '');
    }).catch(() => {});
    api.auth.myProjects().then(setAssignedProjects).catch(() => setAssignedProjects([]));
  }, [user?.role]);

  useEffect(() => {
    if (activeTab === 'settings') {
      const prefs = getStoredPreferences();
      setAccentColor(prefs.accent);
      setCompactMode(prefs.compact);
      setUiFontSize(prefs.fontSize);
      setSidebarCollapsed(prefs.sidebarCollapsed);
      setReduceMotion(prefs.reduceMotion);
      setBorderRadius(prefs.borderRadius);
      setChecklistBadge(prefs.checklistBadge);
      api.settings.get().then((s: any) => {
        setSignature(s.signature || '');
        setSignatureImageUrl(s.signature_image_url || '');
        setAttachmentsEnabled(s.attachments_enabled === '1' || s.attachments_enabled === true);
      }).catch(() => {});
      api.auth.notificationPrefs.get().then(setNotifPrefs).catch(() => {});
      if (isAdmin) {
        api.settings.customFormats.list().then(setCustomFormats).catch(() => []);
        api.admin.loginLog().then(setLoginLog).catch(() => []);
      }
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (attachmentsEnabled && isAdmin) {
      api.attachments.list().then(setAttachmentLibrary).catch(() => setAttachmentLibrary([]));
    } else {
      setAttachmentLibrary([]);
    }
  }, [attachmentsEnabled, isAdmin]);

  const saveProfile = async () => {
    setError('');
    try {
      await api.auth.profile.update({
        projects: projects.trim() || undefined,
        experience: experience.trim() || undefined,
        role_title: roleTitle.trim() || undefined,
        linkedin_url: linkedinUrl.trim() || undefined,
        slack_handle: slackHandle.trim() || undefined,
        other_handles: otherHandles.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    }
  };

  const saveSettings = async () => {
    setError('');
    try {
      if (isAdmin) await api.settings.update({ signature, signature_image_url: signatureImageUrl || undefined, attachments_enabled: attachmentsEnabled });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    }
  };

  const saveNotifPrefs = async () => {
    setError('');
    try {
      await api.auth.notificationPrefs.update(notifPrefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    }
  };

  const addFormat = async () => {
    if (!newFormatName.trim() || !newFormatPattern.trim()) return;
    setError('');
    try {
      await api.settings.customFormats.add({ name: newFormatName.trim(), pattern: newFormatPattern.trim() });
      setCustomFormats(await api.settings.customFormats.list());
      setNewFormatName('');
      setNewFormatPattern('');
      setFormatAdded(true);
      setTimeout(() => setFormatAdded(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to add format');
    }
  };

  const removeFormat = async (id: number) => {
    try {
      await api.settings.customFormats.delete(id);
      setCustomFormats(await api.settings.customFormats.list());
    } catch (e: any) {
      setError(e?.message || 'Failed to remove');
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-deep-navy mb-6">My Profile</h1>

      <div className="flex gap-2 mb-6 border-b border-pale-sky">
        <button
          onClick={() => { setActiveTab('profile'); setSearchParams({}); }}
          className={`px-4 py-2 rounded-t-lg font-medium ${activeTab === 'profile' ? 'bg-[#1a2f5a] text-white' : 'bg-pale-sky/30 text-slate-600 hover:bg-pale-sky/50'}`}
        >
          Profile
        </button>
        <button
          onClick={() => { setActiveTab('settings'); setSearchParams({ tab: 'settings' }); }}
          className={`px-4 py-2 rounded-t-lg font-medium ${activeTab === 'settings' ? 'bg-[#1a2f5a] text-white' : 'bg-pale-sky/30 text-slate-600 hover:bg-pale-sky/50'}`}
        >
          Settings
        </button>
      </div>

      {activeTab === 'profile' && (
        <div className="space-y-6">
          {assignedProjects.length > 0 && (
            <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
              <h2 className="font-semibold text-deep-navy mb-4">Your Project Assignments</h2>
              <p className="text-sm text-slate-600 mb-4">Projects you&apos;re assigned to this semester (managed by admins).</p>
              <ul className="space-y-2">
                {assignedProjects.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-2 border-b border-pale-sky/50 last:border-0">
                    <span className="font-medium">{p.semester ? `${p.semester} — ` : ''}{p.name}</span>
                    {p.role_in_project && <span className="text-sm text-slate-500">({p.role_in_project})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy mb-4">Your Profile</h2>
            <p className="text-sm text-slate-600 mb-4">Build your profile so teammates can see your projects, experience, and how to connect.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Projects / focus areas (free-form)</label>
                <input
                  value={projects}
                  onChange={(e) => setProjects(e.target.value)}
                  placeholder="e.g. Tech sector outreach, Healthcare initiative"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Experience</label>
                <textarea
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder="e.g. 2 years consulting, finance background"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                <input
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Analyst, Project Lead"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Handles & connections</label>
                <div className="space-y-2">
                  <input
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    placeholder="LinkedIn URL"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800"
                  />
                  <input
                    value={slackHandle}
                    onChange={(e) => setSlackHandle(e.target.value)}
                    placeholder="Slack handle (e.g. @username)"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800"
                  />
                  <input
                    value={otherHandles}
                    onChange={(e) => setOtherHandles(e.target.value)}
                    placeholder="Other (Google Drive, Teams, etc.)"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800"
                  />
                </div>
              </div>
              <button onClick={saveProfile} className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium">
                {saved ? 'Saved!' : 'Save Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-8">
          <div className="bg-white dark:bg-[var(--bg-card)] border border-pale-sky dark:border-slate-600 shadow-sm rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy dark:text-[var(--text-primary)] mb-4">Appearance</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">Choose light or dark theme.</p>
            <div className="inline-flex p-1 rounded-xl bg-pale-sky/60 dark:bg-slate-700/60 border border-pale-sky/50 dark:border-slate-500">
              <button
                type="button"
                onClick={() => theme !== 'light' && toggleDark()}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ease-out pillbox-pill ${
                  theme === 'light'
                    ? 'bg-[#1a2f5a] text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-400 bg-transparent hover:bg-pale-sky/40 dark:hover:bg-slate-600/50'
                }`}
              >
                Light
              </button>
              <button
                type="button"
                onClick={() => theme !== 'dark' && toggleDark()}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ease-out pillbox-pill ${
                  theme === 'dark'
                    ? 'bg-[#1a2f5a] text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-400 bg-transparent hover:bg-pale-sky/40 dark:hover:bg-slate-600/50'
                }`}
              >
                Dark
              </button>
            </div>
            <div className="mt-6 pt-4 border-t border-pale-sky dark:border-slate-600 space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-deep-navy dark:text-[var(--text-primary)]">Accent Color</label>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAccentColor(v);
                    savePreferences({ accent: v });
                    applyUserPreferences({ ...getStoredPreferences(), accent: v });
                  }}
                  className="w-10 h-10 rounded border border-pale-sky dark:border-slate-500 cursor-pointer"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">Buttons and links</span>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={compactMode}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setCompactMode(v);
                    savePreferences({ compact: v });
                    applyUserPreferences({ ...getStoredPreferences(), compact: v });
                  }}
                />
                <span className="text-sm text-deep-navy dark:text-[var(--text-primary)]">Compact Mode (tighter spacing)</span>
              </label>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-deep-navy dark:text-[var(--text-primary)]">UI Font Size</label>
                <select
                  value={uiFontSize}
                  onChange={(e) => {
                    const v = e.target.value as UserPreferences['fontSize'];
                    setUiFontSize(v);
                    savePreferences({ fontSize: v });
                    applyUserPreferences({ ...getStoredPreferences(), fontSize: v });
                  }}
                  className="px-3 py-2 rounded-lg border border-pale-sky dark:border-slate-600 bg-white dark:bg-slate-700 text-deep-navy dark:text-[var(--text-primary)]"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-deep-navy dark:text-[var(--text-primary)]">Corner Radius</label>
                <select
                  value={borderRadius}
                  onChange={(e) => {
                    const v = e.target.value as UserPreferences['borderRadius'];
                    setBorderRadius(v);
                    savePreferences({ borderRadius: v });
                    applyUserPreferences({ ...getStoredPreferences(), borderRadius: v });
                  }}
                  className="px-3 py-2 rounded-lg border border-pale-sky dark:border-slate-600 bg-white dark:bg-slate-700 text-deep-navy dark:text-[var(--text-primary)]"
                >
                  <option value="sharp">Sharp</option>
                  <option value="medium">Medium</option>
                  <option value="round">Round</option>
                </select>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reduceMotion}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setReduceMotion(v);
                    savePreferences({ reduceMotion: v });
                    applyUserPreferences({ ...getStoredPreferences(), reduceMotion: v });
                  }}
                />
                <span className="text-sm text-deep-navy dark:text-[var(--text-primary)]">Reduce Motion</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklistBadge}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setChecklistBadge(v);
                    savePreferences({ checklistBadge: v });
                  }}
                />
                <span className="text-sm text-deep-navy dark:text-[var(--text-primary)]">Show Checklist Badge (pending count)</span>
              </label>
            </div>
            <div className="mt-6 pt-4 border-t border-pale-sky dark:border-slate-600">
              <button
                type="button"
                onClick={() => {
                  const def = resetPreferencesToDefault();
                  setAccentColor(def.accent);
                  setCompactMode(def.compact);
                  setUiFontSize(def.fontSize);
                  setSidebarCollapsed(def.sidebarCollapsed);
                  setReduceMotion(def.reduceMotion);
                  setBorderRadius(def.borderRadius);
                  setChecklistBadge(def.checklistBadge);
                }}
                className="px-4 py-2 rounded-lg border border-pale-sky dark:border-slate-600 bg-white dark:bg-slate-700 text-deep-navy dark:text-[var(--text-primary)] font-medium hover:bg-slate-50 dark:hover:bg-slate-600"
              >
                Revert to Default
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Restore Original Appearance Settings.</p>
            </div>
          </div>
          <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy mb-4">Notification Preferences</h2>
            <label className="flex items-center gap-2 mb-2">
              <input type="checkbox" checked={notifPrefs.admin_digest} onChange={(e) => setNotifPrefs((p) => ({ ...p, admin_digest: e.target.checked }))} />
              <span className="text-sm">Admin digest</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notifPrefs.campaign_summary} onChange={(e) => setNotifPrefs((p) => ({ ...p, campaign_summary: e.target.checked }))} />
              <span className="text-sm">Campaign summary</span>
            </label>
            <button onClick={saveNotifPrefs} className="mt-4 px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium">Save Preferences</button>
          </div>
          {isAdmin && (
            <>
              <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
                <h2 className="font-semibold text-deep-navy mb-4">Login Log</h2>
                {loginLog.length === 0 ? <p className="text-slate-500 text-sm">No logins yet.</p> : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {loginLog.map((l) => (
                      <li key={l.id} className="flex flex-wrap gap-2 text-sm py-2 border-b border-slate-100">
                        <span className="font-medium">{l.name || '—'}</span>
                        <span className="text-slate-500">{l.email}</span>
                        <span className="text-slate-400 text-xs ml-auto">{new Date(l.created_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
                <h2 className="font-semibold text-deep-navy mb-4">Email Attachments</h2>
                <label className="flex items-center gap-2 mb-4">
                  <input type="checkbox" checked={attachmentsEnabled} onChange={(e) => setAttachmentsEnabled(e.target.checked)} />
                  <span className="text-sm">Enable email attachments library</span>
                </label>
                {attachmentsEnabled && (
                  <div className="mt-4 pt-4 border-t border-pale-sky">
                    <input type="file" id="att-upload" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setAttachmentUploading(true);
                        try {
                          await api.attachments.upload(f, f.name);
                          setAttachmentLibrary(await api.attachments.list());
                        } catch (err: any) { alert(err?.message); } finally { setAttachmentUploading(false); e.target.value = ''; }
                      }} />
                    <label htmlFor="att-upload" className={`inline-block px-4 py-2 rounded-lg border text-sm cursor-pointer ${attachmentUploading ? 'opacity-50' : ''}`}>+ Upload</label>
                    {attachmentLibrary.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {attachmentLibrary.map((a) => (
                          <li key={a.id} className="flex justify-between text-sm">
                            <span className="truncate">{a.display_name || a.filename}</span>
                            <button onClick={async () => { try { await api.attachments.delete(a.id); setAttachmentLibrary(await api.attachments.list()); } catch (e: any) { alert(e?.message); } }} className="text-red-600 text-xs">Remove</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
                <h2 className="font-semibold text-deep-navy mb-4">Email Signature</h2>
                <p className="text-sm text-slate-600 mb-2">This signature is appended to all outgoing emails. Type text and paste or insert images (e.g. logo) directly in the box below.</p>
                <SignatureEditor value={signature} onChange={setSignature} placeholder="Best regards,&#10;Your Name&#10;YUCG" minHeight="140px" />
                <label className="block text-sm text-slate-600 mt-3 mb-1">Extra signature image URL (optional)</label>
                <input type="url" value={signatureImageUrl} onChange={(e) => setSignatureImageUrl(e.target.value)} placeholder="https://example.com/logo.png" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800" />
                {signatureImageUrl && <img src={signatureImageUrl} alt="Signature" className="mt-2 max-h-16 object-contain border border-pale-sky rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
              </div>
              <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
                <h2 className="font-semibold text-deep-navy mb-4">Custom Email Formats</h2>
                <div className="flex gap-2 mb-4">
                  <input value={newFormatName} onChange={(e) => setNewFormatName(e.target.value)} placeholder="Name" className="flex-1 px-3 py-2 rounded-lg border" />
                  <input value={newFormatPattern} onChange={(e) => setNewFormatPattern(e.target.value)} placeholder="Pattern" className="flex-1 px-3 py-2 rounded-lg border" />
                  <button onClick={addFormat} disabled={!newFormatName.trim() || !newFormatPattern.trim()} className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white disabled:opacity-50">{formatAdded ? 'Added!' : 'Add'}</button>
                </div>
                <ul className="space-y-2">
                  {customFormats.map((f) => (
                    <li key={f.id} className="flex justify-between py-2 border-b text-sm">
                      <span className="font-mono">{f.name}: {f.pattern}</span>
                      <button onClick={() => removeFormat(f.id)} className="text-red-600 text-xs">Remove</button>
                    </li>
                  ))}
                </ul>
              </div>
              <button onClick={saveSettings} className="px-6 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium">{saved ? 'Saved!' : 'Save Settings'}</button>
            </>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
