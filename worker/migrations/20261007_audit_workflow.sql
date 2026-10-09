CREATE TABLE IF NOT EXISTS audit_cases (
 id TEXT NOT NULL, org_id TEXT NOT NULL, contact_id TEXT NOT NULL, deal_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', revision INTEGER NOT NULL DEFAULT 0,
 answers_json TEXT NOT NULL DEFAULT '{}', services_json TEXT NOT NULL DEFAULT '[]',
 service_notes TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, by_user_id TEXT NOT NULL,
 PRIMARY KEY(org_id,id), UNIQUE(org_id,deal_id)
);
CREATE INDEX IF NOT EXISTS audit_cases_org_contact ON audit_cases(org_id,contact_id);
CREATE TABLE IF NOT EXISTS audit_reports (
 id TEXT NOT NULL, org_id TEXT NOT NULL, audit_id TEXT NOT NULL, contact_id TEXT NOT NULL,
 kind TEXT NOT NULL, revision INTEGER NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(org_id,id), UNIQUE(org_id,audit_id,kind,revision)
);
