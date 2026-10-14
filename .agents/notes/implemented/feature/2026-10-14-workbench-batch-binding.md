# Agent Note: Workbench batch settings bind the conversation generation

Status: implemented

English | [中文](2026-10-14-workbench-batch-binding.zh.md)

- Date: 2026-10-14
- Packages: `api/novelai-controller`, `novelai/tool-novelai`, `client/ui-novelai-workbench`

## Problem

The workbench panel owns 批量张数 (1–8) and 间隔（秒）(0–60) and its own generate button loops over them, but neither field existed on `NovelaiWorkbenchState`. A conversation-side `novelai_generate` call — which binds the committed state — therefore always produced exactly one image: the operator's batch settings never reached the tool, and the API payload is single-image by contract (`n_samples: 1`; multi-image is the caller's loop).

## Decision

- The wire state grows optional `batchCount` and `batchIntervalSec`; the panel commits them only when the count is above 1 (absence means the 1-image / 5-second defaults) and restores them clamped to the same ranges on session re-entry.
- `novelai_generate`'s resolution binds both from the committed state alone — the call schema deliberately has no batch arguments, so a model cannot override the operator's paid-volume setting.
- The tool execution mirrors the desktop batch contract: N sequential requests, the configured interval between them, a bound seed walking +1 per image (a batch is not N near-identical frames), and random intent drawing fresh per image — `resolveInput` materializes only the first draw, so the loop re-randomizes the rest. Every image saves beside the primary; the result grew an optional `siblings` array (path + seed) and the render lists them.
- The tool description tells the model that one call produces the panel's count when set above 1.

## Consequences

- One conversation generation now yields the panel's batch: N paid requests, each saved and reported, with per-image seeds for follow-up variation.
- Both new fields cross built browser boundaries — the remotes client bundle embeds the commit schema, so it was rebuilt in the same change (the stripping hazard recorded in [characters slot](2026-10-14-novelai-patch-characters-slot.md)). The tool output schema (`siblings`) is host-side only and needs no browser rebuild.
- Diagnosis caveat learned the hard way: a PowerShell check written as `Contains('\"characters\"')` embeds literal backslashes and always reports false — the "lost characters" readings that triggered this investigation's second loop were that escaped-quote artifact, not real state loss.
