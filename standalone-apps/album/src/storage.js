'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const schemaVersion = 1;

function resolveSqlitePath(filePath) {
  if (filePath === ':memory:') return filePath;
  return path.resolve(filePath);
}

async function ensureDatabaseDirectory(filePath) {
  if (filePath === ':memory:') return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyState() {
  return {
    schemaVersion,
    albums: [],
    photos: [],
  };
}

function normalizeSeedState(seedState) {
  if (typeof seedState === 'function') return seedState();
  if (seedState) return cloneState(seedState);
  return createEmptyState();
}

function runTransaction(database, operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The original error is more useful to callers.
    }
    throw error;
  }
}

function applySchema(database) {
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      album_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      caption TEXT NOT NULL,
      taken_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS albums_created_at_idx
      ON albums (created_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS photos_album_id_idx
      ON photos (album_id);
    CREATE INDEX IF NOT EXISTS photos_taken_at_idx
      ON photos (taken_at DESC, id ASC);
  `);

  database.prepare(`
    INSERT INTO metadata (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(schemaVersion));
}

function hasSeeded(database) {
  const row = database.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get();
  return row?.value === '1';
}

function markSeeded(database) {
  database.prepare(`
    INSERT INTO metadata (key, value)
    VALUES ('seeded', '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}

function insertAlbums(database, albums) {
  const insertAlbum = database.prepare(`
    INSERT INTO albums (id, title, description, created_at, updated_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  albums.forEach((album, index) => {
    insertAlbum.run(
      String(album.id),
      String(album.title),
      String(album.description ?? ''),
      String(album.createdAt),
      String(album.updatedAt),
      index,
    );
  });
}

function insertPhotos(database, photos) {
  const insertPhoto = database.prepare(`
    INSERT INTO photos (
      id,
      title,
      album_id,
      image_url,
      caption,
      taken_at,
      created_at,
      updated_at,
      sort_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  photos.forEach((photo, index) => {
    insertPhoto.run(
      String(photo.id),
      String(photo.title),
      String(photo.albumId),
      String(photo.imageUrl),
      String(photo.caption ?? ''),
      String(photo.takenAt),
      String(photo.createdAt),
      String(photo.updatedAt),
      index,
    );
  });
}

function seedIfEmpty(database, seedState) {
  const albumRow = database.prepare('SELECT COUNT(*) AS count FROM albums').get();
  const photoRow = database.prepare('SELECT COUNT(*) AS count FROM photos').get();
  const isEmpty = Number(albumRow?.count || 0) === 0 && Number(photoRow?.count || 0) === 0;
  if (!isEmpty || hasSeeded(database)) return;

  const state = normalizeSeedState(seedState);
  runTransaction(database, () => {
    insertAlbums(database, Array.isArray(state.albums) ? state.albums : []);
    insertPhotos(database, Array.isArray(state.photos) ? state.photos : []);
    markSeeded(database);
  });
}

function readSchemaVersion(database) {
  const row = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
  const version = Number.parseInt(String(row?.value || schemaVersion), 10);
  return Number.isInteger(version) ? version : schemaVersion;
}

function readAlbums(database) {
  return database.prepare(`
    SELECT id, title, description, created_at AS createdAt, updated_at AS updatedAt
    FROM albums
    ORDER BY sort_order ASC, created_at DESC, id ASC
  `).all().map((album) => ({
    id: album.id,
    title: album.title,
    description: album.description,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  }));
}

function readPhotos(database) {
  return database.prepare(`
    SELECT
      id,
      title,
      album_id AS albumId,
      image_url AS imageUrl,
      caption,
      taken_at AS takenAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM photos
    ORDER BY sort_order ASC, taken_at DESC, id ASC
  `).all().map((photo) => ({
    id: photo.id,
    title: photo.title,
    albumId: photo.albumId,
    imageUrl: photo.imageUrl,
    caption: photo.caption,
    takenAt: photo.takenAt,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
  }));
}

function writeState(database, state) {
  const albums = Array.isArray(state?.albums) ? state.albums : [];
  const photos = Array.isArray(state?.photos) ? state.photos : [];

  runTransaction(database, () => {
    database.prepare('DELETE FROM photos').run();
    database.prepare('DELETE FROM albums').run();
    insertAlbums(database, albums);
    insertPhotos(database, photos);
    database.prepare(`
      INSERT INTO metadata (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(state?.schemaVersion || schemaVersion));
    markSeeded(database);
  });
}

function createAlbumSqliteStore(options = {}) {
  if (!options.filePath) {
    throw new Error('createAlbumSqliteStore requires filePath.');
  }

  const filePath = resolveSqlitePath(options.filePath);
  const seedState = options.seedState;
  let database;
  let setupPromise;

  async function ensureDatabase() {
    if (database) return database;
    if (!setupPromise) {
      setupPromise = (async () => {
        await ensureDatabaseDirectory(filePath);
        const nextDatabase = new DatabaseSync(filePath);
        applySchema(nextDatabase);
        seedIfEmpty(nextDatabase, seedState);
        database = nextDatabase;
        return database;
      })();
    }
    return setupPromise;
  }

  return {
    filePath,
    async read() {
      const db = await ensureDatabase();
      return {
        schemaVersion: readSchemaVersion(db),
        albums: readAlbums(db),
        photos: readPhotos(db),
      };
    },
    async write(value) {
      const db = await ensureDatabase();
      writeState(db, value || createEmptyState());
    },
    close() {
      if (!database) return;
      database.close();
      database = null;
      setupPromise = null;
    },
  };
}

module.exports = {
  createAlbumSqliteStore,
};
