# Agent Note: The workbench artist chains (画师串)

Status: implemented

English | [中文](2026-10-13-workbench-artist-chain.zh.md)

## Problem

NovelAI blends artists through weight-framed runs like `0.3:cola gotouryouta::, 0.9:re0n::` — one pasted standard chain per style, retyped from memory or a scratch file every time. The workbench had quick tags and style presets, but nothing stored the operator's chains, and nothing inserted a whole chain in one action.

## Decision

A named-chains library under the harness home, managed in a collapsible panel section:

- **A single JSON-array document** — `ArtistChainStore` keeps the library as one array of `NovelaiArtistChain` at `<home>/novelai-artist-chains.json`, rewritten atomically (`.tmp` + rename) on every mutation and cached in memory after the first read. A missing, unparseable, or wrong-shaped document reads as an empty library — small re-addable user data, mirroring the panel-state store's tolerance. Without a resolvable home the store degrades to memory-only with the constructor warning.
- **Whole strings under names, never parsed** — each chain is `{ id, name, tags }` with a host-assigned `crypto.randomUUID()` opaque id. The tags text is ONE verbatim string: a pasted standard run like `0.3:cola gotouryouta::, 0.5:yoneyama mai::, 0.7:betabeet::, 0.9:re0n::, 1.8:kim hyung tae::` is stored exactly as given (outer trim only); the store performs no per-artist parsing, weight validation, or recomposition, so nothing the paste expresses can be lost. The name is the library's organizing handle: trimmed, 1–80 characters; the tags 1–2000 characters. `saveArtistChain` creates when the id is empty (the new chain appends as the newest) and updates in place through a stored id, keeping its slot; the list serves newest first.
- **Three Remote verbs on the `novelai` namespace** — `artistChains` reads the library, `saveArtistChain` creates or updates one named chain by id, `removeArtistChain` removes by id. Refusals surface as `novelai/artist-chain-invalid` (reason in the message) and `novelai/artist-chain-missing` (unknown id). The generated namespace needed the host lib rebuild before the client could type the new verbs; the bundle now carries them.
- **The collapsible 画师串 section** — the fold pattern of the styles section, placed beside it. The library loads lazily on first open; each row shows the chain's name and its whole tags text (ellipsis-truncated, full text on hover) with 插入, which appends that chain's tags to the prompt (`prompt === '' ? tags : prompt.trimEnd() + ', ' + tags` through the existing `setPrompt`, so the insert flows into the panel's normal commit chain), and 删除, which removes without a confirmation round-trip (small, re-addable data). Below the rows, a name + tags form saves a new entry (empty id) and re-renders from the saved answer; its button stays disabled until both fields are non-blank. The name placeholder carries the friendly example (如「厚涂风」/ e.g. "impasto style"); the tags placeholder shows the standard format — `0.3:cola gotouryouta::, 0.5:yoneyama mai::, …` with the `权重:画师::，逗号分隔` / `weight:artist::, comma-separated` hint — so the format to paste is visible before anything is typed. All copy lives in the typed dictionaries (both languages).

## Alternatives considered

**Per-artist entry editing (an entry list with weight fields).** Rejected: the real workflow is pasting a standard chain from reference material and managing it as one unit; parsing `weight:artist::` runs back into entries invites lossy fixes, and the per-entry composition re-orders and reformats text the operator already had right. The chain is stored and inserted verbatim instead.

**Client-owned storage.** Rejected: the chains are prompt material every browser surface shares, so they must survive service restarts and follow the operator across browsers; host-side storage keeps id authority and validation beside the other durable workbench state.

## Consequences

`api-novelai-controller` gains `src/artist-chains.ts` and two error-vocabulary rows; `ui-novelai-workbench` gains three inject faces, the section, and bilingual dictionary keys. An insert mutates only the panel prompt — the workbench-state persistence from [the panel-state note](2026-10-13-workbench-state-persistence.md) commits it exactly like a typed edit. Covering specs: `novelai-controller/tests/artist-chains.host.spec.ts` (verbatim tags storage, id-based create and in-place update, newest-first serving, restart semantics, tolerance, refusals, cold-store paths, degradation) and `tests/novelai-controller.host.spec.ts` (the three verbs through the host harness); `ui-novelai-workbench/tests/workbench-panel.client.spec.tsx` covers open/lazy load, insert into empty and non-empty prompts, save/remove, the disabled-form guard, and the failure arms. Deferred: editing a saved chain's name/tags in place from the panel (today the form only creates; updates exist at the verb level), drag ordering, and an artist-name autocomplete over the tag index.
