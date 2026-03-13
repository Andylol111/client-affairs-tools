import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';

export default function Settings() {
  const { user } = useOutletContext<{ user: { role?: string } }>();
  const isAdmin = user?.role === 'admin';
  const [signature, setSignature] = useState('');
  const [customFormats, setCustomFormats] = useState<any[]>([]);
  const [loginLog, setLoginLog] = useState<any[]>([]);
  const [notifPrefs, setNotifPrefs] = useState({ admin_digest: true, campaign_summary: false });
  const [newFormatName, setNewFormatName] = useState('');
  const [newFormatPattern, setNewFormatPattern] = useState('');
  const [saved, setSaved] = useState(false);
  const [formatAdded, setFormatAdded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.settings.get().then((s: any) => setSignature(s.signature || '')).catch(() => {});
    api.auth.notificationPrefs.get().then(setNotifPrefs).catch(() => {});
    if (isAdmin) {
      api.settings.customFormats.list().then(setCustomFormats).catch(() => []);
      api.admin.loginLog().then(setLoginLog).catch(() => []);
    }
  }, [isAdmin]);

  const saveSettings = async () => {
    setError('');
    try {
      if (isAdmin) await api.settings.update({ signature });
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
            Save preferences
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
          <h2 className="font-semibold text-deep-navy mb-4">Email Signature</h2>
          <p className="text-sm text-slate-600 mb-4">
            This signature is appended to all outgoing emails for a professional look.
          </p>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={5}
            placeholder={'Best regards,\nYour Name\nYUCG | Yale Undergraduate Consulting Group'}
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800"
          />
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
              {formatAdded ? 'Added!' : '+ Add Format'}
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
