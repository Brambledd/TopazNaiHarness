---
description: "创作台图像生成与共享 NovelAI 输出库的 Remote 所有者：NovelAI 命名空间之上的目录、计价、付费提交与历史，无需 LLM 回合即可服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-novelai-controller

[English](README.md) | 中文

## 概述

`dsh-api-novelai-controller` 持有宿主 `ctx.novelaiController` 服务与生成的客户端 `ctx.remote.novelai` 命名空间。其 Remote 动词服务生成目录（checkpoint、采样器、噪声调度、创作台默认值）、Anlas 报价、付费文生图提交，并读取共享输出库——一个 JSON 索引与配置输出目录的目录扫描合并而成的库，因此创作台生成与 `novelai_generate` 工具调用呈现为同一条历史。创作台直接经此命名空间生成；不涉及任何模型回合或工具调用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

当浏览器面需要在无 agent 回合的情况下生成或浏览 NovelAI 图片时使用本包：创作台 UI 经 `remotes` 组装挂载 `ctx.remote.novelai`，调用 `catalog`、`estimate`、`generate`、`history` 与 `remove`。

### Remote 动词

| 动词 | 契约 |
|---|---|
| `catalog()` | checkpoint、采样器、调度、`maxSeed` 与创作台默认值 |
| `estimate({ width, height, steps })` | 按官方公式给出 Anlas 报价 |
| `generate(request)` | 解析 → 计价 → 付费提交（绝不重试）→ PNG 存入 `outputDir` → 索引记录 |
| `history({ offset?, limit? })` | 合并库的一页（新者优先）与总数 |
| `removeEntry({ id })` | 删除一条记录与其 PNG 文件 |

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `outputDir` | `workspace/novelai` | 共享图片库目录；把生成工具的 `outputDir` 指向同一路径 |

NovelAI token 在提交时从 `NOVELAI_TOKEN` 环境变量读取；缺失时回答 `novelai/token-missing`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现 internals —— 点击展开</summary>

### 设计原则

- **生成循环里没有 LLM。** 创作台直接与本命名空间后的图像 API 对话；agent 保持可用于提示词起草与变体，而不是表单提交。
- **一个库、两个生产者。** 创作台提交向 `library.json` 追加全参数行；目录里的其他 PNG（工具调用、外部保存）经扫描发现，并用文件内嵌的元数据（`Title`/`Description`/`Comment` tEXt 块）丰富。
- **显式默认化。** `resolveGenerationRequest` 是唯一的默认化步骤：空白负面提示词回退宿主默认，缺省种子随机化，被计价与提交的就是解析后的输入。
- **付费提交绝不重试。** 失败的 POST 可能已为图片扣费，因此失败逐字上抛为 `novelai/generation-failed`。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `NovelaiController` 服务：Remote 动词、错误词表映射、历史分页 |
| [`src/types.ts`](src/types.ts) | 浏览器安全的请求/结果词表与命名空间的 `RemoteErrorDetailsMap` 行 |
| [`src/library.ts`](src/library.ts) | `NovelaiImageLibrary`：JSON 索引、目录扫描合并、原子索引写入 |
| [`src/generation.ts`](src/generation.ts) | 请求解析、创作台默认值与提交管线 |
| [`src/invariant.ts`](src/invariant.ts) | 空 invariant 伴随件：本包不持有持久 harness 关系 |

</details>

-----


## 开发备注

生成的 `ctx.remote.novelai` 命名空间会内嵌进 api-remotes 客户端 bundle，因此这里的动词或类型变更在该 bundle 重建并刷新页面前都不算完成；陈旧 bundle 表现为被静默吞掉的属性代理未命中。

<a id="model-experience"></a>
## 模型体验

Indirectly, through 创作台与 `novelai_generate` 工具：命名空间在无模型回合的情况下服务生成动词，产出图只在对话附加它们时才对模型可见。

#### KV Cache effect

无直接影响；本包从不组装也不发送提供商请求。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

这些边界界定本包何时不适用。它们是当前包约束，不是任务清单。

- **token 仅经环境变量**——服务在提交时读取 `NOVELAI_TOKEN`；设置面的 token 流程随 credential 集成一起到来。
- **仅文生图**——img2img、局部重绘与放大动词在其创作台面存在前是刻意裁剪。
- **无流式进度**——`generate` 是一次一元调用；长提交无法报告步进进度，取消仅限请求作用域。
- **工具调用不入索引**——`novelai_generate` 工具的 PNG 经目录扫描出现在历史里，但索引行（精确请求参数）只由创作台提交写入；工具不追加库索引。
