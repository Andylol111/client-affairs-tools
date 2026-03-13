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
    list: (company?: string) =>
      fetchApi<any[]>(company ? `/api/contacts?company=${encodeURIComponent(company)}` : '/api/contacts'),
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
    loginLog: () => fetchApi<any[]>('/api/auth/login-log'),
  },
  settings: {
    get: () => fetchApi<any>('/api/settings'),
    update: (data: { gmail_email?: string; gmail_app_password?: string; signature?: string }) =>
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
