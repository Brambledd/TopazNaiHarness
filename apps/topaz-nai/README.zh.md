# `@deepseek-ai/topaz-nai`

[English](README.md) | 中文

`topaz-nai` 命令是 TopazNaiHarness 的应用身份：与 `dsh` 相同的 profile 启动机制，绑定到单一实例——独立默认 home（`~/.topaz-nai-harness`，可被 `DSH_HOME` 覆盖）、默认 profile（`topaz`）、以及自己的进程、遥测与补丁监听命名。它存在的目的：让 NovelAI 代理服务在身份层不再是「一个 `dsh` 进程」，同时完整保留 profile/bundle 机制。[src/args.ts](src/args.ts) 拥有命令文法，[src/bin.ts](src/bin.ts) 在任何子系统解析路径之前固定实例 home。非法命令、跨模式选项、配置错误与启动失败均以非零码退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `topaz-nai` | 从实例 home 启动默认 `topaz` profile。 |
| `topaz-nai web` | Web GUI 别名（`--profile web`）；其后是 web 应用自己的参数。 |
| `topaz-nai --profile <name>` | 启动实例 home 下的任意 profile。 |
| `topaz-nai plugin --profile <name> add <pkg>` | 在 profile 目录内转发 pnpm 并核对 bundle 清单。 |
| `topaz-nai --dump-config` | 免启动打印组合后的 profile 树。 |

## 实例 home

启动器的 home 解析规则与 `dsh` 一致（显式 `DSH_HOME` 优先），但变量未设置时默认 `~/.topaz-nai-harness` 而非 `~/.dsh`。该根目录下的 sessions、attachments、credentials、settings、skills 与 profile heal 缓存因此为本实例私有：`dsh` 与 `topaz-nai` 同时启动的两个进程在数据层互不共享。`bin.ts` 的 home 固定先于任何导入执行，所有子系统看到同一个根。

## 与 `dsh` 的关系

`src/profile-boot.ts`、`src/plugin.ts` 与 `src/dump-config.ts` 是换掉应用名与默认值的 `dsh` 启动器；框架接缝（`@deepseek-ai/dsh-app-boot`）共享并按启动器名参数化。上游 `dsh` 仍是通用启动器，本应用是单实例的产品身份。两个启动器都能管理同一个 profile 目录，但各自默认解析自己的 home——「同名 profile」只有在 `DSH_HOME` 指向同一根目录时才是同一个目录。
