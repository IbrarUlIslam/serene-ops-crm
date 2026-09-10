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

