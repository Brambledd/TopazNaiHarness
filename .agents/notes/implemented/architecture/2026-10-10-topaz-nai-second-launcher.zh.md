# Agent Note：topaz-nai，第二个应用 launcher

Status: implemented

[English](2026-10-10-topaz-nai-second-launcher.md) | 中文

> 部分取代 [dsh 单一应用 launcher](2026-08-22-single-dsh-application-launcher.zh.md) 的单一 launcher 范围；该决策对 profile 机制、SDK/ACP 启动以及拒绝直读应用 bin 的立场仍然有效。

## 问题

NovelAI 代理部署的服务以 `dsh` 进程运行：进程列表、遥测名称、补丁监听诊断与 home 目录全部标识为 `dsh`，且实例与同机所有其他 `dsh` 调用共享 `~/.dsh`——sessions、attachments、credentials、settings、skills 与 profile heal 缓存没有实例边界。重命名部署不是配置选项：launcher 名编译在 CLI 内（`apps/cli/src/bin.ts` 到 `args.ts`、`profile-boot.ts`、`dump-config.ts`、`plugin.ts` 都按 `NAME` 打印与解析），而 `~/.dsh` 是 `@deepseek-ai/dsh-home-paths` 的框架默认值。

## 决策

`apps/topaz-nai` 是第二个受支持的应用 launcher `topaz-nai`，承载部署身份。它是 `dsh` launcher 源码加三处差异，不 fork 启动框架：

- **Home。** `src/bin.ts` 在变量未设置或为空时把 `DSH_HOME` 设为 `~/.topaz-nai-harness`，先于任何导入解析路径；所有子系统因此通过普通 `resolveDshHome()` 接缝看到实例 home，该接缝保持不变。
- **默认 profile。** 命令文法把 `--profile` 默认为 `topaz`（`src/args.ts` 的 `DEFAULT_PROFILE`），裸 `topaz-nai` 即启动实例；`topaz-nai web` 保留 web 别名，`--profile` 覆盖依旧可用。
- **名称。** `NAME = 'topaz-nai'` 参数化遥测标签、插件告警、profile 解析消息与补丁监听；`loadLayeredEnv` 读取同样的 `.env` 层（bin 名在该处只是诊断文案，不参与文件名）。

`package.json` 逐字复制 `dsh` 的依赖闭包（dependencies、devDependencies 与 `dsh.configTrees` agent-presets 挂载），使 `healProfilesModuleFallback` 向实例 profiles 镜像同一安装闭包。`tests/args.spec.ts` 固定文法；[`verify-application-entrypoints`](../../../../scripts/verify-application-entrypoints.ts) 将 `topaz-nai` bin 与其 `src/bin.ts` 纳入允许清单。

### 放弃了什么

「单一 launcher」不再是字面事实：两个产品 bin 共享应用启动清单，[单一 launcher note](2026-08-22-single-dsh-application-launcher.zh.md) 记录了更新后的范围。代价有界，因为第二个 launcher 不引入新机制——没有新 profile 语义、没有第二条启动路径、没有 SDK 面。身份收益是一个可命名、可定位 home、可整体终止的进程单元。

## 备选方案

**把仓库 launcher 重命名为 topaz-nai。** 否决：`dsh` 是框架、Python wheel 与文档中的产品和 SDK 契约；整体重命名把部署决策与上游身份变更耦合。

**用包装脚本为 `dsh` 设置 `DSH_HOME`。** 否决：进程仍标识为 `dsh`，默认值由脚本而非二进制持有，任何直接 `dsh` 调用又会静默落回共享 home。

**带完整 `cordis.yml` 的独立应用 bin。** 因 [单一 launcher note](2026-08-22-single-dsh-application-launcher.zh.md) 记录的原因否决：profile 启动之外的第二个生命周期偏离 `dsh-base` 并丢失插件安装。`topaz-nai` 复用 profile 正是为避开这一点。

## 验证

- `tests/args.spec.ts` 覆盖默认 profile、`web` 别名、可重复 `--patch`、dump 模式、plugin 转发与各拒绝路径（`src/args.ts` 100%）。
- `verify-application-entrypoints` 在新增 bin 与可执行源码条目下通过，并拒绝未知的第三个 bin（fixture 覆盖）。
- `tsc -b apps/topaz-nai` 在完整 host 引用链上构建该应用；过滤式 `pnpm install --filter @deepseek-ai/topaz-nai` 只物化该 importer，不重链其他包。
- README 对与本 note 的双语配对已记录；`docs/architecture.md` 启动章节与两篇部分被取代 note 的对应更新在同一变更内完成。

## 后果

- NovelAI 部署从 `~/.topaz-nai-harness`（可被 `DSH_HOME` 覆盖）运行 `topaz-nai`，其进程树、遥测行与诊断名称为 `topaz-nai`。
- `dsh` 与 `topaz-nai` 可在同一台机器并发运行且状态互不重叠；把两者的 `DSH_HOME` 指向同一根目录即恢复刻意共享。
- launcher 源码是 `apps/cli/src` 的副本（jscpd 只扫描 `packages scripts`）；上游 launcher 变更需手工镜像，[应用启动](../../../../docs/architecture.zh.md#application-launch)规则使其保持可见。
