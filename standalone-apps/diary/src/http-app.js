'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const packageJson = require('../package.json');
const manifest = require('../smallphone.app.json');
const { DiaryNotFoundError, DiaryValidationError } = require('./domain');
const { createDiaryService } = require('./service');
const { publicDir: defaultPublicDir } = require('./paths');

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
]);

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

function emptyResponse(statusCode) {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
    },
    body: '',
  };
}

function parseJsonBody(body) {
  if (!body || !String(body).trim()) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    const wrapped = new DiaryValidationError('Request body must be valid JSON.');
    wrapped.cause = error;
    throw wrapped;
  }
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    const wrapped = new DiaryValidationError('URL path contains invalid encoding.');
    wrapped.cause = error;
    throw wrapped;
  }
}

function errorResponse(error) {
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? 'Internal server error.' : error.message;
  return jsonResponse(statusCode, {
    error: {
      code: error.code || error.name || 'INTERNAL_ERROR',
      message,
    },
  });
}

function resolvePublicFile(urlPathname, publicDir) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }

  const requestedPath = decoded === '/' ? '/index.html' : decoded;
  if (requestedPath.includes('\0')) return null;

  const resolved = path.resolve(publicDir, `.${requestedPath}`);
  const relative = path.relative(publicDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function staticResponse(urlPathname, publicDir) {
  const filePath = resolvePublicFile(urlPathname, publicDir);
  if (!filePath) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });

  let body;
  try {
    body = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
    throw error;
  }

  const contentType = mimeTypes.get(path.extname(filePath)) || 'application/octet-stream';
  return {
    statusCode: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
    },
    body,
  };
}

async function dispatchDiaryRequest(request, options = {}) {
  const service = options.service || createDiaryService(options);
  const publicDir = options.publicDir || defaultPublicDir;
  const method = String(request.method || 'GET').toUpperCase();
  const url = new URL(request.url || '/', 'http://smallphone-diary.local');
  const pathname = url.pathname;

  try {
    if (method === 'GET' && pathname === '/health') {
      return jsonResponse(200, {
        ok: true,
        app: manifest.id,
        name: manifest.name,
        version: packageJson.version,
        storage: {
          type: 'sqlite',
          file: service.dbFile || service.dataFile,
        },
      });
    }

    if (method === 'GET' && pathname === '/manifest') {
      return jsonResponse(200, manifest);
    }

    if (pathname === '/api/entries') {
      if (method === 'GET') {
        return jsonResponse(200, {
          entries: await service.listEntries(),
        });
      }

      if (method === 'POST') {
        const entry = await service.createEntry(parseJsonBody(request.body));
        return jsonResponse(201, { entry });
      }
    }

    const entryMatch = pathname.match(/^\/api\/entries\/([^/]+)$/);
    if (entryMatch) {
      const id = decodePathSegment(entryMatch[1]);

      if (method === 'PATCH') {
        const entry = await service.updateEntry(id, parseJsonBody(request.body));
        return jsonResponse(200, { entry });
      }

      if (method === 'DELETE') {
        await service.deleteEntry(id);
        return emptyResponse(204);
      }
    }

    if (method === 'GET' || method === 'HEAD') {
      return staticResponse(pathname, publicDir);
    }

    return jsonResponse(404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Not found.',
      },
    });
  } catch (error) {
    if (error instanceof DiaryValidationError || error instanceof DiaryNotFoundError || error.statusCode) {
      return errorResponse(error);
    }
    return errorResponse(error);
  }
}

async function readRequestBody(request, limitBytes = 1048576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new DiaryValidationError('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeResponse(request, response, result) {
  response.statusCode = result.statusCode;
  for (const [key, value] of Object.entries(result.headers || {})) {
    response.setHeader(key, value);
  }

  if (request.method === 'HEAD' || result.statusCode === 204) {
    response.end();
    return;
  }

  response.end(result.body || '');
}

function createDiaryRequestHandler(options = {}) {
  const service = options.service || createDiaryService(options);
  const handlerOptions = {
    ...options,
    service,
  };

  return async function handleDiaryRequest(request, response) {
    try {
      const body = await readRequestBody(request);
      const result = await dispatchDiaryRequest({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      }, handlerOptions);
      writeResponse(request, response, result);
    } catch (error) {
      writeResponse(request, response, errorResponse(error));
    }
  };
}

function createDiaryHttpServer(options = {}) {
  return http.createServer(createDiaryRequestHandler(options));
}

module.exports = {
  createDiaryHttpServer,
  createDiaryRequestHandler,
  dispatchDiaryRequest,
};
