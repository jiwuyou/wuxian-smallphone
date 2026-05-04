'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const manifest = require('../smallphone.app.json');
const packageJson = require('../package.json');
const {
  LikeGirlAuthError,
  LikeGirlForbiddenError,
  LikeGirlNotFoundError,
  LikeGirlValidationError,
} = require('./domain');
const { createLikeGirlService, sessionCookieName } = require('./service');
const { publicDir: defaultPublicDir, resolvePhotoUploadsDir } = require('./paths');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
]);

function jsonResponse(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

function parseJsonBody(body) {
  if (!String(body || '').trim()) return {};
  try {
    return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
  } catch (error) {
    const wrapped = new LikeGirlValidationError('请求体必须是有效的 JSON。');
    wrapped.cause = error;
    throw wrapped;
  }
}

function errorResponse(error) {
  const statusCode = error.statusCode || 500;
  return jsonResponse(statusCode, {
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: statusCode === 500 ? '服务器内部错误。' : error.message,
    },
  });
}

function headersObject(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) result[key.toLowerCase()] = value;
  return result;
}

function getHeader(headers, name) {
  return headersObject(headers)[name.toLowerCase()] || '';
}

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function sessionIdFromRequest(request) {
  const authorization = getHeader(request.headers, 'authorization');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer.trim();
  const explicit = getHeader(request.headers, 'x-like-girl-session');
  if (explicit) return explicit.trim();
  const cookies = parseCookies(getHeader(request.headers, 'cookie'));
  return cookies[sessionCookieName] || '';
}

function clientIpFromRequest(request) {
  const forwarded = getHeader(request.headers, 'x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.remoteAddress || request.socket?.remoteAddress || 'unknown';
}

function sessionCookie(session) {
  return `${sessionCookieName}=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(session.expiresAt).toUTCString()}`;
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function resolveSafeFile(urlPathname, rootDir, fallback = null) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  const requested = decoded === '/' && fallback ? fallback : decoded;
  if (requested.includes('\0')) return null;
  const resolved = path.resolve(rootDir, `.${requested}`);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function fileResponse(filePath, fallbackContentType = 'application/octet-stream') {
  const body = await fs.readFile(filePath);
  return {
    statusCode: 200,
    headers: {
      'content-type': mimeTypes.get(path.extname(filePath).toLowerCase()) || fallbackContentType,
      'cache-control': 'no-store',
    },
    body,
  };
}

async function uploadResponse(urlPathname, photoUploadsDir) {
  const relativePath = urlPathname.replace(/^\/uploads\/photos/, '') || '/';
  const filePath = resolveSafeFile(relativePath, photoUploadsDir);
  if (!filePath) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '未找到。' } });
  try {
    return await fileResponse(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '未找到。' } });
    }
    throw error;
  }
}

async function staticResponse(urlPathname, publicDir) {
  const pathname = urlPathname === '/admin' || urlPathname === '/admin/' ? '/admin.html' : urlPathname;
  let filePath = resolveSafeFile(pathname, publicDir, '/index.html');
  if (!filePath) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '未找到。' } });
  try {
    return await fileResponse(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
    filePath = path.join(publicDir, 'index.html');
    return fileResponse(filePath, 'text/html; charset=utf-8');
  }
}

