-- Migration 0001: remove the legacy contact_id foreign key from zoom_calls
--
-- STATUS: already applied directly to the live remote D1 database
-- (serene-ops-crm-db) on 2026-09-17, via:
--   npx wrangler d1 execute serene-ops-crm-db --remote --file=<this file>
-- This file is checked in after the fact so the change is tracked in
-- version control (this repo has no wired D1 migrations system yet -- see
-- wrangler.toml, which documents live config the same way). Re-running this
-- file is safe only while zoom_calls is empty; it is NOT safe to re-run
-- once real rows exist (it drops and recreates the table). Do not re-run
-- against production.
--
-- WHY: zoom_calls.contact_id originally had
--   REFERENCES contacts(id)
-- pointing at the relational `contacts` table, which this CRM does not
-- actually use for real contact data (real contacts live in the JSON blob
-- store served by /api/db, crm_snapshot.data.contacts -- the relational
-- `contacts` table is legacy/dead and was confirmed empty, 0 rows). Because
-- of this, every real Zoom Phone call whose destination number matched a
-- real (JSON-blob) contact failed its INSERT into zoom_calls with
-- "FOREIGN KEY constraint failed", and was silently dropped by the
-- try/catch around reconcileZoomEvent in the webhook handler -- meaning
-- calls to known contacts never appeared anywhere in the CRM at all.
--
-- Confirmed safe to apply: zoom_calls had 0 rows at the time this was run.

DROP TABLE zoom_calls;

CREATE TABLE zoom_calls (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  call_id TEXT REFERENCES calls(id),
  zoom_call_id TEXT NOT NULL,
  zoom_event_id TEXT,
  direction TEXT NOT NULL,
  from_number TEXT,
  to_number TEXT,
  status TEXT NOT NULL,
  duration_seconds INTEGER,
  initiated_by TEXT REFERENCES users(id),
  attribution TEXT NOT NULL DEFAULT 'unassigned',
  contact_id TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  recording_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  zoom_phone_identity TEXT
);

CREATE UNIQUE INDEX idx_zoom_calls_zoom_call_id ON zoom_calls(zoom_call_id);
CREATE INDEX idx_zoom_calls_org ON zoom_calls(org_id);
CREATE INDEX idx_zoom_calls_contact ON zoom_calls(contact_id);
CREATE INDEX idx_zoom_calls_initiated_by ON zoom_calls(initiated_by);
