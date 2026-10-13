# Bundled display fonts

Files served by the web build (`apps/web/public/fonts/`) and consumed by
`packages/client/ui-theme/src/styles/zzz.css`.

- `zh-cn-light.ttf` — "InterKnot Sans" body cut (font-weight 1–699).
- `zh-cn-bold.ttf` — "InterKnot Sans" heading cut (font-weight 700–900).
- `zzz-comic-en.woff2` — "ZZZ Comic" Latin display face.
- `zzz-comic-zh.woff2` — "ZZZ Comic" Chinese (Traditional) display face.
- `zzz-impact.woff2` — Impact-style condensed face.

Sources: the InterKnot Sans TTFs ship with
[KawaYiLab/InterKnot-Web](https://github.com/KawaYiLab/InterKnot-Web)
(`public/zh-cn-light.ttf`, `public/zh-cn-bold.ttf`), which documents them as
the 印品鸿蒙体 faces used by the official Zenless Zone Zero website
(zzz.mihoyo.com). The woff2 faces were downloaded from zenless.tools (a
fan-made Zenless Zone Zero themed tools site), static assets
`/_next/static/media/zzz_comic-s.p.1bbdmio7e5wee.woff2`,
`/_next/static/media/zzz_comic_zh_traditional-s.p.3706t0qapi2d_.woff2`, and
`/_next/static/media/impact-s.p.1qg4r65tegenw.woff2`. The typefaces replicate
the look of Zenless Zone Zero (© miHoYo / HoYoverse); the game's actual brand
fonts are not included. Bundled here for personal, non-commercial local use in
this project. Remove this directory to fall back to the system font stack in
`zzz.css`.
