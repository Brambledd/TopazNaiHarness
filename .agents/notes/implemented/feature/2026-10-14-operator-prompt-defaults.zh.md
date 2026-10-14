# Agent Note: 操作者固定提示词默认（质量正向与扩展负面预设）

状态：已实现

[English](2026-10-14-operator-prompt-defaults.md) | 中文

- 日期：2026-10-14
- 包：`novelai/tool-novelai`（代码）、`novelai-prompt-writer` skill（harness 主目录）

## 问题

模型没有任何固定的质量默认：skill 明确禁止未经逐次确认添加通用审美词（规则 2.3），工具的 `DEFAULT_NEGATIVE_PROMPT` 也只镜像官方 V4+「Heavy」预设。每个多人物会话都得靠操作者手动重新要求质量标签和一长串缺陷词。

## 决策

两个落点，各在其约束生效处：

- **Skill（`novelai-prompt-writer/SKILL.md`）**——新增「操作者固定默认」小节，预先批准并覆盖规则 2.3：每张正向提示词前置 `{{masterpiece}}, {{best quality}}, very aesthetic, masterpiece`；场景描绘既有游戏/动漫角色时，额外加该作品的 Danbooru 版权标签（`{{...}}` 形式，与角色标签同一核验管线，如 `{{honkai:_star_rail}}`）加 `{{official art}}`；原创场景两者皆跳过。skill 不追加缺陷负面清单——生成工具会强制执行。
- **工具（`payload.ts` 的 `DEFAULT_NEGATIVE_PROMPT`）**——从 Heavy 预设扩展为操作者的完整质量/边框缺陷清单（新增 dithering、halftone、screentone、negative space、边框族、out of frame、cropped、incomplete composition、low quality、blurry、bad hands）。调用方未发负面时自动生效，即使模型忘记也保住缺陷防护。

## 后果

- 正向质量标签与版权/官方画风标签默认到位；逐次确认的负担转移给真正场景特定的内容。
- 负面预设仅在调用方未发负面时生效——显式（可能更短的）负面依然胜出，保留有意的覆盖。
- skill 文件位于 harness 主目录（按实例、不入库）：改动即时生效，但不会随仓库到达其他实例。
