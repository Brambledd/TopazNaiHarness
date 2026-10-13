# Bundled Zenless Zone Zero game assets

Cursor and image assets served by the web build (`apps/web/public/interknot/`)
and consumed by `packages/client/ui-theme/src/styles/zzz.css` plus client
component CSS modules.

- `cursors/*.png` — the ZZZ in-game cursor set (normal/link/text/busy/resize
  and friends), renamed to ASCII filenames. Hotspot coordinates follow
  InterKnot-Web's `app/assets/styles/theme.css`.
- `images/tab-bg-point.webp` — the dotted point tile behind game panels, tab
  strips, and dropdowns (`#050505 url(...) repeat`).
- `images/close-btn.webp` — the dedicated dialog close-button artwork.
- `images/chat_message_arrow_left.webp` / `chat_message_arrow_right.webp` —
  chat-bubble nipple artwork (originally via zenless-tools' chat generator).
- `images/Bangboo.gif` — Bangboo load mascot (workbench empty/generating
  states).
- `images/loading.gif` — boot loading animation (bundled, currently unused).
- `images/banner.png` — profile banner artwork (workbench empty-state
  backdrop).
- `images/default-cover-novelai.webp` — the PostCard default cover artwork
  (session cards before their first NovelAI generation); user-supplied
  NovelAI output (1024×1024), not part of the InterKnot-Web asset set. The
  `-novelai` name replaces the original `default-cover.webp` (its URL stayed
  cached in long-lived browsers after the artwork changed).
- `images/dennies_v2.webp` — Dennies currency icon (bundled, currently
  unused).
- `images/zzzicon.png` — Inter-Knot brand icon (bundled, currently unused).

Source: [KawaYiLab/InterKnot-Web](https://github.com/KawaYiLab/InterKnot-Web)
(`public/cursors/`, `public/images/`), a fan recreation of the in-game
Inter-Knot website. All artwork depicts Zenless Zone Zero (© miHoYo /
HoYoverse) material; bundled here for personal, non-commercial local use in
this project. Remove this directory to fall back to the plain token-only
skin.
