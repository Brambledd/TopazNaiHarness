# Agent Note：Feed 门控的会话导航（最外层不再暴露对话内容）

Status: implemented

[English](2026-10-10-feed-gated-session-navigation.md) | 中文

## 问题

Web GUI 的最外层界面就是对话本身：应用启动后直接落在所选会话的完整转录、模型选择器和输入区上。InterKnot 皮肤让每个会话都有封面卡片之后，shell 仍没有总览界面——会话详情在任何主动选择之前就可见，也没有办法退回到账号级全景视图。

需求：最外层不显示对话详情，需要从最外层点进去才能进入对话，参照 [InterKnot-Web](https://github.com/KawaYiLab/InterKnot-Web)（封面卡片列表 → 详情）。

## 决策

1. **布局存储持有两级会话视图**（`ui-layout`）：`sessionView: 'feed' | 'entered'` 启动值为 `'feed'`，存储、`ILayout` 服务接口与 frame 上都有 `enterSession()` / `exitToFeed()` 动作。`enterSession` 同时清掉 `feedExpanded` 覆盖，返回 feed 时侧栏从收起态开始。
2. **Frame 门控的是可见性，不是挂载**：AppFrame 渲染第三个中央 pane，占位新的 `'shell.feed'` 子槽位。所有 pane 持续挂载（隐藏的用 `display:none`——把既有的中央 pane 规则推广到三个），进入会话从不重挂对话。feed 级别下对话与创作台 pane 隐藏，frame 在对话 pane 上方渲染 post-header 返回条（返回按钮 + document title），点击调用 `exitToFeed`。
3. **Feed 级侧栏纪律**：feed 级别下侧栏强制收起为 56px rail（独立的 `feedExpanded` 覆盖，已进入级别的宽度偏好不受影响）；rail 上的开关在 feed 上方重新展开、再次收起。已进入级别沿用既有的收起语义。
4. **Feed 墙归 ui-workspace**：新组件 `FeedWall` 通过 `ctx.slots.inject('shell.feed', ...)` 注册进 `'shell.feed'`。它复用平铺浏览派生（最新在前，过滤已归档与 subagent 来源行，隐藏空白临时行），渲染同样的 `SessionNodeItem` 封面卡片但去掉拖拽。每一次会话激活都落在会话级别的对话面上：ui-workspace 的 `open`/`startSession`/`forkSession` 先 `setViewMode('conversation')` 再 `enterSession()`，而 ui-sidebar 的 New Session 注入（走裸 `uiWorkspace.startSession` 服务）做同样的两步调用——一条导航接缝，侧栏行、搜索结果、墙与胶囊的行为完全一致。
5. **侧栏切换变为三段**：列表（feed）/ 对话（conversation）/ 创作台（workbench）。对话与创作台设置中央 `viewMode` 并进入会话级别；列表退回 feed。激活态跟随 owner share 的 `sessionView` + `viewMode`。`dsh.client.inject` 增加信息性的 `@deepseek-ai/dsh-client-ui-layout` 边（含 devDependency 与 tsconfig reference），用于 `ILayout` 类型。

## 曾考虑的替代方案

**布局存储之外再建一个客户端路由/状态**：frame、返回条、侧栏都消费这个级别；第二个状态 owner 会像前 slot 时代的 shell 那样与 store 竞争。store 是两个插件半区已经通过 `ctx.layout` 共享的唯一接口。

**feed 级别卸载对话**：既有的不重挂规则正是因为对话重挂会丢滚动、草稿与投影缓存；门控只管可见性。

**feed 上保持侧栏展开**：rail 让账号视图聚焦卡片，与参考皮肤一致；宽度偏好保留，进入时恢复精确的 feed 前宽度。

## 后果

- 启动落在 feed；用户首先看到封面卡片墙（默认封面见封面卡片 note），会话内容需要显式激活。
- 对话在门后持续挂载：进出都不重挂，details 栏的会话生命周期行为不变。
- ui-layout 的 SlotMap 新增 `'shell.feed'`（`single`，root scope）；client inspect catalog、`docs/subsystems/slots.md` 与各包 README 在同一次变更中更新。
- `pnpm run test:gui` 全绿（299 个文件）：layout-store/feed 级 frame 测试、三段侧栏快照、FeedWall 套件、ui-workspace apply 测试（含 feed-wall 注册与 `enterSession` 断言）共同固定新模型。
- 探测 live server 前必须重建每个被触碰的 client bundle（`ui-layout`、`ui-workspace`、`ui-sidebar`）与 web dist——registry 服务的是 `lib/client.js`，不是源码。

## 相关

- [2026-10-10 会话卡片封面流](2026-10-10-session-cover-cards.zh.md)——墙上渲染的卡片及其背后的投影/缓存接缝。
- [2026-10-10 Feed 瀑布流与 InterKnot 卡片配色](2026-10-10-feed-masonry-card-colors.zh.md)——部分取代本注的单列墙裁剪：墙现在把同样的卡片放进最短列瀑布流，并以品牌蓝标题为锚点。
- [2026-10-10 Zenless Zone Zero web 皮肤](2026-10-10-zzz-game-skin.zh.md)——同一轮换肤中的 token/资产层与菜单纯色修复。
