#!/usr/bin/env node
'use strict';

const { createAlbumService } = require('./service');
const { resolveDbFile } = require('./paths');

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--') {
      continue;
    }

    if (token.startsWith('--')) {
      const raw = token.slice(2);
      const equalsIndex = raw.indexOf('=');
      if (equalsIndex !== -1) {
        flags[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1);
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        flags[raw] = next;
        index += 1;
      } else {
        flags[raw] = true;
      }
      continue;
    }

    if (!command) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  return {
    command: command || 'help',
    flags,
    positionals,
  };
}

function helpText() {
  return `SmallPhone Album CLI

Usage:
  smallphone-album list-albums [--json] [--db-file <path>]
  smallphone-album add-album --title <title> [--description <text>] [--json] [--db-file <path>]
  smallphone-album update-album <id> [--title <title>] [--description <text>] [--json] [--db-file <path>]
  smallphone-album delete-album <id> [--json] [--db-file <path>]
  smallphone-album list-photos [--album-id <id>] [--json] [--db-file <path>]
  smallphone-album add-photo --title <title> --album-id <id> --image-url <url> --taken-at <date> [--caption <text>] [--json] [--db-file <path>]
  smallphone-album update-photo <id> [--title <title>] [--album-id <id>] [--image-url <url>] [--caption <text>] [--taken-at <date>] [--json] [--db-file <path>]
  smallphone-album delete-photo <id> [--json] [--db-file <path>]

  --data-file is accepted as a legacy alias for --db-file.

`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function formatAlbums(albums) {
  if (!albums.length) return 'No albums.\n';
  return albums.map((album) => [
    `- ${album.id}`,
    `  title: ${album.title}`,
    `  updated: ${formatDate(album.updatedAt)}`,
    `  description: ${album.description || ''}`,
  ].join('\n')).join('\n\n') + '\n';
}

function formatPhotos(photos) {
  if (!photos.length) return 'No photos.\n';
  return photos.map((photo) => [
    `- ${photo.id}`,
    `  title: ${photo.title}`,
    `  album: ${photo.albumId}`,
    `  imageUrl: ${photo.imageUrl}`,
    `  taken: ${formatDate(photo.takenAt)}`,
    `  caption: ${photo.caption || ''}`,
  ].join('\n')).join('\n\n') + '\n';
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function pickFields(flags, names) {
  const payload = {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      const camelName = name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      payload[camelName] = flags[name];
    }
  }
  return payload;
}

async function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  const parsed = parseArgs(argv);
  const service = createAlbumService({
    dbFile: resolveDbFile(parsed.flags['db-file'] || parsed.flags['data-file']),
  });

  try {
    if (parsed.flags.help || parsed.command === 'help') {
      output.write(helpText());
      return 0;
    }

    if (parsed.command === 'list-albums') {
      const albums = await service.listAlbums();
      if (parsed.flags.json) writeJson(output, { albums });
      else output.write(formatAlbums(albums));
      return 0;
    }

    if (parsed.command === 'add-album') {
      const album = await service.createAlbum({
        title: parsed.flags.title,
        description: parsed.flags.description,
      });
      if (parsed.flags.json) writeJson(output, { album });
      else output.write(`Created album ${album.id}\n`);
      return 0;
    }

    if (parsed.command === 'update-album') {
      const [id] = parsed.positionals;
      const album = await service.updateAlbum(id, pickFields(parsed.flags, ['title', 'description']));
      if (parsed.flags.json) writeJson(output, { album });
      else output.write(`Updated album ${album.id}\n`);
      return 0;
    }

    if (parsed.command === 'delete-album') {
      const [id] = parsed.positionals;
      const deleted = await service.deleteAlbum(id);
      if (parsed.flags.json) writeJson(output, { deleted });
      else output.write(`Deleted album ${deleted.album.id}\n`);
      return 0;
    }

    if (parsed.command === 'list-photos') {
      const photos = await service.listPhotos({ albumId: parsed.flags['album-id'] });
      if (parsed.flags.json) writeJson(output, { photos });
      else output.write(formatPhotos(photos));
      return 0;
    }

    if (parsed.command === 'add-photo') {
      const photo = await service.createPhoto({
        title: parsed.flags.title,
        albumId: parsed.flags['album-id'],
        imageUrl: parsed.flags['image-url'],
        caption: parsed.flags.caption,
        takenAt: parsed.flags['taken-at'],
      });
      if (parsed.flags.json) writeJson(output, { photo });
      else output.write(`Created photo ${photo.id}\n`);
      return 0;
    }

    if (parsed.command === 'update-photo') {
      const [id] = parsed.positionals;
      const photo = await service.updatePhoto(id, pickFields(parsed.flags, [
        'title',
        'album-id',
        'image-url',
        'caption',
        'taken-at',
      ]));
      if (parsed.flags.json) writeJson(output, { photo });
      else output.write(`Updated photo ${photo.id}\n`);
      return 0;
    }

    if (parsed.command === 'delete-photo') {
      const [id] = parsed.positionals;
      const photo = await service.deletePhoto(id);
      if (parsed.flags.json) writeJson(output, { deleted: photo });
      else output.write(`Deleted photo ${photo.id}\n`);
      return 0;
    }

    errorOutput.write(`Unknown command: ${parsed.command}\n\n${helpText()}`);
    return 1;
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  formatAlbums,
  formatPhotos,
  main,
  parseArgs,
};
