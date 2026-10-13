# Agent Note: The user-configurable NovelAI generation directory

Status: implemented

English | [中文](2026-10-13-novelai-generation-directory.zh.md)

## Problem

Every generated PNG landed flat in the one directory fixed at construction time: the controller built `NovelaiImageLibrary(config.outputDir)` once, and `novelai_generate` closed over the plugin-config path. Pointing the output at a new directory required editing a composition file and restarting the process, and one flat folder had to hold every image the operator ever generated — the workbench rows and tool rows were already merged into one history, but the layout gave them nothing to organize by.

## Decision

The output directory becomes a live, user-owned setting, and the layout gains local-date day folders:

- **Settings override, resolved per call** — the controller registers the `novelai` settings namespace (`generationDir`, empty = follow the deployment `outputDir`) through the optional settings service, mirroring the agent-presets registrant. `resolveEffectiveOutputDir(configured, fallback)` is the single resolver (override trimmed-non-empty wins; relative values resolve against the process cwd), exposed as `effectiveOutputDir()` and behind the new `generationDir`/`setGenerationDir` Remote verbs; `setGenerationDir('')` clears the override, and a refused write surfaces as `novelai/settings-write-failed`. Library instances are cached per resolved directory, so a saved value moves the library, history, and removal to the new tree on the next call — no restart.
- **`<YYYY>/<MM>/<DD>` day folders** — `settleGeneration` mkdirs the local-time day chain and saves the PNG inside it (an injectable `now` pins the clock in tests); the library scan walks the tree depth-first instead of listing the root, so legacy root-level PNGs and nested day folders merge into the same history.
- **The tool follows the same directory** — `tool-novelai/src/directory.ts` resolves the generation root through the mounted controller's `effectiveOutputDir()` (type-only `Pick`, so the package keeps its dev-only edge) and falls back to the plugin config without one; its PNGs save under the same day folders, which is exactly what the recursive scan picks up.
- **Client row** — `ui-novelai` registers the Settings → General **Image output directory** row (`settings.general.item`, the same seat as the token row): it shows the effective absolute path and whether the override supplies it, saves and clears through `remote.novelai.setGenerationDir`, and renders refused writes with the Host diagnostic verbatim. State lives in an apply-world snapshot store (`dir-settings.ts`); the component stays presentational with locale-owned bilingual copy.

## Alternatives considered

**Restart-applied plugin config only.** Rejected: the product requirement is that generations honor the new directory without a service restart, and the settings service already exists for exactly this layering (schema default < user document).

**Day folders keyed by the session or the model.** Rejected for now: a local-calendar layout is sortable in any file manager, matches the PNG stem's embedded timestamp, and needs no parameter knowledge the scan does not have; per-session subdirectories remain deferred work.

**Sharing the day-folder helper between controller and tool at runtime.** Rejected: that would add a runtime `tool-novelai → api-novelai-controller` value edge for four lines; the tool keeps its owned copy under its dev-only type edge.

## Consequences

`api-novelai-controller` gains `@deepseek-ai/dsh-settings` as a peer+dev dependency (type-only import; the scope arrives through `ctx.inject(['settings'], ...)`, so compositions without a settings provider keep the deployment `outputDir`), plus `novelai/settings-write-failed` in the namespace error vocabulary. `tool-novelai` reads the controller only through the already-declared dev-only type edge. The generated `ctx.remote.novelai` namespace carries the two new verbs, so the api-remotes client bundle must be rebuilt before the row works in a running server. Covering specs: `novelai-controller/tests/generation.host.spec.ts` (resolver arms, pinned-clock day folders), `tests/novelai-controller.host.spec.ts` (both Remote verbs, the read-only and provider-absent refusals, the library error naming the effective directory), `tests/library.host.spec.ts` (nested scan plus legacy root), `tool-novelai/tests/directory.spec.ts`, and `ui-novelai/tests/DirRow.client.spec.tsx`.
