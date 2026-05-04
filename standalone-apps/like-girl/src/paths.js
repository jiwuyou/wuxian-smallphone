'use strict';

const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const publicDir = path.join(appRoot, 'public');
const dataDir = path.join(appRoot, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const photoUploadsDir = path.join(uploadsDir, 'photos');
const defaultHost = '127.0.0.1';
const defaultPort = 4103;
const defaultDbFile = path.join(dataDir, 'like-girl.sqlite');
const defaultLegacyJsonFile = path.join(dataDir, 'like-girl.json');
const manifestPath = path.join(appRoot, 'smallphone.app.json');

function resolveDbFile(value = process.env.LIKE_GIRL_DB_FILE) {
  return value ? path.resolve(value) : defaultDbFile;
}

function resolvePhotoUploadsDir(value = process.env.LIKE_GIRL_PHOTO_UPLOADS_DIR) {
  return value ? path.resolve(value) : photoUploadsDir;
}

function resolvePort(value = process.env.PORT) {
  const port = Number.parseInt(String(value || defaultPort), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 无效：${value}`);
  }
  return port;
}

module.exports = {
  appRoot,
  dataDir,
  defaultDbFile,
  defaultHost,
  defaultLegacyJsonFile,
  defaultPort,
  manifestPath,
  photoUploadsDir,
  publicDir,
  resolveDbFile,
  resolvePhotoUploadsDir,
  resolvePort,
  uploadsDir,
};
