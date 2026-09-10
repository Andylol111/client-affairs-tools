export type MemberProfile = { projects?: string; experience?: string; role_title?: string; linkedin_url?: string; slack_handle?: string; other_handles?: string };
export type Project = { id: number; name: string; semester?: string; description?: string; role_in_project?: string };
export type Attachment = { id: number; filename: string; display_name?: string; file_size: number };
export type Template = { id: number; name: string; subject: string; body: string; industry?: string; use_case?: string };
export type Sequence = { id: number; name: string; steps?: { days_after: number; subject: string; body: string }[] };
export type ContactNote = { id: number; note: string; created_at: string; user_id?: number };
export type ContactActivity = { id: number; activity_type: string; details?: string; created_at: string; user_id?: number };
export type ContactProfile = { value_proposition?: string; role_summary?: string; online_sentiment?: string; receptiveness_notes?: string };
export type Sentiment = { error?: string; sentiment_score?: number; sentiment_label?: string; industry_fit?: string; suggested_improvements?: string };
export type Worklist = { owner_email?: string; owner_name?: string; id: number; name: string; type: string; description?: string; contact_count?: number; contacts?: Contact[] };
export type ReleasePerson = { id: number; full_name?: string; title?: string; email?: string; company?: string; company_domain?: string; kept: number; email_status?: string; vendor_check?: string };
export type Release = { id: number; name: string; status: string; people?: ReleasePerson[]; targets?: { id: number; company: string; company_domain?: string }[] };
export type InboxItem = { name?: string; email?: string; status?: string; email_verification_status?: string; id: number; subject?: string; body?: string; from_email?: string; received_at?: string };
export type Member = { id: number; email: string; name?: string; role: string; is_active: number; last_login?: string };
export type LogEntry = { user_id?: number; name?: string; id: number; created_at: string; email?: string; user_email?: string; action?: string; details?: string; ip_address?: string; event_type?: string; resource_type?: string };
export type ApiKey = { key_prefix?: string; id: number; name: string; scopes?: string; created_at?: string; last_used_at?: string };
export type StoredObject = { byte_size?: number; source?: string; id: number; kind: string; s3_key: string; bytes?: number; created_at?: string };
export type CustomFormat = { id: number; name: string; pattern: string; priority?: number };
export type Settings = { signature?: string; signature_image_url?: string; attachments_enabled?: string | boolean };
export type PipelineMetrics = { by_status: { pipeline_status: string; count: number }[] };
export type OneDriveItem = { id: string; name: string; folder?: object; size?: number };

export type Contact = {
  id: number;
  name?: string | null;
  email: string;
  title?: string | null;
  company?: string | null;
  company_domain?: string | null;
  linkedin_url?: string | null;
  confidence?: string | null;
  department?: string | null;
  pipeline_status?: string | null;
  contact_source?: string | null;
  scrape_source?: string;
  source_url?: string;
  scrape_source_url?: string;
  ai_rejected?: boolean;
  email_verification_status?: string | null;
  ai_verdict?: string | null;
  ai_reason?: string | null;
  last_sent_at?: string | null;
  last_send_status?: string | null;
  last_campaign_id?: number | null;
  last_campaign_name?: string | null;
  [key: string]: unknown;
};

export type ContactPage = {
  items: Contact[];
  total: number;
  limit: number;
  offset: number;
};

export type CampaignContact = Contact & {
  id: number;
  contact_id: number;
  campaign_id: number;
  email_subject?: string | null;
  email_body?: string | null;
  status: string;
  last_error?: string | null;
  sent_at?: string | null;
  opened_at?: string | null;
  replied_at?: string | null;
  messages?: Array<{
    id: number;
    sent_at?: string | null;
    events: Array<{ kind: string; occurred_at: string; detail?: string | null }>;
  }>;
};

export type Campaign = {
  id: number;
  name: string;
  status: 'draft' | 'releasing' | 'paused' | 'needs_attention' | 'sent' | string;
  owner_user_id?: number | null;
  sender_user_id?: number | null;
  sequence_id?: number | null;
  contact_count?: number;
  sent_count?: number;
  pending_count?: number;
  failed_count?: number;
  readiness?: { ready: boolean; issues: string[] };
  counts?: Record<string, number>;
  contacts?: CampaignContact[];
  created_at?: string;
  updated_at?: string;
};

