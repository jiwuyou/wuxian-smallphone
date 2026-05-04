'use strict';

const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const defaultPort = 4101;
const defaultHost = '127.0.0.1';
const defaultDbFile = path.join(appRoot, 'data', 'diary.sqlite');
const manifestPath = path.join(appRoot, 'smallphone.app.json');
const publicDir = path.join(appRoot, 'public');

function resolveDbFile(value = process.env.DIARY_DB_FILE) {
  if (!value) return defaultDbFile;
  return path.resolve(process.cwd(), String(value));
}

function resolveDataFile(value = process.env.DIARY_DB_FILE) {
  return resolveDbFile(value);
}

function resolvePort(value = process.env.PORT) {
  if (!value) return defaultPort;
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535. Received: ${value}`);
  }
  return port;
}

module.exports = {
  appRoot,
  defaultDataFile: defaultDbFile,
  defaultDbFile,
  defaultHost,
  defaultPort,
  manifestPath,
  publicDir,
  resolveDataFile,
  resolveDbFile,
  resolvePort,
};
