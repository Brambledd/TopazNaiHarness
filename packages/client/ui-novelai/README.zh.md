---
description: "NovelAI 对话面插件：novelai_generate 工具卡、回合尾图链与回填创作台桥，面向组合作业与维护浏览器对话面的用户。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-novelai

[English](README.md) | 中文

## 概述

`dsh-client-ui-novelai` 在对话中渲染 NovelAI 生成：为每个 `novelai_generate` 调用提供 keyed `tool.call.toolview` 行（状态、提示词摘要、可展开的结果详情）与「回填到创作台」按钮——后者经 `novelaiWorkbench` 桥把调用参数和实际种子投递给已挂载的创作台面板；另有回合尾图链，在收尾的助手消息下方展示每张产出图。本包不持有生成逻辑；面板与动词归创作台包和 NovelAI 控制器所有。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把包组合进已经挂载 ui-conversation（overlay 槽位声明者）、创作台（桥提供者）与 ui-tool（toolview 声明者）的浏览器名单：

```yaml
- id: ui-novelai
  name: '@deepseek-ai/dsh-client-ui-novelai'
```

工具行完全由持久的调用/结果事件推导——状态、摘要、详情均从会话日志折叠，重放渲染一致。回填按钮只在调用成功落定时出现；创作台面板未挂载时投递返回 `false`。

本包还注册了 Settings → General 的 **NovelAI API 令牌** 行：经 Remote credentials 命名空间保存与清除 `NOVELAI_TOKEN` credential，展示凭据的配置状态与来源层，并随推送的 `credentials/reference-updated` 事件刷新。

-----


## 开发备注

工具卡完全从原始调用与结果事件推导；结构化的结果元数据块可以去掉从结果文本解析种子的步骤，此外卡片不从工具包读取任何东西。

<a id="model-experience"></a>
## 模型体验

Indirectly, through 对话面的 `novelai_generate` 卡片：本包渲染已落盘的调用与结果事件，其回填按钮把模型输入委托给创作台排队发送的用户消息。

#### KV Cache effect

无直接失效；卡片渲染重放的日志状态，请求变化归对话追加的消息所有。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **回填载荷从线格式参数重建**——工具卡从调用的持久化参数读取请求字段、从结果文本解析实际种子；未来的结构化结果元数据块可去掉文本解析。
- **回合尾图依赖附件授权**——卡片只渲染会话附件面授权的内容；日志未记录的图片永远不会被抓取。
