'use strict';

const maxTitleLength = 160;
const maxDescriptionLength = 1000;
const maxCaptionLength = 4000;
const maxImageUrlLength = 2000;

class AlbumValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AlbumValidationError';
    this.statusCode = 400;
    this.code = 'ALBUM_VALIDATION_ERROR';
  }
}

class AlbumNotFoundError extends Error {
  constructor(id) {
    super(`Album not found: ${id}`);
    this.name = 'AlbumNotFoundError';
    this.statusCode = 404;
    this.code = 'ALBUM_NOT_FOUND';
  }
}

class PhotoNotFoundError extends Error {
  constructor(id) {
    super(`Photo not found: ${id}`);
    this.name = 'PhotoNotFoundError';
    this.statusCode = 404;
    this.code = 'PHOTO_NOT_FOUND';
  }
}

function assertId(value, label) {
  const id = String(value || '').trim();
  if (!id) {
    throw new AlbumValidationError(`${label} is required.`);
  }
  return id;
}

function normalizeRequiredText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new AlbumValidationError(`${label} is required.`);
  }
  if (text.length > maxLength) {
    throw new AlbumValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function normalizeOptionalText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) {
    throw new AlbumValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function normalizeDate(value, fallback) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const timestamp = Date.parse(candidate);
  if (Number.isNaN(timestamp)) return fallback;
  return new Date(timestamp).toISOString();
}

function normalizeRequiredDate(value, label) {
  const candidate = String(value ?? '').trim();
  if (!candidate) {
    throw new AlbumValidationError(`${label} is required.`);
  }

  const timestamp = Date.parse(candidate);
  if (Number.isNaN(timestamp)) {
    throw new AlbumValidationError(`${label} must be a valid date.`);
  }
  return new Date(timestamp).toISOString();
}

