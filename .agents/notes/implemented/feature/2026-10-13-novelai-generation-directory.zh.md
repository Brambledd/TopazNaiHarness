# Agent Note: 用户可配置的 NovelAI 生图目录

Status: implemented

[English](2026-10-13-novelai-generation-directory.md) | 中文

## 问题

每张生成的 PNG 都平铺在构造时固定的那一个目录里：控制器只在构造时创建一次 `NovelaiImageLibrary(config.outputDir)`，`novelai_generate` 则闭包持有插件配置的路径。把输出指到新目录需要改组合文件并重启进程，而且一个平铺文件夹要装下操作者生成过的所有图片——创作台行与工具行早已合并进同一条历史，但目录布局没有给它们任何组织依据。

## 决策

输出目录成为实时的、用户持有的设置，布局增加本地日期的日期子文件夹：

- **设置覆盖，按次解析**——控制器经可选的 settings 服务注册 `novelai` 设置命名空间（`generationDir`，空值 = 跟随部署 `outputDir`），镜像 agent-presets 注册者的模式。`resolveEffectiveOutputDir(configured, fallback)` 是唯一解析器（覆盖去空白后非空者胜出；相对路径按进程 cwd 解析），经 `effectiveOutputDir()` 与新的 `generationDir`/`setGenerationDir` Remote 动词暴露；`setGenerationDir('')` 清除覆盖，被拒绝的写入上抛为 `novelai/settings-write-failed`。库实例按解析后的目录缓存，因此已保存的值在下一次调用时把库、历史与删除一并搬到新目录树——无需重启。
- **`<YYYY>/<MM>/<DD>` 日期子文件夹**——`settleGeneration` 先 mkdir 本地时间的日期链，再把 PNG 存进去（可注入的 `now` 在测试里钉住时钟）；库扫描改为深度优先遍历目录树而不是只列根目录，因此遗留的根级 PNG 与嵌套日期文件夹合并进同一条历史。
- **工具跟随同一目录**——`tool-novelai/src/directory.ts` 经已挂载控制器的 `effectiveOutputDir()` 解析生成根目录（类型层面 `Pick`，包保持 dev-only 依赖边），没有控制器时回退插件配置；其 PNG 存入同样的日期子文件夹，这正是递归扫描拾取的内容。
- **客户端行**——`ui-novelai` 注册 Settings → General「生图保存目录」行（`settings.general.item`，与 token 行相同的座位）：显示生效的绝对路径以及它是否由覆盖提供，经 `remote.novelai.setGenerationDir` 保存与清除，被拒绝的写入逐字呈现宿主诊断。状态存放在 apply 世界的快照存储（`dir-settings.ts`）；组件保持纯展示，文案走 locale 字典的双语副本。

## 考虑过的替代方案

**只有重启生效的插件配置。** 拒绝：产品要求生成在不重启服务的情况下遵循新目录，而 settings 服务正是为这一分层而生（schema 默认 < 用户文档）。

**按会话或模型命名的日期子文件夹。** 暂时拒绝：本地日历布局在任何文件管理器里都可排序，与 PNG 词干内嵌的时间戳一致，且不需要扫描不具备的参数知识；按会话子目录仍是延期工作。

**在运行时共享控制器与工具之间的日期文件夹辅助函数。** 拒绝：那会为四行代码增加 `tool-novelai → api-novelai-controller` 的运行时值依赖边；工具在自己的 dev-only 类型边下保留自有副本。

## 后果

`api-novelai-controller` 新增 `@deepseek-ai/dsh-settings` 为 peer+dev 依赖（仅类型导入；scope 经 `ctx.inject(['settings'], ...)` 到达，因此未挂载 settings 提供者的组合继续使用部署 `outputDir`），并在命名空间错误词表中加入 `novelai/settings-write-failed`。`tool-novelai` 只经已声明的 dev-only 类型边读取控制器。生成的 `ctx.remote.novelai` 命名空间携带两个新动词，因此必须重建 api-remotes 客户端 bundle，行才能在运行中的服务器上工作。覆盖规格：`novelai-controller/tests/generation.host.spec.ts`（解析器分支、钉住时钟的日期文件夹）、`tests/novelai-controller.host.spec.ts`（两个 Remote 动词、只读与无提供者拒绝、指明生效目录的库错误）、`tests/library.host.spec.ts`（嵌套扫描加遗留根级文件）、`tool-novelai/tests/directory.spec.ts`，以及 `ui-novelai/tests/DirRow.client.spec.tsx`。
