'use strict';

const { randomUUID } = require('node:crypto');

const {
  createAlbum,
  createPhoto,
  deleteAlbum,
  deletePhoto,
  listAlbums,
  listPhotos,
  normalizeState,
  updateAlbum,
  updatePhoto,
} = require('./domain');
const { resolveDbFile } = require('./paths');
const { cloneSeedState } = require('./seed-data');
const { createAlbumSqliteStore } = require('./storage');

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function createAlbumService(options = {}) {
  const store = options.store || createAlbumSqliteStore({
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
    async listAlbums() {
      const state = await readState();
      return listAlbums(state);
    },
    async createAlbum(input) {
      return mutate((state) => createAlbum(state, input, {
        id: idFactory(),
        now: now(),
      }));
    },
    async updateAlbum(id, input) {
      return mutate((state) => updateAlbum(state, id, input, {
        now: now(),
      }));
    },
    async deleteAlbum(id) {
      return mutate((state) => deleteAlbum(state, id));
    },
    async listPhotos(filters) {
      const state = await readState();
      return listPhotos(state, filters);
    },
    async createPhoto(input) {
      return mutate((state) => createPhoto(state, input, {
        id: idFactory(),
        now: now(),
      }));
    },
    async updatePhoto(id, input) {
      return mutate((state) => updatePhoto(state, id, input, {
        now: now(),
      }));
    },
    async deletePhoto(id) {
      return mutate((state) => deletePhoto(state, id));
    },
  };
}

module.exports = {
  createAlbumService,
};
