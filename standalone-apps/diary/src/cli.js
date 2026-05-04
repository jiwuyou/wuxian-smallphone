#!/usr/bin/env node
'use strict';

const { createDiaryService } = require('./service');
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
  return `SmallPhone Diary CLI

Usage:
  smallphone-diary list [--json] [--db-file <path>]
  smallphone-diary add --title <title> --text <text> [--json] [--db-file <path>]
  smallphone-diary update <id> [--title <title>] [--text <text>] [--json] [--db-file <path>]
  smallphone-diary delete <id> [--json] [--db-file <path>]

  --data-file is accepted as a legacy alias for --db-file.

`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function formatEntries(entries) {
  if (!entries.length) return 'No diary entries.\n';
  return entries.map((entry) => {
    const text = entry.text.replace(/\s+/g, ' ').trim();
    return [
      `- ${entry.id}`,
      `  title: ${entry.title}`,
      `  updated: ${formatDate(entry.updatedAt)}`,
      `  text: ${text}`,
    ].join('\n');
  }).join('\n\n') + '\n';
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  const parsed = parseArgs(argv);
  const service = createDiaryService({
    dbFile: resolveDbFile(parsed.flags['db-file'] || parsed.flags['data-file']),
  });

  try {
    if (parsed.flags.help || parsed.command === 'help') {
      output.write(helpText());
      return 0;
    }

    if (parsed.command === 'list') {
      const entries = await service.listEntries();
      if (parsed.flags.json) {
        writeJson(output, { entries });
      } else {
        output.write(formatEntries(entries));
      }
      return 0;
    }

    if (parsed.command === 'add') {
      const entry = await service.createEntry({
        title: parsed.flags.title,
        text: parsed.flags.text,
      });
      if (parsed.flags.json) {
        writeJson(output, { entry });
      } else {
        output.write(`Created diary entry ${entry.id}\n`);
      }
      return 0;
    }

    if (parsed.command === 'update') {
      const [id] = parsed.positionals;
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(parsed.flags, 'title')) payload.title = parsed.flags.title;
      if (Object.prototype.hasOwnProperty.call(parsed.flags, 'text')) payload.text = parsed.flags.text;

      const entry = await service.updateEntry(id, payload);
      if (parsed.flags.json) {
        writeJson(output, { entry });
      } else {
        output.write(`Updated diary entry ${entry.id}\n`);
      }
      return 0;
    }

    if (parsed.command === 'delete') {
      const [id] = parsed.positionals;
      const entry = await service.deleteEntry(id);
      if (parsed.flags.json) {
        writeJson(output, { deleted: entry });
      } else {
        output.write(`Deleted diary entry ${entry.id}\n`);
      }
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
  formatEntries,
  main,
  parseArgs,
};
