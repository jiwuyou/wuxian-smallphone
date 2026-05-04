'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createLikeGirlSqliteStore } = require('../src/storage');
const { cloneSeedState } = require('../src/seed-data');

test('SQLite store seeds, reads, and writes LikeGirl state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-like-girl-store-'));
  const filePath = path.join(dir, 'like-girl.sqlite');
  const store = createLikeGirlSqliteStore({ filePath, seedState: cloneSeedState });
  const seeded = await store.read();
  assert.equal(seeded.profile.title, 'LikeGirl');
  seeded.messages.unshift({ id: 'm2', name: 'Tester', qq: '', text: 'Stored', createdAt: '2026-05-04T00:00:00.000Z' });
  await store.write(seeded);
  store.close();
  const reopened = createLikeGirlSqliteStore({ filePath, seedState: cloneSeedState });
  assert.equal((await reopened.read()).messages.some((item) => item.id === 'm2'), true);
  reopened.close();
});

test('SQLite store migrates native v1 JSON state into SQLite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-like-girl-json-migration-'));
  const filePath = path.join(dir, 'like-girl.sqlite');
  const legacyJsonFile = path.join(dir, 'like-girl.json');
  await fs.writeFile(legacyJsonFile, JSON.stringify({
    schemaVersion: 1,
    profile: { title: 'Migrated LikeGirl', boy: 'A', girl: 'B' },
    about: [{ id: 'a1', title: 'Old about', text: 'Preserved about.' }],
    articles: [],
    photos: [],
    messages: [],
    checklist: [],
  }));
  const store = createLikeGirlSqliteStore({ filePath, legacyJsonFile, seedState: cloneSeedState });
  const migrated = await store.read();
  assert.equal(migrated.profile.title, 'Migrated LikeGirl');
  assert.equal(migrated.about[0].id, 'a1');
  assert.equal(migrated.messageSettings.latestLimit, 100);
  store.close();
});
