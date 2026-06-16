'use strict';

const maxTitleLength = 160;
const maxTextLength = 20000;

class DiaryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiaryValidationError';
    this.statusCode = 400;
    this.code = 'DIARY_VALIDATION_ERROR';
  }
}

class DiaryNotFoundError extends Error {
  constructor(id) {
    super(`Memo note not found: ${id}`);
    this.name = 'DiaryNotFoundError';
    this.statusCode = 404;
    this.code = 'DIARY_ENTRY_NOT_FOUND';
  }
}

function assertEntryId(value) {
  const id = String(value || '').trim();
  if (!id) {
    throw new DiaryValidationError('Memo note id is required.');
  }
  return id;
}

function normalizeTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) {
    throw new DiaryValidationError('Memo note title is required.');
  }
  if (title.length > maxTitleLength) {
    throw new DiaryValidationError(`Memo note title must be ${maxTitleLength} characters or fewer.`);
  }
  return title;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new DiaryValidationError('Memo note text is required.');
  }
  if (text.length > maxTextLength) {
    throw new DiaryValidationError(`Memo note text must be ${maxTextLength} characters or fewer.`);
  }
  return text;
}

function normalizeDate(value, fallback) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const timestamp = Date.parse(candidate);
  if (Number.isNaN(timestamp)) return fallback;
  return new Date(timestamp).toISOString();
}

function cloneEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    text: entry.text,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function normalizeEntry(entry, fallbackDate = new Date(0).toISOString()) {
  if (!entry || typeof entry !== 'object') return null;

  const id = String(entry.id || '').trim();
  const title = String(entry.title || '').trim();
  const text = String(entry.text || '').trim();
  if (!id || !title || !text) return null;

  const createdAt = normalizeDate(entry.createdAt, fallbackDate);
  const updatedAt = normalizeDate(entry.updatedAt, createdAt);

  return {
    id,
    title,
    text,
    createdAt,
    updatedAt,
  };
}

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];
  return {
    schemaVersion: 1,
    entries: entries.map((entry) => normalizeEntry(entry)).filter(Boolean),
  };
}

function listEntries(state) {
  return normalizeState(state).entries
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(cloneEntry);
}

function createEntry(state, input, context) {
  if (!state || !Array.isArray(state.entries)) {
    throw new DiaryValidationError('Memo state must contain an entries array.');
  }

  const now = normalizeDate(context?.now, new Date().toISOString());
  const id = assertEntryId(context?.id);
  if (state.entries.some((entry) => entry.id === id)) {
    throw new DiaryValidationError(`Memo note id already exists: ${id}`);
  }

  const entry = {
    id,
    title: normalizeTitle(input?.title),
    text: normalizeText(input?.text),
    createdAt: now,
    updatedAt: now,
  };

  state.entries.unshift(entry);
  return cloneEntry(entry);
}

function updateEntry(state, idValue, input, context) {
  if (!state || !Array.isArray(state.entries)) {
    throw new DiaryValidationError('Memo state must contain an entries array.');
  }

  const id = assertEntryId(idValue);
  const entry = state.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new DiaryNotFoundError(id);

  const hasTitle = Object.prototype.hasOwnProperty.call(input || {}, 'title');
  const hasText = Object.prototype.hasOwnProperty.call(input || {}, 'text');
  if (!hasTitle && !hasText) {
    throw new DiaryValidationError('PATCH requires title, text, or both.');
  }

  if (hasTitle) entry.title = normalizeTitle(input.title);
  if (hasText) entry.text = normalizeText(input.text);
  entry.updatedAt = normalizeDate(context?.now, new Date().toISOString());

  return cloneEntry(entry);
}

function deleteEntry(state, idValue) {
  if (!state || !Array.isArray(state.entries)) {
    throw new DiaryValidationError('Memo state must contain an entries array.');
  }

  const id = assertEntryId(idValue);
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) throw new DiaryNotFoundError(id);

  const [entry] = state.entries.splice(index, 1);
  return cloneEntry(entry);
}

module.exports = {
  DiaryNotFoundError,
  DiaryValidationError,
  cloneEntry,
  createEntry,
  deleteEntry,
  listEntries,
  normalizeState,
  updateEntry,
};
