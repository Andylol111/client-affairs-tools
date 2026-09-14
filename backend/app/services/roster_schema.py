"""Club-wide officer/director metadata. Not a second CRM and not a paid people dump."""


async def init_roster_schema(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS company_rosters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_key TEXT NOT NULL UNIQUE,
            company_name TEXT NOT NULL,
            company_domain TEXT,
            ticker TEXT,
            cik TEXT,
            source_status TEXT NOT NULL DEFAULT 'pending',
            last_crawled_at TEXT,
            last_verified_at TEXT,
            next_verify_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_error TEXT,
            people_count INTEGER NOT NULL DEFAULT 0,
            current_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_company_rosters_due
            ON company_rosters(next_verify_at, source_status);
        CREATE INDEX IF NOT EXISTS idx_company_rosters_name
            ON company_rosters(company_name);

        CREATE TABLE IF NOT EXISTS company_roster_people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roster_id INTEGER NOT NULL REFERENCES company_rosters(id) ON DELETE CASCADE,
            normalized_name TEXT NOT NULL,
            full_name TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            role_type TEXT NOT NULL DEFAULT 'officer',
            source TEXT NOT NULL,
            source_url TEXT,
            accession TEXT,
            inferred_email TEXT,
            employment TEXT NOT NULL DEFAULT 'current',
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            missed_checks INTEGER NOT NULL DEFAULT 0,
            UNIQUE(roster_id, normalized_name)
        );
        CREATE INDEX IF NOT EXISTS idx_roster_people_employment
            ON company_roster_people(roster_id, employment);
    """)
