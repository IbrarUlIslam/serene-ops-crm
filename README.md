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

The October 12 contact navigation release passed 552 regression checks. Sections, contact tabs, list/cards and saved views use native deep links for Chrome new-tab actions. Contact shortcuts outside Contacts open an access-scoped side preview, with a full-record link. Previous/next walks the entire filtered list across pages and excludes archived or inaccessible records. Filters start collapsed, duplicate filtering remains at the top, and Trying to contact is available in prospect status options and server validation. Notes use one inline composer, retain existing shared context and call notes, preserve drafts per user/contact on the device, and append timestamped notes through an idempotent server save. Lost acknowledgements retain the exact retry payload even after reload. The main CRM loads a dedicated layout stylesheet; embedded page structural styles stay isolated.

The October 13 Zoom Workplace fix passed 560 regression checks. Administrator click-to-call keeps the native zoomphonecall handoff and no longer opens or bootstraps the separately authenticated Zoom Smart Embed panel. Call history and voicemail still sync through the Worker. Hiding an optional legacy panel never initializes the SDK, and a CRM-owned Close control plus Escape can dismiss it without ending a desktop call. Outbound launches require a confirmed server claim and unchanged calling access. Sales retain Google Voice. Verification used mocked handoffs and placed no real calls. Zoom URI reference: https://developers.zoom.us/docs/phone/outbound-call/ .

The October 14 calling update passes 573 regression checks. Every caller can choose Zoom Workplace or Google Voice using the Calling app selector in the sidebar. The preference saves to their own CRM profile and follows contact, pipeline and Next to call actions. Existing defaults remain; a Zoom choice still requires an authorized Zoom Phone mapping and signed-in client. Changing providers cannot grant access or launch an obsolete request. Both handoffs preserve international numbers and use server contact, DNC and local-hours checks; provider opens never count as completed calls. Manual outcomes remain required for Google Voice and calls not automatically attributed by Zoom.

Contacts and Next to call support Phone country filtering. Contact country is separate from phone country: a UK-based contact can have an overseas phone. Explicit mobile-country metadata distinguishes US/Canada numbers when supplied; older ambiguous +1 numbers are labelled US / Canada. Missing phones remain Unknown. UK imports retain Europe/London so daylight-saving changes follow the timezone rules. Prospeo import data, manifests, review rows and guarded backups are private operational files excluded from Git and Pages assets; imports do not create consent, calls, deals or audits.

