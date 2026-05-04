'use strict';

const state = {
  albums: [],
  photos: [],
  selectedAlbumId: '',
  editingAlbumId: null,
  editingPhotoId: null,
};

const elements = {};

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function toDateTimeLocal(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function setStatus(message, isError = false) {
  elements.statusPill.textContent = message;
  elements.statusPill.classList.toggle('error', isError);
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) return null;

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed with ${response.status}`);
  }
  return payload;
}

function albumTitle(albumId) {
  const album = state.albums.find((candidate) => candidate.id === albumId);
  return album ? album.title : albumId;
}

function selectedAlbum() {
  return state.albums.find((album) => album.id === state.selectedAlbumId) || null;
}

function visiblePhotos() {
  if (!state.selectedAlbumId) return [];
  return state.photos.filter((photo) => photo.albumId === state.selectedAlbumId);
}

function resetAlbumForm() {
  state.editingAlbumId = null;
  elements.albumForm.reset();
  elements.albumEditorHeading.textContent = 'New album';
  elements.saveAlbumButton.textContent = 'Save album';
  elements.cancelAlbumEditButton.hidden = true;
}

function resetPhotoForm() {
  state.editingPhotoId = null;
  elements.photoForm.reset();
  elements.photoEditorTitle = 'New photo';
  elements.savePhotoButton.textContent = 'Save photo';
  elements.cancelPhotoEditButton.hidden = true;
  elements.photoAlbumSelect.value = state.selectedAlbumId || state.albums[0]?.id || '';
  elements.photoTakenAtInput.value = toDateTimeLocal();
}

function updatePhotoFormAvailability() {
  const hasAlbums = state.albums.length > 0;
  elements.photoFieldset.disabled = !hasAlbums;
  if (!hasAlbums) {
    elements.photoAlbumSelect.replaceChildren();
  }
}

function renderAlbumSelect() {
  elements.photoAlbumSelect.replaceChildren();
  state.albums.forEach((album) => {
    const option = document.createElement('option');
    option.value = album.id;
    option.textContent = album.title;
    elements.photoAlbumSelect.append(option);
  });
  elements.photoAlbumSelect.value = state.selectedAlbumId || state.albums[0]?.id || '';
}

function renderAlbums() {
  elements.albumCount.textContent = `${state.albums.length} ${state.albums.length === 1 ? 'album' : 'albums'}`;
  elements.albumList.replaceChildren();

  if (!state.albums.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No albums yet.';
    elements.albumList.append(empty);
    return;
  }

  state.albums.forEach((album) => {
    const fragment = elements.albumTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.album-row');
    const selectButton = fragment.querySelector('.album-select-button');
    const title = fragment.querySelector('.album-title');
    const description = fragment.querySelector('.album-description');
    const meta = fragment.querySelector('.album-meta');
    const editButton = fragment.querySelector('.edit-album-button');
    const deleteButton = fragment.querySelector('.delete-album-button');
    const photoCount = state.photos.filter((photo) => photo.albumId === album.id).length;

    row.dataset.albumId = album.id;
    row.classList.toggle('selected', album.id === state.selectedAlbumId);
    selectButton.dataset.albumId = album.id;
    editButton.dataset.albumId = album.id;
    deleteButton.dataset.albumId = album.id;
    title.textContent = album.title;
    description.textContent = album.description || 'No description';
    meta.textContent = `${photoCount} ${photoCount === 1 ? 'photo' : 'photos'} · Updated ${formatDate(album.updatedAt)}`;

    elements.albumList.append(fragment);
  });
}

function renderPhotos() {
  const album = selectedAlbum();
  const photos = visiblePhotos();
  elements.selectedAlbumLabel.textContent = album ? album.title : 'Selected album';
  elements.photoCount.textContent = `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`;
  elements.photoList.replaceChildren();

  if (!state.albums.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Create an album before adding photo metadata.';
    elements.photoList.append(empty);
    return;
  }

  if (!photos.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No photos in this album yet.';
    elements.photoList.append(empty);
    return;
  }

  photos.forEach((photo) => {
    const fragment = elements.photoTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.photo-row');
    const img = fragment.querySelector('img');
    const meta = fragment.querySelector('.photo-meta');
    const title = fragment.querySelector('h3');
    const caption = fragment.querySelector('p');
    const link = fragment.querySelector('a');
    const editButton = fragment.querySelector('.edit-photo-button');
    const deleteButton = fragment.querySelector('.delete-photo-button');

    row.dataset.photoId = photo.id;
    img.src = photo.imageUrl;
    img.alt = photo.title;
    meta.textContent = `${albumTitle(photo.albumId)} · Taken ${formatDate(photo.takenAt)}`;
    title.textContent = photo.title;
    caption.textContent = photo.caption || 'No caption';
    link.href = photo.imageUrl;
    editButton.dataset.photoId = photo.id;
    deleteButton.dataset.photoId = photo.id;

    elements.photoList.append(fragment);
  });
}

function renderAll() {
  renderAlbumSelect();
  renderAlbums();
  renderPhotos();
  updatePhotoFormAvailability();
}

async function loadData(preferredAlbumId = state.selectedAlbumId) {
  setStatus('Loading');
  const [albumsPayload, photosPayload] = await Promise.all([
    requestJson('/api/albums'),
    requestJson('/api/photos'),
  ]);

  state.albums = albumsPayload.albums || [];
  state.photos = photosPayload.photos || [];

  const preferred = state.albums.find((album) => album.id === preferredAlbumId);
  state.selectedAlbumId = preferred ? preferred.id : state.albums[0]?.id || '';
  renderAll();
  setStatus('Ready');
}

function startEditAlbum(album) {
  state.editingAlbumId = album.id;
  elements.albumTitleInput.value = album.title;
  elements.albumDescriptionInput.value = album.description;
  elements.albumEditorHeading.textContent = 'Edit album';
  elements.saveAlbumButton.textContent = 'Update album';
  elements.cancelAlbumEditButton.hidden = false;
  elements.albumTitleInput.focus();
}

function startEditPhoto(photo) {
  state.editingPhotoId = photo.id;
  elements.photoTitleInput.value = photo.title;
  elements.photoAlbumSelect.value = photo.albumId;
  elements.photoImageUrlInput.value = photo.imageUrl;
  elements.photoCaptionInput.value = photo.caption;
  elements.photoTakenAtInput.value = toDateTimeLocal(photo.takenAt);
  elements.savePhotoButton.textContent = 'Update photo';
  elements.cancelPhotoEditButton.hidden = false;
  elements.photoTitleInput.focus();
}

async function saveAlbum(event) {
  event.preventDefault();
  const title = elements.albumTitleInput.value.trim();
  const description = elements.albumDescriptionInput.value.trim();
  if (!title) return;

  elements.saveAlbumButton.disabled = true;
  try {
    let payload;
    if (state.editingAlbumId) {
      payload = await requestJson(`/api/albums/${encodeURIComponent(state.editingAlbumId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description }),
      });
      setStatus('Album updated');
    } else {
      payload = await requestJson('/api/albums', {
        method: 'POST',
        body: JSON.stringify({ title, description }),
      });
      setStatus('Album saved');
    }
    resetAlbumForm();
    await loadData(payload.album.id);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.saveAlbumButton.disabled = false;
  }
}

