'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { normalizeMessageSettings, normalizeState } = require('./domain');

const schemaVersion = 2;

async function ensureDatabaseDirectory(filePath) {
  if (filePath === ':memory:') return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFile(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function getMetadata(database, key) {
  return database.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value;
}

function setMetadata(database, key, value) {
  database.prepare(`
    INSERT INTO metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function singletonJson(database, table, id = 'main') {
  const row = database.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id);
  return row ? JSON.parse(row.payload) : null;
}

function writeSingletonJson(database, table, value, id = 'main') {
  database.prepare(`
    INSERT INTO ${table} (id, payload) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
  `).run(id, JSON.stringify(value || {}));
}

function tableJson(database, table) {
  return database.prepare(`SELECT payload FROM ${table} ORDER BY sort_order ASC, id ASC`).all()
    .map((row) => JSON.parse(row.payload));
}

function writeRows(database, table, rows) {
  database.prepare(`DELETE FROM ${table}`).run();
  const insert = database.prepare(`INSERT INTO ${table} (id, payload, sort_order) VALUES (?, ?, ?)`);
  rows.forEach((row, index) => insert.run(String(row.id), JSON.stringify(row), index));
}

function applySchema(database) {
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS about (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS checklist (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS message_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_credentials (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at TEXT NOT NULL);
  `);
}

function isSeeded(database) {
  return getMetadata(database, 'seeded') === '1';
}

function markSeeded(database) {
  setMetadata(database, 'seeded', '1');
}

function profileCount(database) {
  return database.prepare('SELECT COUNT(*) AS count FROM profile').get()?.count || 0;
}

function writeState(database, value) {
  const state = normalizeState(value || {});
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM profile').run();
    database.prepare('INSERT INTO profile (id, payload) VALUES (?, ?)').run('main', JSON.stringify(state.profile || {}));
    writeRows(database, 'about', state.about || []);
    writeRows(database, 'articles', state.articles || []);
    writeRows(database, 'photos', state.photos || []);
    writeRows(database, 'messages', state.messages || []);
    writeRows(database, 'checklist', state.checklist || []);
    writeSingletonJson(database, 'message_settings', state.messageSettings || normalizeMessageSettings());
    markSeeded(database);
    setMetadata(database, 'schema_version', schemaVersion);
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

function readState(database) {
  return normalizeState({
    schemaVersion,
    profile: singletonJson(database, 'profile') || {},
    about: tableJson(database, 'about'),
    articles: tableJson(database, 'articles'),
    photos: tableJson(database, 'photos'),
    messages: tableJson(database, 'messages'),
    checklist: tableJson(database, 'checklist'),
    messageSettings: singletonJson(database, 'message_settings') || {},
  });
}

function migrateDatabase(database) {
  const previousVersion = Number.parseInt(getMetadata(database, 'schema_version') || '1', 10);
  if (!singletonJson(database, 'message_settings')) {
    writeSingletonJson(database, 'message_settings', normalizeMessageSettings());
  }
  setMetadata(database, 'schema_version', schemaVersion);
  if (previousVersion < schemaVersion) setMetadata(database, 'migrated_from_schema_version', previousVersion);
}

async function seedIfEmpty(database, seedState, legacyJsonFile) {
  if (profileCount(database) || isSeeded(database)) return;
  const legacyState = await readJsonFile(legacyJsonFile);
  if (legacyState) {
    writeState(database, legacyState);
    setMetadata(database, 'migrated_from_json', path.resolve(legacyJsonFile));
    return;
  }
  const state = typeof seedState === 'function' ? seedState() : seedState;
  writeState(database, state || {});
}

function readAdminCredential(database) {
  return singletonJson(database, 'admin_credentials', 'main');
}

function writeAdminCredential(database, credential) {
  writeSingletonJson(database, 'admin_credentials', credential, 'main');
}

function getSession(database, id) {
  const row = database.prepare('SELECT payload FROM sessions WHERE id = ? AND expires_at > ?')
    .get(id, new Date().toISOString());
  return row ? JSON.parse(row.payload) : null;
}

function writeSession(database, session) {
  database.prepare(`
    INSERT INTO sessions (id, payload, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
  `).run(session.id, JSON.stringify(session), session.expiresAt);
}

function deleteSession(database, id) {
  database.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function pruneSessions(database) {
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

function createLikeGirlSqliteStore(options = {}) {
  if (!options.filePath) throw new Error('createLikeGirlSqliteStore requires filePath.');
  const filePath = options.filePath === ':memory:' ? ':memory:' : path.resolve(options.filePath);
  const seedState = options.seedState;
  const legacyJsonFile = options.legacyJsonFile ? path.resolve(options.legacyJsonFile) : null;
  let database;
  let setupPromise;

  async function ensureDatabase() {
    if (database) return database;
    if (!setupPromise) {
      setupPromise = (async () => {
        await ensureDatabaseDirectory(filePath);
        database = new DatabaseSync(filePath);
        applySchema(database);
        migrateDatabase(database);
        await seedIfEmpty(database, seedState, legacyJsonFile);
        return database;
      })();
    }
    return setupPromise;
  }

  return {
    filePath,
    async read() {
      return readState(await ensureDatabase());
    },
    async write(value) {
      writeState(await ensureDatabase(), value || {});
    },
    async readAdminCredential() {
      return readAdminCredential(await ensureDatabase());
    },
    async writeAdminCredential(value) {
      writeAdminCredential(await ensureDatabase(), value);
    },
    async getSession(id) {
      return getSession(await ensureDatabase(), id);
    },
    async writeSession(session) {
      writeSession(await ensureDatabase(), session);
    },
    async deleteSession(id) {
      deleteSession(await ensureDatabase(), id);
    },
    async pruneSessions() {
      pruneSessions(await ensureDatabase());
    },
    close() {
      if (database) database.close();
      database = null;
      setupPromise = null;
    },
  };
}

module.exports = {
  createLikeGirlSqliteStore,
  schemaVersion,
};
