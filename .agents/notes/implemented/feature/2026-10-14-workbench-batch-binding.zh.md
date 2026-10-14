# Agent Note: 创作台批量设置绑定对话生成

状态：已实现

[English](2026-10-14-workbench-batch-binding.md) | 中文

- 日期：2026-10-14
- 包：`api/novelai-controller`、`novelai/tool-novelai`、`client/ui-novelai-workbench`

## 问题

创作台面板拥有批量张数（1–8）与间隔（秒）（0–60），并且自己的生成按钮会按它们循环，但这两个字段在 `NovelaiWorkbenchState` 上不存在。对话侧的 `novelai_generate` 调用绑定的正是已提交状态，因此永远只出一张图：操作者的批量设置从未抵达工具，而 API 载荷按契约就是单图（`n_samples: 1`；多图靠调用方循环）。

## 决策

- wire 状态长出可选 `batchCount` 与 `batchIntervalSec`；面板仅在张数大于 1 时提交它们（缺省即 1 张 / 5 秒默认），会话重入时按同样区间钳制恢复。
- `novelai_generate` 的解析只从已提交状态绑定这两项——调用 schema 刻意不带批量参数，模型无法覆盖操作者的付费量设置。
- 工具执行镜像桌面端批量契约：N 次顺序请求、按配置间隔等待、绑定种子逐张 +1（一批不是 N 张近乎相同的帧）、随机意图逐张重抽——`resolveInput` 只物化第一次抽取，循环负责其余。每张都保存在主图旁边；结果长出可选 `siblings` 数组（路径 + 种子），渲染时逐条列出。
- 工具描述告知模型：面板张数大于 1 时一次调用即产出该数量。

## 后果

- 对话侧一次生成如今产出面板的批量：N 次付费请求，逐张保存并上报，附每张种子便于后续微调。
- 两个新字段都跨越已构建的浏览器边界——remotes 客户端 bundle 内嵌提交 schema，因此本次变更同步重建了它（剥离隐患记录于[角色槽](2026-10-14-novelai-patch-characters-slot.zh.md)）。工具输出 schema（`siblings`）只在宿主侧，无需浏览器重建。
- 诊断教训（血泪）：写成 `Contains('\"characters\"')` 的 PowerShell 检查内嵌字面反斜杠、永远报 false——引发本轮第二次排查的「角色丢失」读数正是这个转义引号假象，不是真实状态丢失。
