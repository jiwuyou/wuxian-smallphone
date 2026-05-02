# SmallPhone 接入 cc-connect webclient 交接文档

日期：2026-05-02

这份文档给接替 SmallPhone 接入工作的 agent 或开发者使用。它基于：

- `/root/cc-connect-fresh/docs/webclient-app-integration.zh-CN.md`
- `/root/projects/smallphone/smallphone-active/docs/smallphone-dual-frontend.md`
- 当前 `smallphone-app` 后端与 stable/beta 前端代码

## 当前结论

SmallPhone 应从“`smallphone-app` 直连 cc-connect Bridge WebSocket”迁到“`smallphone-app` 调 cc-connect webclient app namespace”。

目标链路：

```text
stable frontend :18080
beta frontend   :18082
        |
        v
smallphone-app API :3100
        |
        v
cc-connect webclient backend :9840 /apps/smallphone/...
        |
        v
Bridge
        |
        v
Project Agent
```

关键原则：

- 浏览器只访问 `smallphone-app :3100`。
- 浏览器不要直接连接 Bridge。
- 浏览器不要直接访问带 token 的 webclient backend。
- 不要把 Bridge token、webclient token、management token 写进前端代码、URL、localStorage 或静态文件。
- `smallphone-app` 继续作为 BFF/API 层，保留现有前端 API 形状。

## 当前项目状态

当前目录：

- stable 前端：`/root/projects/smallphone/smallphone-active/generic-mini-phone`
- beta 前端：`/root/projects/smallphone/smallphone-active/generic-mini-phone-beta`
- SmallPhone 后端：`/root/projects/smallphone/smallphone-active/smallphone-app`
- 启动脚本：`/root/projects/smallphone/smallphone-active/start_smallphone.sh`
- 兼容入口：`/root/projects/smallphone/start_smallphone.sh`
- 双前端说明：`/root/projects/smallphone/smallphone-active/docs/smallphone-dual-frontend.md`

当前约定端口：

- stable frontend：`100.120.221.72:18080`
- beta frontend：`100.120.221.72:18082`
- SmallPhone API：`100.120.221.72:3100`
- opencode backend：`100.120.221.72:18096`
- cc-connect Bridge：`127.0.0.1:9810`
- cc-connect management：`9820`
- cc-connect webclient backend 规划端口：`9840`

注意：`18081` 已被文件传输服务占用，不要用于 beta。

`smallphone-app` 当前后端入口：

- `apps/core/server.js`
- `packages/domain/service.js`
- `packages/openclaw-adapter/index.js`
- 数据文件：`data/runtime.json`

当前前端已对接 `smallphone-app` 的 API，包括：

- `GET /api/bootstrap`
- `GET /api/threads`
- `GET /api/threads/:id/messages`
- `POST /api/threads/:id/messages`
- `GET /api/threads/:id/events`
- `GET/POST /api/threads/:id/permissions`

beta 前端已经使用 `EventSource` 订阅 `smallphone-app` 的 thread events。stable/beta 仍保留纯前端和 OpenAI 兼容接口回退逻辑。

## cc-connect webclient app 配置

在 `/root/.cc-connect/config.toml` 中增加 SmallPhone webclient app。不要在文档中记录真实 token。

推荐配置形状：

```toml
[webclient]
enabled = true
host = "127.0.0.1"
port = 9840
token = "replace-with-a-secret-token"
default_app = "smallphone"

[[webclient.apps]]
id = "smallphone"
platform = "web-smallphone"
data_namespace = "smallphone"
```

字段含义：

- `id = "smallphone"`：HTTP 路由命名空间，使用 `/apps/smallphone/...`。
- `platform = "web-smallphone"`：Bridge adapter 平台身份。
- `data_namespace = "smallphone"`：webclient 持久化目录命名空间。

建议 `platform` 使用 `web-smallphone`，不要复用旧 direct Bridge adapter 的 `smallphone`，避免同一个 Bridge 中平台身份冲突。

