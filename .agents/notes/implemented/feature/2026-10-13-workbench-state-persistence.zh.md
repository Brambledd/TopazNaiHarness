# Agent Note: 创作台面板状态的持久化（按会话存储、切换即恢复）

Status: implemented

[English](2026-10-13-workbench-state-persistence.md) | 中文

## 问题

创作台面板已提交的状态只存在于控制器的内存映射与面板的 React 状态里，commit 动词的契约也明说了这一点：内存只保活到服务进程结束。离开对话再回来、刷新页面、或重启服务，面板都会回到目录默认值——操作者的提示词、负面提示词、模型、尺寸、步数、采样器与种子全部静默回退，而 `novelai_generate` 工具的提示词来源（宿主侧绑定的已提交状态）也随面板一同丢失配置。

## 决策

面板状态按会话持久化，面板在每次会话切换时恢复：

- **落在 harness 主目录下的按会话状态文档**——`WorkbenchStateStore` 把每个会话的 JSON 文档持久化在 `<home>/novelai-workbench-states/<sessionId>.json`，控制器构造时经 `resolveDshHome()` 解析一次。读取把缺失、不可解析或形状不对的文档容忍为不存在（生图库索引的容忍方式），写入是原子的（`.tmp` + 改名），会话 id 守卫（`1-64` 个字母、数字、`_`、`-`）保证每个文档名都是单一路径段。热映射仍是挡在存储前面的读穿缓存。
- **提交响亮，读取宽容**——commit 时的持久化失败以新的 `novelai/state-persist-failed` RemoteError 上抛，调用方因此得知面板状态未落盘；对存储不可能写过的会话 id 的读取（subagent id 带冒号）返回不存在，`tool-novelai` 的状态绑定因此在 subagent 会话里继续工作。没有可解析主目录的组合退化为内存保存并给出构造期警告——启动继续。
- **面板每次会话切换都恢复**——会话 id 每次变化，面板都在目录 seeding 落定之后读取该会话已提交的状态，因此恢复的参数胜过种入的默认值，并无条件应用：提示词、负面提示词（自动展开折叠）、模型、尺寸、步数、CFG、采样器、噪声调度，以及把种子钉到固定档的种子值。切回之前的会话会再次恢复——面板切换时不清理任何字段，提交循环又把面板原样发布，所以再次恢复是幂等的。在会话再次切换——或界面已卸载——之后才 resolve 的响应被按次守卫丢弃；面板不新增任何用户可见文案。
- **线上类型保持冻结**——`NovelaiCommitWorkbenchStateRequest` 与 `NovelaiReadWorkbenchStateValue` 与已交付的完全一致；持久化搭同一对请求/返回值的便车，因此无需重建 remotes bundle。

## 考虑过的替代方案

**浏览器本地保存（localStorage）。** 拒绝：已提交状态是宿主持有的——`novelai_generate` 在宿主侧绑定它——因此它必须挺过服务重启，并在操作者从任意浏览器重新打开时跟随会话；localStorage 按源、按浏览器隔离，且会静默腐烂。

**只在面板未被触碰时恢复。** 拒绝：每次会话切换都恢复就是契约——切换对话正是它要撤销的漂移场景——而读取在切换后数毫秒内落定，不存在需要保护的输入窗口；真正需要守卫的是来自面板已再次离开会话的迟到响应，这正是按次守卫丢弃的东西。

**同时持久化逐角色状态。** 暂缓：线上值没有 `characters` 字段，本次变更保持线上类型冻结，因此已提交与恢复的状态只覆盖共享字段；角色卡片维持会话内局部，直到线上类型扩展有了独立的正当理由。

## 后果

`api-novelai-controller` 新增 `@deepseek-ai/dsh-home-paths` 为 peer+dev 依赖（含 tsconfig project reference；构造时解析一次），并在命名空间错误词表中加入 `novelai/state-persist-failed`。状态文档是 harness 主目录下的操作者数据，包升级不影响它们。面板只在当前会话的恢复读取落定后才提交（`panelSettled` 门控）：切换途中重挂的面板会把裸未种子状态发布上去覆盖已存状态——这正是「切走再切回内容就没了」的覆盖来源。恢复守护同样只在读取落定后置位，飞行中被取消的读取会重跑而不是把该会话标记为已恢复。面板状态的归属规则（[客户端会话所有权](../architecture/2026-08-20-client-session-conversation-ownership.zh.md)）把交互状态留在 UI 包；持久化落在宿主侧，因为该状态的第二个消费者——生成工具绑定——就在宿主（[创作台界面](2026-10-08-novelai-workbench-surface.zh.md)）。覆盖规格：`novelai-controller/tests/workbench-state-store.host.spec.ts`（往返、原子替换、容忍、id 拒绝、退化）、`tests/novelai-controller.host.spec.ts`（两个动词、重启语义、不安全 id 与非 Error 拒绝、内存退化），以及 `ui-novelai-workbench/tests/workbench-panel.client.spec.tsx`（恢复、默认值、读取失败、同一会话 id 只读一次、会话切换与切回恢复、迟到响应丢弃、无会话、落定前持有提交的门控）。
