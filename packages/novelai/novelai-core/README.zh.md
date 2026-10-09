---
description: "同构 NovelAI 图像域库：参数模型、线格式载荷组装、Anlas 估算与 Node 侧付费提交客户端，面向构建 NovelAI 生成功能的消费方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-novelai-core

[English](README.md) | 中文

## 概述

`dsh-novelai-core` 持有全部消费方共享的 NovelAI 图像域模型：checkpoint/采样器/噪声调度枚举、规范生成请求、自官方前端移植的线格式载荷组装（V4+ 结构化提示词对象、V5 `karras` 规范化、种子与 CFG 收敛）、官方 Anlas 费用公式，以及——藏在 `./node` 子路径之后——带代理分发与有界 ZIP/PNG 响应提取的付费提交客户端。根入口按构造浏览器安全；只有 Node 消费方导入 `./node`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

当消费方需要描述、计价或提交 NovelAI 文生图请求时使用本包：`novelai_generate` 工具经它组装并提交，生成控制器经它提交，浏览器 UI 从根入口导入参数模型。

### 入口点

| 说明符 | 运行时 | 内容 |
|---|---|---|
| `.` | 浏览器 + Node | 枚举（`NOVELAI_MODELS`、`NOVELAI_SAMPLERS`、`NOVELAI_NOISE_SCHEDULES`）、请求/结果类型、载荷组装、Anlas 估算、文件名词干 |
| `./node` | 仅 Node | `requestGeneration`（undici + 可选代理分发）、`extractImages`（有界 ZIP/PNG 提取）、自环境解析代理 |
| `./invariant` | Node | 注册包清单名的空 invariant 伴随件 |

### 费用纪律

每个提交的请求都付费。提交绝不重试：即使 API 报错，图片也可能已扣费，因此失败逐字上抛。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现 internals —— 点击展开</summary>

### 设计原则

- **纯核心、薄提交边。** 请求组装、Anlas 估算与响应提取都是脱离网络测试的纯函数；只有 `./node` 执行 I/O。
- **浏览器安全的根入口。** 根模块不导入任何 Node 专属运行时，导入参数模型的浏览器 bundle 永远不会拖入 `undici` 或 `fflate`。
- **官方客户端线格式对齐。** V5 请求恒定提交 `noise_schedule: "karras"`；CFG 收敛到 0–10、种子收敛到 `0xffffffff`；V4+ 请求携带 API 要求的结构化 `v4_prompt`/`v4_negative_prompt` 对象；默认负面提示词镜像 V4+ 的 "Heavy" 预设。
- **质量词强化（桌面版对齐）。** 可选 `qualityPreset` 在正面提示词末尾追加官方逐检查点质量词（`light` 仅 V5 可用，其余检查点回落到标准词；提示词带显式 `Text:` 指令时剔除相冲突的 `no text`）；V5 专属的 `transparentBackground` 追加 `transparent background` 并请求 Alpha 通道（`straight_alpha`）。未带预设的请求保持逐字不变。
- **响应提取大声失败。** 非压缩包主体（JSON/HTML 错误页）按错误响应拒绝，绝不会被误判成「缺图需重提」。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 同构入口；再导出参数模型与载荷组装 |
| [`src/types.ts`](src/types.ts) | 模型/采样器枚举、请求与结果类型 |
| [`src/payload.ts`](src/payload.ts) | 线格式体组装、Anlas 估算、文件名词干 |
| [`src/node.ts`](src/node.ts) | Node 入口；再导出提交客户端与响应提取 |
| [`src/client.ts`](src/client.ts) | 带可选代理分发的 HTTP 提交与网络失败指引 |
| [`src/unzip.ts`](src/unzip.ts) | ZIP/PNG 响应提取，带尺寸上限 |
| [`src/invariant.ts`](src/invariant.ts) | 空 invariant 伴随件：纯函数库不持有持久会话关系 |

</details>

-----


## 开发备注

载荷组装是官方客户端线格式规范化的唯一存放点：工具与生成控制器都经 `./node` 提交，规范化变更只在这里落一次，即同时传播到两个消费方。

<a id="model-experience"></a>
## 模型体验

Indirectly, through `novelai_generate` 工具：本包的参数与结果词表塑造该工具的 schema 与结果文本，而后者归消费工具所有。

#### KV Cache effect

无直接影响；本包不注册工具、提示词或事件，也不发送提供商请求。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

这些边界界定本库何时不适用。它们是当前包约束，不是任务清单。

- **仅文生图**——img2img、局部重绘、vibe transfer、精确参考、放大与导演工具是刻意裁剪；它们会带着各自的参数面一起到来。
- **无订阅感知**——Anlas 估算忽略活跃 Opus 的免费额度与参考图附加费；它给出的是最坏情况上界。
- **单图请求**——载荷恒定提交 `n_samples: 1`；多图批次是调用方的循环。