`data_namespace` 上线后不要随意修改。修改它等同于切换到另一套聊天数据。

## 热重载边界

`cc-connect-fresh` 的 webclient apps 支持热重载。如果 `[webclient]` 已启用，且 `host`、`port`、`data_dir` 不变，新增 SmallPhone app 后触发 reload 即可，不需要重启整个 cc-connect 服务。

支持热重载：

- 新增 `[[webclient.apps]]`
- 删除 app
- `enabled = false`
- 切换 `default_app`
- 修改 app 的 `platform`

需要重启：

- `[webclient].host`
- `[webclient].port`
- `[webclient].data_dir`
- app 的 `data_namespace`
- legacy 单 app 与 multi-app 模式互相切换
- 整个 `[webclient].enabled` 从 false 到 true，或从 true 到 false

所以执行时先判断当前 webclient 是否已经启用：

- 已启用：改配置，reload，验证路由。
- 未启用：改配置后重启 cc-connect，再验证路由。

## SmallPhone 后端改造规划

保留前端 API，不让 stable/beta 直接感知 webclient。

新增 runtime mode：

```text
SMALLPHONE_RUNTIME_MODE=cc-webclient
SMALLPHONE_WEBCLIENT_BASE_URL=http://127.0.0.1:9840
SMALLPHONE_WEBCLIENT_TOKEN=...
SMALLPHONE_WEBCLIENT_APP_ID=smallphone
SMALLPHONE_CCCONNECT_PROJECT=smallphone-3e9fc251
```

实现位置建议：

- 在 `smallphone-app/packages/openclaw-adapter/index.js` 新增 `createCcWebclientAdapter(config)`。
- 在 `createRuntimeAdapter()` 中识别 `cc-webclient`。
- 在 `smallphone-app/apps/core/server.js` 读取并传入新增 env。
- 在 `/root/projects/smallphone/smallphone-active/start_smallphone.sh` 从 `/root/.cc-connect/config.toml` 读取 webclient `port` 与 `token`，注入 `smallphone-app` 后端进程。

发送消息使用 webclient v1 send API：

```http
POST /apps/smallphone/api/v1/projects/{project}/send
Authorization: Bearer {webclient.token}
Content-Type: application/json

{
  "session_key": "smallphone:thread:thread-aki",
  "session_id": "thread-aki",
  "message": "用户消息"
}
```

读取消息：

```http
GET /apps/smallphone/api/v1/projects/{project}/sessions/{session_id}
Authorization: Bearer {webclient.token}
```

订阅事件：

```http
GET /apps/smallphone/api/projects/{project}/sessions/{session_id}/events
Authorization: Bearer {webclient.token}
```

## session 映射

当前 `smallphone-app` 已有 thread runtime routing：

- `thread.id`
- `thread.runtime.sessionKey`
- `thread.runtime.sessionGeneration`
- `rotateThreadSession()`

建议映射：

- `session_key`：继续使用 `thread.runtime.sessionKey`，例如 `smallphone:thread:thread-aki`。
- `session_id`：使用安全路径片段，不使用冒号，例如 `thread-aki`。
- 续代后 `session_key` 可为 `smallphone:thread:thread-aki:v2`。
- 续代后 `session_id` 可为 `thread-aki-v2`。

不要把含冒号的 `session_key` 直接当成 `session_id`，webclient 文档要求 `session_id` 满足安全路径片段要求。

## 推荐实施顺序

1. 检查 `/root/.cc-connect/config.toml` 当前是否已经启用 `[webclient]`。
2. 增加 `[[webclient.apps]] smallphone` 配置。
3. 如果 webclient 已启用，触发 cc-connect reload；如果未启用，则重启 cc-connect。
4. 验证 webclient app 路由：

```bash
curl -sS \
  -H "Authorization: Bearer $WEBCLIENT_TOKEN" \
  http://127.0.0.1:9840/apps/smallphone/api/v1/projects/smallphone-3e9fc251/sessions
```

