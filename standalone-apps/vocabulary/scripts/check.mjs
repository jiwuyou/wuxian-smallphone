#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(await readFile(path.join(appRoot, 'smallphone.app.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));

assert.equal(manifest.type, 'source-app');
assert.equal(manifest.id, 'like-girl');
assert.equal(manifest.source.cloneUrl, 'https://gitee.com/kiCode111/like-girl-v5.2.0.git');
assert.equal(manifest.runtime.defaultPort, 23002);
assert.equal(packageJson.scripts.start, 'node scripts/start.mjs');
assert.equal(packageJson.scripts['link-source'], 'node scripts/link-source.mjs');

const sourceDir = process.env.LIKE_GIRL_SOURCE_DIR
  ? path.resolve(process.env.LIKE_GIRL_SOURCE_DIR)
  : path.join(appRoot, 'source');

let sourceStatus = 'not linked';
try {
  await access(path.join(sourceDir, 'index.php'));
  sourceStatus = `linked at ${sourceDir}`;
} catch {
  sourceStatus = `not linked; expected ${sourceDir} or LIKE_GIRL_SOURCE_DIR`;
}

console.log('adapter manifest ok');
console.log(`upstream source: ${sourceStatus}`);
