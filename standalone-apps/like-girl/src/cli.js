#!/usr/bin/env node
'use strict';

const { createLikeGirlService } = require('./service');
const { resolveDbFile } = require('./paths');

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
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
    if (!command) command = token;
    else positionals.push(token);
  }
  return { command: command || 'help', flags, positionals };
}

function helpText() {
  return `LikeGirl 命令行工具

用法：
  smallphone-like-girl bootstrap [--json] [--db-file <path>]
  smallphone-like-girl messages [--json] [--db-file <path>]
  smallphone-like-girl add-message --name <name> --text <text> [--qq <qq>] [--json] [--db-file <path>]

`;
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  const parsed = parseArgs(argv);
  const service = createLikeGirlService({
    dbFile: resolveDbFile(parsed.flags['db-file']),
  });
  try {
    if (parsed.command === 'help' || parsed.flags.help) {
      output.write(helpText());
      return 0;
    }
    if (parsed.command === 'bootstrap') {
      const data = await service.bootstrap();
      if (parsed.flags.json) writeJson(output, data);
      else output.write(`${data.profile.title}: ${data.profile.writing}\n`);
      return 0;
    }
    if (parsed.command === 'messages') {
      const messages = await service.messages();
      if (parsed.flags.json) writeJson(output, { messages });
      else output.write(messages.map((item) => `- ${item.name}: ${item.text}`).join('\n') + '\n');
      return 0;
    }
    if (parsed.command === 'add-message') {
      const message = await service.createMessage({
        name: parsed.flags.name,
        qq: parsed.flags.qq,
        text: parsed.flags.text,
      });
      if (parsed.flags.json) writeJson(output, { message });
      else output.write(`已创建留言 ${message.id}\n`);
      return 0;
    }
    errorOutput.write(`未知命令：${parsed.command}\n\n${helpText()}`);
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
  main,
  parseArgs,
};
