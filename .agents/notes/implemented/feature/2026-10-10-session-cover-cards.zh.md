# Agent Note: Session-card cover feed and the novelai/latestImage projection

Status: implemented

[English](2026-10-10-session-cover-cards.md) | 中文

## Problem

侧边栏会话列表此前把每个会话渲染成一行 32px 的纯文本行。ZZZ 换肤之后，列表仍然没有 InterKnot 的识别度，会话里的 NovelAI 产出在打开会话之前完全不可见。需求：参照 InterKnot-Web 的 PostCard 做成封面卡片——封面取该会话最新一次 NovelAI 生成的图片（还没有生成时用默认封面图），点击进入会话。

阻塞点：侧边栏只能看到列表摘要。图片附件存放在会话日志里，而现有的附件 RPC（`session.attachment`）只能通过已绑定、已打开的会话访问。

## Decision

1. **宿主投影 `novelai/latestImage`**（`packages/novelai/tool-novelai/src/projection.ts`）：对成功的 `novelai_generate` 结果做 latest-wins 折叠——`tool/call` 认领 call id，append-surface 的 `tool/result` 消费它，最后一个图片块连同其 seq 胜出（图片块可能嵌在呈现层的 `tool-result` 块内，折叠会递归）。replacement-surface 的结果永远不会追加。注册不能在 apply 时刻用 `ctx.get('sessionProjections')`：本插件的 `inject` 是 `['tools']`，apply 会先于 session-controller 物化该服务运行，optional get 静默落空——单元改经 `ctx.inject(['sessionProjections'], ...)` 注册，没有该服务的组合保留工具与默认封面。列表流把 wire 视图作为 `SessionSummary.projectionValues` 的一部分发给每个客户端。
   - **冷回填**（`src/backfill.ts`，`coverBackfillSessions`，默认 100）：列表从不物化投影单元格，而 api 列表的小工件冷探测只观测 ≤1KB 的工件——所有真实 NovelAI 会话都超过它，因此缓存行永远长不出这个键，冷封面会一直是默认图。注册时插件因此对缓存单元格缺失的持久化 Session 做最多 `coverBackfillSessions` 次冷折叠（新者优先）：`sessionQuery.observeSession(..., { projectionMode: 'none' })` + `sessionProjectionCache.coldSnapshot`，后者写回刷新后的行；resident Session 与已携带该键（含 `null`）的 Session 跳过。折叠失败只记日志，该会话保持默认封面直至下次活动。
2. **冷会话附件读取**：`SessionManager.readSessionAttachment(sessionId, attachmentId)`，并经 `ClientSessions` / `ISessions` 暴露，base64 载荷只解码一次（`attachment-decode.ts`）。宿主按该会话的日志做授权，因此只有真正被引用的附件才会解析成功。
3. **ui-workspace 卡片**：`SessionNodeItem` 渲染 InterKnot PostCard——黑色外框（`20px 20px 0 20px`、3px 内边距），框的颜色即状态（悬停 lime、选中 yellow），1.576 封面配 `default-cover.webp`，真实图片在其上淡入，运行中显示 `zzz-pulse-border` 呼吸徽章，悬停时操作菜单钉在封面右上角。状态圆点、拖拽标记、⋯ 菜单与悬停卡保留原有的行语义。
4. **封面传输**：ui-workspace 的 apply 闭包内创建 `createCoverCache()`——引用计数管理的 object URL，对无引用条目做 64 条 LRU，60 秒空闲后撤销，失败读取做负缓存。以纯数据注入（`coverCache: CoverCache`）；卡片挂载时 acquire、卸载时 release。缓存随插件 fiber 释放。

## Alternatives considered

**在会话表面内读取封面**（按会话的 client 侧）：只对已打开会话有效；列表需要冷会话的封面。

**通过新的列表 RPC 下发缩略图字节**：重复了附件 RPC 已有的授权规则，还会为没人查看的会话传输像素。

**模块级封面缓存**：跨插件重载的事实单例；被客户端规则禁止，且 URL 撤销必须跟随 fiber 生命周期。

## Consequences

- 侧边栏封面在回填播种过会话的缓存行之后是最终一致的：在宿主重算投影时更新（由活动驱动），不在生成时刻更新。
- 封面读取失败在插件生命周期内不再重试（负缓存）；失败显示默认封面，绝不弹错误界面。
- `flatSessionRowWithoutStatus` 与 `flat` prop 随行式废弃；状态槽的显隐规则（空闲卡不带圆点）保留。
- 修复后的首次启动最多冷折叠 `coverBackfillSessions` 个会话（每个一次解压加折叠）；其后的启动跳过已携带该键的行。
- `pnpm run test:gui` 全绿（投影折叠、封面缓存、卡片行为、卡片 CSS 契约共 55 条新增/更新断言）。
- 被触及的每个客户端程序都必须重建，而不止 ui-workspace：该特性首次实机启动时所有卡片都是默认封面，原因是 `@deepseek-ai/dsh-api-session-controller` 的 client bundle 落后于 `readSessionAttachment`——loader 同步抛错、负缓存吞掉错误、`session/attachment` 请求根本未发出。`pnpm --filter @deepseek-ai/dsh-api-session-controller run bundle`（加 web dist 重建与重启）修复。

## Related

[2026-10-10 Zenless Zone Zero web skin](2026-10-10-zzz-game-skin.zh.md)——这些卡片消费的 token/素材层（`--dsw-zzz-*`、`default-cover.webp`）。
