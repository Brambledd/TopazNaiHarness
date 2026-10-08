---
description: "Remote owner for workbench image generation and the shared NovelAI output library: catalog, pricing, paid submission, and history over the NovelAI namespace, served without an LLM turn."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-novelai-controller

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
| `generate(request)` | Resolve → price → paid submission (never retried) → PNG saved into `outputDir` → index recorded |
| `history({ offset?, limit? })` | One page of the merged library, newest first, with the total |
| `removeEntry({ id })` | Delete one entry and its PNG file |

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `outputDir` | `workspace/novelai` | Shared image library directory; point the generation tool's `outputDir` at the same path |

The NovelAI token is read from the `NOVELAI_TOKEN` environment variable at submission time; a missing token answers `novelai/token-missing`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **No LLM in the generation loop.** The workbench talks to the image API through this namespace directly; the agent stays available for prompt drafting and variation, not for form submission.
- **One library, two producers.** Workbench submissions append full-parameter rows to `library.json`; every other PNG in the directory (tool calls, external saves) is discovered by scan and enriched with the metadata embedded in the file (`Title`/`Description`/`Comment` tEXt chunks).
- **Explicit defaulting.** `resolveGenerationRequest` is the single defaulting step: blank negative prompts fall back to the host default, omitted seeds are randomized, and the resolved input is what gets priced and submitted.
- **Paid submissions never retry.** A failed POST may have charged for the image, so failures surface as `novelai/generation-failed` verbatim.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `NovelaiController` service: Remote verbs, error vocabulary mapping, history paging |
| [`src/types.ts`](src/types.ts) | Browser-safe request/result vocabulary and the namespace's `RemoteErrorDetailsMap` rows |
| [`src/library.ts`](src/library.ts) | `NovelaiImageLibrary`: JSON index, directory scan merge, atomic index writes |
| [`src/generation.ts`](src/generation.ts) | Request resolution, the workbench defaults, and the submission pipeline |
| [`src/invariant.ts`](src/invariant.ts) | Empty invariant companion: the package owns no durable harness relation |

</details>

-----

<a id="model-experience"></a>
## Model Experience

This package never reaches a model: no prompts, tools, or session events are registered, and generation requests consume no tokens or KV cache. Its model impact is indirect — workbench images appear to the agent only when a conversation references them through the attachment system, and the tool's result text remains the sole model-visible generation report.

## Known Limitations and Deferred Work

These limits define when the package is a poor fit. They are current package constraints, not a task backlog.

- **Token through environment only** — the service reads `NOVELAI_TOKEN` at submission time; a settings-surface token flow arrives with credential integration.
- **Text-to-image only** — img2img, inpainting, and upscale verbs are deliberate cuts until their workbench surfaces exist.
- **No streaming progress** — `generate` is one unary call; long submissions cannot report step progress and cancellation is request-scoped only.
- **Tool calls are not indexed** — `novelai_generate` tool PNGs appear in history through the directory scan, but the index row (exact request parameters) is only written by workbench submissions; the tool does not append to the library index.
