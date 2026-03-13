import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';

export default function Admin() {
  const { user } = useOutletContext<{ user: { email: string; role?: string } }>();
  const [activeTab, setActiveTab] = useState<'users' | 'audit' | 'apikeys' | '2fa'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyResult, setNewKeyResult] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    if (activeTab === 'users') api.admin.users.list().then(setUsers).catch(() => setUsers([]));
    if (activeTab === 'audit') api.admin.auditLog().then(setAuditLog).catch(() => setAuditLog([]));
    if (activeTab === 'apikeys') api.admin.apiKeys.list().then(setApiKeys).catch(() => setApiKeys([]));
  }, [user?.role, activeTab]);

  if (user?.role !== 'admin') {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-deep-navy mb-6">Admin Access Required</h1>
        <p className="text-slate-600">You need admin privileges to access this page.</p>
      </div>
    );
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) return;
    setError('');
    try {
      await api.admin.users.invite(inviteEmail.trim());
      setInviteEmail('');
      api.admin.users.list().then(setUsers).catch(() => {});
    } catch (e) {
      setError((e as Error)?.message || 'Failed');
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setError('');
    setNewKeyResult('');
    try {
      const res = await api.admin.apiKeys.create(newKeyName.trim());
      setNewKeyName('');
      setNewKeyResult(res.key || '');
      api.admin.apiKeys.list().then(setApiKeys).catch(() => {});
    } catch (e) {
      setError((e as Error)?.message || 'Failed');
    }
  };

  const handle2FASetup = async () => {
    setError('');
    try {
      const res = await api.admin.twoFactor.setup();
      alert(`Scan this QR code with your authenticator app:\n${res.provisioning_uri}\n\nOr enter secret: ${res.secret}\n\nThen enter the code below to verify.`);
    } catch (e) {
      setError((e as Error)?.message || 'Failed');
    }
  };

  const handle2FAVerify = async () => {
    if (!twoFactorCode.trim()) return;
    setError('');
    try {
      await api.admin.twoFactor.verify(twoFactorCode.trim());
      setTwoFactorCode('');
      alert('2FA enabled successfully.');
    } catch (e) {
      setError((e as Error)?.message || 'Failed');
    }
  };

  const handle2FADisable = async () => {
    if (!twoFactorCode.trim()) return;
    setError('');
    try {
      await api.admin.twoFactor.disable(twoFactorCode.trim());
      setTwoFactorCode('');
      alert('2FA disabled.');
    } catch (e) {
      setError((e as Error)?.message || 'Failed');
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-deep-navy mb-6">Admin Panel</h1>

      <div className="flex gap-2 mb-6 border-b border-pale-sky">
        {(['users', 'audit', 'apikeys', '2fa'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg font-medium capitalize ${
              activeTab === tab ? 'bg-[#1a2f5a] text-white' : 'bg-pale-sky/30 text-slate-600 hover:bg-pale-sky/50'
            }`}
          >
            {tab === '2fa' ? '2FA' : tab}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {activeTab === 'users' && (
        <div className="space-y-6">
          <div className="bg-white border border-pale-sky rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy mb-4">Invite User</h2>
            <p className="text-sm text-slate-600 mb-4">Add a @yale.edu email. They will be able to sign in with Google.</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@yale.edu"
                className="flex-1 px-3 py-2 rounded-lg border border-pale-sky"
              />
              <button onClick={handleInvite} className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium">
                Invite
              </button>
            </div>
          </div>
          <div className="bg-white border border-pale-sky rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy mb-4">Users</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-pale-sky">
                    <th className="text-left py-2">Email</th>
                    <th className="text-left py-2">Name</th>
                    <th className="text-left py-2">Role</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-pale-sky/50">
                      <td className="py-2">{u.email}</td>
                      <td className="py-2">{u.name || '—'}</td>
                      <td className="py-2">
                        <select
                          value={u.role || 'standard'}
                          onChange={async (e) => {
                            try {
                              await api.admin.users.updateRole(u.id, e.target.value);
                              api.admin.users.list().then(setUsers).catch(() => {});
                            } catch (err) {
                              alert((err as Error)?.message);
                            }
                          }}
                          disabled={u.id === user?.id}
                          className="px-2 py-1 rounded border border-pale-sky"
                        >
                          <option value="admin">Admin</option>
                          <option value="standard">Standard</option>
                        </select>
                      </td>
                      <td className="py-2">{u.is_active ? 'Active' : 'Inactive'}</td>
                      <td className="py-2">
                        {u.id !== user?.id && (
                          <button
                            onClick={async () => {
                              try {
                                await api.admin.users.updateStatus(u.id, !u.is_active);
                                api.admin.users.list().then(setUsers).catch(() => {});
                              } catch (err) {
                                alert((err as Error)?.message);
                              }
                            }}
                            className="text-red-600 text-xs hover:underline"
                          >
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-white border border-pale-sky rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Audit Log</h2>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {auditLog.map((a) => (
              <div key={a.id} className="text-sm py-2 border-b border-pale-sky last:border-0">
                <span className="font-medium">{a.action}</span>
                {a.resource_type && <span className="text-slate-500"> • {a.resource_type}</span>}
                {a.details && <span className="text-slate-600"> — {a.details}</span>}
                <span className="text-xs text-slate-400 ml-2">
                  {a.user_email || 'System'} • {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'apikeys' && (
        <div className="space-y-6">
          <div className="bg-white border border-pale-sky rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy mb-4">Create API Key</h2>
            <p className="text-sm text-slate-600 mb-4">For integrations (SharePoint, Zapier, etc.). Store securely.</p>
            <div className="flex gap-2 mb-4">
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. SharePoint)"
                className="flex-1 px-3 py-2 rounded-lg border border-pale-sky"
              />
              <button onClick={handleCreateKey} className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium">
                Create
              </button>
            </div>
            {newKeyResult && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800">Copy this key now. It won&apos;t be shown again:</p>
                <code className="block mt-2 p-2 bg-white rounded text-sm break-all">{newKeyResult}</code>
              </div>
            )}
          </div>
          <div className="bg-white border border-pale-sky rounded-xl p-6">
            <h2 className="font-semibold text-deep-navy mb-4">Your API Keys</h2>
            <ul className="space-y-2">
              {apiKeys.map((k) => (
                <li key={k.id} className="flex justify-between items-center py-2 border-b border-pale-sky last:border-0">
                  <span className="font-mono text-sm">{k.key_prefix}</span>
                  <span className="text-slate-500 text-sm">{k.name}</span>
                  <button
                    onClick={async () => {
                      if (confirm('Revoke this key?')) {
                        try {
                          await api.admin.apiKeys.revoke(k.id);
                          api.admin.apiKeys.list().then(setApiKeys).catch(() => {});
                        } catch (err) {
                          alert((err as Error)?.message);
                        }
                      }
                    }}
                    className="text-red-600 text-sm hover:underline"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {activeTab === '2fa' && (
        <div className="bg-white border border-pale-sky rounded-xl p-6">
          <h2 className="font-semibold text-deep-navy mb-4">Two-Factor Authentication</h2>
          <p className="text-sm text-slate-600 mb-4">Add an extra layer of security for your admin account.</p>
          <div className="space-y-4">
            <button onClick={handle2FASetup} className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium">
              Setup 2FA
            </button>
            <div className="flex gap-2">
              <input
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                className="w-32 px-3 py-2 rounded-lg border border-pale-sky"
                maxLength={6}
              />
              <button onClick={handle2FAVerify} className="px-4 py-2 rounded-lg bg-[#1a2f5a] text-white font-medium">
                Verify
              </button>
              <button onClick={handle2FADisable} className="px-4 py-2 rounded-lg border border-red-300 text-red-600 font-medium">
                Disable 2FA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
