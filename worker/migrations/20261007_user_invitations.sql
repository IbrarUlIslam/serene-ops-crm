CREATE TABLE IF NOT EXISTS user_invitations (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  access_status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  attempted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS user_invitation_locks (
  org_id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
