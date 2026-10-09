# Worker: serene-ops-crm-api

> Current source published October 10, 2026. See the root README for the current module map, testing and deployment guidance. The baseline notes below describe the original September import and are retained as history.

This directory documents the existing, live Cloudflare Worker that powers the
Serene Ops CRM backend (serene-ops-crm-api), for reference and disaster
recovery.

## Contents

- worker.js - verified, byte-accurate copy of the Worker source currently
  deployed in production. Committed as a clean baseline before any
  Zoom/Zoho integration changes are made.
- wrangler.toml - documents the live bindings, routes, and cron triggers
  exactly as configured in the Cloudflare dashboard. It intentionally does
  not redeploy or alter production on its own (no CI/CD is wired to it
  yet).

## Secrets

No secret values are ever stored in this repository. Secrets are managed
directly in Cloudflare via wrangler secret put NAME (or the dashboard),
and only their names are documented in wrangler.toml as comments.

## Status

This baseline reflects the live Worker as verified on 2026-09-10, before the
Zoom OAuth + webhook integration work begins on the zoom-zoho-integration
branch. Changes to this Worker are made incrementally and regression-tested
against the existing endpoints (health check, authenticated API, DB
passthrough, nightly backup jobs, etc.) before each deploy.



## Production dependency: Cloudflare Access CORS bypass (2026-09-10)

`crm.sereneop.com` is protected by Cloudflare Zero Trust Access. Access
intercepts every request to the app, including CORS preflight (`OPTIONS`)
requests. Browsers never send cookies/credentials on a preflight request,
so an unauthenticated `OPTIONS` hitting an Access-protected app normally
gets a bare `403` from Access itself (no CORS headers, request never
reaches the Worker) instead of the `204`/`200` a real CORS preflight
needs. This silently broke every non-GET or custom-header fetch (PUT,
POST, DELETE, and any request with e.g. an Authorization header) made
from the staging frontend origin
(`https://zoom-zoho-integration.serene-ops-crm.pages.dev`) to
`https://crm.sereneop.com/api/*` - including all Zoho mail actions
(send, reply/forward, mark-read, claim, contact link, attachment
upload).

### Fix applied

In the Cloudflare Zero Trust dashboard: **Access controls -> Applications
-> [the `crm.sereneop.com` app] -> Additional settings -> CORS headers ->
"Bypass options requests to origin"** was enabled.


This makes Access forward `OPTIONS` requests straight to the origin
(the Worker) without requiring an Access session, while every other
HTTP method on the app remains fully Access-authenticated exactly as
before. Before enabling it, the app's existing Access-managed CORS
config was inspected and confirmed to be completely empty/default, so
nothing was lost (Cloudflare's UI warns this option clears any
Access-managed CORS settings on the app).

### Why this is still safe

The Worker (`worker.js`, functions `corsHeaders()` / `withCors()`) is
and remains the sole authority for CORS on every response, preflight
included:

- `Access-Control-Allow-Origin` is only ever echoed back for an exact
  match against the `ALLOWED_ORIGINS` allowlist (`https://crm.sereneop.com`
  and `https://zoom-zoho-integration.serene-ops-crm.pages.dev`) - no
  wildcards, no reflection of arbitrary Origin headers.
- `Access-Control-Allow-Credentials: true` is only sent alongside an
  approved origin.
- Only the required methods/headers are advertised.
- `OPTIONS` responses carry CORS metadata only - never CRM data, and
  the Worker performs no state-changing action on `OPTIONS`.
- All real (non-`OPTIONS`) requests to `/api/*` still require a valid
  Access session and are still redirected/rejected by Access when
  unauthenticated - only the preflight itself bypasses Access.
- `/zoom/webhook` remains the only intentionally public endpoint;
  `workers.dev` and its separate Access application were not touched.

### Verification performed (2026-09-10, via curl and live browser testing)

- `OPTIONS /api/db` from the approved staging origin -> `204` with
  correct Worker-issued CORS headers.
- `OPTIONS /api/db` from an unapproved/malicious `Origin` -> `204`
  with **no** `Access-Control-Allow-Origin` header.
