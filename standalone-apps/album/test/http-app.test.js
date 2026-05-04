'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { dispatchAlbumRequest } = require('../src/http-app');
const { createAlbumService } = require('../src/service');

async function createTestService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-album-http-'));
  let id = 0;
  let tick = 0;
  const times = [
    '2026-05-04T10:00:00.000Z',
    '2026-05-04T11:00:00.000Z',
    '2026-05-04T12:00:00.000Z',
    '2026-05-04T13:00:00.000Z',
  ];

  return createAlbumService({
    dbFile: path.join(dir, 'album.sqlite'),
    seedState: () => ({ schemaVersion: 1, albums: [], photos: [] }),
    idFactory: () => `record-${id += 1}`,
    clock: () => times[Math.min(tick++, times.length - 1)],
  });
}

function jsonBody(response) {
  return JSON.parse(String(response.body || '{}'));
}

test('dispatches health, manifest, album routes, and photo routes', async () => {
  const service = await createTestService();

  const health = await dispatchAlbumRequest({
    method: 'GET',
    url: '/health',
  }, { service });
  assert.equal(health.statusCode, 200);
  assert.equal(jsonBody(health).ok, true);
  assert.equal(jsonBody(health).storage.type, 'sqlite');

  const manifest = await dispatchAlbumRequest({
    method: 'GET',
    url: '/manifest',
  }, { service });
  assert.equal(manifest.statusCode, 200);
  assert.equal(jsonBody(manifest).id, 'album');

  const createAlbum = await dispatchAlbumRequest({
    method: 'POST',
    url: '/api/albums',
    body: JSON.stringify({ title: 'API album', description: 'Created through HTTP.' }),
  }, { service });
  assert.equal(createAlbum.statusCode, 201);
  assert.equal(jsonBody(createAlbum).album.id, 'record-1');

  const updateAlbum = await dispatchAlbumRequest({
    method: 'PATCH',
    url: '/api/albums/record-1',
    body: JSON.stringify({ description: 'Updated through HTTP.' }),
  }, { service });
  assert.equal(updateAlbum.statusCode, 200);
  assert.equal(jsonBody(updateAlbum).album.description, 'Updated through HTTP.');

  const createPhoto = await dispatchAlbumRequest({
    method: 'POST',
    url: '/api/photos',
    body: JSON.stringify({
      title: 'API photo',
      albumId: 'record-1',
      imageUrl: 'https://example.com/photo.jpg',
      caption: 'Created through HTTP.',
      takenAt: '2026-05-03T17:30:00.000Z',
    }),
  }, { service });
  assert.equal(createPhoto.statusCode, 201);
  assert.equal(jsonBody(createPhoto).photo.id, 'record-2');

  const listPhotos = await dispatchAlbumRequest({
    method: 'GET',
    url: '/api/photos?albumId=record-1',
  }, { service });
  assert.equal(listPhotos.statusCode, 200);
  assert.deepEqual(jsonBody(listPhotos).photos.map((photo) => photo.title), ['API photo']);

  const updatePhoto = await dispatchAlbumRequest({
    method: 'PATCH',
    url: '/api/photos/record-2',
    body: JSON.stringify({ caption: 'Updated through HTTP.' }),
  }, { service });
  assert.equal(updatePhoto.statusCode, 200);
  assert.equal(jsonBody(updatePhoto).photo.caption, 'Updated through HTTP.');

  const removePhoto = await dispatchAlbumRequest({
    method: 'DELETE',
    url: '/api/photos/record-2',
  }, { service });
  assert.equal(removePhoto.statusCode, 204);

  const removeAlbum = await dispatchAlbumRequest({
    method: 'DELETE',
    url: '/api/albums/record-1',
  }, { service });
  assert.equal(removeAlbum.statusCode, 204);

  const afterDelete = await dispatchAlbumRequest({
    method: 'GET',
    url: '/api/albums',
  }, { service });
  assert.deepEqual(jsonBody(afterDelete).albums, []);
});

test('returns validation errors as JSON API responses', async () => {
  const service = await createTestService();
  const response = await dispatchAlbumRequest({
    method: 'POST',
    url: '/api/albums',
    body: '{"title":',
  }, { service });

  assert.equal(response.statusCode, 400);
  assert.equal(jsonBody(response).error.code, 'ALBUM_VALIDATION_ERROR');
});
