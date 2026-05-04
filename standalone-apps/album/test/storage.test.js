'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAlbumSqliteStore } = require('../src/storage');

test('SQLite store creates schema, seeds once, reads, and writes state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-album-storage-'));
  const filePath = path.join(dir, 'album.sqlite');
  const store = createAlbumSqliteStore({
    filePath,
    seedState: () => ({
      schemaVersion: 1,
      albums: [
        {
          id: 'seed-album',
          title: 'Seed Album',
          description: 'Seed notes',
          createdAt: '2026-05-04T09:00:00.000Z',
          updatedAt: '2026-05-04T09:00:00.000Z',
        },
      ],
      photos: [],
    }),
  });

  const seeded = await store.read();
  assert.equal(seeded.albums[0].id, 'seed-album');

  await store.write({
    schemaVersion: 1,
    albums: [
      {
        id: 'album-2',
        title: 'Written',
        description: '',
        createdAt: '2026-05-04T10:00:00.000Z',
        updatedAt: '2026-05-04T10:00:00.000Z',
      },
    ],
    photos: [
      {
        id: 'photo-2',
        title: 'Written Photo',
        albumId: 'album-2',
        imageUrl: 'https://example.com/photo.jpg',
        caption: '',
        takenAt: '2026-05-03T17:30:00.000Z',
        createdAt: '2026-05-04T10:00:00.000Z',
        updatedAt: '2026-05-04T10:00:00.000Z',
      },
    ],
  });

  const written = await store.read();
  assert.deepEqual(written.albums.map((album) => album.id), ['album-2']);
  assert.deepEqual(written.photos.map((photo) => photo.id), ['photo-2']);

  store.close();
  const files = await fs.readdir(dir);
  assert.equal(files.includes('album.sqlite'), true);
  assert.equal(files.includes('album.json'), false);
});
