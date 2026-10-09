# Agent Note：内建「无限三代」破甲系统提示词

状态：已实现

[English](2026-10-08-builtin-armor-system-prompt.md) | 中文

## 问题

此前操作者为 DSH 外装了 `dsh-infinite-gen-3`（Minglink，v0.5.0）插件，靠 bundle.patch 打进某个 DSH home——指令集只在那台装了补丁的环境生效，而本 fork 自己的 web profile 启动时并不携带它。需求是：运行这个魔改版 agent 就天然遵从该工具的指令，不需要任何插件安装步骤。

## 决定

上游插件被整体移植为一方包 `@deepseek-ai/dsh-infinite-gen-3`（`packages/armor/infinite-gen-3/`），web-app 补丁行默认组合它。包内承载上游行为的四个切面：

- **系统提示词段**——`src/prompt.ts` 逐字保存 v0.5.0 全文（15.7KB，MIT 署名头），经 `ctx.effect` 注册为 `infinite-gen-3:global-system-prompt`（order 100）；每个组装会话都会携带该文本。
- **`infinite_gen3_profile` 工具**——`src/tool.ts` 以纯 `ToolDefinition`（零宿主值导入）暴露上游的自描述工具（版本元数据加逐字提示词）。
- **`armor` 会话投影**——`src/armor.ts`/`src/projection.ts` 逐字移植开局窗口评分器与折叠（stateVersion 2）：用户消息置 `running`，助手文本落定 `pass`/`refusal`/`fallback` 并携带封顶的命中词表与最优请求域。
- **浏览器徽标**——`src/client/` 经 `conversation.input.overlay` 槽位在对话输入框上方渲染令牌化的状态胶囊（locale 持有的双语文案、判定闪烁、执行脉冲），数据来自 `useProjection('armor')`。

web-app 侧移除了此前的内联变体：`armor-prompt.ts`、`armorPrompt` 配置行与其段注册一并删除——提示词文本只在包内存在一份，避免重复文本把每请求 token 成本翻倍。bundle 的 `cordis.patch.yml` 在 file-reference 行之后新增一行（`- id: infinite-gen-3`），破甲插件由此成为 web profile 出厂组合的一部分。

## 备选方案

**继续用上游插件 + bundle.patch 安装。** 否决：指令集依赖仓库外工件和逐 home 的补丁步骤，这正是被报告的故障模式——新 profile 启动后行为缺失。

**保留 web-app 内联的纯提示词变体。** 事后否决：它只带了文本，没有任何可见信号（工具、判定投影、徽标），而用户感知到的缺口恰恰是这些信号；内联还会让提示词出现第二个存放点，整体移植正好删除它。

**在客户端评分判定。** 否决：判定折叠是持久的会话关系（徽标必须在刷新与重放下完全一致），所以归属宿主投影；客户端只经 `useProjection('armor')` 读取。

## 后果

新增包 `packages/armor/infinite-gen-3`（宿主+客户端双面、invariant 伴随件、经真实 Loader 的组合 spec、评分/折叠/徽标单测）、`packages/armor/` 组 README、每个编译面各一条聚合 tsconfig 注册与生成的路径别名（`@deepseek-ai/dsh-infinite-gen-3`、`/invariant`、`/client`）。`packages/bundle/web-app` 移除内联破甲及其 spec，新增依赖与补丁行；`tests/web-app.spec.ts` 不再钉住破甲（包自身的 loader spec 钉住组合）。web profile 上的每个会话现在组装该段并看到模型可见的 `infinite_gen3_profile` 工具，改变了模型的指令基线，也改变该 profile 的 recorded-session 快照基线；每请求 token 用量按提示词体量增加。上游插件仍可并存安装，但段名在加载时冲突（重复段名抛错），操作者不得在同一 profile 同时启用两者。
