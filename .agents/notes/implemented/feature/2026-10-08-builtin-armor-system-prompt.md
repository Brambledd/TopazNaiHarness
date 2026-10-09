# Agent Note: Built-in Infinite Generation Three armor system prompt

Status: implemented

English | [中文](2026-10-08-builtin-armor-system-prompt.zh.md)

## Problem

The fork's operator previously installed `dsh-infinite-gen-3` (Minglink, v0.5.0) as an external plugin patched into a DSH home, so the instruction set only applied where that patch was installed, and the fork's own web profile booted without it. The requirement: running this forked agent must follow that tool's instructions by construction, with no plugin install step.

## Decision

The upstream plugin is ported whole as the first-party package `@deepseek-ai/dsh-infinite-gen-3` (`packages/armor/infinite-gen-3/`), and the web-app patch row composes it by default. The package carries four halves of the upstream behavior:

- **System-prompt section** — `src/prompt.ts` holds the verbatim v0.5.0 text (15.7 KB, MIT attribution header) registered as `infinite-gen-3:global-system-prompt` (order 100) through `ctx.effect`; the text reaches every composed session.
- **`infinite_gen3_profile` tool** — `src/tool.ts` exposes the upstream self-description tool (version metadata plus the verbatim prompt) as a plain `ToolDefinition` with zero host value imports.
- **`armor` session projection** — `src/armor.ts`/`src/projection.ts` port the opening-window scorer and fold verbatim (stateVersion 2): user messages arm `running`, assistant text settles `pass`/`refusal`/`fallback` with capped marker lists and the best-scoring request domain.
- **Browser badge** — `src/client/` renders a token-styled pill above the conversation input through the `conversation.input.overlay` slot (locale-owned bilingual copy, verdict flash, running pulse), driven by `useProjection('armor')`.

The web-app half loses its former inline variant: `armor-prompt.ts`, the `armorPrompt` config row, and its section registration are removed — the prompt text exists once, in the package, so per-request token cost is not doubled by a duplicate. The bundle's `cordis.patch.yml` gains one row (`- id: infinite-gen-3`) after the file-reference row, making the armor plugin part of the shipped web profile composition.

## Alternatives considered

**Keeping the upstream plugin installed via `bundle.patch`.** Rejected: the instruction set then depends on an out-of-repo artifact and a per-home patch step, which is exactly the failure mode reported — a fresh profile boots without the behavior.

**Keeping the web-app inline prompt-only variant.** Rejected after the fact: it shipped the text but none of the visible signals (tool, verdict projection, badge), and the user-visible gap was precisely those signals. Inlining also forks the prompt into a second home, which the full port deletes.

**Client-side scoring of the verdict.** Rejected: the fold is a durable session relation (the badge must survive reload and replay identically), so it belongs in the host projection, with the client reading `useProjection('armor')` only.

## Consequences

New package `packages/armor/infinite-gen-3` (host + client faces, invariant companion, loader-composition spec through the real Loader, unit specs for scorer/fold/badge), group README under `packages/armor/`, and one aggregate tsconfig registration per face plus generated path aliases (`@deepseek-ai/dsh-infinite-gen-3`, `/invariant`, `/client`). `packages/bundle/web-app` loses the inline armor and its specs and gains the dependency + patch row; `tests/web-app.spec.ts` no longer pins armor (the package's own loader spec pins composition). Sessions on the web profile now compose the section and see the model-visible `infinite_gen3_profile` tool, which changes the model's instruction baseline and therefore any recorded-session snapshot for that profile; token usage per request grows by the prompt's size. The upstream plugin remains installable side by side, but its section name collides at load (duplicate section names throw), so operators must not enable both on one profile.
