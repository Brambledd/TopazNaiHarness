# Agent Note: Characters slot on the prompt patch (structured multi-character edits from conversation)

Status: implemented

English | [中文](2026-10-14-novelai-patch-characters-slot.zh.md)

## Problem

`novelai_prompt_patch` could only target the positive, negative, and settings slots. When the operator asked for a multi-character scene, the model followed the tool's "patch first, then generate" contract faithfully — and had nowhere to put the characters but the positive slot. A session log showed 22 positive-slot operations that blended every character's traits into the shared prompt; the workbench panel kept zero character cards, and generation ran with the old blended prompt. The structured `characters` parameter on `novelai_generate` and its backfill split never came into play, because the panel had nothing to backfill.

## Decision

The patch vocabulary grows a fourth slot — `characters` — and the whole chain speaks it:

- **Tool side (`tool-novelai`)** — the schema accepts a 1-based integer `character` per operation; `normalizePatch` rejects missing, zero, fractional, or tag-less characters operations and emits `character` as a string in the plain-record result (the lossless-JSON result boundary). `PATCH_DESCRIPTION` now leads with the multi-character rule: every character gets its own operations and number, only SHARED scene tags (setting, lighting, composition, quality) belong on the positive slot.
- **Card side (`ui-novelai`)** — the slot label map gains `patch.slot.characters`, and each operation renders a `角色 {n}` / `character {n}` prefix so the operator can see which card a line edits before applying.
- **Panel side (`ui-novelai-workbench`)** — the characters branch of `applyPatchRequest` materializes cards up to the highest referenced number (clamped to the model's capacity), edits each card's prompt tags with the same add/remove/modify semantics as the positive slot, and opens the fold so the cards' arrival is visible. The shared prompt is never touched.
- **Fresh-closure subscription** — the patch subscription effect dropped its dependency array: the subscriber must be the current render's closure, because the characters branch reads `model` for capacity and a stale first-render closure would clamp every patch to the unseeded capacity of zero. The old deps array shipped exactly that bug; the positive/negative/settings branches never read state, which is why only the new branch exposed it.
- **Patch-card provenance is unchanged** — the patch still proposes and waits for the operator's 应用; `novelai_generate` keeps reading the committed panel state, so the generated request now carries the structured `characters` straight from the cards.

## Consequences

- A multi-character request now ends with distinct character cards, each generating under its own prompt block, instead of one blended positive prompt.
- The stale-closure hazard is fixed for all future patch branches: any state read inside `applyPatchRequest` is safe because the subscription re-subscribes every render.
- Character-level negative prompts and coordinates stay panel-manual; the patch slot edits prompts only (the schema carries no `x`/`y`), keeping the operation record a string map across the lossless-JSON boundary.
- The committed state now carries the cards end to end: `NovelaiWorkbenchState` grew an optional `characters` array, the panel commits and restores it (cards rehydrate as fresh drafts on session re-entry), and `novelai_generate`'s resolution binds the panel's cards when present — falling back to the call's own `characters` only when the panel has none. A panel with cards is the visible truth; the call argument can no longer silently bypass what the operator applied.
- Unlike the patch tool args, this wire change crosses a built browser boundary: the `@deepseek-ai/dsh-api-remotes` client bundle embeds the generated schemastery schema for `novelai_commitWorkbenchState`, and a stale build — its schema predating `characters` — strips the unknown key from every commit, so prompts and parameters pass while characters vanish silently. Rebuild it (`pnpm --filter @deepseek-ai/dsh-api-remotes bundle`) whenever the workbench-state wire type grows fields; the live failure signature is a panel that shows cards while the persisted state document has no `characters`.
