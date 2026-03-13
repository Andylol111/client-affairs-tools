"""
Database setup for ClientReach AI
"""
import aiosqlite
import os
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "clientreach.db"


def row_to_dict(row):
    """Convert sqlite3.Row to dict (Row has no .get() method)."""
    if row is None:
        return None
    return dict(zip(row.keys(), row))


async def get_db():
    """Get database connection."""
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    """Initialize database schema."""
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT UNIQUE NOT NULL,
                title TEXT,
                company TEXT,
                company_domain TEXT,
                linkedin_url TEXT,
                confidence TEXT DEFAULT 'medium',
                department TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS campaign_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER,
                contact_id INTEGER,
                email_subject TEXT,
                email_body TEXT,
                status TEXT DEFAULT 'pending',
                step_number INTEGER DEFAULT 1,
                sent_at TIMESTAMP,
                opened_at TIMESTAMP,
                replied_at TIMESTAMP,
                FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );

            CREATE TABLE IF NOT EXISTS email_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_contact_id INTEGER,
                event_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (campaign_contact_id) REFERENCES campaign_contacts(id)
            );

            CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company);
            CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
            CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                picture TEXT,
                google_id TEXT UNIQUE,
                access_token TEXT,
                refresh_token TEXT,
                token_expires_at REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS login_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                name TEXT,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_login_log_user ON login_log(user_id);
            CREATE INDEX IF NOT EXISTS idx_login_log_created ON login_log(created_at);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS generated_emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                subject TEXT,
                body TEXT,
                signature TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );

            CREATE TABLE IF NOT EXISTS custom_email_formats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                pattern TEXT NOT NULL,
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_generated_emails_contact ON generated_emails(contact_id);
            CREATE INDEX IF NOT EXISTS idx_generated_emails_created ON generated_emails(created_at);
        """)
        await db.commit()
        # Migration: add user_id to existing generated_emails (if table exists without it)
        try:
            await db.execute("ALTER TABLE generated_emails ADD COLUMN user_id INTEGER REFERENCES users(id)")
            await db.commit()
        except Exception:
            pass  # Column already exists
        try:
            await db.execute("CREATE INDEX IF NOT EXISTS idx_generated_emails_user ON generated_emails(user_id)")
            await db.commit()
        except Exception:
            pass
        # Migration: add OAuth token columns for Gmail API
        for col, col_type in [("access_token", "TEXT"), ("refresh_token", "TEXT"), ("token_expires_at", "REAL")]:
            try:
                await db.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
                await db.commit()
            except Exception:
                pass  # Column already exists

        # Pipeline, notes, templates, sequences, profile analysis, sentiment
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS contact_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                user_id INTEGER,
                note TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES contacts(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS contact_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                activity_type TEXT NOT NULL,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );
            CREATE TABLE IF NOT EXISTS email_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                industry TEXT,
                use_case TEXT,
                user_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS follow_up_sequences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                user_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS follow_up_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sequence_id INTEGER NOT NULL,
                days_after INTEGER NOT NULL DEFAULT 0,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                step_order INTEGER DEFAULT 0,
                FOREIGN KEY (sequence_id) REFERENCES follow_up_sequences(id)
            );
            CREATE TABLE IF NOT EXISTS contact_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER UNIQUE NOT NULL,
                value_proposition TEXT,
                role_summary TEXT,
                online_sentiment TEXT,
                receptiveness_notes TEXT,
                industry TEXT,
                analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );
            CREATE TABLE IF NOT EXISTS email_sentiment_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject TEXT,
                body TEXT,
                contact_id INTEGER,
                sentiment_score REAL,
                sentiment_label TEXT,
                industry_fit TEXT,
                suggested_improvements TEXT,
                parameters_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );
            CREATE TABLE IF NOT EXISTS ab_test_variants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER,
                name TEXT,
                subject TEXT,
                body TEXT,
                variant_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
            );
            CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id);
            CREATE INDEX IF NOT EXISTS idx_contact_activities_contact ON contact_activities(contact_id);
            CREATE INDEX IF NOT EXISTS idx_follow_up_steps_sequence ON follow_up_steps(sequence_id);
        """)
        await db.commit()

        # Migration: add pipeline_status, owner_id, email_verified to contacts
        for col, col_type in [("pipeline_status", "TEXT DEFAULT 'cold'"), ("owner_id", "INTEGER REFERENCES users(id)"), ("email_verified", "INTEGER DEFAULT 0")]:
            try:
                await db.execute(f"ALTER TABLE contacts ADD COLUMN {col} {col_type}")
                await db.commit()
            except Exception:
                pass

        # Roles, audit, API keys, notifications, 2FA
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                action TEXT NOT NULL,
                resource_type TEXT,
                resource_id TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key_hash TEXT NOT NULL UNIQUE,
                key_prefix TEXT NOT NULL,
                name TEXT,
                scopes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS notification_preferences (
                user_id INTEGER PRIMARY KEY,
                admin_digest INTEGER DEFAULT 1,
                campaign_summary INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
            CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
        """)
        await db.commit()

        # Migration: add role, is_active, totp_secret to users
        for col, col_type in [
            ("role", "TEXT DEFAULT 'standard'"),
            ("is_active", "INTEGER DEFAULT 1"),
            ("totp_secret", "TEXT"),
        ]:
            try:
                await db.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
                await db.commit()
            except Exception:
                pass

        # First user becomes admin if no admins exist
        try:
            cursor = await db.execute("SELECT COUNT(*) as n FROM users WHERE role = 'admin'")
            if (await cursor.fetchone())["n"] == 0:
                await db.execute("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)")
                await db.commit()
        except Exception:
            pass
    finally:
        await db.close()
