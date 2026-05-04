# LikeGirl SmallPhone 原生应用

这个应用保留 LikeGirl v5.2.0 的公开页面气质，但不再运行 PHP 或 MySQL。`source/` 中的上游代码仅作为页面和字段参考；当前可运行应用是 SmallPhone 原生应用，包含 Node HTTP 服务、普通 Web 界面、CLI 和 SQLite 存储。

## 常用命令

```bash
pnpm start
pnpm dev
pnpm check
pnpm test
```

适合 Agent/脚本调用的 CLI：

```bash
pnpm cli -- bootstrap
pnpm cli -- messages --json
pnpm cli -- add-message --name 晚风 --text "今晚也很好。"
```

## 配置

运行时变量：

- `PORT`：HTTP 端口，默认 `4103`
- `HOST`：HTTP 监听地址，默认 `127.0.0.1`
- `LIKE_GIRL_DB_FILE`：SQLite 文件路径，默认 `data/like-girl.sqlite`

示例：

```bash
LIKE_GIRL_DB_FILE=/tmp/like-girl.sqlite PORT=4103 \
pnpm start
```

## 迁移范围

原生应用会在首次启动时，把自己的 v1 JSON 状态文件（如果存在：`data/like-girl.json`）迁移到 v2 SQLite 存储。它不会导入上游 LikeGirl 的 MySQL dump，也不会运行 PHP；`source/` 只保留为参考材料。

## API

```bash
curl http://127.0.0.1:4103/health
curl http://127.0.0.1:4103/api/bootstrap
curl http://127.0.0.1:4103/api/photos
curl -X POST http://127.0.0.1:4103/api/messages \
  -H 'content-type: application/json' \
  -d '{"name":"晚风","text":"祝你今天也有被记住的小事。"}'
```

## 说明

- `source/` 不参与运行，也不会被当前应用直接对外服务。
- 公开页面参考 LikeGirl，但不是逐字节复制 PHP 版本。
- 上游 LikeGirl 项目使用 AGPL-3.0；拆成独立仓库时需要保留署名和许可证上下文。
