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
    entries: [],
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
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_created_at_idx
      ON entries (created_at DESC, id ASC);
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

function insertEntries(database, entries) {
  const insertEntry = database.prepare(`
    INSERT INTO entries (id, title, text, created_at, updated_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  entries.forEach((entry, index) => {
    insertEntry.run(
      String(entry.id),
      String(entry.title),
      String(entry.text),
      String(entry.createdAt),
      String(entry.updatedAt),
      index,
    );
  });
}

function seedIfEmpty(database, seedState) {
  const row = database.prepare('SELECT COUNT(*) AS count FROM entries').get();
  if (Number(row?.count || 0) !== 0 || hasSeeded(database)) return;

  const state = normalizeSeedState(seedState);
  runTransaction(database, () => {
    insertEntries(database, Array.isArray(state.entries) ? state.entries : []);
    markSeeded(database);
  });
}

function readSchemaVersion(database) {
  const row = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
  const version = Number.parseInt(String(row?.value || schemaVersion), 10);
  return Number.isInteger(version) ? version : schemaVersion;
}

function readEntries(database) {
  return database.prepare(`
    SELECT id, title, text, created_at AS createdAt, updated_at AS updatedAt
    FROM entries
    ORDER BY sort_order ASC, created_at DESC, id ASC
  `).all().map((entry) => ({
    id: entry.id,
    title: entry.title,
    text: entry.text,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}

function writeState(database, state) {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  runTransaction(database, () => {
    database.prepare('DELETE FROM entries').run();
    insertEntries(database, entries);
    database.prepare(`
      INSERT INTO metadata (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(state?.schemaVersion || schemaVersion));
    markSeeded(database);
  });
}

function createDiarySqliteStore(options = {}) {
  if (!options.filePath) {
    throw new Error('createDiarySqliteStore requires filePath.');
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
        entries: readEntries(db),
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
  createDiarySqliteStore,
};
