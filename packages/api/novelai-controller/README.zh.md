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
| `generate(request)` | 解析 → 计价 → 付费提交（绝不重试）→ PNG 存入 `<dir>/<YYYY>/<MM>/<DD>/` → 索引记录 |
| `history({ offset?, limit? })` | 合并库的一页（新者优先）与总数 |
| `removeEntry({ id })` | 删除一条记录与其 PNG 文件 |
| `generationDir()` | 当前生效的绝对输出目录，以及它是否由已保存的设置覆盖提供 |
| `setGenerationDir({ dir })` | 持久化目录覆盖（空字符串清除）；下一次生图即生效，无需重启 |
| `commitWorkbenchState({ sessionId, state })` | 把一个会话的最新面板状态存入热映射并持久化到 harness 主目录下 |
| `readWorkbenchState({ sessionId })` | 一个会话已提交的面板状态：先查热映射，否则查持久化存储 |
| `artistChains()` | 创作台的命名画师串库，最新在前 |
| `saveArtistChain({ id, name, tags })` | 整串保存一条命名画师串（id 为空即新建，已有 id 原位更新）；去空白后名称 ≤ 80 字符、标签串 ≤ 2000 字符且均非空 |
| `removeArtistChain({ id })` | 删除一条已保存的画师串；未知 id 回答 `novelai/artist-chain-missing` |

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `outputDir` | `workspace/novelai` | 共享图片库的默认目录；把生成工具的 `outputDir` 指向同一路径 |

生效的生图目录按次解析：先读已保存的 Settings → General「生图保存目录」覆盖（`novelai` 设置命名空间的 `generationDir` 字段），否则用 `outputDir` 配置；相对路径按进程工作目录解析。每张 PNG 都存入生效目录下按本地时间 `<YYYY>/<MM>/<DD>` 创建的日期子文件夹。NovelAI token 在提交时从 `NOVELAI_TOKEN` 凭据（凭据存储、`.env`、环境变量依次读取）；缺失时回答 `novelai/token-missing`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现 internals —— 点击展开</summary>

### 设计原则

- **生成循环里没有 LLM。** 创作台直接与本命名空间后的图像 API 对话；agent 保持可用于提示词起草与变体，而不是表单提交。
- **一个库、两个生产者。** 创作台提交向 `library.json` 追加全参数行；目录里任意深度的其他 PNG（工具调用、外部保存）经递归扫描发现，并用文件内嵌的元数据（`Title`/`Description`/`Comment` tEXt 块）丰富。
- **显式默认化。** `resolveGenerationRequest` 是唯一的默认化步骤：空白负面提示词回退宿主默认，缺省种子随机化，被计价与提交的就是解析后的输入。
- **付费提交绝不重试。** 失败的 POST 可能已为图片扣费，因此失败逐字上抛为 `novelai/generation-failed`。
- **目录实时解析。** 库实例按解析后的目录缓存，已保存的设置覆盖因此能在不重启的情况下移动库（以及读取 `effectiveOutputDir()` 的生成工具）。
- **面板状态持久。** 已提交的面板状态原子落盘（`.tmp` + 改名）到 `settings.yaml` 旁的 `<home>/novelai-workbench-states/<sessionId>.json`；缺失、不可解析或形状不对的文档读取为不存在，会话 id 超出 `1-64` 个字母/数字/`_`/`-` 的不能命名文档。持久化失败回答 `novelai/state-persist-failed`；没有可解析 harness 主目录时控制器退化为内存保存并在启动时警告。
- **画师串库是主目录下的用户数据。** 创作台的画师串库是 `<home>/novelai-artist-chains.json` 的一个 `{ id, name, tags }` JSON 数组，每次变更原子重写、按最新在前服务（更新保持原位）。每条画师串是一条命名的整串条目——粘贴来的 `weight:artist::` 串作为标签串原样存储，绝不拆解为逐画师条目；串 id 由宿主分配的不透明串承担。名称（≤ 80 字符）与标签串（≤ 2000 字符）去空白后必须非空；拒绝回答 `novelai/artist-chain-invalid` / `novelai/artist-chain-missing`。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `NovelaiController` 服务：Remote 动词、错误词表映射、历史分页 |
| [`src/types.ts`](src/types.ts) | 浏览器安全的请求/结果词表与命名空间的 `RemoteErrorDetailsMap` 行 |
| [`src/library.ts`](src/library.ts) | `NovelaiImageLibrary`：JSON 索引、目录扫描合并、原子索引写入 |
| [`src/workbench-state-store.ts`](src/workbench-state-store.ts) | `WorkbenchStateStore`：harness 主目录下按会话的面板状态 JSON 文档，原子写入、会话 id 守卫、宽容读取 |
| [`src/artist-chains.ts`](src/artist-chains.ts) | `ArtistChainStore`：画师串库以单个原子重写的 JSON 数组存放于 harness 主目录下，命名标签串原样保留、宿主分配 id、名称与长度校验拒绝 |
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

- **token 仅经环境变量**——服务在提交时读取 `NOVELAI_TOKEN` 凭据（凭据存储、`.env`、环境变量依次读取）；它自身不写入凭据。
- **仅文生图**——img2img、局部重绘与放大动词在其创作台面存在前是刻意裁剪。
- **无流式进度**——`generate` 是一次一元调用；长提交无法报告步进进度，取消仅限请求作用域。
- **工具调用不入索引**——`novelai_generate` 工具的 PNG 经递归目录扫描出现在历史里，但索引行（精确请求参数）只由创作台提交写入；工具不追加库索引。
