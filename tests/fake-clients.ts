/**
 * Подставные Claude Code и Codex для тестов подключения в один щелчок (server/connect.ts): программа в
 * <home>/.local/bin пишет свои аргументы в <home>/<имя>.log и ведёт список серверов MCP там же, где настоящая
 * (~/.claude.json, ~/.codex/config.toml); remove неизвестного сервера — ошибка, как у настоящей
 */
import fs from 'node:fs';
import path from 'node:path';

export function fakeCli(home: string, name: 'claude' | 'codex'): string {
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // Внутри папки проекта ("type": "module") Node иначе прочёл бы сценарий как модуль ES
  fs.writeFileSync(path.join(bin, 'package.json'), '{ "type": "commonjs" }\n');
  const file = path.join(bin, name);
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const home = process.env.HOME, a = process.argv.slice(2);
fs.appendFileSync(path.join(home, ${JSON.stringify(`${name}.log`)}), JSON.stringify(a) + '\\n');
const codex = ${name === 'codex'};
const f = codex ? path.join(home, '.codex', 'config.toml') : path.join(home, '.claude.json');
let list = {};
try {
  const text = fs.readFileSync(f, 'utf8');
  if (codex) for (const m of text.matchAll(/^\\[mcp_servers\\.(\\w+)\\]\\ncommand = (.*)\\nargs = (.*)$/gm)) list[m[1]] = { command: JSON.parse(m[2]), args: JSON.parse(m[3]) };
  else list = JSON.parse(text).mcpServers || {};
} catch {}
if (a[0] !== 'mcp') { console.error('unknown command'); process.exit(2); }
if (a[1] === 'add') {
  const i = a.indexOf('--');
  list[a[i - 1]] = { command: a[i + 1], args: a.slice(i + 2) };
} else if (a[1] === 'remove') {
  const n = a[a.length - 1];
  if (!list[n]) { console.error('No MCP server found with name: ' + n); process.exit(1); }
  delete list[n];
}
fs.mkdirSync(path.dirname(f), { recursive: true });
fs.writeFileSync(f, codex
  ? Object.entries(list).map(([k, v]) => '[mcp_servers.' + k + ']\\ncommand = ' + JSON.stringify(v.command) + '\\nargs = ' + JSON.stringify(v.args) + '\\n').join('\\n')
  : JSON.stringify({ mcpServers: list }));
`, { mode: 0o755 });
  return file;
}

/** Аргументы всех запусков подставной программы */
export const cliCalls = (home: string, name: 'claude' | 'codex'): string[][] => {
  try { return fs.readFileSync(path.join(home, `${name}.log`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]); } catch { return []; }
};
