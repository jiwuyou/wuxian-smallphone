# SmallPhone 双前端运行说明

日期：2026-05-04

当前目标是：保留原来的 stable 锁屏手机界面，同时提供 beta 前端。两套前端共用同一个 SmallPhone API 和同一个 cc-connect webclient app。
SmallPhoneAI 当前默认打开 beta 前端 `22082`；stable 前端 `22080` 只保留为兼容入口，不属于 SmallPhoneAI app-facing readiness 合约。

SmallPhoneAI 当前端口合约：

| Surface | URL |
| --- | --- |
| SmallPhone frontend | `http://127.0.0.1:22082/` |
| SmallPhone API | `http://127.0.0.1:22000/` |
| cc-connect webclient | `http://127.0.0.1:21040/` |
| service-manager | `http://127.0.0.1:20087/` |

## 当前拓扑

```text
cc-connect webclient :21040 /apps/smallphone/...
        ^
        |
smallphone-app API :22000
        ^
        |
  beta frontend   :22082  (SmallPhoneAI 默认入口)

service-manager :20087

legacy stable frontend :22080  (兼容入口，不参与 SmallPhoneAI readiness)
```

浏览器只访问 `smallphone-app API`。不要让浏览器直接连接 cc-connect bridge/webclient，也不要把 bridge token、webclient token、management token 写进前端代码、URL、localStorage 或静态文件。

## 访问地址

- SmallPhoneAI 前端：`http://100.120.221.72:22082/`
- SmallPhoneAI 本地前端：`http://127.0.0.1:22082/`
- 共用 API：`http://100.120.221.72:22000/api`
- 本地 API：`http://127.0.0.1:22000/api`
- opencode backend：`http://100.120.221.72:22096/`
- cc-connect webclient：`http://127.0.0.1:21040/apps/smallphone/...`
- cc-connect bridge：`ws://127.0.0.1:21010/bridge/ws`
- service-manager：`http://127.0.0.1:20087/`
- stable 兼容前端：`http://100.120.221.72:22080/`
- stable 本地兼容前端：`http://127.0.0.1:22080/`

注意：`18081` 当前被 `/root/basepro/fileTransfer` 的文件传输服务占用，不要拿它作为 beta 前端端口。

## 目录约定

- 启动脚本：`/root/projects/smallphone/smallphone-active/start_smallphone.sh`
- 兼容入口：`/root/projects/smallphone/start_smallphone.sh`
- 用户持久化目录：`/root/projects/smallphone/smallphone-home`，默认位于 `smallphone-active/` 外部，可用 `SMALLPHONE_HOME` 覆盖
- stable 前端：`/root/projects/smallphone/smallphone-active/generic-mini-phone`
- beta 前端：`/root/projects/smallphone/smallphone-active/generic-mini-phone-beta`
- SmallPhone API 后端：`/root/projects/smallphone/smallphone-active/smallphone-app`
- cc-connect 项目工作区：`/root/projects/smallphone`
- cc-connect 配置：`/root/.cc-connect/config.toml`

## 运行方式

在本仓库目录启动四个进程：

```bash
cd /root/projects/smallphone/smallphone-active
setsid -f ./start_smallphone.sh </dev/null >/tmp/smallphone-start.log 2>&1
```

脚本会启动 SmallPhone API、默认 beta 前端以及兼容 stable 前端：

- `smallphone-app` API，监听 `100.120.221.72:22000`
- `smallphone-app` API 本地监听 `127.0.0.1:22000`
- opencode backend，监听 `100.120.221.72:22096`
- stable 静态前端，监听 `100.120.221.72:22080`
- stable 静态前端本地监听 `127.0.0.1:22080`
- beta 静态前端，监听 `100.120.221.72:22082`
- beta 静态前端本地监听 `127.0.0.1:22082`

脚本会创建 `SMALLPHONE_HOME` 的必要子目录，并把该路径传给 `smallphone-app`。官方 stable/beta 前端属于 `smallphone-active/` 系统代码；`runtime.json`、附件、用户 app registry、app 分身、用户 app 本地数据、主题、桌面布局和用户自定义 shell 都应保存在 `SMALLPHONE_HOME`，避免更新 `smallphone-active` 时丢失用户内容。更多约定见 [SmallPhone 用户内容持久化约定](./smallphone-user-content.md)。

脚本不会使用 `0.0.0.0`。本地端口通过显式绑定 `127.0.0.1` 的额外监听进程提供。

停止时优先杀父进程 `bash ./start_smallphone.sh`，让脚本的 cleanup 清理子进程。

## 健康检查和 service-manager

`smallphone-app` 提供稳定健康检查：

- `GET /health`
- `GET /api/health`

两者返回公开安全的 JSON，不包含 service-manager token、cc-connect token、runtime 命令或 entry 路径。`scripts/register-service.sh` 会把 `smallphone-core` 注册为 HTTP `/health` 检查，并为 diary、album、like-girl 等独立 App 注册各自的 `/health`。

service-manager 默认地址是 `http://127.0.0.1:20087/`。浏览器和前端只通过 `smallphone-app` 后端控制 service-manager，不直接持有 service-manager token：

