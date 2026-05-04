'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { main, parseArgs } = require('../src/cli');

function captureStream() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    text() {
      return this.chunks.join('');
    },
  };
}

test('parses flags before and after commands', () => {
  assert.deepEqual(parseArgs(['--db-file', '/tmp/album.sqlite', 'list-photos', '--album-id', 'album-1', '--json']), {
    command: 'list-photos',
    flags: {
      'db-file': '/tmp/album.sqlite',
      'album-id': 'album-1',
      json: true,
    },
    positionals: [],
  });
});

test('ignores package-manager argument separator', () => {
  assert.deepEqual(parseArgs(['--', 'list-albums', '--json']), {
    command: 'list-albums',
    flags: {
      json: true,
    },
    positionals: [],
  });
});

test('CLI album and photo commands share the SQLite store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-album-cli-'));
  const dbFile = path.join(dir, 'album.sqlite');

  const addAlbumOutput = captureStream();
  const addAlbumError = captureStream();
  const addAlbumCode = await main([
    '--db-file',
    dbFile,
    'add-album',
    '--title',
    'CLI album',
    '--description',
    'Created from the CLI.',
    '--json',
  ], addAlbumOutput, addAlbumError);

  assert.equal(addAlbumCode, 0);
  assert.equal(addAlbumError.text(), '');
  const album = JSON.parse(addAlbumOutput.text()).album;
  assert.equal(album.title, 'CLI album');

  const addPhotoOutput = captureStream();
  const addPhotoCode = await main([
    '--db-file',
    dbFile,
    'add-photo',
    '--title',
    'CLI photo',
    '--album-id',
    album.id,
    '--image-url',
    'https://example.com/photo.jpg',
    '--caption',
    'Created from the CLI.',
    '--taken-at',
    '2026-05-03T17:30:00.000Z',
    '--json',
  ], addPhotoOutput, captureStream());

  assert.equal(addPhotoCode, 0);
  const photo = JSON.parse(addPhotoOutput.text()).photo;
  assert.equal(photo.albumId, album.id);

  const listOutput = captureStream();
  const listCode = await main([
    '--db-file',
    dbFile,
    'list-photos',
    '--album-id',
    album.id,
    '--json',
  ], listOutput, captureStream());

  assert.equal(listCode, 0);
  const listed = JSON.parse(listOutput.text()).photos;
  assert.equal(listed.some((candidate) => candidate.id === photo.id), true);
});
