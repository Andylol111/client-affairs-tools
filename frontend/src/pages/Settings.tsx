import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { SignatureEditor } from '../components/SignatureEditor';

export default function Settings() {
  const { user } = useOutletContext<{ user: { role?: string } }>();
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
  const [saved, setSaved] = useState(false);
  const [formatAdded, setFormatAdded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
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
  }, [isAdmin]);

  useEffect(() => {
    if (attachmentsEnabled && isAdmin) {
      api.attachments.list().then(setAttachmentLibrary).catch(() => setAttachmentLibrary([]));
    } else {
      setAttachmentLibrary([]);
    }
  }, [attachmentsEnabled, isAdmin]);

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
      await api.settings.customFormats.add({
        name: newFormatName.trim(),
        pattern: newFormatPattern.trim(),
      });
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
      <h1 className="text-2xl font-bold text-deep-navy mb-6">Settings</h1>

      <div className="space-y-8">
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Notification Preferences</h2>
          <p className="text-sm text-slate-600 mb-4">Choose which emails you receive.</p>
          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={notifPrefs.admin_digest}
              onChange={(e) => setNotifPrefs((p) => ({ ...p, admin_digest: e.target.checked }))}
            />
            <span className="text-sm">Admin digest (new logins, security alerts)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={notifPrefs.campaign_summary}
              onChange={(e) => setNotifPrefs((p) => ({ ...p, campaign_summary: e.target.checked }))}
            />
            <span className="text-sm">Campaign summary</span>
          </label>
          <button
            onClick={saveNotifPrefs}
            className="mt-4 px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium"
          >
            Save Preferences
          </button>
        </div>

        {isAdmin && (
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Login Log</h2>
          <p className="text-sm text-slate-600 mb-4">Recent sign-ins (who logged in and when)</p>
          {loginLog.length === 0 ? (
            <p className="text-slate-500 text-sm">No logins yet.</p>
          ) : (
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
        )}

        {isAdmin && (
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Email Attachments</h2>
          <p className="text-sm text-slate-600 mb-4">
            Enable a shared attachment library for emails. Upload PDFs, intro decks, past workstreams—then select them in Email Studio when composing.
          </p>
          <label className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              checked={attachmentsEnabled}
              onChange={(e) => setAttachmentsEnabled(e.target.checked)}
            />
            <span className="text-sm">Enable email attachments library</span>
          </label>
          {attachmentsEnabled && (
            <div className="mt-4 pt-4 border-t border-pale-sky">
              <h3 className="text-sm font-medium text-deep-navy mb-2">Attachment library</h3>
              <p className="text-xs text-slate-600 mb-2">Upload PDFs, intro decks, past workstreams. They appear in Email Studio for selection.</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="file"
                  id="attachment-upload"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setAttachmentUploading(true);
                    try {
                      await api.attachments.upload(file, file.name);
                      setAttachmentLibrary(await api.attachments.list());
                    } catch (err: any) {
                      alert(err?.message || 'Upload failed');
                    } finally {
                      setAttachmentUploading(false);
                      e.target.value = '';
                    }
                  }}
                />
                <label
                  htmlFor="attachment-upload"
                  className={`px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium cursor-pointer hover:bg-slate-50 ${attachmentUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {attachmentUploading ? 'Uploading...' : '+ Upload File'}
                </label>
              </div>
              {attachmentLibrary.length > 0 ? (
                <ul className="space-y-2 max-h-40 overflow-y-auto">
                  {attachmentLibrary.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                      <span className="truncate flex-1" title={a.display_name || a.filename}>
                        {a.display_name || a.filename}
                      </span>
                      <span className="text-slate-500 text-xs mr-2">
                        {a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : ''}
                      </span>
                      <button
                        onClick={async () => {
                          if (!confirm('Remove this file from the library?')) return;
                          try {
                            await api.attachments.delete(a.id);
                            setAttachmentLibrary(await api.attachments.list());
                          } catch (err: any) {
                            alert(err?.message || 'Delete failed');
                          }
                        }}
                        className="text-red-600 text-xs hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500 text-sm">No files yet. Upload PDFs, decks, or documents.</p>
              )}
            </div>
          )}
        </div>
        )}

        {isAdmin && (
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Email Signature</h2>
          <p className="text-sm text-slate-600 mb-4">
            This signature is appended to all outgoing emails. You can type text and paste or insert images (e.g. logo) directly here.
          </p>
          <SignatureEditor
            value={signature}
            onChange={setSignature}
            placeholder="Best regards,&#10;Your Name&#10;YUCG | Yale Undergraduate Consulting Group"
            minHeight="140px"
          />
          <label className="block text-sm text-slate-600 mt-3 mb-1">Extra signature image URL (optional)</label>
          <input
            type="url"
            value={signatureImageUrl}
            onChange={(e) => setSignatureImageUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
          />
          {signatureImageUrl && (
            <p className="text-xs text-slate-500 mt-1">Preview:</p>
            <img src={signatureImageUrl} alt="Signature" className="mt-1 max-h-16 object-contain border border-pale-sky rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
        )}

        {isAdmin && (
        <div className="bg-white border border-pale-sky shadow-sm rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Custom Email Formats</h2>
          <p className="text-sm text-slate-600 mb-4">
            Import custom patterns for inferring emails. Use placeholders: {'{first}'}, {'{last}'}, {'{first_initial}'}.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newFormatName}
              onChange={(e) => setNewFormatName(e.target.value)}
              placeholder="Format name (e.g. first.last)"
              className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
            />
            <input
              type="text"
              value={newFormatPattern}
              onChange={(e) => setNewFormatPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFormat()}
              placeholder="Pattern: {first}.{last}"
              className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
            />
            <button
              onClick={addFormat}
              disabled={!newFormatName.trim() || !newFormatPattern.trim()}
              className="px-4 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] active:scale-[0.98] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 whitespace-nowrap transition-all"
            >
              {formatAdded ? 'Added!' : 'Add Format'}
            </button>
          </div>
          <ul className="space-y-2">
            {customFormats.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="font-mono text-sm">{f.name}: {f.pattern}</span>
                <button
                  onClick={() => removeFormat(f.id)}
                  className="text-red-600 text-sm hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {isAdmin && (
        <button
          onClick={saveSettings}
          className="px-6 py-2 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white font-medium"
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
        )}
      </div>
    </div>
  );
}