export type GeneratedEmail = {
  id: number;
  user_id: number;
  contact_id: number;
  campaign_id?: number | null;
  subject: string;
  body: string;
  signature?: string;
  created_at: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
};

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type DiscoveryLogEntry = {
  email?: string;
  name?: string;
  title?: string;
  contact_source?: string;
  source_url?: string;
  ai_verdict?: string;
  ai_reason?: string;
  ai_source_note?: string;
  discovery_context?: string;
};

export type ScrapeResult = {
  contacts: Contact[];
  count: number;
  found_total?: number;
  duplicates_skipped?: number;
  ai_junk_skipped?: number;
  scrape_run_id?: string;
  discovery_log?: DiscoveryLogEntry[];
  cancelled?: boolean;
};

/** Spreadsheet-backed YUCG outreach coordinator (Agent 3/4 API). */
export type YucgProspectRow = {
  row_index: number;
  company: string;
  sector?: string;
  why_attractive?: string;
  engagement_theme?: string;
  yale_hook?: string;
  outreach_priority?: number;
  contact_type?: string;
  target_role_title?: string;
  incentive_score?: number;
  verification_source_url?: string;
  recommended_message_angle?: string;
  yucg_service_tags?: string[];
};

export type YucgScoreBreakdown = {
  incentive?: number;
  priority?: number;
  yale_hook?: number;
  contact_type_match?: number;
  total?: number;
  rationale?: string;
};

export type YucgVerifiability = {
  company: string;
  row_index: number;
  score_breakdown?: YucgScoreBreakdown;
  verification_source_url?: string;
  yucg_service_tags?: string[];
  website_citation_url?: string;
  website_citation_excerpt?: string;
  reasoning_chain?: string[];
};

export type YucgRecommendation = {
  prospect: YucgProspectRow;
  verifiability: YucgVerifiability;
  composite_score?: number;
};

export type YucgRecommendResponse = {
  mode: 'rules' | 'ollama' | 'ai';
  count: number;
  recommendations: YucgRecommendation[];
  ollama_error?: string | null;
  model?: string | null;
};

export type YucgProspectsMeta = {
  source_path: string;
  source_exists: boolean;
  sheet?: string;
  row_count: number;
  sectors: string[];
  source_kind?: 's3' | 'file';
  source_updated_at?: string | null;
  contact_types: string[];
};

export type EmailPatternRow = {
  company_domain: string;
  company_name?: string;
  pattern_key: string;
  pattern_template: string;
  confidence: number;
  sample_count: number;
  verified_samples: number;
  sources?: string[];
  updated_at?: string;
};

// Empty = same origin. Local Vite proxies /api → :8000. Hosted box serves SPA + API together.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/**
 * Full-page navigations (Google OAuth) must use the real API origin. In dev, `API_BASE` is '' so
 * `fetch` goes through the Vite proxy — but `window.location.href = '/api/auth/google'` hits :5173
 * and can 404 or trigger Firefox OpaqueResponseBlocking on the redirect chain. Use this for OAuth URLs only.
 */
