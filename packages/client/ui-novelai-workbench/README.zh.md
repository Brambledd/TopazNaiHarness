---
description: "NovelAI 创作台插件：参数面板、历史画布、tag 联想、角色提示词与对话互通桥，面向组合作业与维护浏览器工作室面的用户。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-novelai-workbench

[English](README.md) | 中文

## 概述

`dsh-client-ui-novelai-workbench` 是浏览器工作室面：双栏结构——占主导的舞台展示最新生成的图像（contain 适配、生成中遮罩、点击进灯箱缩放、元信息行带种子复用芯片、历史缩略图胶片带可切换舞台且支持滚轮横滚），旁边是独立滚动的控制列，承载提示词面板（模型/尺寸/步数/CFG/采样器/种子；默认检查点取目录的最新条目）、结构化角色卡、基于共享双语 Danbooru 索引的 tag 联想、折叠的风格库与快捷标签浏览器，以及吸底的估算与生成条。侧栏自带的 对话/创作台 开关负责两面切换。它同时提供 `novelaiWorkbench` 桥（对话面的 `novelai_generate` 卡片经此投递草稿），并把组装好的草稿**种入**对话的输入栏（不发送——由用户在那里发送；创作台提示词原样保留）。全部生成动词走 NovelAI 控制器所有的 `remote.novelai` 命名空间；面板本身不持有生成逻辑。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把包组合进已经挂载 ui-layout（workbench 槽位声明者）与 api-remotes 客户端（`remote.novelai` 命名空间）的浏览器名单：

```yaml
- id: ui-novelai-workbench
  name: '@deepseek-ai/dsh-client-ui-novelai-workbench'
```

发往对话的草稿是真实用户消息；回填投递只覆盖请求携带的字段、清空角色卡并把种子切到固定。面板是对注入面的纯 props——显式发送之外没有任何会话写入。

-----


## 开发备注

对话/创作台 模式开关与 `novelaiWorkbench` 桥是其他包可以依赖的两条缝隙；桥类型由本包所有，ui-novelai 以 `import type` 消费。

<a id="model-experience"></a>
## 模型体验

### 发送到对话 草稿投递

#### What the model sees

用户按下发送按钮时排入当前对话的一条可读用户消息——序列化当前草稿：提示词、负面提示词、参数行与逐角色行；该消息是普通落盘的用户输入，不存在隐藏的模型可见输入。

#### Token effect

每次显式发送保留一条用户消息；序列化草稿留在对话中直到压缩。

#### KV Cache effect

只追加：每条发出的草稿位于可复用请求前缀之后，后续发送继续追加而不使其失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **创作台发起的图片不进入对话日志**——把 UI 生成的图片推进当前会话需要先设计会话写入缝隙；当前互通是文本草稿加两个界面共享的输出库。
- **站位编辑是数值式的**——角色站位用百分比 X/Y 输入；可拖拽站位画布仍是开放工作。
- **用户自建风格预设不持久**——风格行派生自策展胶囊分类法；用户自建预设需随 settings 命名空间一起落地。
