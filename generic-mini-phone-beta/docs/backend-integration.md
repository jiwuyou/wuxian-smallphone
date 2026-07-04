# 小手机后端接入说明

## 当前形态

beta 手机前端只接入 smallphone-core 暴露的 HTTP/SSE API。浏览器不直接连接 cc-connect 的 bridge、management 或 webclient 端口，也不保存或发送 cc-connect token。

数据链路：

```text
generic-mini-phone-beta
  -> smallphone-core / smallphone-app :22000 /api
  -> cc-webclient backend :21030
  -> cc-connect bridge/runtime
  -> smallphone-pi 或 smallphone-codex
```

## 后端入口

默认后端：

- `http://127.0.0.1:22000/api`

同机或 Tailscale 页面打开时，前端会探测：

- `?backend=...` 指定的 smallphone-core 地址
- `localStorage.smallphone.backendBase` 中已记住的 smallphone-core 地址
- 当前页面主机的 `:22000/api`
- `127.0.0.1:22000/api` 和 `localhost:22000/api`

`?backend=` 和 localStorage 会被规范到 `/api`，并去掉 URL userinfo、query、hash。cc-connect 常用端口 `21010`、`21020`、`21030`、`21040` 会被拒绝，避免浏览器误连 bridge、management、webclient 或 webhook。

## 已使用 API

- `GET /api/bootstrap`
- `GET /api/reminders`
- `GET /api/threads/:threadID/messages`
- `POST /api/threads/:threadID/messages`
- `GET /api/threads/:threadID/events`
- `GET /api/threads/:threadID/permissions`
- `POST /api/threads/:threadID/permissions`
- `GET /api/threads/:threadID/runtime-project-settings`
- `PATCH /api/threads/:threadID/runtime-project-settings`
- `POST /api/attachments`
- `POST /api/avatars`
- `GET /api/app-registry`
- `GET /api/service-manager/*`

页面刷新或手机浏览器切后台后，前端重新执行 bootstrap，并通过 `/api/threads/:threadID/messages` 恢复当前线程历史。实时回复用 `/api/threads/:threadID/events` 的 EventSource；SSE 中断时，最终消息仍以刷新后的后端历史为准。

## 前端接线

主聊天逻辑：

- `scripts/main.js`

Prompt Board / app 内后端调用：

- `apps/workflows/api.js`
- `apps/workflows/index.js`
- `apps/sillytavern/index.js`

前端可以把 smallphone-core 地址记在 `smallphone.backendBase`，但不能在浏览器侧持有 cc-connect token。cc-webclient token 应只存在于 smallphone-core 或服务端进程环境中。

## 本地启动

仓库根目录提供辅助脚本：

- `/root/projects/smallphone/start_smallphone.sh`

默认地址：

- 前端：`http://<tailscale-or-local-ip>:22080`
- 后端：`http://<tailscale-or-local-ip>:22000/api`

## 验证重点

- 浏览器 Network 中聊天请求只访问 smallphone-core `/api`
- localStorage 不包含 cc-connect token
- 页面刷新后能重新加载联系人、线程和当前线程消息
- EventSource 断开不影响最终历史恢复
