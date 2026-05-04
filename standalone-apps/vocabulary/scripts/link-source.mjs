#!/usr/bin/env node
import { access, lstat, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetArg = process.argv[2];

if (!targetArg) {
  console.error('Usage: pnpm link-source /path/to/like-girl-v5.2.0');
  process.exit(1);
}

const targetDir = path.resolve(process.cwd(), targetArg);
const linkPath = path.join(appRoot, 'source');

try {
  await access(path.join(targetDir, 'index.php'));
} catch {
  console.error(`Expected LikeGirl source with index.php at: ${targetDir}`);
  process.exit(1);
}

try {
  const existing = await lstat(linkPath);
  if (!existing.isSymbolicLink()) {
    console.error(`Refusing to replace non-symlink path: ${linkPath}`);
    process.exit(1);
  }
  await unlink(linkPath);
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

await symlink(targetDir, linkPath, 'dir');
console.log(`Linked ${linkPath} -> ${targetDir}`);