export function getBackendOriginForOAuth(): string {
  const explicit = (import.meta.env.VITE_API_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://localhost:8000';
  if (typeof window !== 'undefined') return window.location.origin.replace(/\/$/, '');
  return '';
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('yucg_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isParseFailure(e: unknown): boolean {
  return e instanceof SyntaxError || (e instanceof Error && e.name === 'SyntaxError');
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
  const text = await res.text();

  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText || ''}`.trim();
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as {
          detail?: string | { msg?: string }[] | { message?: string; issues?: string[] };
        };
        const detail = parsed.detail;
        message = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? String(detail[0]?.msg || message)
            : detail?.message
              ? [detail.message, ...(detail.issues || [])].join(' ')
              : text.replace(/\s+/g, ' ').trim().slice(0, 320);
      } catch (error) {
        if (!isParseFailure(error)) throw error;
        message = text.replace(/\s+/g, ' ').trim().slice(0, 320) || message;
      }
    }
    if (res.status === 401 && path !== '/api/auth/me' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('yucg:unauthorized'));
    }
    throw new ApiError(message, res.status);
  }

  if (!text.trim()) {
    throw new Error('Empty response from server (expected JSON).');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new Error(`Invalid JSON from server: ${snippet || '(empty)'}`);
  }
}

export const api = {
  health: () => fetchApi<{ status: string }>('/api/health'),
  ai: {
    models: () =>
      fetchApi<{
        provider: string;
        default: string;
        groups: { id: string; label: string; models: { id: string; label: string; tier: string; blurb: string }[] }[];
      }>('/api/ai/models'),
  },
  telemetry: {
    event: (data: { event_type: string; resource_type?: string; details?: Record<string, unknown> }) =>
      fetchApi<unknown>('/api/telemetry/event', { method: 'POST', body: JSON.stringify(data) }).catch(() => {}),
    batch: (events: { event_type: string; resource_type?: string; details?: Record<string, unknown> }[]) =>
      fetchApi<{ ok: boolean; count: number }>('/api/telemetry/batch', {
        method: 'POST',
        body: JSON.stringify({ events: events.slice(0, 50) }),
      }).catch(() => ({ ok: false, count: 0 })),
  },
  contacts: {
    companiesSummary: () =>
      fetchApi<{ company: string; company_domain?: string; contact_count: number }[]>(
        '/api/contacts/companies/summary'
      ),
    list: (opts?: {
      company?: string;
      companies?: string;
      mine_only?: boolean;
      q?: string;
      pipeline_status?: string;
      employee_only?: boolean;
      release_id?: number;
      limit?: number;
      offset?: number;
    }, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (opts?.company) params.set('company', opts.company);
      if (opts?.companies) params.set('companies', opts.companies);
      if (opts?.mine_only) params.set('mine_only', 'true');
      if (opts?.q?.trim()) params.set('q', opts.q.trim());
      if (opts?.pipeline_status) params.set('pipeline_status', opts.pipeline_status);
      if (opts?.employee_only) params.set('employee_only', 'true');
      if (opts?.release_id != null) params.set('release_id', String(opts.release_id));
      if (opts?.limit != null) params.set('limit', String(opts.limit));
      if (opts?.offset != null) params.set('offset', String(opts.offset));
      return fetchApi<ContactPage>(`/api/contacts${params.toString() ? '?' + params : ''}`, { signal });
    },
    get: (id: number) => fetchApi<Contact>(`/api/contacts/${id}`),
    create: (data: Partial<Contact> & { email: string }) =>
      fetchApi<Contact>('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) =>
      fetchApi<{ ok: boolean }>(`/api/contacts/${id}`, { method: 'DELETE' }),
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
      }) as Promise<{ contacts: Contact[]; count: number; duplicates_skipped?: number }>;
    },
    scrape: (data: { company_name?: string; domain?: string; linkedin_url?: string; linkedin_max_employees?: number }) =>
      fetchApi<{ contacts: Contact[]; count: number; duplicates_skipped?: number }>('/api/contacts/scrape', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /**
     * NDJSON stream: progress events, then complete | cancelled | error.
     */
    scrapeStream: async (
      data: { company_name?: string; domain?: string; linkedin_url?: string; linkedin_max_employees?: number },
      onEvent: (ev: Record<string, unknown>) => void,
      opts?: { signal?: AbortSignal }
    ): Promise<ScrapeResult> => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/contacts/scrape-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(data),
          signal: opts?.signal,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return { contacts: [], count: 0, duplicates_skipped: 0, cancelled: true };
        }
        throw e;
      }
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
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const dec = new TextDecoder();
      let buffer = '';
      let result: ScrapeResult | null = null;

      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const ev = JSON.parse(line) as Record<string, unknown>;
        onEvent(ev);
        if (ev.type === 'complete') {
          result = {
            contacts: (ev.contacts as Contact[]) || [],
            count: Number(ev.count) || 0,
            found_total: Number(ev.found_total) || Number(ev.count) || 0,
            duplicates_skipped: Number(ev.duplicates_skipped) || 0,
            ai_junk_skipped: Number(ev.ai_junk_skipped) || 0,
            scrape_run_id: ev.scrape_run_id as string | undefined,
            discovery_log: (ev.discovery_log as DiscoveryLogEntry[]) || [],
          };
        }
        if (ev.type === 'cancelled') {
          result = {
            contacts: (ev.contacts as Contact[]) || [],
            count: Number(ev.count) || 0,
            found_total: Number(ev.found_total) || Number(ev.count) || 0,
            duplicates_skipped: Number(ev.duplicates_skipped) || 0,
            cancelled: true,
          };
        }
        if (ev.type === 'error') throw new Error(String(ev.message || 'Scrape failed'));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            handleLine(line);
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return result ?? { contacts: [], count: 0, duplicates_skipped: 0, cancelled: true };
        }
        throw e;
      }
      buffer += dec.decode();
      const tail = buffer.trim();
      if (tail) handleLine(tail);

      if (!result) throw new Error('Stream ended without a complete result');
      return result;
    },
    searchPerson: (data: { name: string; company?: string }) =>
      fetchApi<{ query: string; results: { title?: string; url?: string; content?: string }[]; summary: string | null; message: string | null }>(
        '/api/contacts/search-person',
        { method: 'POST', body: JSON.stringify(data) }
      ),
    bulkDelete: (contact_ids: number[]) =>
      fetchApi<{ deleted: number; skipped: number }>('/api/contacts/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ contact_ids }),
      }),
    clearAll: (data: {
      confirm: boolean;
      domain?: string;
      clear_pattern_cache?: boolean;
      clear_discovery_logs?: boolean;
    }) =>
      fetchApi<{
        contacts_deleted: number;
        patterns_deleted: number;
        discovery_logs_deleted: number;
        domain: string | null;
      }>('/api/contacts/clear-all', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    emailPatterns: (domain: string) =>
      fetchApi<{ domain: string; patterns: EmailPatternRow[]; count: number }>(
        `/api/contacts/email-patterns?domain=${encodeURIComponent(domain)}`
      ),
    reconcileIdentity: (domain?: string) =>
      fetchApi<{ fixed: number; removed: number; unchanged: number }>(
        `/api/contacts/reconcile-identity${domain ? '?domain=' + encodeURIComponent(domain) : ''}`,
        { method: 'POST' }
      ),
    purgeJunkContacts: (domain?: string) =>
      fetchApi<{ removed: number }>(
        `/api/contacts/purge-junk-contacts${domain ? '?domain=' + encodeURIComponent(domain) : ''}`,
        { method: 'POST' }
      ),
    discoveryLog: (scrapeRunId: string) =>
      fetchApi<{ scrape_run_id: string; entries: DiscoveryLogEntry[]; count: number }>(
        `/api/contacts/discovery-log?scrape_run_id=${encodeURIComponent(scrapeRunId)}`
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
      model?: string;
    }) =>
      fetchApi<{ subject: string; body: string; contact_id: number }>('/api/emails/generate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    testSend: (data: { to_email: string; subject: string; body: string; attachment_ids?: number[] }) =>
      fetchApi<unknown>('/api/emails/test-send', { method: 'POST', body: JSON.stringify(data) }),
    generated: (params?: { contact_id?: number; sort?: string }) =>
      fetchApi<GeneratedEmail[]>(`/api/emails/generated${params && Object.keys(params).length ? '?' + new URLSearchParams(params as Record<string, string>) : ''}`),
    saveDraft: (data: { contact_id: number; subject: string; body: string }) =>
      fetchApi<GeneratedEmail>('/api/emails/generated', { method: 'POST', body: JSON.stringify(data) }),
    updateDraft: (id: number, data: { subject: string; body: string }) =>
      fetchApi<{ ok: boolean; id: number }>(`/api/emails/generated/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteDraft: (id: number) =>
      fetchApi<{ ok: boolean; id: number }>(`/api/emails/generated/${id}`, { method: 'DELETE' }),
    clearGeneratedCache: () =>
      fetchApi<{ ok: boolean; deleted: number }>('/api/emails/generated', { method: 'DELETE' }),
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
      model?: string;
    }) =>
      fetchApi<{ subject: string; body: string; contact_id?: number | null }>('/api/emails/generate-template', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  campaigns: {
    list: () => fetchApi<Campaign[]>('/api/campaigns'),
    get: (id: number) => fetchApi<Campaign>(`/api/campaigns/${id}`),
    delete: (id: number) => fetchApi<{ ok: boolean }>(`/api/campaigns/${id}`, { method: 'DELETE' }),
    create: (name: string) =>
      fetchApi<Campaign>('/api/campaigns', { method: 'POST', body: JSON.stringify({ name }) }),
    addContacts: (id: number, data: { contact_ids: number[]; email_subjects?: Record<string, string>; email_bodies?: Record<string, string> }) =>
      fetchApi<unknown>(`/api/campaigns/${id}/contacts`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    send: (id: number) =>
      fetchApi<{ ok: boolean; sent: number; failed: number; pending_left: number; status: string }>(`/api/campaigns/${id}/send`, { method: 'POST' }),
    release: (id: number) =>
      fetchApi<{ ok: boolean; status: string; counts: Record<string, number> }>(`/api/campaigns/${id}/release`, { method: 'POST' }),
    pause: (id: number) =>
      fetchApi<{ ok: boolean; status: string }>(`/api/campaigns/${id}/pause`, { method: 'POST' }),
    resume: (id: number) =>
      fetchApi<{ ok: boolean; status: string; counts: Record<string, number> }>(`/api/campaigns/${id}/resume`, { method: 'POST' }),
    retryFailed: (id: number) =>
      fetchApi<{ ok: boolean; status: string; retried: number }>(`/api/campaigns/${id}/retry-failed`, { method: 'POST' }),
    updateContactEmail: (campaignId: number, ccId: number, subject?: string, body?: string) =>
      fetchApi<unknown>(`/api/campaigns/${campaignId}/contact/${ccId}?${new URLSearchParams({ ...(subject != null && { subject }), ...(body != null && { body }) })}`, {
        method: 'PATCH',
      }),
    update: (id: number, data: { sequence_id?: number | null }) =>
      fetchApi<unknown>(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  analytics: {
    dashboard: () => fetchApi<{ contacts_discovered_today: number; emails_in_queue: number; active_campaigns: number; total_sent: number; opened: number; open_rate: number; reply_rate: number }>('/api/analytics/dashboard'),
    campaignMetrics: (id: number) => fetchApi<unknown>(`/api/analytics/campaigns/${id}/metrics`),
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
      get: () => fetchApi<MemberProfile>('/api/auth/profile'),
      update: (data: { projects?: string; experience?: string; role_title?: string; linkedin_url?: string; slack_handle?: string; other_handles?: string }) =>
        fetchApi<MemberProfile>('/api/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),
    },
    team: () => fetchApi<Member[]>('/api/auth/team'),
    myProjects: () => fetchApi<Project[]>('/api/auth/my-projects'),
    notificationPrefs: {
      get: () => fetchApi<{ admin_digest: boolean; campaign_summary: boolean }>('/api/auth/notification-preferences'),
      update: (data: { admin_digest?: boolean; campaign_summary?: boolean }) =>
        fetchApi<{ admin_digest: boolean; campaign_summary: boolean }>('/api/auth/notification-preferences', { method: 'PUT', body: JSON.stringify(data) }),
    },
    slack: {
      connectUrl: () => fetchApi<{ redirect_url: string }>('/api/auth/slack/connect'),
      status: () => fetchApi<{ connected: boolean; team_name?: string }>('/api/auth/slack/status'),
      disconnect: () => fetchApi<unknown>('/api/auth/slack/disconnect', { method: 'DELETE' }),
    },
    complete2fa: (code: string) =>
      fetchApi<{ ok: boolean }>('/api/auth/2fa/login', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
  },
  admin: {
    catalog: () =>
      fetchApi<{
        bucket: string | null;
        objects: StoredObject[];
        prefixes: { prefix: string; objects: StoredObject[] }[];
      }>('/api/admin/catalog'),
    loginLog: () => fetchApi<LogEntry[]>('/api/admin/login-log'),
    users: {
      list: () => fetchApi<Member[]>('/api/admin/users'),
      invite: (email: string) =>
        fetchApi<unknown>('/api/admin/users/invite', { method: 'POST', body: JSON.stringify({ email }) }),
      updateRole: (userId: number, role: string) =>
        fetchApi<unknown>(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
      updateStatus: (userId: number, isActive: boolean) =>
        fetchApi<unknown>(`/api/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
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
      fetchApi<LogEntry[]>(`/api/admin/audit-log?limit=${limit || 100}`),
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
      list: () => fetchApi<ApiKey[]>('/api/admin/api-keys'),
      create: (name: string, scopes?: string) =>
        fetchApi<{ key: string }>('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ name, scopes }) }),
      revoke: (id: number) =>
        fetchApi<unknown>(`/api/admin/api-keys/${id}`, { method: 'DELETE' }),
    },
    twoFactor: {
      status: () => fetchApi<{ status: 'enabled' | 'pending' | 'not_setup' }>('/api/admin/2fa/status'),
      setup: () => fetchApi<{ provisioning_uri: string; secret: string }>('/api/admin/2fa/setup', { method: 'POST' }),
      verify: (code: string) =>
        fetchApi<unknown>('/api/admin/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
      disable: (code: string) =>
        fetchApi<unknown>('/api/admin/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
      reset: () => fetchApi<unknown>('/api/admin/2fa/reset', { method: 'POST' }),
    },
    projects: {
      list: () => fetchApi<Project[]>('/api/admin/projects'),
      create: (data: { name: string; semester?: string; description?: string }) =>
        fetchApi<Project>('/api/admin/projects', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) => fetchApi<unknown>(`/api/admin/projects/${id}`, { method: 'DELETE' }),
      assignments: (projectId: number) => fetchApi<(Member & { user_id: number; role_in_project?: string })[]>(`/api/admin/projects/${projectId}/assignments`),
      assignUser: (userId: number, data: { project_id: number; role_in_project?: string }) =>
        fetchApi<unknown>(`/api/admin/users/${userId}/project`, { method: 'PUT', body: JSON.stringify(data) }),
      unassignUser: (userId: number, projectId: number) =>
        fetchApi<unknown>(`/api/admin/users/${userId}/project/${projectId}`, { method: 'DELETE' }),
      userProjects: (userId: number) => fetchApi<Project[]>(`/api/admin/users/${userId}/projects`),
    },
    operations: {
      events: (params?: { limit?: number; event_type?: string; days?: number }) =>
        fetchApi<LogEntry[]>(`/api/admin/operations/events?${new URLSearchParams(Object.entries(params || {}).map(([key, value]) => [key, String(value)]))}`),
      heatmap: (params?: { days?: number; group_by?: string }) =>
        fetchApi<{
          group_by: string;
          days: number;
          grid: Record<string, Record<string, number>>;
          rows: Record<string, unknown>[];
          matrix_2d?: { row_labels: string[]; col_labels: string[]; values: number[][] };
        }>(`/api/admin/operations/heatmap?${new URLSearchParams(Object.entries(params || {}).map(([key, value]) => [key, String(value)]))}`),
      aggregates: (days?: number) =>
        fetchApi<{ by_event_type: { event_type: string; count: number }[]; by_resource_type: { resource_type: string; count: number }[]; days: number }>(
          `/api/admin/operations/aggregates?days=${days ?? 30}`
        ),
      resources: {
        list: () => fetchApi<{ id: number; name: string; content_text: string; content_type?: string; content_length?: number }[]>('/api/admin/operations/resources'),
        create: (data: { name: string; content_text: string; content_type?: string }) =>
          fetchApi<unknown>('/api/admin/operations/resources', { method: 'POST', body: JSON.stringify(data) }),
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
      fetchApi<unknown>(`/api/outreach/contacts/${contactId}/pipeline`, {
        method: 'PATCH',
        body: JSON.stringify({ pipeline_status: status }),
      }),
    notes: {
      list: (contactId: number) => fetchApi<ContactNote[]>(`/api/outreach/contacts/${contactId}/notes`),
      create: (contactId: number, note: string) =>
        fetchApi<unknown>('/api/outreach/notes', {
          method: 'POST',
          body: JSON.stringify({ contact_id: contactId, note }),
        }),
    },
    activities: {
      list: (contactId: number) => fetchApi<ContactActivity[]>(`/api/outreach/contacts/${contactId}/activities`),
      create: (contactId: number, type: string, details?: string) =>
        fetchApi<unknown>('/api/outreach/activities', {
          method: 'POST',
          body: JSON.stringify({ contact_id: contactId, activity_type: type, details }),
        }),
    },
    templates: {
      list: (industry?: string) =>
        fetchApi<Template[]>(industry ? `/api/outreach/templates?industry=${encodeURIComponent(industry)}` : '/api/outreach/templates'),
      create: (data: { name: string; subject: string; body: string; industry?: string; use_case?: string }) =>
        fetchApi<unknown>('/api/outreach/templates', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) => fetchApi<unknown>(`/api/outreach/templates/${id}`, { method: 'DELETE' }),
    },
    sequences: {
      list: () => fetchApi<Sequence[]>('/api/outreach/sequences'),
      create: (name: string, steps: { days_after: number; subject: string; body: string }[]) =>
        fetchApi<unknown>('/api/outreach/sequences', {
          method: 'POST',
          body: JSON.stringify({ name, steps }),
        }),
    },
    profile: {
      get: (contactId: number) => fetchApi<ContactProfile>(`/api/outreach/contacts/${contactId}/profile`),
      refresh: (contactId: number) =>
        fetchApi<ContactProfile>(`/api/outreach/contacts/${contactId}/profile/refresh`, { method: 'POST' }),
    },
    sentiment: {
      analyze: (data: { subject: string; body: string; industry?: string; target_role?: string }) =>
        fetchApi<Sentiment>('/api/outreach/sentiment/analyze', { method: 'POST', body: JSON.stringify(data) }),
    },
    markReplied: (ccId: number) =>
      fetchApi<unknown>(`/api/outreach/campaign-contacts/${ccId}/mark-replied`, { method: 'POST' }),
    /** Gmail inbox scan: mark campaign replies and optionally cold → contacted. Requires gmail.readonly (re-auth if needed). */
    syncStatus: () => fetchApi<{ last_success_at?: string; error?: string; in_progress?: boolean }>('/api/outreach/sync-status'),
    syncInboxReplies: (autoSortContacted = true) =>
      fetchApi<{ ok: boolean; error?: string; in_progress?: boolean; marked_replied?: number; promoted?: number; message?: string; errors?: string[]; pipeline_promoted_contacted?: number }>(`/api/outreach/sync-inbox-replies?auto_sort_contacted=${autoSortContacted ? 'true' : 'false'}`, {
        method: 'POST',
      }),
    /** Promote cold → contacted from sent campaign rows (no Gmail). */
    autoSortPipeline: () =>
      fetchApi<{ ok: boolean; promoted: number }>('/api/outreach/auto-sort-pipeline', { method: 'POST' }),
    verifyEmail: (email: string) =>
      fetchApi<{ valid: boolean }>(`/api/outreach/verify-email?email=${encodeURIComponent(email)}`),
    pipelineMetrics: () => fetchApi<PipelineMetrics>('/api/outreach/metrics/pipeline'),
    campaigns: {
      list: () => fetchApi<Worklist[]>('/api/outreach/campaigns'),
      get: (id: number) => fetchApi<Worklist>(`/api/outreach/campaigns/${id}`),
      create: (data: { name: string; type: 'community' | 'individual'; description?: string; priority?: number }) =>
        fetchApi<Worklist>('/api/outreach/campaigns', { method: 'POST', body: JSON.stringify(data) }),
      addContacts: (id: number, contactIds: number[]) =>
        fetchApi<unknown>(`/api/outreach/campaigns/${id}/contacts`, {
          method: 'POST',
          body: JSON.stringify({ contact_ids: contactIds }),
        }),
      removeContact: (campaignId: number, contactId: number) =>
        fetchApi<unknown>(`/api/outreach/campaigns/${campaignId}/contacts/${contactId}`, { method: 'DELETE' }),
      delete: (id: number) =>
        fetchApi<unknown>(`/api/outreach/campaigns/${id}`, { method: 'DELETE' }),
    },
    sendTiming: (industry?: string) =>
      fetchApi<unknown>(industry ? `/api/outreach/send-timing?industry=${encodeURIComponent(industry)}` : '/api/outreach/send-timing'),
  },
  attachments: {
    list: () => fetchApi<Attachment[]>('/api/attachments'),
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
      fetchApi<unknown>(`/api/attachments/${id}`, { method: 'DELETE' }),
    downloadUrl: (id: number) => `${API_BASE}/api/attachments/${id}/download`,
    onedrive: {
      list: () => fetchApi<{ configured: boolean; items: OneDriveItem[] }>('/api/attachments/onedrive'),
      attach: (item_id: string) =>
        fetchApi<unknown>('/api/attachments/onedrive/attach', {
          method: 'POST',
          body: JSON.stringify({ item_id }),
        }),
    },
  },
  yucg: {
    prospectsMeta: () => fetchApi<YucgProspectsMeta>('/api/yucg/prospects/meta'),
    listProspects: (opts?: {
      sector?: string;
      contact_type?: string;
      min_incentive_score?: number;
      outreach_priority?: number;
      limit?: number;
      q?: string;
    }) => {
      const params = new URLSearchParams();
      if (opts?.sector) params.set('sector', opts.sector);
      if (opts?.contact_type) params.set('contact_type', opts.contact_type);
      if (opts?.min_incentive_score != null) params.set('min_incentive_score', String(opts.min_incentive_score));
      if (opts?.outreach_priority != null) params.set('outreach_priority', String(opts.outreach_priority));
      if (opts?.limit != null) params.set('limit', String(opts.limit));
      if (opts?.q?.trim()) params.set('q', opts.q.trim());
      const qs = params.toString();
      return fetchApi<{ prospects: YucgProspectRow[]; count: number; items?: YucgProspectRow[]; total?: number }>(
        `/api/yucg/prospects${qs ? `?${qs}` : ''}`
      ).then((res) => ({
        prospects: res.prospects ?? res.items ?? [],
        count: res.count ?? res.total ?? (res.prospects ?? res.items ?? []).length,
      }));
    },
    refreshProspects: () =>
      fetchApi<YucgProspectsMeta>('/api/yucg/prospects/refresh', { method: 'POST' }),
    recommend: (opts?: {
      sector?: string;
      contact_type?: string;
      min_incentive_score?: number;
      contact_type_match?: string;
      n?: number;
    }) => {
      const params = new URLSearchParams();
      if (opts?.sector) params.set('sector', opts.sector);
      if (opts?.contact_type) params.set('contact_type', opts.contact_type);
      if (opts?.min_incentive_score != null) params.set('min_incentive_score', String(opts.min_incentive_score));
      if (opts?.contact_type_match) params.set('contact_type_match', opts.contact_type_match);
      if (opts?.n != null) params.set('n', String(opts.n));
      const qs = params.toString();
      return fetchApi<YucgRecommendResponse>(`/api/yucg/prospects/recommend${qs ? `?${qs}` : ''}`);
    },
    aiRecommend: (data?: {
      sector?: string;
      contact_type?: string;
      min_incentive_score?: number;
      n?: number;
      model?: string;
    }) =>
      fetchApi<YucgRecommendResponse>('/api/yucg/prospects/ai-recommend', {
        method: 'POST',
        body: JSON.stringify(data ?? {}),
      }),
    exportShortlist: async (row_indices: number[]) => {
      const res = await fetch(`${API_BASE}/api/yucg/prospects/export-shortlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ row_indices: row_indices, row_indexes: row_indices }),
      });
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
      const cd = res.headers.get('Content-Disposition');
      const match = cd?.match(/filename="([^"]+)"/);
      const filename = match?.[1] || 'YUCG_outreach_shortlist.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    listReleases: () => fetchApi<Release[]>('/api/yucg/releases'),
    getRelease: (id: number) => fetchApi<Release>(`/api/yucg/releases/${id}`),
    createRelease: (data: { name: string; row_indexes: number[]; notes?: string }) =>
      fetchApi<{ id: number; status: string; targets: number }>('/api/yucg/releases', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    mintPerson: (
      releaseId: number,
      targetId: number,
      data: { full_name: string; title?: string; source_url?: string; blurb?: string },
    ) =>
      fetchApi<unknown>(`/api/yucg/releases/${releaseId}/targets/${targetId}/mint`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    keepPerson: (releaseId: number, personId: number, keep = true) =>
      fetchApi<unknown>(`/api/yucg/releases/${releaseId}/people/${personId}/keep`, {
        method: 'POST',
        body: JSON.stringify({ keep }),
      }),
    rebuildPack: (releaseId: number) =>
      fetchApi<unknown>(`/api/yucg/releases/${releaseId}/pack`, { method: 'POST' }),
    releaseInbox: (releaseId: number) => fetchApi<InboxItem[]>(`/api/yucg/releases/${releaseId}/inbox`),
  },
  yucgoutreach: {
    createRun: (data: {
      company_name: string;
      company_domain?: string;
      linkedin_company_url?: string;
      max_prospects?: number;
      worker_concurrency?: number;
    }) =>
      fetchApi<{ id: number; status: string }>('/api/yucgoutreach/runs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listRuns: (limit?: number) =>
      fetchApi<Record<string, unknown>[]>(`/api/yucgoutreach/runs?limit=${limit ?? 50}`),
    getRun: (id: number) => fetchApi<unknown>(`/api/yucgoutreach/runs/${id}`),
    listProspects: (runId: number, limit?: number) =>
      fetchApi<Record<string, unknown>[]>(`/api/yucgoutreach/runs/${runId}/prospects?limit=${limit ?? 500}`),
    importContacts: (runId: number) =>
      fetchApi<{ created: number; updated: number; skipped: number }>(
        `/api/yucgoutreach/runs/${runId}/import-contacts`,
        { method: 'POST' }
      ),
    deleteRun: (id: number) =>
      fetchApi<{ ok: boolean; deleted: number }>(`/api/yucgoutreach/runs/${id}`, { method: 'DELETE' }),
    exportExcel: async (runId: number) => {
      const res = await fetch(`${API_BASE}/api/yucgoutreach/runs/${runId}/export.xlsx`, { headers: getAuthHeaders() });
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
      const cd = res.headers.get('Content-Disposition');
      const match = cd?.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `YUCGoutreach_export_${runId}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  },
  settings: {
    get: () => fetchApi<Settings>('/api/settings'),
    update: (data: { signature?: string; signature_image_url?: string; attachments_enabled?: boolean }) =>
      fetchApi<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
    customFormats: {
      list: () => fetchApi<CustomFormat[]>('/api/settings/custom-formats'),
      add: (data: { name: string; pattern: string; priority?: number }) =>
        fetchApi<unknown>('/api/settings/custom-formats', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) =>
        fetchApi<unknown>(`/api/settings/custom-formats/${id}`, { method: 'DELETE' }),
    },
  },
};
