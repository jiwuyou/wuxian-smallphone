'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const {
  LikeGirlAuthError,
  LikeGirlForbiddenError,
  LikeGirlValidationError,
  bootstrap,
  clone,
  createMessage,
  deleteCollectionRecord,
  getArticle,
  getCollectionRecord,
  listArticles,
  normalizeMessageSettings,
  normalizeProfile,
  normalizeState,
  patchCollectionRecord,
  replaceCollectionRecord,
} = require('./domain');
const { defaultLegacyJsonFile, resolveDbFile, resolvePhotoUploadsDir } = require('./paths');
const { cloneSeedState } = require('./seed-data');
const { createLikeGirlSqliteStore } = require('./storage');

const sessionCookieName = 'like_girl_admin';
const defaultAdminUser = 'admin';
const defaultAdminPassword = 'loveww';
const supportedImageTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/svg+xml', '.svg'],
]);

class LikeGirlRateLimitError extends Error {
  constructor(message = '今日留言次数已达上限。') {
    super(message);
    this.name = 'LikeGirlRateLimitError';
    this.statusCode = 429;
    this.code = 'LIKE_GIRL_RATE_LIMIT';
  }
}

function hashPassword(password, salt = randomBytes(16).toString('hex'), iterations = 120000) {
  const hash = pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function md5(value) {
  return createHash('md5').update(String(value)).digest('hex');
}

function safeCompareHex(left, right) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, storedHash) {
  const value = String(storedHash || '');
  if (/^[a-f0-9]{32}$/i.test(value)) return safeCompareHex(md5(password), value);
  const parts = value.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterations, salt, hash] = parts;
  return safeCompareHex(hashPassword(password, salt, Number.parseInt(iterations, 10)).split('$')[3], hash);
}

function normalizeAdminInput(input = {}) {
  const username = String(input.username || input.adminName || '').trim();
  const password = String(input.password || input.pw || '');
  if (!/^[a-zA-Z0-9]{3,40}$/.test(username)) throw new LikeGirlValidationError('用户名必须为 3-40 位字母或数字。');
  if (!password) throw new LikeGirlValidationError('密码不能为空。');
  return { username, password };
}

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function getClientIp(context = {}) {
  return String(context.ip || '').split(',')[0].trim() || 'unknown';
}

function parseLimit(limit, fallback) {
  const count = Number.parseInt(String(limit || ''), 10);
  if (Number.isInteger(count) && count > 0) return count;
  return fallback;
}

function publicMessages(state, limit) {
  const normalized = normalizeState(state);
  const messages = bootstrap(normalized).messages;
  return messages.slice(0, parseLimit(limit, normalized.messageSettings.latestLimit));
}

function createCredential(username, password, now) {
  return {
    username,
    passwordHash: hashPassword(password),
    createdAt: now,
    updatedAt: now,
  };
}

function publicAdminUser(credential) {
  return {
    username: credential.username,
    updatedAt: credential.updatedAt,
  };
}