function cloneAlbum(album) {
  return {
    id: album.id,
    title: album.title,
    description: album.description,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

function clonePhoto(photo) {
  return {
    id: photo.id,
    title: photo.title,
    albumId: photo.albumId,
    imageUrl: photo.imageUrl,
    caption: photo.caption,
    takenAt: photo.takenAt,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
  };
}

function normalizeAlbum(album, fallbackDate = new Date(0).toISOString()) {
  if (!album || typeof album !== 'object') return null;

  const id = String(album.id || '').trim();
  const title = String(album.title || '').trim();
  if (!id || !title) return null;

  const createdAt = normalizeDate(album.createdAt, fallbackDate);
  const updatedAt = normalizeDate(album.updatedAt, createdAt);

  return {
    id,
    title,
    description: String(album.description ?? '').trim(),
    createdAt,
    updatedAt,
  };
}

function normalizePhoto(photo, albumIds, fallbackDate = new Date(0).toISOString()) {
  if (!photo || typeof photo !== 'object') return null;

  const id = String(photo.id || '').trim();
  const title = String(photo.title || '').trim();
  const albumId = String(photo.albumId || '').trim();
  const imageUrl = String(photo.imageUrl || '').trim();
  if (!id || !title || !albumId || !imageUrl || !albumIds.has(albumId)) return null;

  const createdAt = normalizeDate(photo.createdAt, fallbackDate);
  const updatedAt = normalizeDate(photo.updatedAt, createdAt);
  const takenAt = normalizeDate(photo.takenAt, createdAt);

  return {
    id,
    title,
    albumId,
    imageUrl,
    caption: String(photo.caption ?? '').trim(),
    takenAt,
    createdAt,
    updatedAt,
  };
}

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const albums = [];
  const albumIds = new Set();

  for (const album of Array.isArray(source.albums) ? source.albums : []) {
    const normalized = normalizeAlbum(album);
    if (!normalized || albumIds.has(normalized.id)) continue;
    albums.push(normalized);
    albumIds.add(normalized.id);
  }

  const photos = [];
  const photoIds = new Set();
  for (const photo of Array.isArray(source.photos) ? source.photos : []) {
    const normalized = normalizePhoto(photo, albumIds);
    if (!normalized || photoIds.has(normalized.id)) continue;
    photos.push(normalized);
    photoIds.add(normalized.id);
  }

  return {
    schemaVersion: 1,
    albums,
    photos,
  };
}

function listAlbums(state) {
  return normalizeState(state).albums
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(cloneAlbum);
}

function listPhotos(state, filters = {}) {
  const normalized = normalizeState(state);
  let photos = normalized.photos;

  if (filters.albumId) {
    const albumId = assertId(filters.albumId, 'Album id');
    if (!normalized.albums.some((album) => album.id === albumId)) {
      throw new AlbumNotFoundError(albumId);
    }
    photos = photos.filter((photo) => photo.albumId === albumId);
  }

  return photos
    .slice()
    .sort((left, right) => Date.parse(right.takenAt) - Date.parse(left.takenAt))
    .map(clonePhoto);
}

function assertState(state) {
  if (!state || !Array.isArray(state.albums) || !Array.isArray(state.photos)) {
    throw new AlbumValidationError('Album state must contain albums and photos arrays.');
  }
}

function findAlbum(state, id) {
  const album = state.albums.find((candidate) => candidate.id === id);
  if (!album) throw new AlbumNotFoundError(id);
  return album;
}

function findPhoto(state, id) {
  const photo = state.photos.find((candidate) => candidate.id === id);
  if (!photo) throw new PhotoNotFoundError(id);
  return photo;
}

function createAlbum(state, input, context) {
  assertState(state);

  const now = normalizeDate(context?.now, new Date().toISOString());
  const id = assertId(context?.id, 'Album id');
  if (state.albums.some((album) => album.id === id)) {
    throw new AlbumValidationError(`Album id already exists: ${id}`);
  }

  const album = {
    id,
    title: normalizeRequiredText(input?.title, 'Album title', maxTitleLength),
    description: normalizeOptionalText(input?.description, 'Album description', maxDescriptionLength),
    createdAt: now,
    updatedAt: now,
  };

  state.albums.unshift(album);
  return cloneAlbum(album);
}

function updateAlbum(state, idValue, input, context) {
  assertState(state);

  const id = assertId(idValue, 'Album id');
  const album = findAlbum(state, id);
  const hasTitle = Object.prototype.hasOwnProperty.call(input || {}, 'title');
  const hasDescription = Object.prototype.hasOwnProperty.call(input || {}, 'description');
  if (!hasTitle && !hasDescription) {
    throw new AlbumValidationError('PATCH requires title, description, or both.');
  }

  if (hasTitle) album.title = normalizeRequiredText(input.title, 'Album title', maxTitleLength);
  if (hasDescription) {
    album.description = normalizeOptionalText(input.description, 'Album description', maxDescriptionLength);
  }
  album.updatedAt = normalizeDate(context?.now, new Date().toISOString());

  return cloneAlbum(album);
}

function deleteAlbum(state, idValue) {
  assertState(state);

  const id = assertId(idValue, 'Album id');
  const index = state.albums.findIndex((album) => album.id === id);
  if (index === -1) throw new AlbumNotFoundError(id);

  const [album] = state.albums.splice(index, 1);
  const before = state.photos.length;
  state.photos = state.photos.filter((photo) => photo.albumId !== id);

  return {
    album: cloneAlbum(album),
    photosDeleted: before - state.photos.length,
  };
}

function createPhoto(state, input, context) {
  assertState(state);

  const now = normalizeDate(context?.now, new Date().toISOString());
  const id = assertId(context?.id, 'Photo id');
  if (state.photos.some((photo) => photo.id === id)) {
    throw new AlbumValidationError(`Photo id already exists: ${id}`);
  }

  const albumId = assertId(input?.albumId, 'Album id');
  findAlbum(state, albumId);

  const photo = {
    id,
    title: normalizeRequiredText(input?.title, 'Photo title', maxTitleLength),
    albumId,
    imageUrl: normalizeRequiredText(input?.imageUrl, 'Photo image URL', maxImageUrlLength),
    caption: normalizeOptionalText(input?.caption, 'Photo caption', maxCaptionLength),
    takenAt: normalizeRequiredDate(input?.takenAt, 'Photo taken date'),
    createdAt: now,
    updatedAt: now,
  };

  state.photos.unshift(photo);
  return clonePhoto(photo);
}

function updatePhoto(state, idValue, input, context) {
  assertState(state);

  const id = assertId(idValue, 'Photo id');
  const photo = findPhoto(state, id);
  const fields = ['title', 'albumId', 'imageUrl', 'caption', 'takenAt'];
  const hasAnyField = fields.some((field) => Object.prototype.hasOwnProperty.call(input || {}, field));
  if (!hasAnyField) {
    throw new AlbumValidationError('PATCH requires title, albumId, imageUrl, caption, takenAt, or a combination.');
  }

  if (Object.prototype.hasOwnProperty.call(input || {}, 'title')) {
    photo.title = normalizeRequiredText(input.title, 'Photo title', maxTitleLength);
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, 'albumId')) {
    const albumId = assertId(input.albumId, 'Album id');
    findAlbum(state, albumId);
    photo.albumId = albumId;
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, 'imageUrl')) {
    photo.imageUrl = normalizeRequiredText(input.imageUrl, 'Photo image URL', maxImageUrlLength);
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, 'caption')) {
    photo.caption = normalizeOptionalText(input.caption, 'Photo caption', maxCaptionLength);
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, 'takenAt')) {
    photo.takenAt = normalizeRequiredDate(input.takenAt, 'Photo taken date');
  }
  photo.updatedAt = normalizeDate(context?.now, new Date().toISOString());

  return clonePhoto(photo);
}

function deletePhoto(state, idValue) {
  assertState(state);

  const id = assertId(idValue, 'Photo id');
  const index = state.photos.findIndex((photo) => photo.id === id);
  if (index === -1) throw new PhotoNotFoundError(id);

  const [photo] = state.photos.splice(index, 1);
  return clonePhoto(photo);
}

module.exports = {
  AlbumNotFoundError,
  AlbumValidationError,
  PhotoNotFoundError,
  cloneAlbum,
  clonePhoto,
  createAlbum,
  createPhoto,
  deleteAlbum,
  deletePhoto,
  listAlbums,
  listPhotos,
  normalizeState,
  updateAlbum,
  updatePhoto,
};
