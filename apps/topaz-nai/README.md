# `@deepseek-ai/topaz-nai`

English | [中文](README.zh.md)

The `topaz-nai` command is the TopazNaiHarness application identity: the same profile boot as `dsh`, bound to one instance — a dedicated default home (`~/.topaz-nai-harness`, overridable by `DSH_HOME`), a default profile (`topaz`), and its own process, telemetry, and patch-watch naming. It exists so the NovelAI agent service stops being "a `dsh` process" at the identity layer while keeping the whole profile/bundle machinery unchanged. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) pins the instance home before any subsystem resolves a path. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `topaz-nai` | Boot the default `topaz` profile from the instance home. |
| `topaz-nai web` | The web GUI alias (`--profile web`); the web app's own flags follow. |
| `topaz-nai --profile <name>` | Boot any profile under the instance home. |
| `topaz-nai plugin --profile <name> add <pkg>` | Forward to pnpm inside the profile directory and reconcile the bundle list. |
| `topaz-nai --dump-config` | Print the composed profile tree without booting. |

## Instance home

The launcher resolves its home exactly like `dsh` (explicit `DSH_HOME` wins), but when the variable is unset it defaults to `~/.topaz-nai-harness` instead of `~/.dsh`. Sessions, attachments, credentials, settings, skills, and the profile heal cache under that root are therefore private to this instance: two processes booting `dsh` and `topaz-nai` share nothing at the data layer. The `bin.ts` home pin runs before any import resolves a path, so every subsystem observes the same root.

## Relationship to `dsh`

`src/profile-boot.ts`, `src/plugin.ts`, and `src/dump-config.ts` are the `dsh` launchers with the application name and defaults swapped; the framework seam (`@deepseek-ai/dsh-app-boot`) is shared and parameterized by launcher name. Upstream `dsh` stays the general-purpose launcher; this app is the single-instance product identity. Both launchers can manage the same profile directory, but each resolves its own home by default, so "same profile name" only means the same directory when `DSH_HOME` points both at one root.
