"""Durable, member-private research records on the existing SQLite warehouse."""


async def init_research_schema(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS research_briefs (
            id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            project_id INTEGER REFERENCES projects(id), name TEXT NOT NULL, spec_json TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS research_sources (
            id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            brief_id INTEGER NOT NULL REFERENCES research_briefs(id), url TEXT NOT NULL,
            excerpt TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', observed_at TEXT NOT NULL,
            content_hash TEXT NOT NULL, source_type TEXT NOT NULL,
            UNIQUE(owner_id, brief_id, url, content_hash)
        );
        CREATE TABLE IF NOT EXISTS research_companies (
            id INTEGER PRIMARY KEY, brief_id INTEGER NOT NULL REFERENCES research_briefs(id),
            name TEXT NOT NULL, domain TEXT NOT NULL, reason TEXT NOT NULL,
            source_ids_json TEXT NOT NULL DEFAULT '[]', match_state TEXT NOT NULL,
            disposition TEXT, review_reason TEXT, warnings_json TEXT NOT NULL DEFAULT '[]',
            observed_at TEXT NOT NULL, evidence_hash TEXT NOT NULL,
            UNIQUE(brief_id, domain)
        );
        CREATE TABLE IF NOT EXISTS research_jobs (
            id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            brief_id INTEGER NOT NULL REFERENCES research_briefs(id), project_id INTEGER REFERENCES projects(id),
            spec_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
            completed_tasks INTEGER NOT NULL DEFAULT 0, total_tasks INTEGER NOT NULL DEFAULT 0,
            people_count INTEGER NOT NULL DEFAULT 0, provider_state TEXT NOT NULL DEFAULT 'not_started',
            error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_scheduled_at TEXT,
            lease_token TEXT, lease_expires_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS research_one_active_owner ON research_jobs(owner_id)
            WHERE status IN ('queued','running');
        CREATE TABLE IF NOT EXISTS research_tasks (
            id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES research_jobs(id),
            company_id INTEGER NOT NULL REFERENCES research_companies(id), kind TEXT NOT NULL,
            cursor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued',
            attempt_count INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_expires_at TEXT,
            available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, error TEXT, result_count INTEGER NOT NULL DEFAULT 0,
            stop_reason TEXT, UNIQUE(job_id, company_id, kind, cursor)
        );
        CREATE INDEX IF NOT EXISTS research_task_claim ON research_tasks(status, available_at, job_id);
        CREATE TABLE IF NOT EXISTS research_provider_requests (
            id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            provider TEXT NOT NULL, request_key TEXT NOT NULL, state TEXT NOT NULL,
            result_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TEXT NOT NULL, UNIQUE(owner_id, provider, request_key)
        );
        CREATE INDEX IF NOT EXISTS research_provider_day ON research_provider_requests(provider, created_at);
        CREATE TABLE IF NOT EXISTS research_domain_leases (
            domain TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL,
            next_allowed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS contact_recommendations (
            id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            brief_id INTEGER NOT NULL REFERENCES research_briefs(id), company_id INTEGER REFERENCES research_companies(id),
            person_id INTEGER, candidate_id INTEGER, person_key TEXT NOT NULL,
            person_json TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL,
            state TEXT NOT NULL, explanation TEXT NOT NULL, disposition TEXT, review_reason TEXT,
            contact_id INTEGER REFERENCES contacts(id), reviewer_id INTEGER REFERENCES users(id),
            version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(owner_id, brief_id, person_key)
        );
    """)
