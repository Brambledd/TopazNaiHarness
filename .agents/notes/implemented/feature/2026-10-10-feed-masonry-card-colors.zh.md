# Agent Note：Feed 瀑布流与 InterKnot 卡片配色

Status: implemented

[English](2026-10-10-feed-masonry-card-colors.md) | 中文

## 问题

Feed 墙（`shell.feed`）最初是一列居中的封面卡片竖排。用户指出 [InterKnot-Web](https://github.com/KawaYiLab/InterKnot-Web)（`app/components/VirtualMasonry.vue`、`app/assets/styles/theme.css`）才是参照：它的 feed 让卡片高低错落，配色安排克制而明确。已批准的方案：真实瀑布流排布加上原项目的色彩系统，适配到会话卡片上。

## 决策

- **放置算法** — `rows/feed-masonry.ts` 把 VirtualMasonry 的几何参数移植为纯函数：目标列宽 240px、间距 16px、列数钳制在 2–6，剩余宽度拉伸进各列。卡片按行优先放进当前最矮的列（并列取最左），最新的卡片保持在左上角，阅读顺序从左向右扫过。不做虚拟化：会话量级很小。
- **实测卡高** — `FeedWall` 把每张卡渲染进一个绝对定位的 cell，用一个共享的 `ResizeObserver` 观察这些 cell；实测高度（封面比例 + 信息条）经版本计数器驱动重排。未实测的卡片使用退路高度，首帧先按估算排布。墙自身的 content box 是放置空间（外宽 1552px = 内容 1520px = 宽视口下正好六个 240px 列）。没有 `ResizeObserver` 的运行时（jsdom）保持退路布局——这是仓库级的守卫惯例。
- **配色** — 卡片标题改为品牌蓝锚点（`--dsw-zzz-primary`，`#008bff`；hover/选中提亮为 `--dsw-zzz-electric`），空白临时行通过新增的 `blankRow` 类保持三级灰。这沿用 InterKnot「一个强调色作为墙面锚点、状态色只出现在边框上」的安排；用应用自身的 ZZZ 蓝替换原项目的材质蓝，让这面墙与整个换肤保持同一个蓝色系。早前 `.cardCover` 的修复（默认图上不叠方格纹理）保持不变。
- **按封面比例的错落** — 比例裁剪放在封面图片自身（CSS 默认 `aspect-ratio: 1.576`）：真实封面解码后，其固有 `naturalWidth/naturalHeight` 内联替换比例，竖图变高、横图变矮，实测高度循环随即重排墙面。默认占位图永不采用占位图自身的 1:1 比例。

## 曾考虑的替代方案

- CSS 多列（`columns: 240px`）零 JavaScript 就能得到瀑布流，但阅读顺序是竖向的（先读完第一列再看第二列），破坏最新优先的扫视与最短列的错落；行优先放置器保住了阅读顺序。
- 把封面尺寸解析进 `novelai/latestImage` 投影可以在字节加载前按真实比例预排布；之所以推迟，是因为实测高度的循环已经在加载时重排，而 host 侧的尺寸读取为了一帧的精度增加一条存储接缝。

## 后果

- `placeMasonry` 有单元测试覆盖（`tests/feed-masonry.spec.ts`）；rows 与 feed-wall 的 spec 覆盖颜色钩子与封面缓存生命周期。
- 一次 PowerShell 5.1 的 `Set-Content` 重写损坏了 `tests/rows.client.spec.tsx`（UTF-8 被当作 GB2312 读取）；文件从 HEAD 恢复，会话期的封面断言按当前实现重写。绝不把工作区文本用不带 `-Encoding utf8NoBOM` 的 `Get-Content`/`Set-Content` 做往返。
- README（英/中）已记录瀑布流墙。

## 相关

- [2026-10-10 Feed 门控的会话导航](2026-10-10-feed-gated-session-navigation.zh.md)——部分取代本注的单列墙裁剪：墙现在把同样的卡片放进最短列瀑布流，并以品牌蓝标题为锚点。
- [2026-10-10 会话卡片封面流](2026-10-10-session-cover-cards.zh.md)——墙上渲染的卡片及其背后的投影/缓存接缝。
