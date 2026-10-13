---
description: "Remote owner for workbench image generation and the shared NovelAI output library: catalog, pricing, paid submission, and history over the NovelAI namespace, served without an LLM turn."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-novelai-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-novelai-controller` owns the Host `ctx.novelaiController` service and the generated Client `ctx.remote.novelai` namespace. Its Remote verbs serve the generation catalog (checkpoints, samplers, noise schedules, workbench defaults), quote Anlas prices, submit paid text-to-image generations, and read the shared output library — a JSON index merged with a directory scan of the configured output directory, so workbench generations and `novelai_generate` tool calls appear as one history. The workbench generates through this namespace directly; no model turn or tool call is involved.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when a browser surface must generate or browse NovelAI images without an agent turn: the workbench UI mounts `ctx.remote.novelai` through the `remotes` assembly and calls `catalog`, `estimate`, `generate`, `history`, and `remove`.

### Remote verbs

| Verb | Contract |
|---|---|
| `catalog()` | Checkpoints, samplers, schedules, `maxSeed`, and the workbench defaults |
| `estimate({ width, height, steps })` | Anlas price quote from the official formula |
| `generate(request)` | Resolve → price → paid submission (never retried) → PNG saved under `<dir>/<YYYY>/<MM>/<DD>/` → index recorded |
| `history({ offset?, limit? })` | One page of the merged library, newest first, with the total |
| `removeEntry({ id })` | Delete one entry and its PNG file |
| `generationDir()` | The effective absolute output directory and whether the saved settings override supplies it |
| `setGenerationDir({ dir })` | Persist the directory override (empty clears it); the next generation applies it without a restart |
| `commitWorkbenchState({ sessionId, state })` | Store one session's latest panel state in the hot map and persist it under the harness home |
| `readWorkbenchState({ sessionId })` | One session's committed panel state: the hot map first, the durable store otherwise |
| `artistChains()` | The workbench's named artist-chains library, newest first |
| `saveArtistChain({ id, name, tags })` | Save one named chain whole (an empty id creates, a stored id updates in place); the name ≤ 80 chars and the tags ≤ 2000 chars, both non-empty after trim |
| `removeArtistChain({ id })` | Remove one saved chain; an unknown id answers `novelai/artist-chain-missing` |

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `outputDir` | `workspace/novelai` | Default shared image library directory; point the generation tool's `outputDir` at the same path |

The effective generation directory resolves per call: the saved Settings → General **Image output directory** override (`novelai` settings namespace, `generationDir` field) first, the `outputDir` config otherwise; relative values resolve against the process working directory. Every PNG lands under the effective directory's local-time `<YYYY>/<MM>/<DD>` day folders, created on demand. The NovelAI token is read from the `NOVELAI_TOKEN` credential (store, then `.env`, then environment) at submission time; a missing token answers `novelai/token-missing`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **No LLM in the generation loop.** The workbench talks to the image API through this namespace directly; the agent stays available for prompt drafting and variation, not for form submission.
- **One library, two producers.** Workbench submissions append full-parameter rows to `library.json`; every other PNG in the directory at any depth (tool calls, external saves) is discovered by the recursive scan and enriched with the metadata embedded in the file (`Title`/`Description`/`Comment` tEXt chunks).
- **Explicit defaulting.** `resolveGenerationRequest` is the single defaulting step: blank negative prompts fall back to the host default, omitted seeds are randomized, and the resolved input is what gets priced and submitted.
- **Paid submissions never retry.** A failed POST may have charged for the image, so failures surface as `novelai/generation-failed` verbatim.
- **The directory resolves live.** The library instance is cached per resolved directory, so a saved settings override moves the library (and the tool, which reads `effectiveOutputDir()`) without a restart.
- **Panel state is durable.** A committed panel state lands atomically (`.tmp` + rename) at `<home>/novelai-workbench-states/<sessionId>.json` beside `settings.yaml`; missing, unparseable, or wrong-shaped documents read as absent, and a session id outside `1-64` letters/digits/`_`/`-` cannot name a document. A persist failure answers `novelai/state-persist-failed`; with no resolvable harness home the controller degrades to host memory and warns at boot.
- **The artist chains are user data under the home.** The workbench's 画师串 library lives as one JSON array of `{ id, name, tags }` at `<home>/novelai-artist-chains.json`, atomically rewritten per mutation and served newest first (updates keep their slot). Each chain is ONE named whole-string entry — a pasted `weight:artist::` run is stored verbatim as the tags, never parsed into per-artist rows; ids are host-assigned opaques. The name (≤ 80 chars) and tags (≤ 2000 chars) must be non-empty after trim; refusals answer `novelai/artist-chain-invalid` / `novelai/artist-chain-missing`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `NovelaiController` service: Remote verbs, error vocabulary mapping, history paging |
| [`src/types.ts`](src/types.ts) | Browser-safe request/result vocabulary and the namespace's `RemoteErrorDetailsMap` rows |
| [`src/library.ts`](src/library.ts) | `NovelaiImageLibrary`: JSON index, directory scan merge, atomic index writes |
| [`src/workbench-state-store.ts`](src/workbench-state-store.ts) | `WorkbenchStateStore`: atomic per-session panel-state JSON documents under the harness home, session-id guard, tolerant reads |
| [`src/artist-chains.ts`](src/artist-chains.ts) | `ArtistChainStore`: the 画师串 library as one atomically rewritten JSON array under the harness home, named whole-string tags kept verbatim, host-assigned ids, name/length validation refusals |
| [`src/generation.ts`](src/generation.ts) | Request resolution, the workbench defaults, and the submission pipeline |
| [`src/invariant.ts`](src/invariant.ts) | Empty invariant companion: the package owns no durable harness relation |

</details>

-----


## Dev Note

The generated `ctx.remote.novelai` namespace embeds into the api-remotes client bundle, so any verb or type change here is not complete until that bundle is rebuilt and the page reloaded; a stale bundle manifests as a silently swallowed property-proxy miss.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the workbench and the `novelai_generate` tool: the namespace serves generation verbs without a model turn, and produced images reach the model only when a conversation attaches them.

#### KV Cache effect

No direct effect; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

These limits define when the package is a poor fit. They are current package constraints, not a task backlog.

- **Token through environment only** — the service reads the `NOVELAI_TOKEN` credential (store, then `.env`, then environment) at submission time; it writes no credential itself.
- **Text-to-image only** — img2img, inpainting, and upscale verbs are deliberate cuts until their workbench surfaces exist.
- **No streaming progress** — `generate` is one unary call; long submissions cannot report step progress and cancellation is request-scoped only.
- **Tool calls are not indexed** — `novelai_generate` tool PNGs appear in history through the recursive directory scan, but the index row (exact request parameters) is only written by workbench submissions; the tool does not append to the library index.
