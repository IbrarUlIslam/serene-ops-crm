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

The October 10 CRM changes passed 505 tests. Administrators see all contacts and can filter or assign them by user; sales staff see assigned contacts only. The release adds confirmed Zoho From addresses, browser history navigation, contact cards and DNC/Not interested statuses, unified Notes with call notes, server duplicate prevention and an administrator call dashboard.

## Deployment and credentials

Production secrets are stored in Cloudflare, not this repository. Database records, uploaded documents, backups and local screenshots are excluded. Cloudflare Access policies are managed separately.

Worker deployment uses `worker/wrangler.toml`; preserve existing variables and secrets. Pages deployment must use a dedicated public directory containing only frontend HTML/CSS/JS and the three assets under `assets/`. Do not upload the whole source repository as public site content.

Publishing source is separate from changing user permissions, creating invitations or placing calls.


The infrastructure review also hardens Access JWT claims and Zoho diagnostics, retries failed Zoom webhook events, discovers business backup tables automatically, surfaces backup and queue failures, paginates 45-day backup retention, and redacts query strings in Worker logs. Build Pages with `node scripts/build-pages.mjs`; only its explicit frontend list is published. Private business backups exclude active sessions, Zoho OAuth credentials/state and user password hashes. D1 Time Travel is the full-database recovery path; R2 backups do not copy linked external documents.


The October 12 navigation fix passed 515 tests. Browser Back stays within the signed-in CRM at the entry page; Back/Forward restore contact tabs and page shortcuts without discarding pending notes. Refresh the frontend once after deployment to load the fix. Authentication expiry and staff access restrictions remain enforced.

The October 12 sales dashboard release passed 537 regression checks. Admins can review current contact assignments and unique contacts worked today, this calendar week or this calendar month, with daily breakdowns by salesperson in Pakistan time. Sales associates receive a read-only Dashboard showing only their own recorded work today; week/month reporting and team data are denied on the server. Apply worker/migrations/20261012_sales_dashboard.sql before deploying the Worker. The activity ledger preserves reporting when snapshot history is trimmed and excludes assignment-only changes, imports, automation and dialer opens.

Sales Call actions use a checked tel link for Google Voice in Chrome; administrators retain Zoom. Each salesperson must enable Google Voice one-click dialing alongside their extension: https://support.google.com/chrome/answer/11397414 . The CRM verifies assigned access, stored phone, calling hours and DNC before handoff. Google Voice does not report call completion through this handoff; outcomes and notes must be saved in the CRM. No actual call, invitation or provider purchase was made during verification.
