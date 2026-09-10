# Worker: serene-ops-crm-api

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
