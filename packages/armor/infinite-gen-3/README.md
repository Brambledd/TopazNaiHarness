---
description: "The Infinite Generation Three armor plugin: always-on armor prompt section, the infinite_gen3_profile tool, the armor verdict projection, and the browser badge, for users and maintainers composing the fork's agent persona."
kind: "package-reference"
---

# @deepseek-ai/dsh-infinite-gen-3

English | [中文](README.zh.md)

## Summary

`dsh-infinite-gen-3` is the fork's first-party continuation of Minglink/dsh-infinite-gen-3 v0.5.0 (MIT): the 无限三代 armor instruction set ships as a built-in dual-half plugin instead of an external home-installed one. The host half registers the verbatim armor prompt as an always-on `systemPrompt` section, the `infinite_gen3_profile` self-description tool, and the `armor` projection that classifies every completed assistant message (refusal / fallback / pass, request domain, marker counts). The browser half renders the verdict as a pill above the composer card. Adding the package to a composition — as the web profile does through the dsh-web-app bundle — starts all four by construction; no plugin install step exists.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the plugin beside the prompt and tool services (the session projection registry is optional; without it the badge is absent but the prompt and tool still register).

### Composition

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-infinite-gen-3'
# optional, for the armor projection and the browser badge:
- name: '@deepseek-ai/dsh-session-projection'
```

### What the parts do

| Part | Meaning |
|---|---|
| Prompt section | `infinite-gen-3:global-system-prompt`, order 100, the verbatim v0.5.0 armor text |
| Tool | `infinite_gen3_profile` — returns the plugin's lineage, calibration, features, and the verbatim prompt |
| Projection | `armor` — `{running, verdict, words, safe, risk, domain, domainHits}` folded from committed events |
| Browser badge | The `armor-badge` entry in the conversation input overlay: on while idle, pulsing while running, flashing the verdict for 2.5 s after each answer |

### Verdict semantics

Refusal markers count only inside the first 160 characters of the answer; the same words mid-answer do not. Fallback-redirect markers count anywhere. Domain markers (`web`, `game`, `llm`, `mobile`, `miniprogram`, `network`, `cloud`, `crack`, `nsfw`) score over the opening window and report the best-scoring domain. Marker lists cap at three.

### Failures and recovery

Unmounting the plugin removes the section, the tool, and the projection key together, because every registration is an effect on the mounting fiber. Compositions without the projection registry load the plugin normally and simply lack the `armor` key. The tool output carries the full 15.7 KB prompt text by design; it is a read, not a transformation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the fold and the wiring; the observable behavior is fully covered in [Use this package](#use-this-package).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host plugin entry: section, tool, optional projection registration |
| [`src/prompt.ts`](src/prompt.ts) | The verbatim armor text and its section constants |
| [`src/armor.ts`](src/armor.ts) | The opening-window scorer and the pure event fold |
| [`src/projection.ts`](src/projection.ts) | Zod schemas and the registry-facing unit definition |
| [`src/tool.ts`](src/tool.ts) | The `infinite_gen3_profile` tool definition |
| [`src/types.ts`](src/types.ts) | One home of the `armor` projection-key declaration |
| [`src/client/`](src/client/index.ts) | Browser half: dictionaries and the overlay badge |

### Fold rules

- `user/message` arms `running` with a fresh idle verdict; the next non-empty `assistant/message` scores and settles it.
- Empty assistant content (max-tokens usage-host messages) returns the same state reference; the registry's `Object.is` gate keeps the change feed quiet.
- The wire view is the whole state, validated by the same strict schema; `stateVersion: 2` matches the upstream plugin's fold version.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session projection subsystem](../../../docs/subsystems/session-projection.md) — the registry that drives the armor unit.
- [Built-in armor system prompt note](../../../.agents/notes/implemented/feature/2026-10-08-builtin-armor-system-prompt.md) — the decision record for shipping the armor set first-party.
- [Web client architecture](../../../docs/subsystems/web-client.md) — the slot system the badge registers into.

-----

## Dev Note

The armor prompt text is vendored verbatim from the upstream MIT plugin; edits to it belong upstream first. The fork's continuation policy is recorded in the [built-in armor system prompt note](../../../.agents/notes/implemented/feature/2026-10-08-builtin-armor-system-prompt.md).

-----

<a id="model-experience"></a>
## Model Experience

### Armor instruction section and profile tool

#### What the model sees

The always-on `infinite-gen-3:global-system-prompt` section — the verbatim 15.7 KB v0.5.0 text vendored in [`src/prompt.ts`](src/prompt.ts) — sets the compliance baseline of every request, and the zero-argument `infinite_gen3_profile` tool returns the plugin metadata plus that same text on request.

#### Token effect

A fixed ≈4k-token section on every request of every session in the composition plus the tool schema; the tool result adds the prompt-sized payload only when the model calls it. Compositions without the package are unaffected.

#### KV Cache effect

The section is static text ordered after the identity block, so its contribution to the prompt prefix is cache-stable across turns of an unchanged composition.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The scorer is heuristic, not semantic** — the verdict classification matches marker lists ported verbatim from the upstream plugin; a paraphrased refusal or fallback can pass. The badge is an operator signal, not a guarantee.
- **The verdict flash is time-based** — the 2.5 s flash window follows the upstream badge behavior; a slow reader can miss it, and the detail line persists only in the projection value.
- **The badge layout is anchored, not stacked** — the pill shares the overlay anchor with the slash-command menu; both visible at once can overlap visually because the anchor is a zero-height absolute row.
