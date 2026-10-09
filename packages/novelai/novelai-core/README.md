---
description: "Isomorphic NovelAI image domain library: parameter model, wire-payload assembly, Anlas estimation, and the Node-side paid submission client, for consumers building NovelAI generation features."
kind: "package-reference"
---

# @deepseek-ai/dsh-novelai-core

English | [中文](README.zh.md)

## Summary

`dsh-novelai-core` owns the NovelAI image domain model shared by every consumer: the checkpoint/sampler/schedule enums, the canonical generation request, wire-payload assembly ported from the official frontend (V4+ structured prompt objects, V5 `karras` normalization, seed and CFG clamping), the official Anlas cost formula, and — behind the `./node` subpath — the paid submission client with proxy dispatch and bounded ZIP/PNG response extraction. The root entry is browser-safe by construction; only Node consumers import `./node`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when a consumer needs to describe, price, or submit NovelAI text-to-image requests: the `novelai_generate` tool assembles and submits through it, the generation controller submits through it, and browser UI imports the parameter model from the root entry.

### Entry points

| Specifier | Runtime | Contents |
|---|---|---|
| `.` | browser + Node | Enums (`NOVELAI_MODELS`, `NOVELAI_SAMPLERS`, `NOVELAI_NOISE_SCHEDULES`), request/result types, payload assembly, Anlas estimate, filename stems |
| `./node` | Node only | `requestGeneration` (undici + optional proxy dispatch), `extractImages` (bounded ZIP/PNG extraction), proxy resolution from environment |
| `./invariant` | Node | Empty invariant companion registering the package manifest name |

### Cost discipline

Every submitted request is paid. Submission never retries: the API may have charged for an image even when it reports an error, so failures surface verbatim.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Pure core, thin submission edge.** Request assembly, Anlas estimation, and response extraction are pure functions tested without the network; only `./node` performs I/O.
- **Browser-safe root entry.** The root module imports no Node-only runtime, so browser bundles importing the parameter model never pull `undici` or `fflate`.
- **Official-client wire parity.** V5 requests always submit `noise_schedule: "karras"`; CFG clamps to 0–10 and the seed to `0xffffffff`; V4+ requests carry the structured `v4_prompt`/`v4_negative_prompt` objects the API requires; the default negative prompt mirrors the V4+ "Heavy" preset.
- **Response extraction fails loud.** A non-archive body (JSON/HTML error page) is rejected as an error response, never mistaken for a missing image that would justify a resubmission.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Isomorphic entry; re-exports the parameter model and payload assembly |
| [`src/types.ts`](src/types.ts) | Model/sampler enums, request and result types |
| [`src/payload.ts`](src/payload.ts) | Wire-body assembly, Anlas estimation, filename stems |
| [`src/node.ts`](src/node.ts) | Node entry; re-exports the submission client and response extraction |
| [`src/client.ts`](src/client.ts) | HTTP submission with optional proxy dispatch and network-failure guidance |
| [`src/unzip.ts`](src/unzip.ts) | ZIP/PNG response extraction with bounded sizes |
| [`src/invariant.ts`](src/invariant.ts) | Empty invariant companion: a pure library owns no durable session relation |

</details>

-----


## Dev Note

The payload assembly is the single home of the official-client wire normalizations: the tool and the generation controller both submit through `./node`, so a normalization change lands once here and propagates to both consumers.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `novelai_generate` tool: this package's parameter and result vocabulary shapes the tool's schema and result text, which the consuming tool owns.

#### KV Cache effect

No direct effect; the package registers no tools, prompts, or events and sends no provider requests.

## Known Limitations and Deferred Work

These limits define when the library is a poor fit. They are current package constraints, not a task backlog.

- **Text-to-image only** — img2img, inpainting, vibe transfer, precise reference, upscale, and director tools are deliberate cuts; they arrive with their own parameter surfaces.
- **No subscription awareness** — the Anlas estimate ignores the active-Opus free allowance and reference surcharges; it bounds the worst case.
- **Single-image requests** — the payload always submits `n_samples: 1`; multi-image batches are the caller's loop.
