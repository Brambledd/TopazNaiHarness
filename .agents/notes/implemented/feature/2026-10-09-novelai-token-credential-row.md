# Agent Note: NovelAI token configuration through the credential seam

Status: implemented

English | [中文](2026-10-09-novelai-token-credential-row.zh.md)

## Problem

The `novelai_generate` tool authenticated with the plugin config `token` or the raw `NOVELAI_TOKEN` process environment variable. The operator's NovelAI generation failed with `HTTP 401 Unauthorized` and the only remedies were editing a composition file or restarting the process with a different environment value — there was no runtime surface to store a valid persistent token, and an invalid token surfaced as a bare 401 with no pointer to where a replacement goes.

## Decision

The token moves onto the existing credential-reference seam, and the user-facing write path becomes a settings row:

- **Host resolution** — `tool-novelai/src/token.ts` owns `resolveToken(config, credentials)`: per call it reads the plugin config `token` first, then `ctx.credentials.resolve(credentialRef('NOVELAI_TOKEN'))` (the provider layers its store over project/user `.env` files and the process environment), then the bare environment when no provider is mounted. Per-call resolution means a saved token reaches the next generation without a plugin restart. The web profile already mounts `@deepseek-ai/dsh-credentials-local`, so no composition change is needed.
- **Client row** — `ui-novelai` registers the Settings → General **NovelAI API token** row (`settings.general.item`, the feature-owned single-preference seat). The row shows the credential's configured state and source layer via `remote.credentials.describe`, saves and clears through `remote.credentials.set`/`unset`, and refreshes on pushed `credentials/reference-updated` events plus `connection/reset`. State lives in an apply-world snapshot store (`token-settings.ts`); the component stays presentational with locale-owned bilingual copy.
- **Actionable failures** — the missing-token error and a mapped HTTP 401 error both name the configurable layers: the Settings → General row, the plugin config `token`, and the `NOVELAI_TOKEN` credential.

## Alternatives considered

**A dedicated settings section (a `settings.section` page like Models).** Rejected: one credential is a single setting, and the settings doctrine reserves whole pages for sections of settings; `settings.general.item` is the seat designed for exactly this.

**A workbench-side token field.** Rejected: the workbench is the generation surface, not the configuration surface; a second token entry point would split the fact's home, and the credential store already converges every reader.

**Config-file-only documentation (teach the user to edit cordis.yml).** Rejected as the primary path: it requires a server-side edit and a composition reload for what is a per-user secret; it remains supported as the explicit override layer.

## Consequences

`tool-novelai` gains `@deepseek-ai/dsh-credentials` as a peer+dev dependency and reads the optional service through `ctx.get('credentials')`, so compositions without a provider keep working through config and environment. `ui-novelai` gains `remote`/`remote.credentials` service injects and the `@deepseek-ai/dsh-api-remotes`/`@deepseek-ai/dsh-client-ui-settings` informational edges. The token value itself never rides a read path: the row renders only `CredentialInfo` facts. Covering specs: `tool-novelai/tests/token.spec.ts` (resolution order, absent-value handling, loud failure) and `ui-novelai/tests/TokenRow.client.spec.tsx` (describe-driven states, save/clear writes, refusal diagnostics, reload-on-invalidation). Operators whose environment already carries a valid `NOVELAI_TOKEN` see no behavior change; the stored credential layer shadows the environment only when the user saves through the row.
