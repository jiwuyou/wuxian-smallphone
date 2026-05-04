# Codex Handoff: SmallPhone 用户 App / 自定义前端平台

日期：2026-05-04

## 当前仓库状态

本机路径：

```text
/root/projects/smallphone/smallphone-active
```

当前相关 Git 仓库均已 clean：

```text
smallphone-active                         e01dda7 feat: add user app platform and persistence
generic-mini-phone                        74afcda feat: align stable shell with beta
smallphone-user-shell-template            7326200 feat: align template with official shell
standalone-apps/like-girl/source          7efff9a update leaving.php. 修复QQ信息获取接口
```

根仓库 `.gitignore` 已忽略独立仓库：

```text
generic-mini-phone/
smallphone-user-shell-template/
standalone-apps/like-girl/source/
```

## 架构分层

SmallPhone 现在按这几层理解：

```text
smallphone-active/              # 系统代码，主要仓库 wuxian-smallphone
  smallphone-app/               # SmallPhone Core 后端
  generic-mini-phone-beta/      # 官方 beta 前端壳
  standalone-apps/              # 已做的独立 app 示例/源码

generic-mini-phone/             # 官方 stable 前端壳，独立 Git 仓库，已对齐 beta

smallphone-user-shell-template/ # 用户自定义前端桌面模板，独立 Git 仓库

smallphone-home/                # 用户持久化目录，位于 smallphone-active 外部
```

默认用户目录：

```text
/root/projects/smallphone/smallphone-home
```

可覆盖：

```bash
SMALLPHONE_HOME=/path/to/smallphone-home ./start_smallphone.sh
```

用户内容应放在 `SMALLPHONE_HOME`，避免更新 `smallphone-active` 时丢失：

```text
runtime.json
attachments/
channel-workspaces/
admin-workspaces/
system-workspace/
shells/
apps/
themes/
desktop-layouts/
```

## 已实现能力

`smallphone-app` 后端已支持：

- `SMALLPHONE_HOME` 路径解析，默认在 `smallphone-active` 外部。
- `runtime.json`、附件、workspace、shell/app/theme/layout/instance 用户内容从 `SMALLPHONE_HOME` 解析。
- 从旧 `smallphone-app/data/runtime.json` 首次迁移，不删除旧文件。
- 用户内容 schema：
  - `apps`
  - `appInstances`
  - `themes`
  - `desktopLayouts`
  - `shells`
  - `activeShell`
- API：
  - `GET /api/user-content`
  - `PUT /api/user-content`
  - `GET /api/app-registry`
- 用户 shell 静态服务：
  - `/shells/<shell-id>/...`
  - 支持 `shell.entry`
  - 拒绝路径穿越
- registry/user-content 会过滤敏感字段：
  - `token`
  - `apiKey`
  - `secret`
  - `password`
  - `authorization`
  - `credentials`
- legacy attachment 迁移后仍可读。

`start_smallphone.sh` 已：

- 默认设置 `SMALLPHONE_HOME="$ROOT_DIR/smallphone-home"`。
- 启动前创建必要子目录。
- 把 `SMALLPHONE_HOME` 传给 `smallphone-app`。

## 官方前端与模板仓库

官方前端：

```text
generic-mini-phone/       # stable
generic-mini-phone-beta/  # beta
```

stable 已文件级对齐 beta。当前体验主要以这套官方前端壳为准。

用户 shell 模板仓库：

```text
smallphone-user-shell-template/
```

它已对齐当前官方前端壳，包含：

```text
index.html
style.css
scripts/
apps/
smallphone.shell.json
scripts/install.mjs
scripts/serve.mjs
docs/user-shell-customization.md
docs/user-shell-deployment.md
```

使用方式：

```bash
cd smallphone-user-shell-template
SMALLPHONE_HOME=/path/to/smallphone-home \
SMALLPHONE_API=http://127.0.0.1:3100 \
SHELL_ID=my-desktop \
SHELL_NAME="我的桌面" \
npm run install:shell
```

访问：

```text
http://127.0.0.1:3100/shells/my-desktop/
```

## 已有 Standalone Apps

根仓库已加入：

```text
standalone-apps/diary
standalone-apps/album
standalone-apps/like-girl
standalone-apps/vocabulary
```

LikeGirl 当前是 Node.js + SQLite 原生实现，不依赖 PHP/MySQL 运行时。上游 PHP 源码在：

```text
standalone-apps/like-girl/source
```

这是独立 Git 仓库，仅作参考，不要直接编辑。

LikeGirl 分身模型：

```bash
cd standalone-apps/like-girl
pnpm run start:clone
```

分身默认：

```text
http://127.0.0.1:4108/
data/instances/like-girl-clone/like-girl.sqlite
data/instances/like-girl-clone/uploads/photos/
```

## 已验证内容

已跑过：

```bash
bash -n start_smallphone.sh
cd smallphone-app && npm run check
cd smallphone-app && npm test
git diff --check
```

`smallphone-app` 测试：`19/19` pass。

还做过真实 HTTP 端到端烟测：

- 临时启动 `smallphone-app`
- 使用临时 `SMALLPHONE_HOME`
- `GET /api/user-content`
- `PUT /api/user-content`
- `GET /api/app-registry`
- `/shells/custom-shell/`
- 路径穿越 `/shells/custom-shell/../runtime.json` 返回 `403`
- 确认 `runtime.json` 落盘

## 重要约束

- 不要把用户数据写进 `smallphone-active`。
- 不要回退用户已有改动，除非用户明确要求。
- 官方前端视觉如无明确要求，不要随意改。
- 不要把 token、API key、secret 写进前端或 app registry。
- 用户 shell 是前端代码，必须只处理公开数据。

## 下一步建议任务

用户关心：新增 app 能不能不重启 SmallPhone。

后端基础已经有了，但官方前端还没有完全动态化。下一步建议做：

1. 官方前端启动时读取：

```text
GET /api/app-registry
```

2. 将 `appInstances` 渲染成桌面图标。

3. 点击动态 app 图标时，用统一 iframe 打开：

```text
instance.settings.url
instance.entry
app.entry
```

4. App 管理里增加“刷新应用列表”。

5. 支持不刷新页面的 registry reload。

6. 可选后续：后端 app process manager。

当前结论：

- 如果是已启动的外部服务或静态 shell，后端 registry 可以不重启更新。
- 若想官方桌面即时出现新 app，还需要把官方前端接入动态 app registry。

