import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('manifest describes the LikeGirl source app', async () => {
  const manifest = JSON.parse(await readFile(path.join(appRoot, 'smallphone.app.json'), 'utf8'));

  assert.equal(manifest.type, 'source-app');
  assert.equal(manifest.id, 'like-girl');
  assert.equal(manifest.license, 'AGPL-3.0');
  assert.equal(manifest.source.repository, 'https://gitee.com/kiCode111/like-girl-v5.2.0');
  assert.equal(manifest.source.cloneUrl, 'https://gitee.com/kiCode111/like-girl-v5.2.0.git');
  assert.equal(manifest.source.vendored, false);
  assert.equal(manifest.runtime.defaultPort, 4102);
  assert.equal(manifest.runtime.packageManager, 'pnpm');
});

test('package scripts delegate to adapter scaffolding', async () => {
  const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.packageManager, 'pnpm@10.33.0');
  assert.equal(packageJson.engines.node, '>=20');
  assert.equal(packageJson.scripts.start, 'node scripts/start.mjs');
  assert.equal(packageJson.scripts.dev, 'node scripts/start.mjs');
  assert.equal(packageJson.scripts.check, 'node scripts/check.mjs');
  assert.equal(packageJson.scripts.test, 'node --test');
});
