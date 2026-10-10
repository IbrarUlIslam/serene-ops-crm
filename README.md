# Serene Ops CRM

Custom CRM hosted on Cloudflare Pages with a Cloudflare Worker API, D1 database and R2 document storage.

## Source map

- `index.html`: application shell and embedded native frontend template.
- `audits.*`, `audit-connectors.*`: audit workflow and research connections.
- `call-queue.*`: contact calling list and outcome entry.
- `users.*`: user administration and invitations.
- `worker/worker.js`: backend entry point and core integrations.
- `worker/*.mjs`: audit generation, permissions, contact autosave, archiving, calling, storage and workflow modules.
- `worker/migrations/`: database schema changes.
- `worker/*.test.mjs`: regression tests.
- `worker/*.cjs`: historical frontend transformation and verification utilities. The committed frontend already contains their changes; do not rerun all transforms as a build step.

## Verification

Use a current Node.js version with the built-in SQLite module:

```sh
node --test --test-isolation=none "worker/*.test.mjs"
```

The October 10 CRM changes passed 502 tests. Administrators see all contacts and can filter or assign them by user; sales staff see assigned contacts only. The release adds confirmed Zoho From addresses, browser history navigation, contact cards and DNC/Not interested statuses, unified Notes with call notes, server duplicate prevention and an administrator call dashboard.

## Deployment and credentials

Production secrets are stored in Cloudflare, not this repository. Database records, uploaded documents, backups and local screenshots are excluded. Cloudflare Access policies are managed separately.

Worker deployment uses `worker/wrangler.toml`; preserve existing variables and secrets. Pages deployment must use a dedicated public directory containing only frontend HTML/CSS/JS and the three assets under `assets/`. Do not upload the whole source repository as public site content.

Publishing source is separate from changing user permissions, creating invitations or placing calls.


The infrastructure review also hardens Access JWT claims and Zoho diagnostics, retries failed Zoom webhook events, discovers business backup tables automatically, surfaces backup and queue failures, paginates 45-day backup retention, and redacts query strings in Worker logs. Build Pages with `node scripts/build-pages.mjs`; only its explicit frontend list is published. Private business backups exclude active sessions, Zoho OAuth credentials/state and user password hashes. D1 Time Travel is the full-database recovery path; R2 backups do not copy linked external documents.
