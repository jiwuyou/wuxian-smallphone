'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { dispatchDiaryRequest } = require('../src/http-app');
const { createDiaryService } = require('../src/service');

async function createTestService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-diary-http-'));
  let id = 0;
  let tick = 0;
  const times = [
    '2026-05-04T10:00:00.000Z',
    '2026-05-04T11:00:00.000Z',
    '2026-05-04T12:00:00.000Z',
  ];

  return createDiaryService({
    dbFile: path.join(dir, 'diary.sqlite'),
    seedState: () => ({ schemaVersion: 1, entries: [] }),
    idFactory: () => `entry-${id += 1}`,
    clock: () => times[Math.min(tick++, times.length - 1)],
  });
}

function jsonBody(response) {
  return JSON.parse(String(response.body || '{}'));
}

test('dispatches health, manifest, and memo entry API routes', async () => {
  const service = await createTestService();

  const health = await dispatchDiaryRequest({
    method: 'GET',
    url: '/health',
  }, { service });
  assert.equal(health.statusCode, 200);
  assert.equal(jsonBody(health).ok, true);
  assert.equal(jsonBody(health).storage.type, 'sqlite');

  const manifest = await dispatchDiaryRequest({
    method: 'GET',
    url: '/manifest',
  }, { service });
  assert.equal(manifest.statusCode, 200);
  assert.equal(jsonBody(manifest).id, 'diary');
  assert.equal(jsonBody(manifest).name, 'SmallPhone Memo');

  const create = await dispatchDiaryRequest({
    method: 'POST',
    url: '/api/entries',
    body: JSON.stringify({ title: 'API note', text: 'Created through HTTP.' }),
  }, { service });
  assert.equal(create.statusCode, 201);
  assert.equal(jsonBody(create).entry.id, 'entry-1');

  const list = await dispatchDiaryRequest({
    method: 'GET',
    url: '/api/entries',
  }, { service });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(jsonBody(list).entries.map((entry) => entry.title), ['API note']);

  const update = await dispatchDiaryRequest({
    method: 'PATCH',
    url: '/api/entries/entry-1',
    body: JSON.stringify({ text: 'Updated through HTTP.' }),
  }, { service });
  assert.equal(update.statusCode, 200);
  assert.equal(jsonBody(update).entry.text, 'Updated through HTTP.');

  const remove = await dispatchDiaryRequest({
    method: 'DELETE',
    url: '/api/entries/entry-1',
  }, { service });
  assert.equal(remove.statusCode, 204);

  const afterDelete = await dispatchDiaryRequest({
    method: 'GET',
    url: '/api/entries',
  }, { service });
  assert.deepEqual(jsonBody(afterDelete).entries, []);
});

test('serves concise memo UI copy while preserving stored entries', async () => {
  const service = await createTestService();
  await service.createEntry({
    title: 'Persisted note',
    text: 'Existing stored entries should still render.',
  });

  const response = await dispatchDiaryRequest({
    method: 'GET',
    url: '/',
  }, { service });

  assert.equal(response.statusCode, 200);
  const html = String(response.body);
  assert.match(html, /SmallPhone Memo/);
  assert.match(html, /Memo list/);
  assert.match(html, /Search notes/);
  assert.doesNotMatch(html, /Diary|Room|Studio|world|二维地图|地图布局|应用入口/);

  const list = await dispatchDiaryRequest({
    method: 'GET',
    url: '/api/entries',
  }, { service });
  assert.deepEqual(jsonBody(list).entries.map((entry) => entry.title), ['Persisted note']);
});

test('returns validation errors as JSON API responses', async () => {
  const service = await createTestService();
  const response = await dispatchDiaryRequest({
    method: 'POST',
    url: '/api/entries',
    body: '{"title":',
  }, { service });

  assert.equal(response.statusCode, 400);
  assert.equal(jsonBody(response).error.code, 'DIARY_VALIDATION_ERROR');
});
