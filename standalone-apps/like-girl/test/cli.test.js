'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { main, parseArgs } = require('../src/cli');

function capture() {
  return {
    chunks: [],
    write(chunk) { this.chunks.push(String(chunk)); },
    text() { return this.chunks.join(''); },
  };
}

test('parses package-manager separator', () => {
  assert.deepEqual(parseArgs(['--', 'messages', '--json']), {
    command: 'messages',
    flags: { json: true },
    positionals: [],
  });
});

test('CLI writes messages to SQLite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-like-girl-cli-'));
  const dbFile = path.join(dir, 'like-girl.sqlite');
  const output = capture();
  const code = await main([
    'add-message',
    '--db-file',
    dbFile,
    '--name',
    'CLI',
    '--text',
    'Stored through CLI.',
    '--json',
  ], output, capture());
  assert.equal(code, 0);
  const message = JSON.parse(output.text()).message;
  assert.equal(message.name, 'CLI');
  const listOutput = capture();
  assert.equal(await main(['messages', '--db-file', dbFile, '--json'], listOutput, capture()), 0);
  assert.equal(JSON.parse(listOutput.text()).messages.some((item) => item.id === message.id), true);
});
