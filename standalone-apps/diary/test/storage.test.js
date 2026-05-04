'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDiarySqliteStore } = require('../src/storage');

test('SQLite store creates schema, seeds once, reads, and writes state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-diary-storage-'));
  const filePath = path.join(dir, 'diary.sqlite');
  const store = createDiarySqliteStore({
    filePath,
    seedState: () => ({
      schemaVersion: 1,
      entries: [
        {
          id: 'seed',
          title: 'Seed',
          text: 'Seed body',
          createdAt: '2026-05-04T09:00:00.000Z',
          updatedAt: '2026-05-04T09:00:00.000Z',
        },
      ],
    }),
  });

  const seeded = await store.read();
  assert.equal(seeded.entries[0].id, 'seed');

  await store.write({
    schemaVersion: 1,
    entries: [
      {
        id: 'entry-2',
        title: 'Written',
        text: 'Written body',
        createdAt: '2026-05-04T10:00:00.000Z',
        updatedAt: '2026-05-04T10:00:00.000Z',
      },
    ],
  });

  const written = await store.read();
  assert.deepEqual(written.entries.map((entry) => entry.id), ['entry-2']);
  assert.equal(written.entries[0].title, 'Written');

  store.close();
  const files = await fs.readdir(dir);
  assert.equal(files.includes('diary.sqlite'), true);
  assert.equal(files.includes('diary.json'), false);
});