- Authenticated `PUT /api/db` from staging -> succeeds normally.
- Unauthenticated direct `GET`/`POST`/`PUT` to private `/api/*` routes
  -> still rejected/redirected by Access.
- `crm.sereneop.com` and `workers.dev` remain Access-protected.
- `/zoom/webhook` remains public (405 on GET, as expected - it only
  accepts the real webhook method).

### Operational note

If this Access application is ever recreated or its CORS settings are
reset, this bypass must be re-enabled or every cross-origin mutating
request from the staging (and any future non-`crm.sereneop.com`)
frontend to the CRM API will start failing CORS preflight again. The
Worker's own `ALLOWED_ORIGINS` allowlist is the actual security
boundary and does not need to change when this setting is touched.


## Staging same-origin hostname: staging-crm.sereneop.com (2026-09-11)

`staging-crm.sereneop.com` is a dedicated same-origin staging hostname on
this same Worker, added so authenticated live regression of the
`zoom-zoho-integration` Pages branch does not hit the cross-site
Cloudflare Access + CORS problem a `*.pages.dev` preview origin has when
calling `crm.sereneop.com/api/*` directly. It has its own DNS record
(proxied CNAME to `serene-ops-crm.pages.dev`, mirroring `crm.sereneop.com`'s
record) and its own, separate Cloudflare Access application (same
"Approved Serene Ops users" reusable policy as production; a distinct AUD,
added to `ACCESS_AUD` in `wrangler.toml`).

On this hostname the Worker (see `proxyStagingFrontend` in `worker.js`)
handles every request itself: `/api/*` goes through the exact same handlers
as production, and everything else is proxied server-side to the current
`zoom-zoho-integration` Pages branch deployment
(`zoom-zoho-integration.serene-ops-crm.pages.dev`).

### Required Worker secrets: STAGING_PAGES_ACCESS_CLIENT_ID / STAGING_PAGES_ACCESS_CLIENT_SECRET

The `zoom-zoho-integration.serene-ops-crm.pages.dev` branch preview is
itself protected by its own separate Cloudflare Access application
("Serene Ops CRM (pages.dev)"). The Worker's server-side proxy fetch to
that origin carries no browser session/cookies, so without authenticating
that specific request, Access hands back a login redirect for its own app
instead of the real page -- which, if passed through to the real browser,
sends it into a second Access context it cannot cleanly resolve (this is
what produced an "Invalid login session" error during setup).

The fix: the Worker authenticates that one internal fetch using a
Cloudflare Access **Service Token**, sent as the `CF-Access-Client-Id` /
`CF-Access-Client-Secret` headers. This is entirely separate from, and
never mixed with, the production CRM Access app, its AUD list, or the
end-user login flow -- it only lets this Worker's own outbound request
through the *pages.dev preview's* Access gate; end users still log into
`staging-crm.sereneop.com` normally via the real "Approved Serene Ops
users" policy.

Provisioning (done once, by a human, in the Cloudflare dashboard and
terminal -- never via chat/AI, since the secret values must never pass
through any AI-visible channel):

1. Zero Trust -> Access -> Service Auth -> **Create Service Token**, named
   e.g. `Serene Ops CRM Staging Proxy`.
2. Add that Service Token to the **Service Auth policy** on the
   `zoom-zoho-integration.serene-ops-crm.pages.dev` Access application
   ("Serene Ops CRM (pages.dev)"), so requests carrying its Client
   ID/Secret bypass the interactive login for that app specifically.
3. Set the two Worker secrets directly (values are generated once by
   Cloudflare and shown only at Service Token creation time -- copy them
   straight into these commands, never paste them anywhere else):
   ```
   wrangler secret put STAGING_PAGES_ACCESS_CLIENT_ID
   wrangler secret put STAGING_PAGES_ACCESS_CLIENT_SECRET
   ```

If these secrets are missing, wrong, or the Service Auth policy isn't
attached yet, the Worker's proxy detects the resulting 3xx/401/403 from
the pages.dev origin and returns a clear "Staging proxy misconfigured"
error to the browser instead of forwarding an Access login redirect
(which is what caused the original bug) -- so a broken configuration
fails loudly and safely rather than looping.
