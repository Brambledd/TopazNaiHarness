# Workbench bundle freshness: index revalidation and visible boot revs

Status: implemented

English | [中文](2026-10-14-frontend-index-revalidation.zh.md)

- Date: 2026-10-14
- Packages: `host/frontend-static`, `client/modules`
- Status: implemented

## Context

The workbench characters persistence fix reached the server (rebuilt `lib/client.js` on disk, restarted host) while the operator's browser kept running a stale bundle: archives written after the restart still lacked the `characters` field, which only the old bundle's commit effect produces. The plugin bundle route serves combo responses under `cache-control: immutable` with rev-carrying URLs — correct by itself — but the index HTML that embeds those URLs was served with no caching metadata and no validator, so browser behavior on reload was unspecified and a stale cached index pinned a whole session to stale bundle URLs.

## Decision

Two changes, one structural and one diagnostic:

- `host/frontend-static` serves every index response (root and configured index path, GET and HEAD) with `cache-control: no-cache`. Hashed dist assets keep their name-driven caching; unhashed plugin bundles keep `immutable` because their freshness rides the rev query in a now-always-fresh index.
- `client/modules` appends one `console.log("[dsh] bundles:", …)` line to the injected boot facade, printing every batch's rev-carrying URL. An operator can compare two consecutive reloads and see immediately whether the page picked up new bundles, without DevTools network inspection.

## Consequences

- A plain reload can no longer serve a stale boot graph; "deployed but the browser disagrees" diagnoses start from the console line instead of cache archaeology.
- The facade test sandbox gained a console stub (the log line runs at boot).
- `frontend-static`'s spec asserts `no-cache` on index responses and `null` (absent header) on asset and error responses, keeping the contract explicit.