function parseMultipartBody(body, contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new LikeGirlValidationError('Multipart boundary 缺失。');
  const boundary = `--${match[1] || match[2]}`;
  const raw = Buffer.isBuffer(body) ? body.toString('latin1') : Buffer.from(String(body), 'utf8').toString('latin1');
  const fields = {};
  const files = [];
  for (const part of raw.split(boundary)) {
    if (!part || part === '--\r\n' || part === '--') continue;
    const normalized = part.startsWith('\r\n') ? part.slice(2) : part;
    const headerEnd = normalized.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerLines = normalized.slice(0, headerEnd).split('\r\n');
    let content = normalized.slice(headerEnd + 4);
    if (content.endsWith('\r\n')) content = content.slice(0, -2);
    if (content.endsWith('--')) content = content.slice(0, -2);
    const headers = Object.fromEntries(headerLines.map((line) => {
      const index = line.indexOf(':');
      return index === -1 ? ['', ''] : [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
    }).filter(([key]) => key));
    const disposition = headers['content-disposition'] || '';
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;
    if (filename) {
      files.push({
        fieldName: name,
        filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: Buffer.from(content, 'latin1'),
      });
    } else {
      fields[name] = Buffer.from(content, 'latin1').toString('utf8');
    }
  }
  return { fields, files };
}

function parseUploadBody(request) {
  const contentType = getHeader(request.headers, 'content-type');
  if (/^multipart\/form-data/i.test(contentType)) return parseMultipartBody(request.body || Buffer.alloc(0), contentType);
  const input = parseJsonBody(request.body);
  if (!input.data) throw new LikeGirlValidationError('上传数据不能为空。');
  const base64 = String(input.data).replace(/^data:[^;]+;base64,/, '');
  return {
    fields: input,
    files: [{
      fieldName: 'file',
      filename: input.filename || 'upload',
      contentType: input.contentType || String(input.data).match(/^data:([^;]+);base64,/)?.[1] || 'application/octet-stream',
      buffer: Buffer.from(base64, 'base64'),
    }],
  };
}

function recordKey(collection) {
  if (collection === 'about') return 'about';
  if (collection === 'articles') return 'article';
  if (collection === 'photos') return 'photo';
  if (collection === 'checklist') return 'checklistItem';
  if (collection === 'messages') return 'message';
  return 'record';
}

async function adminCollectionResponse(service, sessionId, method, collection, id, body) {
  const key = recordKey(collection);
  if (!id) {
    if (method === 'GET') return jsonResponse(200, { [collection]: await service.adminCollection(sessionId, collection) });
    if (method === 'POST') return jsonResponse(201, { [key]: await service.createAdminRecord(sessionId, collection, parseJsonBody(body)) });
  }
  if (id && method === 'GET') return jsonResponse(200, { [key]: await service.getAdminRecord(sessionId, collection, decodeURIComponent(id)) });
  if (id && (method === 'PATCH' || method === 'PUT')) {
    return jsonResponse(200, { [key]: await service.updateAdminRecord(sessionId, collection, decodeURIComponent(id), parseJsonBody(body)) });
  }
  if (id && method === 'DELETE') {
    return jsonResponse(200, { [key]: await service.deleteAdminRecord(sessionId, collection, decodeURIComponent(id)) });
  }
  return null;
}

async function dispatchLikeGirlRequest(request, options = {}) {
  const service = options.service || createLikeGirlService(options);
  const publicDir = options.publicDir || defaultPublicDir;
  const photoUploadsDir = options.photoUploadsDir || resolvePhotoUploadsDir();
  const method = String(request.method || 'GET').toUpperCase();
  const url = new URL(request.url || '/', 'http://smallphone-like-girl.local');
  const pathname = url.pathname;
  const sessionId = sessionIdFromRequest(request);

  try {
    if (method === 'GET' && pathname === '/health') {
      return jsonResponse(200, {
        ok: true,
        app: manifest.id,
        version: packageJson.version,
        storage: {
          type: 'sqlite',
          file: service.dbFile,
        },
      });
    }
    if (method === 'GET' && pathname === '/manifest') return jsonResponse(200, manifest);
    if (method === 'GET' && pathname === '/api/bootstrap') return jsonResponse(200, await service.bootstrap());
    if (method === 'GET' && pathname === '/api/site') return jsonResponse(200, { profile: await service.profile() });
    if (method === 'GET' && pathname === '/api/about') return jsonResponse(200, { about: await service.about() });
    if (method === 'GET' && pathname === '/api/articles') return jsonResponse(200, { articles: await service.articles() });
    const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)$/);
    if (method === 'GET' && articleMatch) {
      return jsonResponse(200, { article: await service.article(decodeURIComponent(articleMatch[1])) });
    }
    if (method === 'GET' && pathname === '/api/photos') return jsonResponse(200, { photos: await service.photos() });
    if (pathname === '/api/messages') {
      if (method === 'GET') return jsonResponse(200, { messages: await service.messages(url.searchParams.get('limit')) });
      if (method === 'POST') {
        return jsonResponse(201, {
          message: await service.createMessage(parseJsonBody(request.body), { ip: clientIpFromRequest(request) }),
        });
      }
    }
    if (method === 'GET' && pathname === '/api/checklist') return jsonResponse(200, { checklist: await service.checklist() });

    if (pathname === '/api/admin/login' && method === 'POST') {
      const result = await service.login(parseJsonBody(request.body));
      return jsonResponse(200, result, { 'set-cookie': sessionCookie(result.session) });
    }
    if (pathname === '/api/admin/logout' && method === 'POST') {
      const result = await service.logout(sessionId);
      return jsonResponse(200, result, { 'set-cookie': clearSessionCookie() });
    }
    if (pathname === '/api/admin/session' && method === 'GET') return jsonResponse(200, await service.me(sessionId));
    if (pathname === '/api/admin/state' && method === 'GET') return jsonResponse(200, await service.adminState(sessionId));
    if (pathname === '/api/admin/site') {
      if (method === 'GET') return jsonResponse(200, { profile: (await service.adminState(sessionId)).state.profile });
      if (method === 'PUT' || method === 'PATCH') return jsonResponse(200, { profile: await service.updateProfile(sessionId, parseJsonBody(request.body)) });
    }
    if (pathname === '/api/admin/message-settings') {
      if (method === 'GET') return jsonResponse(200, { messageSettings: (await service.adminState(sessionId)).state.messageSettings });
      if (method === 'PUT' || method === 'PATCH') return jsonResponse(200, { messageSettings: await service.updateMessageSettings(sessionId, parseJsonBody(request.body)) });
    }
    if (pathname === '/api/admin/admin' && (method === 'PUT' || method === 'PATCH')) {
      return jsonResponse(200, { admin: await service.updateAdminCredential(sessionId, parseJsonBody(request.body)) }, { 'set-cookie': clearSessionCookie() });
    }
    if (pathname === '/api/admin/uploads/photos' && method === 'POST') {
      const uploadBody = parseUploadBody(request);
      const file = uploadBody.files.find((item) => item.fieldName === 'file') || uploadBody.files[0];
      const upload = await service.savePhotoUpload(sessionId, file || {});
      return jsonResponse(201, { upload });
    }
    const adminMatch = pathname.match(/^\/api\/admin\/(about|articles|photos|checklist|messages)(?:\/([^/]+))?$/);
    if (adminMatch) {
      const response = await adminCollectionResponse(service, sessionId, method, adminMatch[1], adminMatch[2], request.body);
      if (response) return response;
    }

    if (pathname.startsWith('/uploads/photos/')) {
      if (method === 'GET' || method === 'HEAD') return uploadResponse(pathname, photoUploadsDir);
    }
    if (method === 'GET' || method === 'HEAD') return staticResponse(pathname, publicDir);
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '未找到。' } });
  } catch (error) {
    if (
      error instanceof LikeGirlValidationError ||
      error instanceof LikeGirlNotFoundError ||
      error instanceof LikeGirlAuthError ||
      error instanceof LikeGirlForbiddenError ||
      error.statusCode
    ) {
      return errorResponse(error);
    }
    return errorResponse(error);
  }
}

