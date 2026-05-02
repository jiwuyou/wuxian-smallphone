# SmallPhone 双前端运行说明

日期：2026-05-02

当前目标是：保留原来的 stable 锁屏手机界面，同时提供 beta 前端。两套前端共用同一个 SmallPhone API 和同一个 cc-connect webclient app。

## 当前拓扑

```text
cc-connect webclient :9840 /apps/smallphone/...
        ^
        |
smallphone-app API :3100
        ^
        |
  stable frontend :18080
  beta frontend   :18082
```

浏览器只访问 `smallphone-app API`。不要让浏览器直接连接 cc-connect bridge/webclient，也不要把 bridge token、webclient token、management token 写进前端代码、URL、localStorage 或静态文件。

## 访问地址

- stable 前端：`http://100.120.221.72:18080/`
- beta 前端：`http://100.120.221.72:18082/`
- stable 本地前端：`http://127.0.0.1:18080/`
- beta 本地前端：`http://127.0.0.1:18082/`
- 共用 API：`http://100.120.221.72:3100/api`
- 本地 API：`http://127.0.0.1:3100/api`
- opencode backend：`http://100.120.221.72:18096/`
- cc-connect webclient：`http://127.0.0.1:9840/apps/smallphone/...`
- cc-connect bridge：`ws://127.0.0.1:9810/bridge/ws`

注意：`18081` 当前被 `/root/basepro/fileTransfer` 的文件传输服务占用，不要拿它作为 beta 前端端口。

## 目录约定

- 启动脚本：`/root/projects/smallphone/smallphone-active/start_smallphone.sh`
- 兼容入口：`/root/projects/smallphone/start_smallphone.sh`
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

脚本会启动：

- `smallphone-app` API，监听 `100.120.221.72:3100`
- `smallphone-app` API 本地监听 `127.0.0.1:3100`
- opencode backend，监听 `100.120.221.72:18096`
- stable 静态前端，监听 `100.120.221.72:18080`
- stable 静态前端本地监听 `127.0.0.1:18080`
- beta 静态前端，监听 `100.120.221.72:18082`
- beta 静态前端本地监听 `127.0.0.1:18082`

脚本不会使用 `0.0.0.0`。本地端口通过显式绑定 `127.0.0.1` 的额外监听进程提供。

停止时优先杀父进程 `bash ./start_smallphone.sh`，让脚本的 cleanup 清理子进程。

## cc-connect 接入方式

`start_smallphone.sh` 默认让 `smallphone-app` 使用：

```text
SMALLPHONE_RUNTIME_MODE=cc-webclient
SMALLPHONE_WEBCLIENT_BASE_URL=http://127.0.0.1:9840
SMALLPHONE_WEBCLIENT_APP_ID=smallphone
SMALLPHONE_CCCONNECT_PROJECT=smallphone-3e9fc251
SMALLPHONE_CLIENT_ID=smallphone
SMALLPHONE_APP_ID=chat
```

webclient URL、token、项目名会从 `/root/.cc-connect/config.toml` 读取。文档里不要记录真实 token。management URL 和 token 同样从 `/root/.cc-connect/config.toml` 读取，并只注入 `smallphone-app` 后端进程。

锁屏前端的消息链路是：

```text
浏览器前端 -> http://100.120.221.72:3100/api -> smallphone-app -> cc-connect webclient -> smallphone project agent
```

## 验证命令

检查监听：

```bash
ss -ltnp | rg '100\.120\.221\.72:18080|100\.120\.221\.72:18082|100\.120\.221\.72:3100|127\.0\.0\.1:18080|127\.0\.0\.1:18082|127\.0\.0\.1:3100|100\.120\.221\.72:18096|:9810|:9840'
```

检查 runtime：

```bash
curl -sS http://100.120.221.72:3100/api/bootstrap \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["runtime"])'
```

期望看到 `runtime.id` 是 `cc-webclient`，项目是 `smallphone-3e9fc251`，webclient app 是 `smallphone`。

检查两个前端：

```bash
curl -sS http://100.120.221.72:18080/ | rg '<title>|scripts/main.js'
curl -sS http://100.120.221.72:18082/ | rg '<title>|scripts/main.js'
```

## 开发规则

- 改 stable UI 时编辑 `generic-mini-phone`。
- 改 beta UI 时编辑 `generic-mini-phone-beta`。
- 两套前端默认共用同一个 `3100/api`，所以联系人、线程、消息和记忆是一致的。
- 如果只做 UI 实验，优先改 beta，不要动 stable。
- 如果要改消息协议或数据结构，先检查 `smallphone-app` 的 API 兼容性。
- 不要把 cc-connect bridge/webclient token 暴露给浏览器。
