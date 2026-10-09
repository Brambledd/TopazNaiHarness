---
description: "The model-facing novelai_generate tool: paid text-to-image generation through the official NovelAI image API, with request assembly, response extraction, Anlas estimation, and output saving, for users and maintainers choosing, configuring, or debugging the tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-novelai

English | [中文](README.zh.md)

## Summary

`dsh-tool-novelai` lets the agent generate anime-style images through the official NovelAI image API: it assembles the wire request from model arguments, submits one paid generation per call, extracts the returned PNG from the ZIP response, and saves it into a configured output directory. Each result reports the saved path and the seed, so a follow-up call can vary one element of a liked image while keeping the rest identical. Costs are estimated before submission with the official Anlas formula, and failed responses never auto-retry because the server may already have charged for the image.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when the agent should produce NovelAI images as part of its work: illustration requests, prompt iteration with a stable seed, or batch creative tasks. The only setup is mounting the plugin and providing a token.

### Minimal configuration

```yaml
- id: tool-novelai
  name: '@deepseek-ai/dsh-tool-novelai'
```

The token is read from the `NOVELAI_TOKEN` environment variable; alternatively set it in the plugin config.

| Field | Default | Meaning |
|---|---|---|
| `token` | `''` | Persistent API token; empty falls back to `NOVELAI_TOKEN` |
| `imageBaseUrl` | `https://image.novelai.net` | Image API base URL |
| `outputDir` | `workspace/novelai` | Directory for generated PNGs; relative paths resolve against the process working directory |
| `timeoutMs` | `180000` | Per-request timeout |
| `proxyUrl` | `''` | HTTP(S) proxy URL for reaching the API; empty defers to the `NOVELAI_PROXY`/`HTTPS_PROXY` environment variables, unset means a direct connection |

### What each call does

The model sends a prompt plus optional overrides (model, dimensions, steps, CFG, sampler, noise schedule, seed, negative prompt, filename). The tool validates the constraints the schema cannot express — 64-multiple dimensions within 64–3072, integer steps within 1–50, CFG within 0–10, a filename without path separators — applies defaults (832×1216, 28 steps, CFG 5, `k_euler`, heavy negative preset, random seed), submits one `POST /ai/generate-image`, extracts the PNG from the ZIP response, and writes it to the output directory. A success returns the saved path, byte size, seed, and Anlas estimate.

### Cost discipline

Every call is paid. The tool description tells the model to batch and iterate deliberately, never in a loop. Failed submissions fail loud and are never retried automatically: the API may have charged for an image even when it reports an error.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **One paid round trip per call.** The tool submits exactly one generation request; request assembly, Anlas estimation, and response extraction are pure functions tested without the network.
- **Official-client wire parity.** Request normalizations are ported from the official frontend: V5 requests always submit `noise_schedule: "karras"`, CFG is clamped to 0–10, the seed to `0xffffffff`, and V4+ requests carry the (empty) character-prompt fields the API requires. The default negative prompt mirrors the V4+ "Heavy" undesired-content preset because the API receives only the merged text.
- **No silent retries.** A paid POST may have produced and charged for an image even on a 5xx, so failures surface verbatim; only 429-style situations are left to the caller.
- **Response extraction fails loud.** A non-archive body (JSON/HTML error page) is rejected as an error response, never mistaken for a missing image that would justify a resubmission.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, `novelai_generate` registration, default resolution, HTTP submission, file saving |
| [`src/types.ts`](src/types.ts) | Model/sampler enums, request and result types |
| [`src/payload.ts`](src/payload.ts) | Pure wire-body assembly, Anlas estimation, filename stems |
| [`src/client.ts`](src/client.ts) | HTTP submission with optional proxy dispatch and network-failure guidance |
| [`src/unzip.ts`](src/unzip.ts) | ZIP/PNG response extraction with bounded sizes |
| [`src/invariant.ts`](src/invariant.ts) | Empty invariant companion: the adapter owns no durable session relation |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `apply` and no default export.

</details>

-----


## Dev Note

The request normalizations are ported from the official NovelAI frontend; wire-shape changes belong upstream first. Trust in TypeScript stops at the wire: response validation covers the ZIP/PNG container and size bounds, not the semantic content of the image.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-novelai) is the exhaustive source for the `novelai_generate` schema. The model sees one `novelai_generate` tool: a required `prompt` string plus optional `negativePrompt`, `model` (enum of the eight current checkpoints), `width`/`height` (64-multiple integers), `steps` (1–50), `cfgScale` (0–10), `sampler` (enum), `noiseSchedule` (enum), `seed` (0–4294967295), and `filename`. The description states that every call is paid and that the seed enables controlled variation.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are stable.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains its full arguments. A success renders exactly `Saved <model> image (<width>x<height>, seed <seed>, ~<anlas> Anlas) to <path>`. Stable failures name the rejected constraint, e.g. ``Error: invalid dimensions: 833x1217 (each side must be a multiple of 64 within 64–3072)``, or the HTTP status of a failed submission.

#### Token effect

Call arguments remain until compaction; the result text is one fixed-shape line.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Text-to-image only** — img2img, inpainting, vibe transfer, precise reference, upscale, and director tools are deliberate Phase-1 cuts; they arrive with their own parameter surfaces.
- **No subscription awareness** — the Anlas estimate ignores the active-Opus free allowance and reference surcharges; it bounds the worst case.
- **Single output directory** — all sessions of one process share `outputDir`; per-session subdirectories arrive with the library package.
- **Token in config or environment only** — no credential-service integration yet.
