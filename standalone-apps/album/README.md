# SmallPhone Album

Standalone SmallPhone Album app. It is source-first and dependency-free: native Node HTTP server, plain HTML/CSS/JS UI, SQLite storage through Node's built-in `node:sqlite`, and a CLI that uses the same storage/domain code as the API.

Album stores photo metadata only. It records `imageUrl` values and never accepts binary uploads.

## Requirements

- Node.js 22 or newer
- pnpm by default

## Scripts

```bash
pnpm start
pnpm dev
pnpm cli -- list-albums
pnpm test
pnpm check
```

The server listens on `http://127.0.0.1:23004` by default. Override with `PORT`:

```bash
PORT=4204 pnpm start
```

Runtime data defaults to `data/album.sqlite`. Override with `ALBUM_DB_FILE`:

```bash
ALBUM_DB_FILE=/tmp/smallphone-album.sqlite pnpm start
```

## API

```bash
curl http://127.0.0.1:23004/health
curl http://127.0.0.1:23004/manifest
curl http://127.0.0.1:23004/api/albums
curl -X POST http://127.0.0.1:23004/api/albums \
  -H 'content-type: application/json' \
  -d '{"title":"Weekend Walks","description":"Reference images collected outside."}'
curl -X PATCH http://127.0.0.1:23004/api/albums/<id> \
  -H 'content-type: application/json' \
  -d '{"title":"Updated album","description":"Updated notes."}'
curl -X DELETE http://127.0.0.1:23004/api/albums/<id>

curl http://127.0.0.1:23004/api/photos
curl http://127.0.0.1:23004/api/photos?albumId=<album-id>
curl -X POST http://127.0.0.1:23004/api/photos \
  -H 'content-type: application/json' \
  -d '{"title":"Corner light","albumId":"<album-id>","imageUrl":"https://example.com/photo.jpg","caption":"Late light.","takenAt":"2026-05-04T17:30:00.000Z"}'
curl -X PATCH http://127.0.0.1:23004/api/photos/<id> \
  -H 'content-type: application/json' \
  -d '{"caption":"Updated caption."}'
curl -X DELETE http://127.0.0.1:23004/api/photos/<id>
```

Deleting an album also deletes photo metadata assigned to that album.

## CLI

```bash
pnpm cli -- list-albums
pnpm cli -- add-album --title "Weekend Walks" --description "Reference images collected outside."
pnpm cli -- update-album <id> --title "Updated album"
pnpm cli -- delete-album <id>
pnpm cli -- list-photos --album-id <album-id>
pnpm cli -- add-photo --title "Corner light" --album-id <album-id> --image-url "https://example.com/photo.jpg" --caption "Late light." --taken-at "2026-05-04T17:30:00.000Z"
pnpm cli -- update-photo <id> --caption "Updated caption."
pnpm cli -- delete-photo <id>
pnpm cli -- list-photos --json
```

Use `--db-file <path>` on any CLI command to point at a specific SQLite database. `--data-file <path>` remains accepted as a legacy alias. Existing `data/album.json` files may remain in place as legacy data, but runtime storage is `data/album.sqlite` unless overridden.

Album shape:

```json
{
  "id": "album-id",
  "title": "Album title",
  "description": "Album notes",
  "createdAt": "2026-05-04T09:00:00.000Z",
  "updatedAt": "2026-05-04T09:00:00.000Z"
}
```

Photo metadata shape:

```json
{
  "id": "photo-id",
  "title": "Photo title",
  "albumId": "album-id",
  "imageUrl": "https://example.com/photo.jpg",
  "caption": "Caption text",
  "takenAt": "2026-05-04T17:30:00.000Z",
  "createdAt": "2026-05-04T09:00:00.000Z",
  "updatedAt": "2026-05-04T09:00:00.000Z"
}
```

## Files

- `smallphone.app.json`: standalone app manifest
- `src/domain.js`: album and photo workflow rules and validation
- `src/storage.js`: SQLite store with schema creation and seed-on-empty
- `src/service.js`: storage-backed album service
- `src/http-app.js`: native HTTP routing and static UI serving
- `src/cli.js`: command-line interface
- `public/`: plain browser UI
- `test/`: node:test coverage
