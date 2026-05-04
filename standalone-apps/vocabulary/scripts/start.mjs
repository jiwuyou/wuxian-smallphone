#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || '4102';
const phpBin = process.env.PHP_BIN || 'php';

const sourceDir = await resolveSourceDir();
const documentRoot = await resolveDocumentRoot(sourceDir);

const args = ['-S', `${host}:${port}`, '-t', documentRoot];
console.log(`Starting LikeGirl from ${sourceDir}`);
console.log(`${phpBin} ${args.join(' ')}`);

const child = spawn(phpBin, args, {
  cwd: sourceDir,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error(`Unable to start ${phpBin}. Install PHP CLI or set PHP_BIN.`);
    process.exit(1);
  }
  throw error;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

async function resolveSourceDir() {
  const candidates = [
    process.env.LIKE_GIRL_SOURCE_DIR,
    path.join(appRoot, 'source'),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));

  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, 'index.php'))) {
      return candidate;
    }
  }

  console.error([
    'LikeGirl source is not linked.',
    '',
    'Clone it into this adapter:',
    '  git clone https://gitee.com/kiCode111/like-girl-v5.2.0.git source',
    '',
    'Or link an existing checkout:',
    '  pnpm link-source /path/to/like-girl-v5.2.0',
    '',
    'Or set LIKE_GIRL_SOURCE_DIR=/path/to/like-girl-v5.2.0.',
  ].join('\n'));
  process.exit(1);
}

async function resolveDocumentRoot(sourceDir) {
  const candidates = [
    sourceDir,
    path.join(sourceDir, 'public'),
  ];

  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, 'index.php'))) {
      return candidate;
    }
  }

  console.error(`No PHP document root with index.php was found under ${sourceDir}.`);
  process.exit(1);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
