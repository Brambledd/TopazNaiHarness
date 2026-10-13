# Agent Note: 创作台画师串

Status: implemented

[English](2026-10-13-workbench-artist-chain.md) | 中文

## 问题

NovelAI 通过 `0.3:cola gotouryouta::, 0.9:re0n::` 这类权重框架串混合画师——每种风格一条标准串，全凭记忆或临时文件每次重新粘贴。创作台已有快捷标签与风格库，但没有任何东西保存操作者的串，也没有一步插入整条串的动作。

## 决策

harness 主目录下的命名画师串库，在创作台一个可折叠分区里管理：

- **单个 JSON 数组文档** —— `ArtistChainStore` 把库存放在 `<home>/novelai-artist-chains.json`，每次变更原子重写（`.tmp` + 改名），首次读取后进内存缓存。缺失、不可解析或形状不对的文档按空库读取——小体量可重建的用户数据，与面板状态存储的容忍方式一致。没有可解析主目录时存储退化为内存保存并给出构造期警告。
- **名称之下的整串文本，绝不拆解** —— 每条画师串是 `{ id, name, tags }`，id 为宿主分配的 `crypto.randomUUID()` 不透明串。标签串文本是一条原样整串：粘贴来的标准串如 `0.3:cola gotouryouta::, 0.5:yoneyama mai::, 0.7:betabeet::, 0.9:re0n::, 1.8:kim hyung tae::` 按原样存储（仅去首尾空白）；存储层不做逐画师拆解、权重校验或重组，粘贴内容所表达的一切都不会丢失。名称是库的组织句柄：去空白后 1–80 字符；标签串 1–2000 字符。`saveArtistChain` 在 id 为空时新建（新串追加为最新）、经已存 id 原位更新并保持其位置；列表按最新在前服务。
- **`novelai` 命名空间上的三个 Remote 动词** —— `artistChains` 读取库，`saveArtistChain` 按 id 新建或更新一条命名串，`removeArtistChain` 按 id 删除。拒绝以 `novelai/artist-chain-invalid`（原因在 message）与 `novelai/artist-chain-missing`（未知 id）呈现。生成的命名空间需要先重建 host lib，客户端才能对新动词通过类型检查；bundle 现已携带。
- **可折叠的「画师串」分区** —— 沿用风格库分区的折叠模式，置于其旁。库在首次展开时懒加载；每行展示画师串的名称与整段标签串文本（省略号截断，悬停看全文），提供 插入——把该串标签串追加到提示词（经既有 `setPrompt`：`prompt === '' ? tags : prompt.trimEnd() + ', ' + tags`，插入因此走面板正常的提交链）——与免确认回路的 删除（小体量可重建数据）。行下方是名称 + 标签串表单，保存一条新条目（空 id）并按返回的库重渲染；两个字段都非空白前按钮保持禁用。名称占位符给出友好示例（如「厚涂风」/ e.g. "impasto style"）；标签串占位符展示标准格式——`0.3:cola gotouryouta::, 0.5:yoneyama mai::, …` 并附 `权重:画师::，逗号分隔` / `weight:artist::, comma-separated` 提示——输入之前格式就已可见。全部文案都在类型化词典里（双语）。

## 考虑过的替代方案

**逐画师条目编辑（带权重输入框的条目列表）。** 拒绝：真实工作流是从参考资料粘贴一条标准串、把它当作一个整体管理；把 `weight:artist::` 串拆回条目会引入有损修正，且逐条目重组会重排、改写操作者本来已经正确的文本。标签串因此按原样存储与插入。

**客户端自持存储。** 拒绝：画师串是每个浏览器面共享的提示词素材，必须挺过服务重启、跨浏览器跟随操作者；宿主侧存储把 id 权威与校验放在其余持久创作台状态旁边。

## 后果

`api-novelai-controller` 新增 `src/artist-chains.ts` 与两个错误词表行；`ui-novelai-workbench` 新增三个注入面、该分区与双语词典键。插入只改动面板提示词——[面板状态注](2026-10-13-workbench-state-persistence.zh.md) 的创作台状态持久化会像手输一样提交它。覆盖规格：`novelai-controller/tests/artist-chains.host.spec.ts`（标签串原样存储、按 id 新建与原位更新、最新在前、重启语义、容忍、拒绝、冷存储路径、退化）与 `tests/novelai-controller.host.spec.ts`（经宿主 harness 的三个动词）；`ui-novelai-workbench/tests/workbench-panel.client.spec.tsx` 覆盖展开/懒加载、插入空与非空提示词、保存/删除、禁用表单守卫与失败分支。暂缓：从面板原位编辑已存串的名称/标签串（今天表单只新建；更新存在于动词层）、拖拽排序、以及基于 tag 索引的画师名联想。