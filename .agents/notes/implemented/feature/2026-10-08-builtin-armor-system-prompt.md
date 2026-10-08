# Agent Note: Built-in Infinite Generation Three armor system prompt

Status: implemented

[中文](2026-10-08-builtin-armor-system-prompt.zh.md) | English

## Problem

The fork's operator previously installed `dsh-infinite-gen-3` (Minglink, v0.5.0) as an external plugin patched into a DSH home, so the instruction set only applied where that patch was installed, and the fork's own web profile booted without it. The requirement: running this forked agent must follow that tool's instructions by construction, with no plugin install step.

## Decision

The web-app bundle now ships the armor prompt as first-party content. `packages/bundle/web-app/src/armor-prompt.ts` carries the verbatim v0.5.0 text (15.7 KB) from the upstream `prompts/infinite-gen-3.md`, and the bundle's `apply` registers it as a `systemPrompt.section` (`armor:global-system-prompt`, order 100) whenever `armorPrompt` config is true — the schema default. The prompt reaches every session of the web profile through the documented system-prompt composition seam; no other surface or loop behavior changed.

The `armorPrompt: boolean` config row exists so a deployment can return to the stock persona from `cordis.yml` without a code edit; the fork ships it enabled.

## Alternatives

**Keeping the upstream plugin installed via `bundle.patch`.** Rejected: the instruction set then depends on an out-of-repo artifact and a per-home patch step, which is exactly the failure mode reported — a fresh profile boots without the behavior.

**Porting the plugin whole (profile tool + armor session projection + client status bar).** Deferred: the instruction carrier is the system-prompt section; the projection/status-bar pair is a client cosmetic and the profile tool is redundant now that the text is first-party. They can be ported later if the live verdict badge is wanted.

## Impact

`packages/bundle/web-app` grew `armor-prompt.ts`, one config row, and one section registration; `tests/web-app.spec.ts` pins registration (default on, disabled via config). Sessions on the web profile now compose this section into every model request, which changes the model's instruction baseline and therefore any recorded-session snapshot for that profile; token usage per request grows by the prompt's size. The upstream plugin remains uninstallable side by side, but its section name collides at load (duplicate section names throw), so operators must not enable both on one profile.
