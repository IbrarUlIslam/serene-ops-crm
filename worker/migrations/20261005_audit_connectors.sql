CREATE TABLE IF NOT EXISTS audit_connector_runs (
  id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  source TEXT NOT NULL,
  target_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  by_user_id TEXT NOT NULL,
  result_json TEXT,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS audit_connector_runs_org_date ON audit_connector_runs(org_id, created_at);
