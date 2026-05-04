'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AlbumNotFoundError,
  AlbumValidationError,
  PhotoNotFoundError,
  createAlbum,
  createPhoto,
  deleteAlbum,
  deletePhoto,
  listAlbums,
  listPhotos,
  normalizeState,
  updateAlbum,
  updatePhoto,
} = require('../src/domain');

test('normalizes persisted state and drops orphan photos', () => {
  const state = normalizeState({
    albums: [
      {
        id: 'album-1',
        title: ' Album ',
        description: ' Notes ',
        createdAt: '2026-05-04T09:00:00.000Z',
        updatedAt: 'bad-date',
      },
      {
        id: '',
        title: 'Missing id',
      },
    ],
    photos: [
      {
        id: 'photo-1',
        title: ' Photo ',
        albumId: 'album-1',
        imageUrl: ' https://example.com/photo.jpg ',
        caption: ' Caption ',
        takenAt: '2026-05-03T17:30:00.000Z',
        createdAt: '2026-05-04T10:00:00.000Z',
        updatedAt: 'bad-date',
      },
      {
        id: 'orphan',
        title: 'Orphan',
        albumId: 'missing',
        imageUrl: 'https://example.com/orphan.jpg',
      },
    ],
  });

  assert.deepEqual(state, {
    schemaVersion: 1,
    albums: [
      {
        id: 'album-1',
        title: 'Album',
        description: 'Notes',
        createdAt: '2026-05-04T09:00:00.000Z',
        updatedAt: '2026-05-04T09:00:00.000Z',
      },
    ],
    photos: [
      {
        id: 'photo-1',
        title: 'Photo',
        albumId: 'album-1',
        imageUrl: 'https://example.com/photo.jpg',
        caption: 'Caption',
        takenAt: '2026-05-03T17:30:00.000Z',
        createdAt: '2026-05-04T10:00:00.000Z',
        updatedAt: '2026-05-04T10:00:00.000Z',
      },
    ],
  });
});

test('creates, lists, updates, and deletes albums and photo metadata', () => {
  const state = normalizeState({ albums: [], photos: [] });
  const album = createAlbum(state, {
    title: ' Weekend ',
    description: ' Walks ',
  }, {
    id: 'album-1',
    now: '2026-05-04T10:00:00.000Z',
  });

  assert.equal(album.title, 'Weekend');
  assert.equal(state.albums.length, 1);

  const updatedAlbum = updateAlbum(state, 'album-1', {
    description: 'Updated walks',
  }, {
    now: '2026-05-04T11:00:00.000Z',
  });

  assert.equal(updatedAlbum.title, 'Weekend');
  assert.equal(updatedAlbum.description, 'Updated walks');
  assert.deepEqual(listAlbums(state).map((candidate) => candidate.id), ['album-1']);

  const photo = createPhoto(state, {
    title: ' Corner ',
    albumId: 'album-1',
    imageUrl: ' https://example.com/photo.jpg ',
    caption: ' Late light ',
    takenAt: '2026-05-03T17:30:00.000Z',
  }, {
    id: 'photo-1',
    now: '2026-05-04T12:00:00.000Z',
  });

  assert.equal(photo.title, 'Corner');
  assert.equal(photo.caption, 'Late light');
  assert.deepEqual(listPhotos(state, { albumId: 'album-1' }).map((candidate) => candidate.id), ['photo-1']);

  const updatedPhoto = updatePhoto(state, 'photo-1', {
    caption: 'Updated caption',
  }, {
    now: '2026-05-04T13:00:00.000Z',
  });

  assert.equal(updatedPhoto.caption, 'Updated caption');
  assert.equal(updatedPhoto.updatedAt, '2026-05-04T13:00:00.000Z');

  const deletedPhoto = deletePhoto(state, 'photo-1');
  assert.equal(deletedPhoto.id, 'photo-1');
  assert.deepEqual(state.photos, []);

  createPhoto(state, {
    title: ' Second ',
    albumId: 'album-1',
    imageUrl: 'https://example.com/second.jpg',
    caption: '',
    takenAt: '2026-05-03T18:00:00.000Z',
  }, {
    id: 'photo-2',
    now: '2026-05-04T14:00:00.000Z',
  });

  const deletedAlbum = deleteAlbum(state, 'album-1');
  assert.equal(deletedAlbum.album.id, 'album-1');
  assert.equal(deletedAlbum.photosDeleted, 1);
  assert.deepEqual(state.albums, []);
  assert.deepEqual(state.photos, []);
});

test('validates required fields and missing records', () => {
  const state = normalizeState({
    albums: [
      {
        id: 'album-1',
        title: 'Album',
        createdAt: '2026-05-04T09:00:00.000Z',
        updatedAt: '2026-05-04T09:00:00.000Z',
      },
    ],
    photos: [],
  });

  assert.throws(() => createAlbum(state, {
    title: '',
  }, {
    id: 'album-2',
    now: '2026-05-04T10:00:00.000Z',
  }), AlbumValidationError);

  assert.throws(() => createPhoto(state, {
    title: 'Photo',
    albumId: 'missing',
    imageUrl: 'https://example.com/photo.jpg',
    takenAt: '2026-05-04T10:00:00.000Z',
  }, {
    id: 'photo-1',
    now: '2026-05-04T10:00:00.000Z',
  }), AlbumNotFoundError);

  assert.throws(() => createPhoto(state, {
    title: 'Photo',
    albumId: 'album-1',
    imageUrl: 'https://example.com/photo.jpg',
  }, {
    id: 'photo-1',
    now: '2026-05-04T10:00:00.000Z',
  }), AlbumValidationError);

  assert.throws(() => updatePhoto(state, 'missing', {
    caption: 'Nope',
  }, {
    now: '2026-05-04T11:00:00.000Z',
  }), PhotoNotFoundError);
});
