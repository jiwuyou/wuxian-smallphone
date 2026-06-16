'use strict';

const state = {
  entries: [],
  editingId: null,
  query: '',
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

function resetForm() {
  state.editingId = null;
  elements.form.reset();
  elements.editorHeading.textContent = 'New memo';
  elements.saveButton.textContent = 'Save note';
  elements.cancelEditButton.hidden = true;
}

function startEdit(entry) {
  state.editingId = entry.id;
  elements.titleInput.value = entry.title;
  elements.textInput.value = entry.text;
  elements.editorHeading.textContent = 'Edit memo';
  elements.saveButton.textContent = 'Update note';
  elements.cancelEditButton.hidden = false;
  elements.titleInput.focus();
}

function renderEntries() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase();
  const visibleEntries = normalizedQuery
    ? state.entries.filter((entry) => (
      entry.title.toLocaleLowerCase().includes(normalizedQuery) ||
      entry.text.toLocaleLowerCase().includes(normalizedQuery)
    ))
    : state.entries;
  const noteLabel = state.entries.length === 1 ? 'note' : 'notes';
  elements.entryCount.textContent = normalizedQuery
    ? `${visibleEntries.length}/${state.entries.length} ${noteLabel}`
    : `${state.entries.length} ${noteLabel}`;
  elements.entryList.replaceChildren();

  if (!visibleEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = normalizedQuery ? 'No matching notes.' : 'No notes yet.';
    elements.entryList.append(empty);
    return;
  }

  visibleEntries.forEach((entry) => {
    const fragment = elements.entryTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.entry-row');
    const meta = fragment.querySelector('.entry-meta');
    const title = fragment.querySelector('h3');
    const text = fragment.querySelector('p');
    const editButton = fragment.querySelector('.edit-button');
    const deleteButton = fragment.querySelector('.delete-button');

    row.dataset.entryId = entry.id;
    meta.textContent = `Updated ${formatDate(entry.updatedAt)}`;
    title.textContent = entry.title;
    text.textContent = entry.text;
    editButton.dataset.entryId = entry.id;
    deleteButton.dataset.entryId = entry.id;

    elements.entryList.append(fragment);
  });
}

async function loadEntries() {
  setStatus('Loading');
  const payload = await requestJson('/api/entries');
  state.entries = payload.entries || [];
  renderEntries();
  setStatus('Ready');
}

async function saveEntry(event) {
  event.preventDefault();
  const title = elements.titleInput.value.trim();
  const text = elements.textInput.value.trim();
  if (!title || !text) return;

  elements.saveButton.disabled = true;
  try {
    if (state.editingId) {
      await requestJson(`/api/entries/${encodeURIComponent(state.editingId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, text }),
      });
      setStatus('Updated');
    } else {
      await requestJson('/api/entries', {
        method: 'POST',
        body: JSON.stringify({ title, text }),
      });
      setStatus('Saved');
    }
    resetForm();
    await loadEntries();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.saveButton.disabled = false;
  }
}

async function deleteEntry(id) {
  const entry = state.entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  if (!window.confirm(`Delete "${entry.title}"?`)) return;

  try {
    await requestJson(`/api/entries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (state.editingId === id) resetForm();
    setStatus('Deleted');
    await loadEntries();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function bindEvents() {
  elements.form.addEventListener('submit', saveEntry);
  elements.cancelEditButton.addEventListener('click', resetForm);
  elements.searchInput.addEventListener('input', () => {
    state.query = elements.searchInput.value;
    renderEntries();
  });
  elements.refreshButton.addEventListener('click', () => {
    loadEntries().catch((error) => setStatus(error.message, true));
  });
  elements.entryList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-entry-id]');
    if (!button) return;
    const entry = state.entries.find((candidate) => candidate.id === button.dataset.entryId);
    if (!entry) return;

    if (button.classList.contains('edit-button')) {
      startEdit(entry);
    } else if (button.classList.contains('delete-button')) {
      deleteEntry(entry.id);
    }
  });
}

function collectElements() {
  elements.form = document.querySelector('#entry-form');
  elements.titleInput = document.querySelector('#entry-title');
  elements.textInput = document.querySelector('#entry-text');
  elements.searchInput = document.querySelector('#entry-search');
  elements.editorHeading = document.querySelector('#editor-heading');
  elements.saveButton = document.querySelector('#save-button');
  elements.cancelEditButton = document.querySelector('#cancel-edit-button');
  elements.refreshButton = document.querySelector('#refresh-button');
  elements.statusPill = document.querySelector('#status-pill');
  elements.entryCount = document.querySelector('#entry-count');
  elements.entryList = document.querySelector('#entry-list');
  elements.entryTemplate = document.querySelector('#entry-template');
}

document.addEventListener('DOMContentLoaded', () => {
  collectElements();
  bindEvents();
  loadEntries().catch((error) => setStatus(error.message, true));
});
