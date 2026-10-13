# Agent Note: Session-card cover feed and the novelai/latestImage projection

Status: implemented

English | [中文](2026-10-10-session-cover-cards.zh.md)

## Problem

The sidebar session list rendered one 32px text row per session. After the ZZZ reskin the list still carried no InterKnot identity, and a session's NovelAI work was invisible until you opened it. The ask: InterKnot-Web PostCard-style cover cards, the cover being the session's latest NovelAI image (default art before the first generation), click-to-open.

The blocker: the sidebar only ever sees list summaries. Image attachments live inside session logs, and the existing attachment RPC (`session.attachment`) was reachable only through a bound, open session.

## Decision

1. **Host projection `novelai/latestImage`** (`packages/novelai/tool-novelai/src/projection.ts`): a latest-wins fold over successful `novelai_generate` results — call ids claimed on `tool/call`, consumed on append-surface `tool/result`, last image block wins with its seq (the block may sit inside the presented nested `tool-result`; the fold recurses). Replacement-surface results never append. Registration cannot use `ctx.get('sessionProjections')` at apply time: this plugin's `inject` is `['tools']`, so apply runs before the session-controller materializes the service and the optional get silently no-ops — the unit registers through `ctx.inject(['sessionProjections'], ...)` instead, and compositions without the service keep the tool on the default cover. The list flow serves the wire view to every client as part of `SessionSummary.projectionValues`.
   - **Cold backfill** (`src/backfill.ts`, `coverBackfillSessions`, default 100): the list never materializes projection cells, and the api list's small-artifact cold probe only observes artifacts ≤1KB — every real NovelAI session exceeds it, so cached rows never gain the key and cold covers stay default forever. At registration the plugin therefore cold-folds up to `coverBackfillSessions` persisted Sessions (newest first) whose cached cell is missing through `sessionQuery.observeSession(..., { projectionMode: 'none' })` + `sessionProjectionCache.coldSnapshot`, which writes the refreshed row; resident Sessions and Sessions already carrying the key (`null` included) are skipped. Failed folds log and leave default art until the next activity.
2. **Cold attachment read**: `SessionManager.readSessionAttachment(sessionId, attachmentId)` + `ClientSessions`/`ISessions` exposure, decoding the base64 payload once (`attachment-decode.ts`). The Host authorizes against that session's log, so only genuinely referenced attachments resolve.
3. **Cards in ui-workspace**: `SessionNodeItem` renders the InterKnot PostCard cut — black frame (`20px 20px 0 20px`, 3px pad) whose color IS the state (lime hover, yellow selected), 1.576 cover with `default-cover.webp`, the real image fading in over it, a breathing `zzz-pulse-border` running chip, and the hover-revealed actions menu pinned to the cover. Status dots, drag markers, the ⋯ menu, and the hover card keep their row semantics.
4. **Cover transport**: `createCoverCache()` in ui-workspace's apply closure — reference-counted object URLs, 64-entry LRU over unreferenced entries, 60s idle revocation, negative caching of failed reads. Injected as plain data (`coverCache: CoverCache`); cards acquire on mount / release on unmount. Disposed with the plugin fiber.

## Alternatives considered

**Read covers inside the conversation surface** (per-session client): only works for open sessions; the list needs covers for cold sessions.

**Serve thumbnail bytes through a new list RPC**: duplicates the authorization rule the attachment RPC already owns and ships pixels for sessions nobody is looking at.

**Module-level cover cache**: a de-facto singleton across plugin reloads; forbidden by the client rules, and URL revocation must follow fiber life.

## Consequences

- The sidebar covers are eventually-consistent once the backfill has seeded a session's row: they update when the host recomputes projections (activity-driven), not at generation time.
- Failed cover reads stop retrying for the plugin's lifetime (negative cache); a failed read shows the default cover, never an error surface.
- `flatSessionRowWithoutStatus` and the `flat` prop died with the row cut; the status slot's show/hide rule (idle cards carry no dot) survived.
- The first boot after this fix folds up to `coverBackfillSessions` cold sessions (one decompress + fold each); later boots skip sessions whose row already carries the key.
- `pnpm run test:gui` green (55 new/updated assertions across projection fold, cover cache, card behavior, card CSS contract).
- Every touched client program must be rebuilt, not just ui-workspace: the first live boot after this feature shipped default covers on every card because the `@deepseek-ai/dsh-api-session-controller` client bundle predated `readSessionAttachment` — the loader threw synchronously, the negative cache hid the error, and no `session/attachment` request ever fired. `pnpm --filter @deepseek-ai/dsh-api-session-controller run bundle` (plus web dist rebuild and restart) fixed it.

## Related

[2026-10-10 Zenless Zone Zero web skin](2026-10-10-zzz-game-skin.md) — the token/asset layer these cards consume (`--dsw-zzz-*`, `default-cover.webp`).