function createLikeGirlService(options = {}) {
  const store = options.store || createLikeGirlSqliteStore({
    filePath: options.dbFile || resolveDbFile(),
    seedState: options.seedState || cloneSeedState,
    legacyJsonFile: options.legacyJsonFile || defaultLegacyJsonFile,
  });
  const idFactory = options.idFactory || randomUUID;
  const clock = options.clock || (() => new Date());
  const uploadDir = options.photoUploadsDir || resolvePhotoUploadsDir();
  const adminUser = options.adminUser || process.env.LIKE_GIRL_ADMIN_USER || defaultAdminUser;
  const adminPassword = options.adminPassword || process.env.LIKE_GIRL_ADMIN_PASSWORD || defaultAdminPassword;
  let writeQueue = Promise.resolve();

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

  async function ensureAdminCredential() {
    let credential = await store.readAdminCredential();
    if (!credential) {
      const now = clock().toISOString();
      credential = createCredential(adminUser, adminPassword, now);
      await store.writeAdminCredential(credential);
    }
    return credential;
  }

  async function requireAdmin(sessionId) {
    if (!sessionId) throw new LikeGirlAuthError();
    const session = await store.getSession(sessionId);
    if (!session) throw new LikeGirlAuthError();
    return session;
  }

  function assertDailyMessageLimit(state, ip, now) {
    const settings = normalizeMessageSettings(state.messageSettings);
    const today = dayKey(now);
    const count = state.messages.filter((message) => (
      message.ip === ip && dayKey(message.createdAt) === today
    )).length;
    if (count >= settings.dailyLimitPerIp) {
      throw new LikeGirlRateLimitError();
    }
  }

  function collectionRows(state, collection) {
    const normalized = normalizeState(state);
    if (collection === 'articles') return listArticles(normalized);
    if (collection === 'photos') return bootstrap(normalized).photos;
    if (collection === 'messages') return normalized.messages.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (collection === 'about') return normalized.about;
    if (collection === 'checklist') return normalized.checklist;
    throw new LikeGirlValidationError(`不支持的集合：${collection}`);
  }

  return {
    dbFile: store.filePath,
    sessionCookieName,
    async bootstrap() {
      return bootstrap(await readState());
    },
    async adminState(sessionId) {
      const session = await requireAdmin(sessionId);
      const state = await readState();
      return {
        admin: { username: session.username },
        state,
      };
    },
    async profile() {
      return (await readState()).profile;
    },
    async updateProfile(sessionId, input) {
      await requireAdmin(sessionId);
      return mutate((state) => {
        state.profile = normalizeProfile({ ...state.profile, ...input });
        return clone(state.profile);
      });
    },
    async articles() {
      return listArticles(await readState());
    },
    async about() {
      return (await readState()).about;
    },
    async article(id) {
      return getArticle(await readState(), id);
    },
    async photos() {
      return bootstrap(await readState()).photos;
    },
    async messages(limit) {
      return publicMessages(await readState(), limit);
    },
    async checklist() {
      return (await readState()).checklist;
    },
    async messageSettings() {
      return (await readState()).messageSettings;
    },
    async createMessage(input, context = {}) {
      const ip = getClientIp(context);
      const now = clock().toISOString();
      return mutate((state) => {
        assertDailyMessageLimit(state, ip, now);
        return createMessage(state, input, {
          id: idFactory(),
          ip,
          now,
          settings: state.messageSettings,
        });
      });
    },
    async login(input) {
      const { username, password } = normalizeAdminInput(input);
      const credential = await ensureAdminCredential();
      if (username !== credential.username || !verifyPassword(password, credential.passwordHash)) {
        throw new LikeGirlAuthError('用户名或密码错误。');
      }
      const now = clock();
      const expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString();
      const session = {
        id: idFactory(),
        username,
        createdAt: now.toISOString(),
        expiresAt,
      };
      await store.pruneSessions();
      await store.writeSession(session);
      return {
        session,
        admin: publicAdminUser(credential),
      };
    },
    async logout(sessionId) {
      if (sessionId) await store.deleteSession(sessionId);
      return { ok: true };
    },
    async me(sessionId) {
      const session = await requireAdmin(sessionId);
      const credential = await ensureAdminCredential();
      return {
        session: {
          username: session.username,
          expiresAt: session.expiresAt,
        },
        admin: publicAdminUser(credential),
      };
    },
    async updateAdminCredential(sessionId, input) {
      await requireAdmin(sessionId);
      const { username, password } = normalizeAdminInput(input);
      const existing = await ensureAdminCredential();
      const now = clock().toISOString();
      const credential = {
        ...existing,
        username,
        passwordHash: hashPassword(password),
        updatedAt: now,
      };
      await store.writeAdminCredential(credential);
      await store.deleteSession(sessionId);
      return publicAdminUser(credential);
    },
    async adminCollection(sessionId, collection) {
      await requireAdmin(sessionId);
      return collectionRows(await readState(), collection);
    },
    async getAdminRecord(sessionId, collection, id) {
      await requireAdmin(sessionId);
      return getCollectionRecord(await readState(), collection, id);
    },
    async createAdminRecord(sessionId, collection, input) {
      await requireAdmin(sessionId);
      const id = input?.id || idFactory();
      return mutate((state) => replaceCollectionRecord(state, collection, {
        ...input,
        id,
      }, {
        id,
        now: clock().toISOString(),
      }));
    },
    async updateAdminRecord(sessionId, collection, id, input) {
      await requireAdmin(sessionId);
      return mutate((state) => patchCollectionRecord(state, collection, id, input, {
        now: clock().toISOString(),
      }));
    },
    async deleteAdminRecord(sessionId, collection, id) {
      await requireAdmin(sessionId);
      return mutate((state) => deleteCollectionRecord(state, collection, id));
    },
    async updateMessageSettings(sessionId, input) {
      await requireAdmin(sessionId);
      return mutate((state) => {
        state.messageSettings = normalizeMessageSettings({ ...state.messageSettings, ...input });
        return clone(state.messageSettings);
      });
    },
    async savePhotoUpload(sessionId, upload) {
      await requireAdmin(sessionId);
      const contentType = String(upload.contentType || '').split(';')[0].trim().toLowerCase();
      const extension = supportedImageTypes.get(contentType) || path.extname(String(upload.filename || '')).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(extension)) {
        throw new LikeGirlValidationError('只支持上传图片。');
      }
      const buffer = Buffer.isBuffer(upload.buffer) ? upload.buffer : Buffer.from(upload.buffer || '');
      if (!buffer.length) throw new LikeGirlValidationError('上传文件不能为空。');
      if (buffer.length > 5 * 1024 * 1024) throw new LikeGirlValidationError('上传文件不能超过 5 MB。');
      await fs.mkdir(uploadDir, { recursive: true });
      const safeExtension = extension === '.jpeg' ? '.jpg' : extension;
      const filename = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}${safeExtension}`;
      const filePath = path.join(uploadDir, filename);
      await fs.writeFile(filePath, buffer);
      return {
        filename,
        url: `/uploads/photos/${filename}`,
        contentType: contentType || 'application/octet-stream',
        size: buffer.length,
      };
    },
  };
}

module.exports = {
  LikeGirlRateLimitError,
  createLikeGirlService,
  hashPassword,
  sessionCookieName,
  verifyPassword,
};
