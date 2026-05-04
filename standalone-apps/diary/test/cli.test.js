'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { main, parseArgs } = require('../src/cli');

function captureStream() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    text() {
      return this.chunks.join('');
    },
  };
}

test('parses flags before and after commands', () => {
  assert.deepEqual(parseArgs(['--db-file', '/tmp/diary.sqlite', 'list', '--json']), {
    command: 'list',
    flags: {
      'db-file': '/tmp/diary.sqlite',
      json: true,
    },
    positionals: [],
  });
});

test('ignores package-manager argument separator', () => {
  assert.deepEqual(parseArgs(['--', 'list', '--json']), {
    command: 'list',
    flags: {
      json: true,
    },
    positionals: [],
  });
});

test('CLI add and list share the SQLite store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-diary-cli-'));
  const dbFile = path.join(dir, 'diary.sqlite');

  const addOutput = captureStream();
  const addError = captureStream();
  const addCode = await main([
    '--db-file',
    dbFile,
    'add',
    '--title',
    'CLI note',
    '--text',
    'Created from the CLI.',
    '--json',
  ], addOutput, addError);

  assert.equal(addCode, 0);
  assert.equal(addError.text(), '');
  const created = JSON.parse(addOutput.text()).entry;
  assert.equal(created.title, 'CLI note');

  const listOutput = captureStream();
  const listCode = await main([
    '--db-file',
    dbFile,
    'list',
    '--json',
  ], listOutput, captureStream());

  assert.equal(listCode, 0);
  const listed = JSON.parse(listOutput.text()).entries;
  assert.equal(listed.some((entry) => entry.id === created.id), true);
});
