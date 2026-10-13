---
description: "面向模型的 novelai_generate 工具：经官方 NovelAI 图像 API 的付费文生图，覆盖请求组装、响应提取、Anlas 估算与产物保存，面向选择、配置或调试该工具的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-novelai

[English](README.md) | 中文

## 概述

`dsh-tool-novelai` 让 agent 经官方 NovelAI 图像 API 生成动漫风格图片：从模型参数组装线格式请求，每次调用提交一次付费生成，从 ZIP 响应中提取 PNG，并保存到配置的输出目录。每个结果报告保存路径与种子，因此后续调用可以在保持其余参数不变的前提下对喜欢的图做单点变体。提交前按官方 Anlas 公式估算费用；失败响应永不自动重试，因为服务端可能已经为图片扣费。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

当 agent 需要在工作中产出 NovelAI 图片时使用本包：插画请求、稳定种子下的提示词迭代、批量创作任务。唯一的前置是挂载插件并提供 token。

### 最小配置

```yaml
- id: tool-novelai
  name: '@deepseek-ai/dsh-tool-novelai'
```

token 从 `NOVELAI_TOKEN` 环境变量读取；也可以在插件配置里设置。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `token` | `''` | 持久 API token；为空时回退 `NOVELAI_TOKEN` |
| `imageBaseUrl` | `https://image.novelai.net` | 图像 API 基础 URL |
| `outputDir` | `workspace/novelai` | 生成 PNG 的保存目录；相对路径按进程工作目录解析 |
| `timeoutMs` | `180000` | 单请求超时 |
| `proxyUrl` | `''` | 访问 API 的 HTTP(S) 代理；为空时遵循 `NOVELAI_PROXY`/`HTTPS_PROXY` 环境变量，均未设置则直连 |
| `coverBackfillSessions` | `100` | 启动时为填充会话列表封面投影而冷折叠的 Session 数（新者优先）；`0` 关闭回填 |

### 每次调用做什么

模型发送提示词与可选覆盖项（模型、尺寸、步数、CFG、采样器、噪声调度、种子、负面提示词、文件名）。工具校验 schema 表达不了的约束——64 的倍数且在 64–3072 内的尺寸、1–50 的整数步数、0–10 的 CFG、不含路径分隔符的文件名——然后应用默认值（832×1216、28 步、CFG 5、`k_euler`、Heavy 负面预设、随机种子），提交一次 `POST /ai/generate-image`，从 ZIP 响应提取 PNG 并写入输出目录。成功返回保存路径、字节大小、种子与 Anlas 估算。

### 费用纪律

每次调用都付费。工具描述要求模型有意识地批量与迭代，绝不循环刷图。失败的提交大声失败且绝不自动重试：即使 API 报错，图片也可能已经生成并扣费。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现 internals —— 点击展开</summary>

### 设计原则

- **每次调用一次付费往返。** 工具只提交恰好一次生成请求；请求组装、Anlas 估算与响应提取都是纯函数，脱离网络测试。
- **官方客户端线格式对齐。** 请求规范化自官方前端移植：V5 请求恒定提交 `noise_schedule: "karras"`，CFG 收敛到 0–10，种子收敛到 `0xffffffff`，V4+ 请求携带 API 要求的（空）角色提示词字段。默认负面提示词镜像 V4+ 的 "Heavy" 不良内容预设，因为 API 只接收合并后的文本。
- **不静默重试。** 付费 POST 即使返回 5xx 也可能已产出并扣费，因此失败逐字上抛；只有 429 类情形交给调用方处置。
- **令牌经 credential 缝解析。** 每次调用先读插件 config 的 `token`，再读 `NOVELAI_TOKEN` credential（Settings → General 行写入存储层），最后读裸环境变量；令牌变更无需重启即对下一次调用生效。
- **响应提取大声失败。** 非压缩包主体（JSON/HTML 错误页）按错误响应拒绝，绝不会被误判成「缺图需重提」。
- **投影等待其服务。** `novelai/latestImage` 单元经 `ctx.inject(['sessionProjections'], ...)` 注册，因此即使 session-controller 插件在本插件自身依赖之后才激活，注册也能落地。没有该服务的组合保留工具本身；会话列表展示默认封面。

### 会话列表封面列

该单元的 wire 值供给 web 会话列表（`SessionSummary.projectionValues['novelai/latestImage']`），列表把每个会话最新一次生成渲染为封面。启动时有一次有界回填（`coverBackfillSessions`，新者优先）：对缓存单元格缺失的持久化 Session 做冷折叠并写回 projection-cache 行，下次启动即跳过；resident Session 一并跳过，因为其强制缓存点已经落过检查点。某次折叠失败只记日志，该会话保持默认封面直至下次活动。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、`novelai_generate` 注册、默认值解析、HTTP 提交、文件保存 |
| [`src/types.ts`](src/types.ts) | 模型/采样器枚举、请求与结果类型 |
| [`src/payload.ts`](src/payload.ts) | 纯线格式体组装、Anlas 估算、文件名词干 |
| [`src/client.ts`](src/client.ts) | 带可选代理分发的 HTTP 提交与网络失败指引 |
| [`src/unzip.ts`](src/unzip.ts) | ZIP/PNG 响应提取，带尺寸上限 |
| [`src/invariant.ts`](src/invariant.ts) | 空 invariant 伴随件：适配器不持有持久会话关系 |

### 导出形状

本插件是函数/命名空间插件：导出 `name` / `inject` / `apply`，无默认导出。

</details>

-----


## 开发备注

请求规范化自官方 NovelAI 前端移植；线格式变更应先回到上游。对 TypeScript 的信任止于线格式：响应校验覆盖 ZIP/PNG 容器与尺寸上限，不覆盖图像的语义内容。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-novelai)是 `novelai_generate` schema 的穷尽来源。模型看到一个 `novelai_generate` 工具：必填 `prompt` 字符串加可选项 `negativePrompt`、`model`（当前八个 checkpoint 的枚举）、`width`/`height`（64 的倍数整数）、`steps`（1–50）、`cfgScale`（0–10）、`sampler`（枚举）、`noiseSchedule`（枚举）、`seed`（0–4294967295）与 `filename`。描述写明每次调用都付费，种子用于受控变体。

#### Token effect

工具可见的每个请求上都是固定 schema 成本；描述与 schema 稳定。

#### KV Cache effect

定义与可见性不变时前缀稳定。

### 调用历史与结果

#### 模型看到什么

每条助手工具调用保留完整参数。成功渲染为确定的 `Saved <model> image (<width>x<height>, seed <seed>, ~<anlas> Anlas) to <path>`。稳定的失败会指明被拒绝的约束，例如 ``Error: invalid dimensions: 833x1217 (each side must be a multiple of 64 within 64–3072)``，或失败提交的 HTTP 状态。

#### Token effect

调用参数保留到压缩为止；结果文本是一行固定形状。

#### KV Cache effect

只追加；新可见内容位于可复用的请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些边界界定工具何时不适用。它们是当前包约束，不是任务清单。

- **仅文生图**——img2img、局部重绘、vibe transfer、精确参考、放大与导演工具是第一阶段的刻意裁剪；它们会带着各自的参数面一起到来。
- **无订阅感知**——Anlas 估算忽略活跃 Opus 的免费额度与参考图附加费；它给出的是最坏情况上界。
- **单一输出目录**——同一进程的所有会话共享 `outputDir`；按会话子目录随库包一起到来。
- **提交前不校验令牌**——无效的持久令牌会以 NovelAI 的 HTTP 401 出现在工具结果里；错误信息会指向 Settings → General 中保存替换令牌的行。
