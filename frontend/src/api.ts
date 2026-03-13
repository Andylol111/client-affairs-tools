// In dev, use same-origin so Vite proxy forwards /api to backend (avoids self-signed cert issues)
const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_URL || 'http://localhost:8000');

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('yucg_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  health: () => fetchApi<{ status: string }>('/api/health'),
  contacts: {
    list: (company?: string, mineOnly?: boolean) => {
      const params = new URLSearchParams();
      if (company) params.set('company', company);
      if (mineOnly) params.set('mine_only', 'true');
      return fetchApi<any[]>(`/api/contacts${params.toString() ? '?' + params : ''}`);
    },
    get: (id: number) => fetchApi<any>(`/api/contacts/${id}`),
    create: (data: any) =>
      fetchApi<any>('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) =>
      fetchApi<any>(`/api/contacts/${id}`, { method: 'DELETE' }),
    importFile: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return fetch(`${API_BASE}/api/contacts/import`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: form,
      }).then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }) as Promise<{ contacts: any[]; count: number }>;
    },
    scrape: (data: { company_name?: string; domain?: string; linkedin_url?: string; linkedin_max_employees?: number }) =>
      fetchApi<{ contacts: any[]; count: number }>('/api/contacts/scrape', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  emails: {
    generate: (data: {
      contact_id: number;
      tone?: string;
      length?: string;
      angle?: string;
      custom_instructions?: string;
      value_proposition?: string;
    }) =>
      fetchApi<{ subject: string; body: string; contact_id: number }>('/api/emails/generate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    testSend: (data: { to_email: string; subject: string; body: string }) =>
      fetchApi<any>('/api/emails/test-send', { method: 'POST', body: JSON.stringify(data) }),
    generated: (params?: { contact_id?: number; sort?: string }) =>
      fetchApi<any[]>(`/api/emails/generated${params && Object.keys(params).length ? '?' + new URLSearchParams(params as any) : ''}`),
    generateTemplate: (data: {
      name?: string;
      company?: string;
      title?: string;
      email?: string;
      tone?: string;
      length?: string;
      angle?: string;
      custom_instructions?: string;
      value_proposition?: string;
    }) =>
      fetchApi<{ subject: string; body: string }>('/api/emails/generate-template', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  campaigns: {
    list: () => fetchApi<any[]>('/api/campaigns'),
    get: (id: number) => fetchApi<any>(`/api/campaigns/${id}`),
    create: (name: string) =>
      fetchApi<any>('/api/campaigns', { method: 'POST', body: JSON.stringify({ name }) }),
    addContacts: (id: number, data: { contact_ids: number[]; email_subjects?: Record<string, string>; email_bodies?: Record<string, string> }) =>
      fetchApi<any>(`/api/campaigns/${id}/contacts`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    send: (id: number) =>
      fetchApi<any>(`/api/campaigns/${id}/send`, { method: 'POST' }),
    updateContactEmail: (campaignId: number, ccId: number, subject?: string, body?: string) =>
      fetchApi<any>(`/api/campaigns/${campaignId}/contact/${ccId}?${new URLSearchParams({ ...(subject != null && { subject }), ...(body != null && { body }) })}`, {
        method: 'PATCH',
      }),
  },
  analytics: {
    dashboard: () => fetchApi<any>('/api/analytics/dashboard'),
    campaignMetrics: (id: number) => fetchApi<any>(`/api/analytics/campaigns/${id}/metrics`),
    insights: () => fetchApi<{ insights: string[] }>('/api/analytics/insights'),
  },
  auth: {
    notificationPrefs: {
      get: () => fetchApi<any>('/api/auth/notification-preferences'),
      update: (data: { admin_digest?: boolean; campaign_summary?: boolean }) =>
        fetchApi<any>('/api/auth/notification-preferences', { method: 'PUT', body: JSON.stringify(data) }),
    },
  },
  admin: {
    loginLog: () => fetchApi<any[]>('/api/admin/login-log'),
    users: {
      list: () => fetchApi<any[]>('/api/admin/users'),
      invite: (email: string) =>
        fetchApi<any>('/api/admin/users/invite', { method: 'POST', body: JSON.stringify({ email }) }),
      updateRole: (userId: number, role: string) =>
        fetchApi<any>(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
      updateStatus: (userId: number, isActive: boolean) =>
        fetchApi<any>(`/api/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
    },
    auditLog: (limit?: number) =>
      fetchApi<any[]>(`/api/admin/audit-log?limit=${limit || 100}`),
    apiKeys: {
      list: () => fetchApi<any[]>('/api/admin/api-keys'),
      create: (name: string, scopes?: string) =>
        fetchApi<any>('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ name, scopes }) }),
      revoke: (id: number) =>
        fetchApi<any>(`/api/admin/api-keys/${id}`, { method: 'DELETE' }),
    },
    twoFactor: {
      setup: () => fetchApi<any>('/api/admin/2fa/setup', { method: 'POST' }),
      verify: (code: string) =>
        fetchApi<any>('/api/admin/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
      disable: (code: string) =>
        fetchApi<any>('/api/admin/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
    },
  },
  outreach: {
    updatePipeline: (contactId: number, status: string) =>
      fetchApi<any>(`/api/outreach/contacts/${contactId}/pipeline`, {
        method: 'PATCH',
        body: JSON.stringify({ pipeline_status: status }),
      }),
    notes: {
      list: (contactId: number) => fetchApi<any[]>(`/api/outreach/contacts/${contactId}/notes`),
      create: (contactId: number, note: string) =>
        fetchApi<any>('/api/outreach/notes', {
          method: 'POST',
          body: JSON.stringify({ contact_id: contactId, note }),
        }),
    },
    activities: {
      list: (contactId: number) => fetchApi<any[]>(`/api/outreach/contacts/${contactId}/activities`),
      create: (contactId: number, type: string, details?: string) =>
        fetchApi<any>('/api/outreach/activities', {
          method: 'POST',
          body: JSON.stringify({ contact_id: contactId, activity_type: type, details }),
        }),
    },
    templates: {
      list: (industry?: string) =>
        fetchApi<any[]>(industry ? `/api/outreach/templates?industry=${encodeURIComponent(industry)}` : '/api/outreach/templates'),
      create: (data: { name: string; subject: string; body: string; industry?: string; use_case?: string }) =>
        fetchApi<any>('/api/outreach/templates', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) => fetchApi<any>(`/api/outreach/templates/${id}`, { method: 'DELETE' }),
    },
    sequences: {
      list: () => fetchApi<any[]>('/api/outreach/sequences'),
      create: (name: string, steps: { days_after: number; subject: string; body: string }[]) =>
        fetchApi<any>('/api/outreach/sequences', {
          method: 'POST',
          body: JSON.stringify({ name, steps }),
        }),
    },
    profile: {
      get: (contactId: number) => fetchApi<any>(`/api/outreach/contacts/${contactId}/profile`),
      refresh: (contactId: number) =>
        fetchApi<any>(`/api/outreach/contacts/${contactId}/profile/refresh`, { method: 'POST' }),
    },
    sentiment: {
      analyze: (data: { subject: string; body: string; industry?: string; target_role?: string }) =>
        fetchApi<any>('/api/outreach/sentiment/analyze', { method: 'POST', body: JSON.stringify(data) }),
    },
    markReplied: (ccId: number) =>
      fetchApi<any>(`/api/outreach/campaign-contacts/${ccId}/mark-replied`, { method: 'POST' }),
    verifyEmail: (email: string) =>
      fetchApi<any>(`/api/outreach/verify-email?email=${encodeURIComponent(email)}`),
    pipelineMetrics: () => fetchApi<any>('/api/outreach/metrics/pipeline'),
    sendTiming: (industry?: string) =>
      fetchApi<any>(industry ? `/api/outreach/send-timing?industry=${encodeURIComponent(industry)}` : '/api/outreach/send-timing'),
  },
  settings: {
    get: () => fetchApi<any>('/api/settings'),
    update: (data: { signature?: string }) =>
      fetchApi<any>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
    customFormats: {
      list: () => fetchApi<any[]>('/api/settings/custom-formats'),
      add: (data: { name: string; pattern: string; priority?: number }) =>
        fetchApi<any>('/api/settings/custom-formats', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) =>
        fetchApi<any>(`/api/settings/custom-formats/${id}`, { method: 'DELETE' }),
    },
  },
};
