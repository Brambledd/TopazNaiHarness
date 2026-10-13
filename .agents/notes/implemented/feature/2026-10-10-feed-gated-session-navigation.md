# Agent Note: Feed-gated session navigation (the outermost surface shows no conversation detail)

Status: implemented

English | [中文](2026-10-10-feed-gated-session-navigation.zh.md)

## Problem

The Web GUI's outermost surface was the conversation itself: booting the app dropped the user straight into the selected session's full transcript, model picker, and composer. After the InterKnot reskin gave every session a cover card, the shell still had no overview surface — the session detail was visible before any deliberate choice, and there was no way to step back out to a whole-account view without closing panels.

The ask: the outermost level shows no conversation detail; clicking through from it enters the conversation, modeled on [InterKnot-Web](https://github.com/KawaYiLab/InterKnot-Web) (feed of cover cards → detail).

## Decision

1. **A two-level session view in the layout store** (`ui-layout`): `sessionView: 'feed' | 'entered'` boots at `'feed'`, with `enterSession()` / `exitToFeed()` actions on the store, the `ILayout` service face, and the frame. `enterSession` also drops the `feedExpanded` override so a return to the feed starts collapsed.
2. **The frame gates visibility, not mount**: AppFrame renders a third center pane occupying the new `'shell.feed'` child slot. All panes stay mounted (`display:none` for hidden ones — the existing center-pane rule extended to three panes), so entering a session never remounts the conversation. At the feed level the conversation and workbench panes are hidden and the frame renders a post-header back bar (back button + document title) above the conversation pane; its click calls `exitToFeed`.
3. **Feed sidebar discipline**: at the feed level the sidebar force-collapses to its 56px rail (a separate `feedExpanded` override, so the entered-level width preference is untouched); the rail's toggle re-expands it over the feed and collapses it back. At the entered level the pre-existing collapse semantics are unchanged.
4. **The feed wall is ui-workspace's**: a new `FeedWall` component registers into `'shell.feed'` through `ctx.slots.inject('shell.feed', ...)`. It reuses the flat browsing derivation (newest first, archived and subagent-origin rows filtered, blank provisional rows hidden) and renders the same `SessionNodeItem` cover cards without drag affordances. Every session activation lands on the conversation surface at the session level: ui-workspace's `open`/`startSession`/`forkSession` call `setViewMode('conversation')` then `enterSession()`, and ui-sidebar's New Session inject (which rides the raw `uiWorkspace.startSession` service) makes the same two calls — one navigation seam, exercised identically from sidebar rows, search results, the wall, and the capsule.
5. **The sidebar switch becomes three segments**: 列表 (feed) / 对话 (conversation) / 创作台 (workbench). Conversation and workbench set the center `viewMode` and enter the session level; feed exits to it. Active state follows the owner share's `sessionView` + `viewMode`. `dsh.client.inject` gains the informational `@deepseek-ai/dsh-client-ui-layout` edge (plus devDependency and tsconfig reference) for the `ILayout` type.

## Alternatives considered

**A client-side route/state outside the layout store**: the frame, back bar, and sidebar all consume the level; a second state owner would race the store the way the pre-slot shell did. The store is the single face both plugin halves already share through `ctx.layout`.

**Unmounting the conversation at the feed level**: the existing no-remount rule exists because a conversation remount loses scroll, composer draft, and projection caches; the gate is visibility only.

**Keeping the sidebar expanded over the feed**: the rail keeps the account view centered on cards and matches the reference skin; the width preference survives, so entering restores the exact pre-feed width.

## Consequences

- Boot lands on the feed; the first thing a user sees is the cover-card wall with the default art (see the cover-cards note), and session content requires an explicit activation.
- The conversation stays mounted behind the gate: entering and exiting never remounts it, and the details column keeps its session-lifecycle behavior unchanged.
- ui-layout's SlotMap grows `'shell.feed'` (`single`, root scope); the client inspect catalog, `docs/subsystems/slots.md`, and the package READMEs updated in the same change.
- `pnpm run test:gui` green (299 files): layout-store/feed-level frame tests, the three-segment sidebar snapshots, the FeedWall suite, and the ui-workspace apply tests (including the feed-wall registration and `enterSession` assertions) all pin the new model.
- Live-server probing requires rebuilding every touched client bundle (`ui-layout`, `ui-workspace`, `ui-sidebar`) plus the web dist — the registry serves `lib/client.js`, not sources.

## Related

- [2026-10-10 Session-card cover feed](2026-10-10-session-cover-cards.md) — the cards the wall renders and the projection/caching seam behind them.
- [2026-10-10 Feed masonry and InterKnot card colors](2026-10-10-feed-masonry-card-colors.md) — supersedes this note's single-column wall cut: the wall now places the same cards into a shortest-column masonry with the brand-blue title anchor.
- [2026-10-10 Zenless Zone Zero web skin](2026-10-10-zzz-game-skin.md) — the token/asset layer and the solid menu fix from the same reskin pass.
