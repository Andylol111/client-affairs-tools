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
  if (!res.ok) {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const msg = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? j.detail[0]?.msg : text;
      throw new Error(msg || text);
    } catch (e) {
      if (e instanceof Error && e.message && e.message !== text) throw e;
      throw new Error(text);
    }
  }
  return res.json();
}

/** Per-page cursor heatmap grid. Separate type avoids OXC parse issues with nested generics. */
export type CursorHeatmapPage = { grid: number[][], bins: number };
/** Cursor heatmap API response. */
export type CursorHeatmapResponse = { days: number, pages: Record<string, CursorHeatmapPage> };

export const api = {
  health: () => fetchApi<{ status: string }>('/api/health'),
  telemetry: {
    event: (data: { event_type: string; resource_type?: string; details?: Record<string, unknown> }) =>
      fetchApi<any>('/api/telemetry/event', { method: 'POST', body: JSON.stringify(data) }).catch(() => {}),
    batch: (events: { event_type: string; resource_type?: string; details?: Record<string, unknown> }[]) =>
      fetchApi<{ ok: boolean; count: number }>('/api/telemetry/batch', {
        method: 'POST',
        body: JSON.stringify({ events: events.slice(0, 50) }),
      }).catch(() => ({ ok: false, count: 0 })),
  },
  contacts: {
    list: (opts?: { company?: string; mine_only?: boolean; q?: string; pipeline_status?: string }) => {
      const params = new URLSearchParams();
      if (opts?.company) params.set('company', opts.company);
      if (opts?.mine_only) params.set('mine_only', 'true');
      if (opts?.q?.trim()) params.set('q', opts.q.trim());
      if (opts?.pipeline_status) params.set('pipeline_status', opts.pipeline_status);
      return fetchApi<any[]>(`/api/contacts${params.toString() ? '?' + params : ''}`);
    },
    get: (id: number) => fetchApi<any>(`/api/contacts/${id}`),
    create: (data: any) =>
      fetchApi<any>('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) =>
      fetchApi<any>(`/api/contacts/${id}`, { method: 'DELETE' }),
    importFile: (file: File, skipDuplicates = true) => {
      const form = new FormData();
      form.append('file', file);
      return fetch(`${API_BASE}/api/contacts/import?skip_duplicates=${skipDuplicates}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: form,
      }).then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }) as Promise<{ contacts: any[]; count: number; duplicates_skipped?: number }>;
    },
    scrape: (data: { company_name?: string; domain?: string; linkedin_url?: string; linkedin_max_employees?: number }) =>
      fetchApi<{ contacts: any[]; count: number; duplicates_skipped?: number }>('/api/contacts/scrape', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    searchPerson: (data: { name: string; company?: string }) =>
      fetchApi<{ query: string; results: { title?: string; url?: string; content?: string }[]; summary: string | null; message: string | null }>(
        '/api/contacts/search-person',
        { method: 'POST', body: JSON.stringify(data) }
      ),
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
    testSend: (data: { to_email: string; subject: string; body: string; attachment_ids?: number[] }) =>
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
    delete: (id: number) => fetchApi<any>(`/api/campaigns/${id}`, { method: 'DELETE' }),
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
    update: (id: number, data: { sequence_id?: number | null }) =>
      fetchApi<any>(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  analytics: {
    dashboard: () => fetchApi<any>('/api/analytics/dashboard'),
    campaignMetrics: (id: number) => fetchApi<any>(`/api/analytics/campaigns/${id}/metrics`),
    insights: () => fetchApi<{ insights: string[] }>('/api/analytics/insights'),
    dueFollowUps: () => fetchApi<{ count: number }>('/api/analytics/due-follow-ups'),
    timeSeries: (days?: number) =>
      fetchApi<{ labels: string[]; sent: number[]; opened: number[]; replied: number[] }>(
        `/api/analytics/time-series${days != null ? `?days=${days}` : ''}`
      ),
    exportCsv: async () => {
      const res = await fetch(`${API_BASE}/api/analytics/export`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'analytics_export.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
  },
  auth: {
    profile: {
      get: () => fetchApi<any>('/api/auth/profile'),
      update: (data: { projects?: string; experience?: string; role_title?: string; linkedin_url?: string; slack_handle?: string; other_handles?: string }) =>
        fetchApi<any>('/api/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),
    },
    team: () => fetchApi<any[]>('/api/auth/team'),
    myProjects: () => fetchApi<any[]>('/api/auth/my-projects'),
    notificationPrefs: {
      get: () => fetchApi<any>('/api/auth/notification-preferences'),
      update: (data: { admin_digest?: boolean; campaign_summary?: boolean }) =>
        fetchApi<any>('/api/auth/notification-preferences', { method: 'PUT', body: JSON.stringify(data) }),
    },
    slack: {
      connectUrl: () => fetchApi<{ redirect_url: string }>('/api/auth/slack/connect'),
      status: () => fetchApi<{ connected: boolean; team_name?: string }>('/api/auth/slack/status'),
      disconnect: () => fetchApi<any>('/api/auth/slack/disconnect', { method: 'DELETE' }),
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
      exportExcel: async () => {
        const res = await fetch(`${API_BASE}/api/admin/users/export`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const text = await res.text();
          try {
            const j = JSON.parse(text);
            const d = j.detail;
            throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d[0]?.msg : text);
          } catch (e) {
            if (e instanceof Error && e.message !== text) throw e;
            throw new Error(text);
          }
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'YUCG_users_export.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      },
    },
    auditLog: (limit?: number) =>
      fetchApi<any[]>(`/api/admin/audit-log?limit=${limit || 100}`),
    exportAuditLogExcel: async () => {
      const res = await fetch(`${API_BASE}/api/admin/audit-log/export`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          const d = j.detail;
          throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d[0]?.msg : text);
        } catch (e) {
          if (e instanceof Error && e.message !== text) throw e;
          throw new Error(text);
        }
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'YUCG_audit_log.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    },
    exportAllZip: async () => {
      const res = await fetch(`${API_BASE}/api/admin/export/all`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          const d = j.detail;
          throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d[0]?.msg : text);
        } catch (e) {
          if (e instanceof Error && e.message !== text) throw e;
          throw new Error(text);
        }
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'YUCG_admin_export_all.zip';
      a.click();
      URL.revokeObjectURL(url);
    },
    apiKeys: {
      list: () => fetchApi<any[]>('/api/admin/api-keys'),
      create: (name: string, scopes?: string) =>
        fetchApi<any>('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ name, scopes }) }),
      revoke: (id: number) =>
        fetchApi<any>(`/api/admin/api-keys/${id}`, { method: 'DELETE' }),
    },
    twoFactor: {
      status: () => fetchApi<{ status: 'enabled' | 'pending' | 'not_setup' }>('/api/admin/2fa/status'),
      setup: () => fetchApi<any>('/api/admin/2fa/setup', { method: 'POST' }),
      verify: (code: string) =>
        fetchApi<any>('/api/admin/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
      disable: (code: string) =>
        fetchApi<any>('/api/admin/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
      reset: () => fetchApi<any>('/api/admin/2fa/reset', { method: 'POST' }),
    },
    projects: {
      list: () => fetchApi<any[]>('/api/admin/projects'),
      create: (data: { name: string; semester?: string; description?: string }) =>
        fetchApi<any>('/api/admin/projects', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) => fetchApi<any>(`/api/admin/projects/${id}`, { method: 'DELETE' }),
      assignments: (projectId: number) => fetchApi<any[]>(`/api/admin/projects/${projectId}/assignments`),
      assignUser: (userId: number, data: { project_id: number; role_in_project?: string }) =>
        fetchApi<any>(`/api/admin/users/${userId}/project`, { method: 'PUT', body: JSON.stringify(data) }),
      unassignUser: (userId: number, projectId: number) =>
        fetchApi<any>(`/api/admin/users/${userId}/project/${projectId}`, { method: 'DELETE' }),
      userProjects: (userId: number) => fetchApi<any[]>(`/api/admin/users/${userId}/projects`),
    },
    operations: {
      events: (params?: { limit?: number; event_type?: string; days?: number }) =>
        fetchApi<any[]>(`/api/admin/operations/events?${new URLSearchParams(params as any || {})}`),
      heatmap: (params?: { days?: number; group_by?: string }) =>
        fetchApi<{
          group_by: string;
          days: number;
          grid: Record<string, Record<string, number>>;
          rows: any[];
          matrix_2d?: { row_labels: string[]; col_labels: string[]; values: number[][] };
        }>(`/api/admin/operations/heatmap?${new URLSearchParams(params as any || {})}`),
      cursorHeatmap: (params?: { days?: number; bins?: number }) =>
        fetchApi<CursorHeatmapResponse>(
          `/api/admin/operations/cursor-heatmap?${new URLSearchParams(params as any || {})}`
        ),
      aggregates: (days?: number) =>
        fetchApi<{ by_event_type: { event_type: string; count: number }[]; by_resource_type: { resource_type: string; count: number }[]; days: number }>(
          `/api/admin/operations/aggregates?days=${days ?? 30}`
        ),
      resources: {
        list: () => fetchApi<any[]>('/api/admin/operations/resources'),
        create: (data: { name: string; content_text: string; content_type?: string }) =>
          fetchApi<any>('/api/admin/operations/resources', { method: 'POST', body: JSON.stringify(data) }),
        upload: async (file: File) => {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch(`${API_BASE}/api/admin/operations/resources/upload`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: form,
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
      },
      ollamaQuery: (query: string) =>
        fetchApi<{ answer: string | null; error: string | null }>('/api/admin/operations/ollama/query', {
          method: 'POST',
          body: JSON.stringify({ query }),
        }),
      exportInsightsExcel: async (days?: number) => {
        const res = await fetch(
          `${API_BASE}/api/admin/operations/export/insights?days=${days ?? 30}`,
          { headers: getAuthHeaders() }
        );
        if (!res.ok) {
          const text = await res.text();
          try {
            const j = JSON.parse(text);
            const d = j.detail;
            throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d[0]?.msg : text);
          } catch (e) {
            if (e instanceof Error && e.message !== text) throw e;
            throw new Error(text);
          }
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `YUCG_operations_insights_${days ?? 30}d.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      },
      exportChartsZip: async (days?: number) => {
        const res = await fetch(
          `${API_BASE}/api/admin/operations/export/charts?days=${days ?? 30}`,
          { headers: getAuthHeaders() }
        );
        if (!res.ok) {
          const text = await res.text();
          try {
            const j = JSON.parse(text);
            const d = j.detail;
            throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d[0]?.msg : text);
          } catch (e) {
            if (e instanceof Error && e.message !== text) throw e;
            throw new Error(text);
          }
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `YUCG_operations_charts_${days ?? 30}d.zip`;
        a.click();
        URL.revokeObjectURL(url);
      },
      exportFullZip: async (days?: number) => {
        const res = await fetch(
          `${API_BASE}/api/admin/operations/export/full?days=${days ?? 30}`,
          { headers: getAuthHeaders() }
        );
        if (!res.ok) {
          const text = await res.text();
          try {
            const j = JSON.parse(text);
            const d = j.detail;
            throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d[0]?.msg : text);
          } catch (e) {
            if (e instanceof Error && e.message !== text) throw e;
            throw new Error(text);
          }
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `YUCG_operations_full_export_${days ?? 30}d.zip`;
        a.click();
        URL.revokeObjectURL(url);
      },
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
    campaigns: {
      list: () => fetchApi<any[]>('/api/outreach/campaigns'),
      get: (id: number) => fetchApi<any>(`/api/outreach/campaigns/${id}`),
      create: (data: { name: string; type: 'community' | 'individual'; description?: string; priority?: number }) =>
        fetchApi<any>('/api/outreach/campaigns', { method: 'POST', body: JSON.stringify(data) }),
      addContacts: (id: number, contactIds: number[]) =>
        fetchApi<any>(`/api/outreach/campaigns/${id}/contacts`, {
          method: 'POST',
          body: JSON.stringify({ contact_ids: contactIds }),
        }),
      removeContact: (campaignId: number, contactId: number) =>
        fetchApi<any>(`/api/outreach/campaigns/${campaignId}/contacts/${contactId}`, { method: 'DELETE' }),
      delete: (id: number) =>
        fetchApi<any>(`/api/outreach/campaigns/${id}`, { method: 'DELETE' }),
    },
    sendTiming: (industry?: string) =>
      fetchApi<any>(industry ? `/api/outreach/send-timing?industry=${encodeURIComponent(industry)}` : '/api/outreach/send-timing'),
  },
  attachments: {
    list: () => fetchApi<any[]>('/api/attachments'),
    upload: (file: File, displayName?: string) => {
      const form = new FormData();
      form.append('file', file);
      if (displayName) form.append('display_name', displayName);
      return fetch(`${API_BASE}/api/attachments`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: form,
      }).then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }) as Promise<{ id: number; filename: string; display_name?: string; file_size: number }>;
    },
    delete: (id: number) =>
      fetchApi<any>(`/api/attachments/${id}`, { method: 'DELETE' }),
    downloadUrl: (id: number) => `${API_BASE}/api/attachments/${id}/download`,
  },
  settings: {
    get: () => fetchApi<any>('/api/settings'),
    update: (data: { signature?: string; signature_image_url?: string; attachments_enabled?: boolean }) =>
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
