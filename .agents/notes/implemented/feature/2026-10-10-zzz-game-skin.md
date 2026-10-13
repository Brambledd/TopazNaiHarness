# Agent Note: Zenless Zone Zero web skin

Status: implemented

English | [中文](2026-10-10-zzz-game-skin.zh.md)

## Problem

The web client shipped the default neutral DeepSeek palette. The operator asked for a Zenless Zone Zero visual identity built from real fan-project material rather than a palette swap: the zenless-ui design language, zenless.tools type, and the InterKnot-Web game assets (cursors, textures, artwork) —without breaking the [web styling system](../../../../docs/web-styling.md) (CSS Modules, tokens-only colors, no component library) or the [client styling architecture](../architecture/2026-08-17-dynamic-client-render-and-attachment-ownership.md) (global sheets are ui-theme-owned and lifecycle-managed).

## Decision

One new global sheet plus targeted component signatures; every asset is a static file under `apps/web/public/`, never bundled or inlined.

- **Token layer** —`ui-theme/src/styles/zzz.css` (sixth global sheet, mounted after the two token sheets so equal-specificity remaps win the cascade) publishes `--dsw-zzz-*` accents, textures, cursor URLs, and display-font stacks on `body`, and remaps the dark/light alias palettes (base surfaces, brand primary `#008bff`, electric `#2eb6ff`, yellow→green pulse pair, scrollbar thumbs). Fonts: "InterKnot Sans" (印品鸿蒙体 `zh-cn-light/bold.ttf`, weight split at 700) shadows `--dsw-font-family` for the whole UI; "ZZZ Comic" stays the Latin display fallback.
- **Game cursors** —`body` plus semantic selectors (`button/a/summary/…`, `input/textarea/[contenteditable]`, `:disabled`, `[aria-busy]`) get the InterKnot-Web cursor PNGs with measured hotspots; `!important` mirrors upstream so module-level `cursor:` declarations cannot outrank the skin.
- **Panel material** —`--dsw-specific-menu` becomes `#101013 url(tab-bg-point.webp) repeat` (dark) / `#f4f5f7 url(...) repeat` (light); every consumer already reads it through a `background:` shorthand, so no component edit is needed. `--dsw-alias-bg-layer-2` deliberately keeps a plain color: it feeds gradients and box-shadows where a full background value would invalidate the declaration.
- **Component signatures** —Modal (`20px 0 20px 20px`, ink border, dotted fill, `close-btn.webp` close button with the icon visually suppressed), user bubbles (borderless fill + `chat_message_arrow_right.webp` nipple at the InterKnot geometry, theme-scoped brightness filters), the conversation tab highlight (the InterKnot squashed-hexagon SVG as a data URI, hard-flickering `#fbfe00→dcfe00` at 800 ms while scaling 1.08→.2), the hero marquee (two counter-drifting rotated rows behind the stack, CSS-pseudo only so no product copy enters TSX), the workbench stage (Bangboo mascot on empty/running states over the `banner.png` backdrop), and the sidebar/frame drag handle (game col-resize cursor). All motion has `prefers-reduced-motion` fallbacks.
- **Provenance** —`apps/web/public/interknot/LICENSE.md` and `apps/web/public/fonts/LICENSE.md` record sources and the personal, non-commercial local-use stance; ASCII-renamed cursor files avoid non-ASCII `url()` pitfalls.

## Alternatives considered

**Bundling assets through the CSS pipeline (Vite `?url` imports).** Rejected: theme CSS is an inlined string inside ui-theme's dynamic bundle, so relative asset URLs would need bundle-internal hashing for files the shell already serves from `public/`; page-relative URLs keep the sheet diffable and the assets swappable.

**Texturing `--dsw-alias-bg-layer-2` directly.** Rejected: the alias feeds `linear-gradient(...)` stops and `box-shadow` colors (TrajectoryTimeline), where a space-separated background value silently invalidates the whole declaration.

**Injecting the marquee/tab SVG through component TSX.** Rejected for the marquee (the text would be hardcoded product copy, violating locale ownership); the tab highlight keeps its geometry as an SVG data URI in CSS, which is presentation, not copy.

## Consequences

`test:gui` passes unchanged except the intentional `ui-workspace` selected-row token assertion, updated with the behavior. Every added selector is theme-scoped or token-driven, so removing `zzz.css` (and the `public/interknot` + TTF files) restores the stock skin. New game-art dependencies are confined to `apps/web/public/` with license notes; no package manifest, loader graph, or slot shape changed. The skin remaps existing `--dsw-*` aliases, so future components inherit it without opting in.
