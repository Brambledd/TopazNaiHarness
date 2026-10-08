# Agent Note: NovelAI workbench surface (interactive studio, tag autocomplete, history canvas, quick tags)

Status: implemented

[中文](2026-10-08-novelai-workbench-surface.zh.md) | English

## Problem

The fork targets a direct-NovelAI agent, but the only generation surface was the model tool: a user could not compose a prompt interactively, pick parameters, browse what was generated, or reuse a past generation. The desktop reference (Langbai NovelAI Studio) owns all of these interactions, and the fork's rule is to mirror them.

## Decision

The workbench is one feature package, `@deepseek-ai/dsh-client-ui-novelai-workbench`, registered into the layout's `'workbench'` slot. The sidebar carries a 对话/创作台 mode switch backed by `LayoutState.viewMode`; the frame keeps both center panes mounted and hides one, so generation state survives switching. The host side is the `NovelaiController` Remote namespace (`novelai`): `catalog`, `estimate`, `generate`, `history`, `removeEntry`, `suggestTags`, and `readEntry`.

**Inject declaration.** A client plugin calling a generated Remote namespace must declare the aggregate *and* the dot-path namespace — `inject = ['remote', 'remote.novelai']` — matching the ui-conversation (`remote.session`) and ui-commands (`remote.commands`) precedent. Declaring only the dot-path fails `ctx.remote` access; declaring only the aggregate fails the namespace property. This cost the series its first live-debug round and is the convention every future remote consumer must follow.

**Parameter panel (desktop parity).** Resolution uses the desktop's model: five pixel tiers (0.4/1/1.5/2/3 MP, the 0.4 tier pinned to 409 600 px) × thirteen aspect ratios, resolved by a 64 px lattice search that scores ratio error against area usage under the official 3 Mi-pixel cap; manual width/height commit on blur or Enter, snapped to 64 px and clamped to the largest partner side. Seed is a two-segment 🎲 random / 🔒 fixed switch; fixed shows a value field plus a dice randomize button, and the completed generation's actual seed is displayed afterwards. The Anlas quote is fetched live (350 ms debounce) over width/height/steps. The negative prompt is a controlled fold.

**Tag autocomplete.** Typing in either prompt textarea extracts the word at the caret (CJK included), debounces 80 ms with a monotonic request id so a stale response never overwrites a newer batch, and queries `suggestTags`: the local bilingual Danbooru index first (see below), then the NovelAI `suggest-tags` endpoint (Bearer token, 5 s timeout, proxy dispatch), falling back to a built-in dictionary (~134 curated entries ported from the MIT desktop app), ranked exact > prefix > substring, then post count. The dropdown anchors vertically below the caret via the mirror-div probe, offers at most 8 items, navigates with arrows, accepts with Enter/Tab, closes with Escape, and stays silent during IME composition.

**Bilingual tag index.** Full-coverage suggestions (game and anime characters such as `topaz (honkai: star rail)`) come from the desktop's optional dataset: the pinned-commit `tags_enhanced.csv` (GBK, GPL-3.0), downloaded on demand (20 MB cap, record floor, atomic replace) to the controller's `tagIndexPath` and never bundled. The first `suggestTags` call on a fresh deployment starts the download in the background; the controller also exposes `tagIndexStatus` and `downloadTagIndex`.

**History canvas.** `readEntry` returns the PNG base64 over the JSON remote channel; the client mints object URLs, caches them per mount, and revokes them at unmount. Tiles open a full-screen lightbox (`role="dialog"`, `aria-modal`) with entry metadata, a parameter backfill button (fills prompt/negative/model/size/steps and switches seed to fixed), and a one-click variation (entry parameters with a fresh random seed).

**Quick tags and styles.** The inspiration-capsule library (curated builtin batch + three authored batches, packed `en=zh|…` strings parsed at load, merged by category/subgroup with per-category English dedup) drives a fold-open browser: category tabs, a bilingual filter, and chips that append `tag, ` to the prompt. The style presets row derives from the taxonomy's 风格画风 category and prepends the style tag.

## Alternatives

**Serving library images through a static webserver route.** Rejected: it would add a file-serving surface for one consumer. Base64 over the existing Remote namespace keeps the trust boundary unchanged and costs a few hundred milliseconds per thumbnail on localhost.

**Bundling the Danbooru Chinese tag CSV.** Rejected as *bundled data*: the dataset is GPL-3.0 while this repo's ported data is MIT-scoped. What shipped instead is the desktop's optional download — fetched on demand into the configured path, validated (header shape, record floor, byte cap), and never committed to the repo — so full character coverage arrives without changing the license surface.

**Writing workbench generations into the conversation session.** Deferred: model-visible input requires a session event, and pushing UI-initiated images into the active session needs a session-write seam design. Generations already interoperate through the shared output library that both the workbench and the `novelai_generate` tool record into; the explicit push remains open work.

**Persistent user-created style presets.** Deferred: the desktop stores them in app data with an image manager. The fork ships curated presets derived from the capsule taxonomy; user-authored presets would want a settings-namespace contribution and arrive with it.

## Impact

`packages/client/ui-novelai-workbench` (panel, autocomplete, capsule, history), `packages/api/novelai-controller` (namespace verbs, dictionary, scoring), and `packages/novelai/novelai-core` (`requestTagSuggestions`) grew; the api-remotes client bundle embeds the regenerated namespace and must be rebuilt after any controller verb change — a stale remotes bundle manifests as a silently swallowed property-proxy miss, so verb additions are not complete until that bundle is rebuilt and the page reloaded. Component specs cover the panel, autocomplete, capsule, and history behaviors; a host spec covers dictionary ranking. Known deferred work: the session-push interop above and persistent style presets.