async function savePhoto(event) {
  event.preventDefault();
  const title = elements.photoTitleInput.value.trim();
  const albumId = elements.photoAlbumSelect.value;
  const imageUrl = elements.photoImageUrlInput.value.trim();
  const caption = elements.photoCaptionInput.value.trim();
  const takenAt = elements.photoTakenAtInput.value;
  if (!title || !albumId || !imageUrl || !takenAt) return;

  elements.savePhotoButton.disabled = true;
  try {
    let payload;
    const body = JSON.stringify({ title, albumId, imageUrl, caption, takenAt });
    if (state.editingPhotoId) {
      payload = await requestJson(`/api/photos/${encodeURIComponent(state.editingPhotoId)}`, {
        method: 'PATCH',
        body,
      });
      setStatus('Photo updated');
    } else {
      payload = await requestJson('/api/photos', {
        method: 'POST',
        body,
      });
      setStatus('Photo saved');
    }
    state.selectedAlbumId = payload.photo.albumId;
    resetPhotoForm();
    await loadData(payload.photo.albumId);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.savePhotoButton.disabled = false;
  }
}

async function deleteAlbum(id) {
  const album = state.albums.find((candidate) => candidate.id === id);
  if (!album) return;
  if (!window.confirm(`Delete "${album.title}" and its photo metadata?`)) return;

  try {
    await requestJson(`/api/albums/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (state.editingAlbumId === id) resetAlbumForm();
    if (state.selectedAlbumId === id) state.selectedAlbumId = '';
    setStatus('Album deleted');
    await loadData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deletePhoto(id) {
  const photo = state.photos.find((candidate) => candidate.id === id);
  if (!photo) return;
  if (!window.confirm(`Delete "${photo.title}" metadata?`)) return;

  try {
    await requestJson(`/api/photos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (state.editingPhotoId === id) resetPhotoForm();
    setStatus('Photo deleted');
    await loadData(state.selectedAlbumId);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function bindEvents() {
  elements.albumForm.addEventListener('submit', saveAlbum);
  elements.photoForm.addEventListener('submit', savePhoto);
  elements.cancelAlbumEditButton.addEventListener('click', resetAlbumForm);
  elements.cancelPhotoEditButton.addEventListener('click', resetPhotoForm);
  elements.refreshButton.addEventListener('click', () => {
    loadData().catch((error) => setStatus(error.message, true));
  });

  elements.albumList.addEventListener('click', (event) => {
    const selectButton = event.target.closest('.album-select-button[data-album-id]');
    const editButton = event.target.closest('.edit-album-button[data-album-id]');
    const deleteButton = event.target.closest('.delete-album-button[data-album-id]');

    if (selectButton) {
      state.selectedAlbumId = selectButton.dataset.albumId;
      resetPhotoForm();
      renderAll();
      return;
    }

    if (editButton) {
      const album = state.albums.find((candidate) => candidate.id === editButton.dataset.albumId);
      if (album) startEditAlbum(album);
      return;
    }

    if (deleteButton) {
      deleteAlbum(deleteButton.dataset.albumId);
    }
  });

  elements.photoList.addEventListener('click', (event) => {
    const editButton = event.target.closest('.edit-photo-button[data-photo-id]');
    const deleteButton = event.target.closest('.delete-photo-button[data-photo-id]');

    if (editButton) {
      const photo = state.photos.find((candidate) => candidate.id === editButton.dataset.photoId);
      if (photo) startEditPhoto(photo);
      return;
    }

    if (deleteButton) {
      deletePhoto(deleteButton.dataset.photoId);
    }
  });
}

function collectElements() {
  elements.statusPill = document.querySelector('#status-pill');
  elements.refreshButton = document.querySelector('#refresh-button');
  elements.albumForm = document.querySelector('#album-form');
  elements.albumTitleInput = document.querySelector('#album-title');
  elements.albumDescriptionInput = document.querySelector('#album-description');
  elements.albumEditorHeading = document.querySelector('#album-editor-heading');
  elements.saveAlbumButton = document.querySelector('#save-album-button');
  elements.cancelAlbumEditButton = document.querySelector('#cancel-album-edit-button');
  elements.albumCount = document.querySelector('#album-count');
  elements.albumList = document.querySelector('#album-list');
  elements.albumTemplate = document.querySelector('#album-template');
  elements.photoForm = document.querySelector('#photo-form');
  elements.photoFieldset = document.querySelector('#photo-fieldset');
  elements.photoTitleInput = document.querySelector('#photo-title');
  elements.photoAlbumSelect = document.querySelector('#photo-album');
  elements.photoImageUrlInput = document.querySelector('#photo-image-url');
  elements.photoCaptionInput = document.querySelector('#photo-caption');
  elements.photoTakenAtInput = document.querySelector('#photo-taken-at');
  elements.savePhotoButton = document.querySelector('#save-photo-button');
  elements.cancelPhotoEditButton = document.querySelector('#cancel-photo-edit-button');
  elements.selectedAlbumLabel = document.querySelector('#selected-album-label');
  elements.photoCount = document.querySelector('#photo-count');
  elements.photoList = document.querySelector('#photo-list');
  elements.photoTemplate = document.querySelector('#photo-template');
}

document.addEventListener('DOMContentLoaded', () => {
  collectElements();
  bindEvents();
  resetPhotoForm();
  loadData().catch((error) => setStatus(error.message, true));
});
