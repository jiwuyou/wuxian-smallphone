import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BACKEND_STORAGE_KEY,
  normalizeCoreBackendBase,
  resolveBackendBase,
} from '../apps/workflows/api.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const blockedCcConnectPorts = ['21010', '21020', '21030', '21040'];

function createLocalStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const removed = [];
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      removed.push(key);
      data.delete(key);
    },
    removed,
  };
}

function withWindow({ location, localStorage }, callback) {
  const previousWindow = globalThis.window;
  globalThis.window = { location, localStorage };
  try {
    return callback();
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

test('core backend base strips browser-side credentials, query tokens, and hashes', () => {
  assert.equal(
    normalizeCoreBackendBase('http://user:secret@phone.test:22000/smallphone?token=secret#frag'),
    'http://phone.test:22000/api',
  );
  assert.equal(
    normalizeCoreBackendBase('phone.test:22000'),
    'http://phone.test:22000/api',
  );

  withWindow({
    location: {
      protocol: 'https:',
      hostname: 'phone.test',
      origin: 'https://phone.test:22080',
    },
    localStorage: createLocalStorage(),
  }, () => {
    assert.equal(
      normalizeCoreBackendBase('/api?token=secret'),
      'https://phone.test:22080/api',
    );
  });
});

test('core backend base rejects cc-connect and non-http endpoints', () => {
  for (const port of blockedCcConnectPorts) {
    assert.equal(normalizeCoreBackendBase(`http://phone.test:${port}/api?token=secret`), '');
  }
  assert.equal(normalizeCoreBackendBase('ws://phone.test:22000/api'), '');
  assert.equal(normalizeCoreBackendBase('wss://phone.test:22000/api'), '');
});

test('resolveBackendBase falls back to smallphone-core when storage points at cc-connect', () => {
  const localStorage = createLocalStorage({
    [BACKEND_STORAGE_KEY]: 'http://phone.test:21030/api?token=secret',
  });

  const resolved = withWindow({
    location: {
      protocol: 'http:',
      hostname: 'phone.test',
      origin: 'http://phone.test:22080',
    },
    localStorage,
  }, () => resolveBackendBase());

  assert.equal(resolved, 'http://phone.test:22000/api');
  assert.deepEqual(localStorage.removed, [BACKEND_STORAGE_KEY]);
});

test('resolveBackendBase follows the page protocol for same-host fallback', () => {
  const resolved = withWindow({
    location: {
      protocol: 'https:',
      hostname: 'phone.test',
      origin: 'https://phone.test:22082',
    },
    localStorage: createLocalStorage(),
  }, () => resolveBackendBase());

  assert.equal(resolved, 'https://phone.test:22000/api');
});

test('frontend runtime files do not reference cc-connect ports directly', () => {
  const runtimeFiles = [
    '../scripts/main.js',
    '../apps/workflows/index.js',
    '../apps/sillytavern/index.js',
  ];
  const blockedPortPattern = new RegExp(blockedCcConnectPorts.join('|'));

  for (const file of runtimeFiles) {
    const source = readFileSync(resolve(currentDir, file), 'utf8');
    assert.doesNotMatch(source, blockedPortPattern, file);
  }
});