- `GET /api/service-manager/health`
- `GET /api/service-manager/services`
- `GET /api/service-manager/services/:id/status`
- `GET /api/service-manager/services/:id/logs?limit=200`
- `POST /api/service-manager/services/:id/start`
- `POST /api/service-manager/services/:id/stop`
- `POST /api/service-manager/services/:id/restart`

`start_smallphone.sh` 和 `scripts/register-service.sh` 会把 `SMALLPHONE_SERVICE_MANAGER_URL` 注入 `smallphone-app` 后端进程，并在可用时注入 `SMALLPHONE_SERVICE_MANAGER_TOKEN`；token 来源依次是 `SMALLPHONE_SERVICE_MANAGER_TOKEN`、`SERVICE_MANAGER_TOKEN`、`service-manager token show`。不要把 token 写进前端代码、URL、localStorage 或静态文件。

## cc-connect 接入方式

`start_smallphone.sh` 默认让 `smallphone-app` 使用：

```text
SMALLPHONE_RUNTIME_MODE=cc-webclient
SMALLPHONE_WEBCLIENT_BASE_URL=http://127.0.0.1:21040
SMALLPHONE_WEBCLIENT_APP_ID=smallphone
SMALLPHONE_CCCONNECT_PROJECT=smallphone-3e9fc251
SMALLPHONE_CLIENT_ID=smallphone
SMALLPHONE_APP_ID=chat
```

webclient URL、token、项目名会从 `/root/.cc-connect/config.toml` 读取。文档里不要记录真实 token。management URL 和 token 同样从 `/root/.cc-connect/config.toml` 读取，并只注入 `smallphone-app` 后端进程。

锁屏前端的消息链路是：

```text
浏览器前端 -> http://100.120.221.72:22000/api -> smallphone-app -> cc-connect webclient -> smallphone project agent
```

## 验证命令

检查 SmallPhoneAI 当前端口合约：

```bash
ss -ltnp | rg '100\.120\.221\.72:22082|100\.120\.221\.72:22000|127\.0\.0\.1:22082|127\.0\.0\.1:22000|:21040|:20087'
```

检查兼容和内部监听：

```bash
ss -ltnp | rg '100\.120\.221\.72:22080|100\.120\.221\.72:22082|100\.120\.221\.72:22000|127\.0\.0\.1:22080|127\.0\.0\.1:22082|127\.0\.0\.1:22000|100\.120\.221\.72:22096|:21010|:21040|:20087'
```

检查 runtime：

```bash
curl -sS http://100.120.221.72:22000/health
curl -sS http://100.120.221.72:22000/api/bootstrap \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["runtime"])'
```

期望看到 `runtime.id` 是 `cc-webclient`，项目是 `smallphone-3e9fc251`，webclient app 是 `smallphone`。

检查默认前端，必要时检查兼容 stable：

```bash
curl -sS http://100.120.221.72:22082/ | rg '<title>|scripts/main.js'
curl -sS http://100.120.221.72:22080/ | rg '<title>|scripts/main.js'
```

## 开发规则

- 日常功能开发只改 beta：`generic-mini-phone-beta`。
- beta 验证通过并实际使用一段时间后，再执行 promote 同步到 stable：`generic-mini-phone`。
- promote 是发布动作，不是两个前端分别手工改同一功能；AI 或开发者不应一个文件一个文件分别改 beta/stable。
- stable 是发布通道，原则上不手写新功能改动。若 stable 必须紧急修复，修复后必须回灌 beta，避免长期分叉。
- promote 后要再跑 stable 最小检查，并在一次提交中包含 beta + stable 的同步结果。
- 两套前端默认共用同一个 `22000/api`，所以联系人、线程、消息和记忆是一致的。
- 如果要改消息协议或数据结构，先检查 `smallphone-app` 的 API 兼容性。
- 不要把 cc-connect bridge/webclient token 暴露给浏览器。

## Beta -> Stable Promote 规则

长期上 stable/beta 是同一条前端主线，不是两个长期分叉。默认流程：

1. 只改 beta。
2. beta 验证通过，并使用一段时间。
3. 执行 promote 脚本从 beta 同步到 stable。
4. 跑 stable 最小检查。
5. 一次提交包含 beta + stable。

promote 脚本尚未落地前，人工同步也必须按这个规则执行：先确认 beta 是来源，再批量同步到 stable，不要让 AI 对两个目录分别做独立实现。

建议的未来命令：

```bash
npm run frontend:promote -- --dry-run
npm run frontend:promote
npm run frontend:promote -- --commit
```

promote 应使用白名单同步：

- `index.html`
- `style.css`
- `scripts/`
- `apps/`
- 必要的 assets

promote 应默认排除：

- `docs/`
- 用户数据
- 临时文件
- 构建产物
- `.git`
- 任何 runtime token、API key、secret

promote 后最小检查：

```bash
node --check generic-mini-phone-beta/scripts/main.js
node --check generic-mini-phone/scripts/main.js
git diff --check
git -C generic-mini-phone diff --check
```