async function readRequestBody(request, limitBytes = 6 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new LikeGirlValidationError('请求体过大。');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createLikeGirlRequestHandler(options = {}) {
  const service = options.service || createLikeGirlService(options);
  return async function handle(request, response) {
    try {
      const body = ['POST', 'PATCH', 'PUT'].includes(String(request.method).toUpperCase())
        ? await readRequestBody(request)
        : Buffer.alloc(0);
      const result = await dispatchLikeGirlRequest({
        method: request.method,
        url: request.url,
        headers: request.headers,
        remoteAddress: request.socket?.remoteAddress,
        body,
      }, {
        ...options,
        service,
      });
      response.statusCode = result.statusCode;
      for (const [key, value] of Object.entries(result.headers || {})) response.setHeader(key, value);
      if (request.method === 'HEAD') response.end();
      else response.end(result.body || '');
    } catch (error) {
      const result = errorResponse(error);
      response.statusCode = result.statusCode;
      for (const [key, value] of Object.entries(result.headers || {})) response.setHeader(key, value);
      response.end(result.body || '');
    }
  };
}

function createLikeGirlHttpServer(options = {}) {
  return http.createServer(createLikeGirlRequestHandler(options));
}

module.exports = {
  createLikeGirlHttpServer,
  dispatchLikeGirlRequest,
  jsonResponse,
  parseMultipartBody,
};
