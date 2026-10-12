CREATE TABLE IF NOT EXISTS sales_contact_activity (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
 contact_id TEXT NOT NULL, kind TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_activity_org_date ON sales_contact_activity(org_id,occurred_at,user_id,contact_id);
UPDATE user_visibility SET sections_json=json_insert(sections_json,'$[#]','today')
WHERE access_profile='sales_associate' AND NOT EXISTS(SELECT 1 FROM json_each(sections_json) WHERE value='today');
