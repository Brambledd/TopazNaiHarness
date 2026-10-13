# Agent Note：绝区零 Web 皮肤

Status: implemented

[English](2026-10-10-zzz-game-skin.md) | 中文

## 问题

Web 客户端此前是默认的中性 DeepSeek 配色。运营者要求以真实同人项目的素材构建绝区零视觉识别，而不是只换配色：zenless-ui 的设计语言、zenless.tools 的字体、InterKnot-Web 的游戏素材（光标、纹理、图像）——同时不破坏 [web 样式系统](../../../../docs/web-styling.zh.md)（CSS Modules、仅 token 配色、无组件库），也不破坏[客户端样式架构](../architecture/2026-08-17-dynamic-client-render-and-attachment-ownership.zh.md)（全局样式表归 ui-theme 所有并纳入生命周期管理）。

## 决策

新增一张全局样式表，配合若干组件签名处理；所有素材都是 `apps/web/public/` 下的静态文件，从不打包或内联。

- **Token 层** —— `ui-theme/src/styles/zzz.css`（第六张全局样式表，排在两张 token 表之后装载，让同优先级的重映射赢得级联）在 `body` 上发布 `--dsw-zzz-*` 强调色、纹理、光标 URL 与展示字体栈，并重映射深浅两套别名调色板（基础表面、品牌主色 `#008bff`、电光 `#2eb6ff`、黄→绿脉冲对、滚动条拇指）。字体方面，"InterKnot Sans"（印品鸿蒙体，`zh-cn-light/bold.ttf`，按 700 分档）为整个 UI 影子化 `--dsw-font-family`；"ZZZ Comic" 保留为拉丁展示回退。
- **游戏光标** —— `body` 及语义选择器（`button/a/summary/…`、`input/textarea/[contenteditable]`、`:disabled`、`[aria-busy]`）使用 InterKnot-Web 光标 PNG 与实测热点；`!important` 镜像上游写法，使模块级 `cursor:` 声明无法压过皮肤。
- **面板材质** —— `--dsw-specific-menu` 变为 `#101013 url(tab-bg-point.webp) repeat`（深色）/ `#f4f5f7 url(...) repeat`（浅色）；所有消费方都已通过 `background:` 简写读取它，因此无需改动组件。`--dsw-alias-bg-layer-2` 刻意保持纯色：它参与渐变与阴影（TrajectoryTimeline），完整的 background 值会让整条声明失效。
- **组件签名** —— Modal（`20px 0 20px 20px`、墨色描边、点纹填充、`close-btn.webp` 关闭按钮并视觉抑制图标）、用户气泡（无边框填充 + InterKnot 几何的 `chat_message_arrow_right.webp` 尖角、按主题限定亮度滤镜）、会话页签高亮（InterKnot 压扁六边形 SVG data URI，800ms `#fbfe00↔#dcfe00` 硬闪烁并 1.08↔1.2 缩放）、英雄区跑马灯（栈后两行反向漂移的旋转行，仅用 CSS 伪元素，产品文案不进 TSX）、工作台舞台（空态/运行态 Bangboo 吉祥物叠加 `banner.png` 背板）与侧栏/框架拖拽手柄（游戏 col-resize 光标）。所有动效都有 `prefers-reduced-motion` 回退。
- **出处** —— `apps/web/public/interknot/LICENSE.md` 与 `apps/web/public/fonts/LICENSE.md` 记录来源及个人非商业本地使用立场；光标文件 ASCII 重命名以规避非 ASCII `url()` 陷阱。

## 备选方案

**经 CSS 管道（Vite `?url` 导入）打包素材。** 否决：主题 CSS 是 ui-theme 动态 bundle 内联的字符串，相对资源 URL 需要面向 bundle 内部哈希，而 shell 本就从 `public/` 服务这些文件；页根相对 URL 保持样式表可对比、素材可替换。

**直接给 `--dsw-alias-bg-layer-2` 加纹理。** 否决：该别名是 `linear-gradient(...)` 色标与 `box-shadow` 颜色的输入，空格分隔的 background 值会让整条声明静默失效。

**经组件 TSX 注入跑马灯/页签 SVG。** 跑马灯因此否决（文本会成为硬编码产品文案，违反 locale 归属）；页签高亮的几何以 SVG data URI 留在 CSS 中——那是呈现，不是文案。

## 后果

`test:gui` 保持全绿，仅有意更新了 `ui-workspace` 选中行 token 断言。新增选择器要么主题限定要么由 token 驱动，删除 `zzz.css`（及 `public/interknot` 与 TTF 文件）即可还原原皮肤。新的游戏素材依赖限定在 `apps/web/public/` 并附许可说明；包清单、装载图与槽位形状均无变化。皮肤重映射既有 `--dsw-*` 别名，后续组件无需显式加入即可继承。
