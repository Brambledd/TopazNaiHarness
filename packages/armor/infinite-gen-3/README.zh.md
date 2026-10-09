---
description: "无限三代破甲插件：常驻破甲系统提示词段、infinite_gen3_profile 工具、破甲判定投影与浏览器状态条，面向组合作业与维护本 fork 智能体人格的用户。"
kind: "package-reference"
---

# @deepseek-ai/dsh-infinite-gen-3

[English](README.md) | 中文

## 概述

`dsh-infinite-gen-3` 是 Minglink/dsh-infinite-gen-3 v0.5.0（MIT）在本 fork 内的第一方延续：无限三代破甲指令集以内置双面插件的形式随组合启动，而不是依赖外部安装。宿主半注册逐字保留的破甲提示词（常驻 `systemPrompt` 段）、`infinite_gen3_profile` 自述工具，以及为每条完成的助手消息分类（拒绝 / 改写 / 通过、请求域、标记计数）的 `armor` 投影；浏览器半把判定渲染为输入框上方的状态条。把包加入组合——web profile 经 dsh-web-app bundle 已经如此——即同时启动全部四件能力，无需任何插件安装步骤。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把插件组合在提示词与工具服务之侧（会话投影注册表是可选的：缺它时状态条缺席，提示词与工具照常注册）。

### Composition

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-infinite-gen-3'
# optional, for the armor projection and the browser badge:
- name: '@deepseek-ai/dsh-session-projection'
```

### 各部分职责

| 部分 | 含义 |
|---|---|
| 提示词段 | `infinite-gen-3:global-system-prompt`，order 100，v0.5.0 破甲文本逐字保留 |
| 工具 | `infinite_gen3_profile`——返回插件谱系、强度标定、特性列表与逐字提示词 |
| 投影 | `armor`——`{running, verdict, words, safe, risk, domain, domainHits}`，由已提交事件折叠 |
| 浏览器状态条 | conversation input overlay 的 `armor-badge` 条目：空闲常亮、执行中脉冲、答案后闪现判定 2.5 秒 |

### 判定语义

拒绝标记只在答案前 160 个字符内计数；同样的词出现在正文中段不算。改写重定向标记全文计数。域标记（`web`、`game`、`llm`、`mobile`、`miniprogram`、`network`、`cloud`、`crack`、`nsfw`）在开头窗口内评分并报告得分最高的域。标记列表最多报告三项。

### 失败与恢复

卸载插件会同时移除提示词段、工具与投影键——每个注册都是挂载 fiber 上的 effect。没有投影注册表的组合照常加载本插件，只是缺少 `armor` 键。工具输出按设计携带完整的 15.7 KB 提示词文本；它是一次读取，不是变换。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现 internals —— 点击展开</summary>

本节解释折叠与接线；可观察行为见[使用本包](#use-this-package)。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 宿主插件入口：段、工具、可选投影注册 |
| [`src/prompt.ts`](src/prompt.ts) | 逐字破甲文本与段常量 |
| [`src/armor.ts`](src/armor.ts) | 开头窗口评分器与纯事件折叠 |
| [`src/projection.ts`](src/projection.ts) | zod schema 与面向注册表的单元定义 |
| [`src/tool.ts`](src/tool.ts) | `infinite_gen3_profile` 工具定义 |
| [`src/types.ts`](src/types.ts) | `armor` 投影键声明的唯一家 |
| [`src/client/`](src/client/index.ts) | 浏览器半：词典与 overlay 状态条 |

### 折叠规则

- `user/message` 以全新空闲判定武装 `running`；下一条非空 `assistant/message` 评分并落定。
- 空的助手内容（max-tokens 的 usage-host 消息）返回同一状态引用；注册表的 `Object.is` 门保持变更流安静。
- wire 视图即整个状态，由同一 strict schema 校验；`stateVersion: 2` 与上游插件的折叠版本一致。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [会话投影子系统](../../../docs/subsystems/session-projection.zh.md)——驱动破甲单元的注册表。
- [内置破甲系统提示词 note](../../../.agents/notes/implemented/feature/2026-10-08-builtin-armor-system-prompt.zh.md)——破甲集第一方化的决策记录。
- [Web client 架构](../../../docs/subsystems/web-client.zh.md)——状态条注册进入的槽位系统。

-----

<a id="dev-note"></a>

## 开发备注

破甲提示词文本逐字移植自上游 MIT 插件；对它的修改应先回到上游。本 fork 的延续策略记录在[内置破甲系统提示词 note](../../../.agents/notes/implemented/feature/2026-10-08-builtin-armor-system-prompt.zh.md)。

-----

<a id="model-experience"></a>
## 模型体验

### Armor instruction section and profile tool

#### What the model sees

常驻的 `infinite-gen-3:global-system-prompt` 段——逐字保留在 [`src/prompt.ts`](src/prompt.ts) 的 15.7 KB v0.5.0 文本——设定每个请求的服从基线；零参数的 `infinite_gen3_profile` 工具按需返回插件元数据与同一份文本。

#### Token effect

组合内每个会话的每次请求都是固定的 ≈4k token 段加工具 schema；工具结果只在模型调用时才追加提示词体量的载荷。不含本包的组合不受影响。

#### KV Cache effect

该段是排序在身份块之后的静态文本，其提示词前缀贡献在组合不变时跨轮次缓存稳定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **评分器是启发式而非语义级**——判定分类匹配的是从上游插件逐字移植的标记表；转述的拒绝或改写可能被判为通过。状态条是操作者信号，不是保证。
- **判定闪现基于时间**——2.5 秒闪现窗口沿用上游状态条行为；阅读慢可能错过，细节行只保留在投影值里。
- **状态条布局是锚定而非堆叠**——药丸与斜杠命令菜单共享 overlay 锚点；两者同时可见时可能视觉重叠，因为锚点是零高的绝对定位行。