5. 在 `smallphone-app` 实现 `cc-webclient` adapter。
6. 先实现文本消息 send，并通过读取 session 消息拿最终 assistant 回复。
7. 确认 stable/beta 的 `POST /api/threads/:id/messages` 不需要改。
8. 修改 `start_smallphone.sh`，默认使用 `SMALLPHONE_RUNTIME_MODE=cc-webclient`。
9. 启动 SmallPhone 并验证：

```bash
cd /root/projects/smallphone/smallphone-active
setsid -f ./start_smallphone.sh </dev/null >/tmp/smallphone-start.log 2>&1
```

10. 验证 SmallPhone runtime：

```bash
curl -sS http://100.120.221.72:3100/api/bootstrap \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["runtime"])'
```

11. 验证 stable/beta 前端：

```bash
curl -sS http://100.120.221.72:18080/ | rg '<title>|scripts/main.js'
curl -sS http://100.120.221.72:18082/ | rg '<title>|scripts/main.js'
```

12. 文本闭环稳定后，再实现 `smallphone-app` 服务端订阅 webclient SSE，并转发为当前前端已支持的：

- `assistant.stream`
- `assistant.done`
- `assistant.persisted`

## P1 与 P2 范围

P1：文本闭环

- `smallphone-app` 调 webclient v1 send。
- 等待或轮询 webclient session 最终消息。
- 将 assistant 回复落到 `smallphone-app/data/runtime.json`。
- 保留 `smallphone-app` 自己的 `/api/threads/:id/events`，即使第一版只推最终结果。
- 不接图片、文件、复杂 run events。

P2：流式与附件

- `smallphone-app` 服务端订阅 webclient SSE。
- 转换 webclient run/message events 为 SmallPhone 现有 SSE 事件。
- 接入 v1 send 的 `images` 字段。
- Agent 返回附件时使用 webclient 返回的 `url`。
- 如需隐藏 webclient 地址，可由 `smallphone-app` 增加附件代理路由。

## 权限策略

第一版不要迁移权限模型。

当前 SmallPhone 权限入口继续保留：

- `GET /api/permissions/templates`
- `GET /api/threads/:id/permissions`
- `POST /api/threads/:id/permissions`

浏览器只调用 `smallphone-app`。`smallphone-app` 继续携带 cc-connect management token 调 management API。不要让前端直接调用 management。

## 关键风险

- `platform` 与旧 adapter 冲突：使用 `web-smallphone`。
- `data_namespace` 误改：上线后不要改。
- `session_id` 不安全：不要用带冒号的 `session_key` 当 `session_id`。
- token 泄漏：不要让前端直接访问 webclient backend。
- 事件重复：P2 转发 SSE 时要去重，避免 webclient 最终消息和 SmallPhone 落库消息重复显示。
- 双数据源：P1 阶段 SmallPhone 仍会把消息落在 `runtime.json`，webclient 也会持久化一份消息。先接受双写，后续再决定是否让 webclient 成为唯一消息源。
- 禁用或删除 app：webclient 会断开该 app 的 SSE，但磁盘数据不会自动删除。前端应按普通断线处理。

## 验收标准

最小验收：

- `/apps/smallphone/...` 路由可访问。
- `smallphone-app /api/bootstrap` 显示 runtime 为 `cc-webclient`。
- stable 与 beta 都能读取同一组 contacts/threads/messages。
- 从 stable 或 beta 发送消息后，Project Agent 能收到，并返回 assistant 回复。
- 回复能写回 `smallphone-app/data/runtime.json`。
- 前端不包含 webclient token、Bridge token、management token。

增强验收：

- beta 的实时流式显示正常。
- session rotate 后新会话不污染旧会话。
- cc-connect reload 后 SmallPhone 无需改前端即可继续工作。
- webclient app 禁用后，SmallPhone 返回清晰错误，而不是静默成功。
