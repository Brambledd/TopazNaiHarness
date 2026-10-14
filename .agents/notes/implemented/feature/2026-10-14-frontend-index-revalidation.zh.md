# 创作台 bundle 新鲜度：index 强制重验证与可见的启动 rev

状态：已实现

[English](2026-10-14-frontend-index-revalidation.md) | 中文

- 日期：2026-10-14
- 包：`host/frontend-static`、`client/modules`
- 状态：已实现

## 背景

角色持久化修复抵达服务端（磁盘 `lib/client.js` 已重建、host 已重启）时，操作者的浏览器仍在跑过期 bundle：重启后写入的存档依然没有 `characters` 字段——只有旧 bundle 的提交逻辑才会产出这种形态。插件 bundle 路由以 `cache-control: immutable` 加携带 rev 的 URL 下发 combo 响应——本身正确——但嵌入这些 URL 的 index HTML 在下发时没有任何缓存元数据和验证器，浏览器刷新时的行为因此未指明，一份过期的缓存 index 会把整个会话钉死在过期的 bundle URL 上。

## 决策

两处改动，一结构性一诊断性：

- `host/frontend-static` 为每份 index 响应（根路径与配置的 index 路径，GET 与 HEAD）附加 `cache-control: no-cache`。带哈希的 dist 资源维持名称驱动的缓存；未哈希的插件 bundle 维持 `immutable`，因为它们的新鲜度骑在 rev 查询参数上，而 index 现在永远新鲜。
- `client/modules` 在注入的启动 facade 末尾追加一行 `console.log("[dsh] bundles:", …)`，打印每个批次携带 rev 的 URL。操作者对比两次连续刷新即可立刻看出页面是否拿到了新 bundle，无需打开开发者工具查网络。

## 后果

- 普通刷新不再可能下发过期的启动图；「已部署但浏览器不一致」的诊断从 console 行开始，而不是缓存考古。
- facade 测试沙箱补了 console 桩（日志行在启动时执行）。
- `frontend-static` 的 spec 断言 index 响应带 `no-cache`、资源与错误响应头缺失（`null`），契约显式化。
