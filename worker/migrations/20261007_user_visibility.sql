CREATE TABLE IF NOT EXISTS user_visibility (
 org_id TEXT NOT NULL,user_id TEXT NOT NULL,sections_json TEXT NOT NULL,edit_sections_json TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL,PRIMARY KEY(org_id,user_id)
);
UPDATE users SET role_id='role_contributor',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='u_zayna' AND email='zaynazem@gmail.com';
INSERT INTO user_visibility(org_id,user_id,sections_json,edit_sections_json,updated_at)
 SELECT org_id,id,'["today","calendar","clients","work","tickets","social","activity"]','["work","tickets","social"]',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users WHERE id='u_zayna' ON CONFLICT(org_id,user_id) DO NOTHING;
