# Agent Note: topaz-nai, the second application launcher

Status: implemented

English | [中文](2026-10-10-topaz-nai-second-launcher.zh.md)

> Partially supersedes the single-launcher scope of [one dsh launcher for application profiles](2026-08-22-single-dsh-application-launcher.md), which remains authoritative for profile mechanics, SDK/ACP launch, and the rejection of direct app bins.

## Problem

The NovelAI agent deployment runs its service as a `dsh` process: `ps` output, telemetry names, patch-watch diagnostics, and the home directory all identify as `dsh`, and the instance shares `~/.dsh` with every other `dsh` invocation on the machine — sessions, attachments, credentials, settings, skills, and the profile heal cache have no instance boundary. Renaming the deployment is not a configuration choice: the launcher name is compiled into the CLI (`apps/cli/src/bin.ts` through `args.ts`, `profile-boot.ts`, `dump-config.ts`, `plugin.ts` all print and resolve by `NAME`), and `~/.dsh` is the framework default in `@deepseek-ai/dsh-home-paths`.

## Decision

`apps/topaz-nai` is a second supported application launcher, `topaz-nai`, carrying the deployment's identity. It is the `dsh` launcher source with three differences and no fork of the boot framework:

- **Home.** `src/bin.ts` sets `DSH_HOME` to `~/.topaz-nai-harness` when the variable is unset or blank, before any import resolves a path; every subsystem therefore observes the instance home through the ordinary `resolveDshHome()` seam, which stays unchanged.
- **Default profile.** The command grammar defaults `--profile` to `topaz` (`DEFAULT_PROFILE` in `src/args.ts`), so a bare `topaz-nai` boots the instance; `topaz-nai web` keeps the web alias and `--profile` overrides remain available.
- **Name.** `NAME = 'topaz-nai'` parameterizes telemetry labels, plugin warnings, profile resolution messages, and the patch watchers; `loadLayeredEnv` reads the same `.env` layers (the bin name is diagnostic text there, not a filename).

`package.json` copies the `dsh` dependency closure verbatim (dependencies, devDependencies, and the `dsh.configTrees` agent-presets mount) so `healProfilesModuleFallback` mirrors the same install closure into the instance's profiles. `tests/args.spec.ts` pins the grammar; [`verify-application-entrypoints`](../../../../scripts/verify-application-entrypoints.ts) allowlists the `topaz-nai` bin and its `src/bin.ts`.

### What was given up

"One launcher" is no longer literally true: two product bins share the application-launch inventory, and the [single-launcher note](2026-08-22-single-dsh-application-launcher.md) records the updated scope. The cost is bounded because the second launcher owns no new mechanism — no new profile semantics, no second boot path, no SDK surface. The identity win is a process that is nameable, homeable, and killable as one unit.

## Alternatives considered

**Rename the repository's launcher to topaz-nai.** Rejected: `dsh` is the product and SDK contract across the framework, Python wheels, and documentation; a wholesale rename couples a deployment decision to an upstream identity change.

**Run `dsh` with `DSH_HOME` set by a wrapper script.** Rejected: the process still identifies as `dsh`, the wrapper owns the default instead of the binary, and any direct `dsh` invocation silently lands in the shared home again.

**A dedicated app bin with a complete `cordis.yml`.** Rejected for the reasons [the single-launcher note](2026-08-22-single-dsh-application-launcher.md) records: a second lifecycle beside profile launch drifts from `dsh-base` and loses plugin installation. `topaz-nai` reuses profiles precisely to avoid that.

## Verification

- `tests/args.spec.ts` covers the default profile, the `web` alias, repeatable `--patch`, dump modes, plugin forwarding, and the rejection paths (100% on `src/args.ts`).
- `verify-application-entrypoints` passes with the new bin and executable-source entries, and rejects an unknown third bin (fixture coverage).
- `tsc -b apps/topaz-nai` builds the app against the full host reference chain; a filtered `pnpm install --filter @deepseek-ai/topaz-nai` materializes the importer without relinking other packages.
- Bilingual pairing for the README pair and this note is recorded; the launch sections of `docs/architecture.md` and both partially superseded notes are updated in the same change.

## Consequences

- The NovelAI deployment runs `topaz-nai` from `~/.topaz-nai-harness` (overridable by `DSH_HOME`), and its process tree, telemetry rows, and diagnostics name `topaz-nai`.
- `dsh` and `topaz-nai` can run concurrently on one machine with disjoint state; pointing both at one `DSH_HOME` restores sharing deliberately.
- The launcher sources stay a copy of `apps/cli/src` (jscpd scans `packages scripts` only); upstream launcher changes must be mirrored by hand, which the note on [application launch](../../../../docs/architecture.md#application-launch) keeps visible.
