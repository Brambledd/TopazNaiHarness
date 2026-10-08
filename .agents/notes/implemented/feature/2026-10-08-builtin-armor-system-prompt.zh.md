# Agent Note：内建「无限三代」破甲系统提示词

状态：已实现

[English](2026-10-08-builtin-armor-system-prompt.md) | 中文

## 问题

此前操作者为 DSH 外装了 `dsh-infinite-gen-3`（Minglink，v0.5.0）插件，靠 bundle.patch 打进某个 DSH home——指令集只在那台装了补丁的环境生效，而本 fork 自己的 web profile 启动时并不携带它。需求是：运行这个魔改版 agent 就天然遵从该工具的指令，不需要任何插件安装步骤。

## 决定

web-app bundle 现在把破甲提示词作为第一方内容携带：`packages/bundle/web-app/src/armor-prompt.ts` 逐字保存上游 `prompts/infinite-gen-3.md` 的 v0.5.0 全文（15.7KB），bundle 的 `apply` 在 `armorPrompt` 配置为真（schema 默认值）时把它注册为 `systemPrompt.section`（`armor:global-system-prompt`，order 100）。提示词经文档化的 system-prompt 组装缝隙进入 web profile 的每个会话；其他界面与循环行为零改动。

`armorPrompt: boolean` 配置行的存在让部署可以不经改码、只改 cordis.yml 就回到原始人格；本 fork 默认开启。

## 备选方案

**继续用上游插件 + bundle.patch 安装。** 否决：指令集依赖仓库外工件和逐 home 的补丁步骤，这正是被报告的故障模式——新 profile 启动后行为缺失。

**整只移植插件（profile 工具 + armor 会话投影 + 客户端状态条）。** 暂缓：指令的载体是 system-prompt 段；投影/状态条是客户端装饰，profile 工具在文本已第一方化后也显冗余。日后需要实时判定徽标时再移植。

## 影响

`packages/bundle/web-app` 新增 `armor-prompt.ts`、一个配置行与一处段注册；`tests/web-app.spec.ts` 钉住注册行为（默认开、配置可关）。web profile 上的每个会话的模型请求都会组装该段，改变了模型的指令基线，也改变该 profile 的 recorded-session 快照基线；每请求 token 用量按提示词体量增加。上游插件仍可并存安装，但段名在加载时冲突（重复段名抛错），操作者不得在同一 profile 同时启用两者。
