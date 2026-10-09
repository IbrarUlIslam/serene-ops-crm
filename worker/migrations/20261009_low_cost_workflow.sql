CREATE TABLE IF NOT EXISTS call_reservations (
 org_id TEXT NOT NULL, contact_id TEXT NOT NULL, user_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL, PRIMARY KEY (org_id,contact_id)
);
CREATE TABLE IF NOT EXISTS crm_daily_usage (
 day TEXT NOT NULL, kind TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (day,kind)
);
