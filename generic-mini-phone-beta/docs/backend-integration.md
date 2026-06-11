# 小手机后端接入说明

## 当前形态

小手机前端现在支持两种运行方式：

- 后端模式：优先连接 `opencode` 上新增的 `/smallphone` API
- 回退模式：后端不可用时继续使用原有纯前端本地逻辑

## 后端入口

后端挂在：

- `opencode/packages/opencode/src/server/routes/smallphone.ts`

注册位置：

- `opencode/packages/opencode/src/server/server.ts`

本地状态文件：

- 默认随 `XDG_DATA_HOME` 走；当前落在 `/tmp/opencode-data/opencode/smallphone/state.json`

## 已实现 API

- `GET /smallphone/bootstrap`
- `PUT /smallphone/state`
- `POST /smallphone/import`
- `GET /smallphone/threads/:threadID/prompt-preview`
- `POST /smallphone/threads/:threadID/messages`

## 前端接线

前端主逻辑在：

- `generic-mini-phone/scripts/main.js`

当前行为：

- 启动时请求 `/smallphone/bootstrap`
- 角色卡、记忆、世界书、设置、动态、论坛、手账改动后回写 `/smallphone/state`
- 导入走 `/smallphone/import`
- 发消息和继续生成走 `/smallphone/threads/:threadID/messages`
- 提示词预览优先走后端 preview

## 本地启动

仓库根目录提供了一个辅助脚本：

- `/root/projects/smallphone/start_smallphone.sh`

作用：

- 启动 `opencode` headless server
- 启动小手机静态前端

默认地址：

- 前端：`http://<tailscale-or-local-ip>:22080`
- 后端：`http://<tailscale-or-local-ip>:22096`

运行前提：

- 系统已安装 `bun`
- 系统有 `python3`
- `opencode` 依赖已安装，推荐：
  `BUN_CONFIG_REGISTRY=https://registry.npmmirror.com bun install --ignore-scripts`

## 注意事项

- 如果前端是通过 `file://` 直接打开，后端已经允许 `Origin: null` 的 CORS 开发场景
- 如果通过 `http://<tailscale-or-local-ip>:22080` 打开前端，前端会优先探测：
  `?backend=...` 指定地址、已记住的后端地址、同机 `:22096` 后端
- 后端已允许 `localhost`、`127.0.0.1`、RFC1918 局域网网段和 `100.x.x.x` Tailscale 来源跨端口访问
- 当前版本仍未接通 tool / MCP / subagent，只完成了内容后端与真实聊天闭环
