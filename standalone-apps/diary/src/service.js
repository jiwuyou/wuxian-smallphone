'use strict';

const { randomUUID } = require('node:crypto');

const {
  createEntry,
  deleteEntry,
  listEntries,
  normalizeState,
  updateEntry,
} = require('./domain');
const { resolveDbFile } = require('./paths');
const { cloneSeedState } = require('./seed-data');
const { createDiarySqliteStore } = require('./storage');

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function createDiaryService(options = {}) {
  const store = options.store || createDiarySqliteStore({
    filePath: options.dbFile || options.dataFile || resolveDbFile(),
    seedState: options.seedState || cloneSeedState,
  });
  const clock = options.clock || (() => new Date());
  const idFactory = options.idFactory || randomUUID;
  let writeQueue = Promise.resolve();

  function now() {
    return toIsoString(clock());
  }

  async function readState() {
    return normalizeState(await store.read());
  }

  function mutate(mutator) {
    const operation = writeQueue.then(async () => {
      const state = await readState();
      const result = mutator(state);
      await store.write(state);
      return result;
    });

    writeQueue = operation.catch(() => {});
    return operation;
  }

  return {
    dbFile: store.filePath,
    dataFile: store.filePath,
    async listEntries() {
      const state = await readState();
      return listEntries(state);
    },
    async createEntry(input) {
      return mutate((state) => createEntry(state, input, {
        id: idFactory(),
        now: now(),
      }));
    },
    async updateEntry(id, input) {
      return mutate((state) => updateEntry(state, id, input, {
        now: now(),
      }));
    },
    async deleteEntry(id) {
      return mutate((state) => deleteEntry(state, id));
    },
  };
}

module.exports = {
  createDiaryService,
};
