# SmallPhone Memo

Standalone SmallPhone Memo app for concise notes. It is source-first and dependency-free: native Node HTTP server, plain HTML/CSS/JS UI, SQLite storage through Node's built-in `node:sqlite`, and a CLI that uses the same storage/domain code as the API.

## Requirements

- Node.js 22 or newer
- pnpm by default

## Scripts

```bash
pnpm start
pnpm dev
pnpm cli -- list
pnpm test
pnpm check
```

The server listens on `http://127.0.0.1:23001` by default. Override with `PORT`:

```bash
PORT=4201 pnpm start
```

Runtime data defaults to `data/diary.sqlite`. Override with `DIARY_DB_FILE`:

```bash
DIARY_DB_FILE=/tmp/smallphone-diary.sqlite pnpm start
```

## API

```bash
curl http://127.0.0.1:23001/health
curl http://127.0.0.1:23001/manifest
curl http://127.0.0.1:23001/api/entries
curl -X POST http://127.0.0.1:23001/api/entries \
  -H 'content-type: application/json' \
  -d '{"title":"明天事项","text":"10:00 交项目状态，路上买咖啡豆。"}'
curl -X PATCH http://127.0.0.1:23001/api/entries/<id> \
  -H 'content-type: application/json' \
  -d '{"title":"更新后的标题","text":"更新后的正文"}'
curl -X DELETE http://127.0.0.1:23001/api/entries/<id>
```

## CLI

```bash
pnpm cli -- list
pnpm cli -- add --title "明天事项" --text "10:00 交项目状态，路上买咖啡豆。"
pnpm cli -- update <id> --title "新的标题"
pnpm cli -- delete <id>
pnpm cli -- list --json
```

Use `--db-file <path>` on any CLI command to point at a specific SQLite database. `--data-file <path>` remains accepted as a legacy alias. Existing `data/diary.json` files may remain in place as legacy data, but runtime storage is `data/diary.sqlite` unless overridden. The CLI, API, and web UI all operate on the same entry shape:

```json
{
  "id": "entry-id",
  "title": "Memo title",
  "text": "Memo text",
  "createdAt": "2026-05-04T09:00:00.000Z",
  "updatedAt": "2026-05-04T09:00:00.000Z"
}
```

## Files

- `smallphone.app.json`: standalone app manifest
- `src/domain.js`: memo workflow rules and validation
- `src/storage.js`: SQLite store with schema creation and seed-on-empty
- `src/service.js`: storage-backed memo service
- `src/http-app.js`: native HTTP routing and static UI serving
- `src/cli.js`: command-line interface
- `public/`: plain browser UI
- `test/`: node:test coverage
