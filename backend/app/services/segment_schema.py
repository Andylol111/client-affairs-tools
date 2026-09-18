"""Company segments: AI-assigned from a fixed list, then member-managed, plus
per-segment outreach goals for the actual-vs-goal comparison chart."""


async def init_segment_schema(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS company_segments (
            id INTEGER PRIMARY KEY,
            company_key TEXT NOT NULL UNIQUE,
            company_name TEXT NOT NULL,
            company_domain TEXT,
            segment TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'ai',
            rationale TEXT,
            classified_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS segment_goals (
            segment TEXT PRIMARY KEY,
            target_companies INTEGER NOT NULL DEFAULT 0,
            updated_by INTEGER REFERENCES users(id),
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    """)
