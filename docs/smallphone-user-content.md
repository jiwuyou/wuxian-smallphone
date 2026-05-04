# SmallPhone 用户内容持久化约定

日期：2026-05-04

SmallPhone 的系统代码位于 `smallphone-active/`，可以频繁更新。用户自己的 app、app 分身、主题、桌面布局、自定义前端 shell 和附件数据应保存在 `SMALLPHONE_HOME`，默认是：

```text
/root/projects/smallphone/smallphone-home
```

可以启动前覆盖：

```bash
SMALLPHONE_HOME=/path/to/my-smallphone-home ./start_smallphone.sh
```

## 目录边界

```text
smallphone-active/           # 系统代码和官方前端壳，可更新
smallphone-home/             # 用户持久化内容，更新时不覆盖
  runtime.json               # 联系人、线程、用户 app registry、shell/theme/layout 配置
  attachments/               # 附件
  channel-workspaces/        # 联系人/线程工作区
  admin-workspaces/          # 管理员角色工作区
  system-workspace/          # SmallPhone 系统级记忆工作区
  shells/<shell-id>/         # 用户自定义桌面前端
  apps/<app-id>/             # 用户安装 app 的本地代码、数据、SQLite、上传目录等
  themes/                    # 用户主题资源
  desktop-layouts/           # 可选布局资源
```

## 官方壳与用户壳

官方前端壳仍然是默认入口，负责桌面、App 容器和恢复能力。它属于 `smallphone-active/` 的系统代码，可以随仓库更新；用户不要把需要长期保存的桌面改动直接写进官方壳目录。

用户也可以在 `SMALLPHONE_HOME/shells/<id>/` 放自己的前端桌面，并通过后端用户内容 API 注册。选择用户 shell 只改变桌面壳来源，不要求复制或覆盖官方前端文件。

访问用户 shell 时使用：

```text
/shells/<shell-id>/
```

后端只允许读取 `SMALLPHONE_HOME/shells/<shell-id>/` 内的文件，并拒绝路径穿越。自定义 shell 的公开 registry 会过滤 `token`、`apiKey`、`secret`、`password`、`authorization`、`credentials` 等敏感字段。

## 更新流程

更新系统代码时只更新 `smallphone-active/`：

```bash
cd /root/projects/smallphone/smallphone-active
git pull
./start_smallphone.sh
```

启动脚本会创建 `SMALLPHONE_HOME` 的必要子目录，并把路径传给 `smallphone-app`。如果旧数据仍在 `smallphone-app/data/runtime.json`，后端会在首次启动时复制到新的 `SMALLPHONE_HOME/runtime.json`，不会删除旧文件。用户 app 的实例配置保存在 `runtime.json`，本地代码、SQLite、上传目录和其他运行数据应放在 `SMALLPHONE_HOME/apps/<app-id>/` 下；更新 `smallphone-active/` 不应覆盖这些文件。

## 设计原则

- 系统代码可以被替换，用户内容不能写死在系统源码里。
- 官方前端壳可以更新，但不应覆盖用户桌面布局和用户 shell。
- 用户 app 分身应通过实例配置隔离端口、SQLite、上传目录和启动参数。
- 浏览器可读取的 app registry 只能包含公开字段，密钥留在后端或用户本地配置中。
