'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DiaryNotFoundError,
  DiaryValidationError,
  createEntry,
  deleteEntry,
  listEntries,
  normalizeState,
  updateEntry,
} = require('../src/domain');

test('normalizes persisted state and drops incomplete entries', () => {
  const state = normalizeState({
    entries: [
      {
        id: 'entry-1',
        title: ' Title ',
        text: ' Text ',
        createdAt: '2026-05-04T09:00:00.000Z',
        updatedAt: 'bad-date',
      },
      {
        id: '',
        title: 'Missing id',
        text: 'Nope',
      },
    ],
  });

  assert.deepEqual(state, {
    schemaVersion: 1,
    entries: [
      {
        id: 'entry-1',
        title: 'Title',
        text: 'Text',
        createdAt: '2026-05-04T09:00:00.000Z',
        updatedAt: '2026-05-04T09:00:00.000Z',
      },
    ],
  });
});

test('creates, lists, updates, and deletes memo notes through the entry model', () => {
  const state = normalizeState({ entries: [] });
  const created = createEntry(state, {
    title: ' First note ',
    text: ' Body text ',
  }, {
    id: 'entry-1',
    now: '2026-05-04T10:00:00.000Z',
  });

  assert.equal(created.title, 'First note');
  assert.equal(created.text, 'Body text');
  assert.equal(state.entries.length, 1);

  const updated = updateEntry(state, 'entry-1', {
    title: 'Updated note',
  }, {
    now: '2026-05-04T11:00:00.000Z',
  });

  assert.equal(updated.title, 'Updated note');
  assert.equal(updated.text, 'Body text');
  assert.equal(updated.updatedAt, '2026-05-04T11:00:00.000Z');
  assert.deepEqual(listEntries(state).map((entry) => entry.id), ['entry-1']);

  const deleted = deleteEntry(state, 'entry-1');
  assert.equal(deleted.id, 'entry-1');
  assert.deepEqual(state.entries, []);
});

test('validates required create and update fields', () => {
  const state = normalizeState({ entries: [] });

  assert.throws(() => createEntry(state, {
    title: '',
    text: 'Body',
  }, {
    id: 'entry-1',
    now: '2026-05-04T10:00:00.000Z',
  }), DiaryValidationError);

  assert.throws(() => updateEntry(state, 'missing', {
    title: 'Nope',
  }, {
    now: '2026-05-04T11:00:00.000Z',
  }), DiaryNotFoundError);
});
