# Agent Note: Feed masonry and InterKnot card colors

Status: implemented

English | [中文](2026-10-10-feed-masonry-card-colors.zh.md)

## Problem

The feed wall (`shell.feed`) shipped as a single centered column of cover cards. The user pointed at [InterKnot-Web](https://github.com/KawaYiLab/InterKnot-Web) (`app/components/VirtualMasonry.vue`, `app/assets/styles/theme.css`) as the reference: its feed staggers cards at different heights and keeps a tight, deliberate color arrangement. The approved plan: real waterfall placement plus the original's color system, adapted to the session-card cut.

## Decision

- **Placement** — `rows/feed-masonry.ts` ports VirtualMasonry's geometry as a pure function: target column 240px, gap 16px, column count clamped to 2–6, remaining width stretched into the columns. Cards place row-major into the currently shortest column (ties leftmost), so the newest card stays top-left and reading order sweeps left to right. No virtualization: session counts are small.
- **Measured heights** — `FeedWall` renders each card inside an absolutely positioned cell and observes the cells with one shared `ResizeObserver`; measured heights (cover aspect + meta strip) drive re-placement through a version counter. Unmeasured cards use a fallback height, so the first paint lays out before measurement lands. The wall's own content box is the placement space (1552px outer = 1520px content = six 240px columns at wide viewports). Runtimes without `ResizeObserver` (jsdom) keep the fallback layout — the repo-wide guard convention.
- **Colors** — card titles become the brand-blue anchor (`--dsw-zzz-primary`, `#008bff`; hover/selected brighten to `--dsw-zzz-electric`), blank provisional rows stay tertiary gray via a new `blankRow` class. This follows InterKnot's "one accent color as the wall's anchor, state colors only on frames" arrangement; the app's own ZZZ blue replaces InterKnot's material blue so the wall keeps one blue family with the rest of the reskin. The earlier `.cardCover` fix (no square-grid texture over the default art) stays.
- **Per-cover stagger** — the aspect cut lives on the cover image itself (`aspect-ratio: 1.576` as the CSS default): when a real cover decodes, its intrinsic `naturalWidth/naturalHeight` replaces the ratio inline, portrait generations run tall, landscape ones squat, and the measured-height loop re-places the wall. The default art never adopts the placeholder's 1:1 ratio.

## Alternatives considered

- CSS multi-column (`columns: 240px`) gives the waterfall with zero JavaScript but reads column-major (the whole first column before the second), breaking newest-first scanning and the shortest-column stagger; the row-major placer keeps the reading order.
- Parsing cover dimensions into the `novelai/latestImage` projection would pre-layout each card at its true ratio before bytes load; deferred because the measured-height loop already re-places on load and the host-side dimension read adds a storage seam for one frame of accuracy.

## Consequences

- `placeMasonry` is unit-covered (`tests/feed-masonry.spec.ts`); the rows and feed-wall specs cover the color hooks and the cover-cache lifecycle.
- A PowerShell 5.1 `Set-Content` rewrite corrupted `tests/rows.client.spec.tsx` (UTF-8 read as GB2312); the file was restored from HEAD and the session-era cover assertions rewritten against the current implementation. Never round-trip workspace text through `Get-Content`/`Set-Content` without `-Encoding utf8NoBOM`.
- README (en/zh) documents the masonry wall.

## Related

- [2026-10-10 Feed-gated session navigation](2026-10-10-feed-gated-session-navigation.md) — partially superseded by this note: the wall's single-column cut is now the shortest-column masonry with the brand-blue title anchor.
- [2026-10-10 Session-card cover feed](2026-10-10-session-cover-cards.md) — the cards the wall renders and the projection/caching seam behind them.
