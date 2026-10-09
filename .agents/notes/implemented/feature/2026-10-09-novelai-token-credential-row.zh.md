# Agent Note: 经 credential 缝配置 NovelAI 令牌

Status: implemented

[English](2026-10-09-novelai-token-credential-row.md) | 中文

## 问题

`novelai_generate` 工具只用插件 config 的 `token` 或裸 `NOVELAI_TOKEN` 进程环境变量做鉴权。操作者的生图请求以 `HTTP 401 Unauthorized` 失败，而当时的补救只有改组合文件或换环境变量重启进程——没有运行时界面可以存入有效的持久令牌，无效令牌也只是裸 401，不指向该去哪里替换。

## 决策

令牌迁移到既有的 credential 引用缝上，用户写入路径变成一个设置行：

- **宿主解析**——`tool-novelai/src/token.ts` 拥有 `resolveToken(config, credentials)`：每次调用先读插件 config 的 `token`，再读 `ctx.credentials.resolve(credentialRef('NOVELAI_TOKEN'))`（provider 把存储层叠加在项目/用户 `.env` 文件与进程环境之上），未挂载 provider 时读裸环境变量。按调用解析意味着保存的令牌无需重启插件即对下一次生成生效。web profile 已挂载 `@deepseek-ai/dsh-credentials-local`，无需改组合。
- **客户端行**——`ui-novelai` 注册 Settings → General 的 **NovelAI API 令牌** 行（`settings.general.item`，特性自有的单偏好座位）。该行经 `remote.credentials.describe` 展示凭据的配置状态与来源层，经 `remote.credentials.set`/`unset` 保存与清除，并随推送的 `credentials/reference-updated` 事件与 `connection/reset` 刷新。状态存放在 apply 世界的快照 store（`token-settings.ts`）；组件保持纯展示，文案走双语词典。
- **可执行的失败信息**——缺令牌错误与映射后的 HTTP 401 错误都点名各可配置层：Settings → General 行、插件 config `token`、`NOVELAI_TOKEN` credential。

## 备选方案

**独立设置段（像 Models 那样的 `settings.section` 页）。** 否决：单个 credential 是单一设置，设置规范把整页留给成组的设置；`settings.general.item` 正是为此设计的座位。

**创作台侧的令牌输入框。** 否决：创作台是生成界面而非配置界面；第二个令牌入口会拆散事实的唯一存放点，credential 存储本就已汇聚所有读取方。

**只写配置文件文档（教用户改 cordis.yml）。** 否决其作为主路径：对每用户机密而言它要求服务端改动与组合重载；它仍作为显式覆盖层受支持。

## 后果

`tool-novelai` 新增 `@deepseek-ai/dsh-credentials` 为 peer+dev 依赖，并经 `ctx.get('credentials')` 读取可选服务，因此未挂载 provider 的组合仍可经 config 与环境工作。`ui-novelai` 新增 `remote`/`remote.credentials` 服务注入与 `@deepseek-ai/dsh-api-remotes`/`@deepseek-ai/dsh-client-ui-settings` 信息边。令牌值本身从不出现在任何读取路径上：该行只渲染 `CredentialInfo` 事实。覆盖 spec：`tool-novelai/tests/token.spec.ts`（解析顺序、缺失值处理、大声失败）与 `ui-novelai/tests/TokenRow.client.spec.tsx`（describe 驱动的状态、保存/清除写入、拒绝诊断、失效刷新）。环境已带有效 `NOVELAI_TOKEN` 的操作者不受影响；仅当用户经该行保存时，存储的 credential 层才遮蔽环境层。
