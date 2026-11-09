// Подключение агента в один щелчок (server/connect.ts): Claude Desktop — файл настроек (чужое сохраняется,
// копия рядом, испорченный не трогается), Claude Code и Codex — их командами (подставные программы)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createConnect } from '../../server/connect';
import { cliCalls, fakeCli } from '../fake-clients';

const CMD = { command: '/Applications/Slideria.app/Contents/MacOS/Slideria', args: ['--mcp'] };

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-connect-'));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const state = (c: ReturnType<typeof createConnect>, id: string) => c.state().find((s) => s.id === id)!;

test('Claude Desktop: не установлен — понятная ошибка; установлен — Slideria в его настройках, чужое на месте', async () => {
  const h = home();
  try {
    const c = createConnect({ home: h.dir, platform: 'darwin', env: {}, pathDirs: [] });
    expect(state(c, 'claude-desktop')).toEqual({ id: 'claude-desktop', installed: false, connected: false });
    await expect(c.connect('claude-desktop', CMD)).rejects.toThrow(/Claude Desktop не найден/);

    const dir = path.join(h.dir, 'Library', 'Application Support', 'Claude');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'claude_desktop_config.json');
    // Файла настроек ещё нет — создаётся
    expect(await c.connect('claude-desktop', CMD)).toEqual({ id: 'claude-desktop', installed: true, connected: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ mcpServers: { slideria: CMD } });
    expect(fs.existsSync(`${file}.bak`)).toBe(false);

    // Свои серверы и настройки пользователя остаются; прежний файл — копией рядом
    const before = JSON.stringify({ globalShortcut: 'Alt+Space', mcpServers: { files: { command: 'npx', args: ['fs'] }, slideria: { command: 'old', args: [] } } }, null, 2);
    fs.writeFileSync(file, before);
    await c.connect('claude-desktop', CMD);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ globalShortcut: 'Alt+Space', mcpServers: { files: { command: 'npx', args: ['fs'] }, slideria: CMD } });
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe(before);

    expect(await c.disconnect('claude-desktop')).toEqual({ id: 'claude-desktop', installed: true, connected: false });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ globalShortcut: 'Alt+Space', mcpServers: { files: { command: 'npx', args: ['fs'] } } });
  } finally { h.done(); }
});

test('Claude Desktop: испорченный файл настроек не перезаписывается', async () => {
  const h = home();
  try {
    const dir = path.join(h.dir, '.config', 'Claude');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'claude_desktop_config.json');
    fs.writeFileSync(file, '{ "mcpServers": { ');
    const c = createConnect({ home: h.dir, platform: 'linux', env: {}, pathDirs: [] });
    expect(state(c, 'claude-desktop')).toEqual({ id: 'claude-desktop', installed: true, connected: false });
    await expect(c.connect('claude-desktop', CMD)).rejects.toThrow(/не читаются/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ "mcpServers": { ');
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
  } finally { h.done(); }
});

test('Claude Desktop на Windows: обычная папка, личная копия пакета Microsoft Store и Claude-Data — во все, что есть', async () => {
  const h = home();
  try {
    const env = { APPDATA: path.join(h.dir, 'Roaming'), LOCALAPPDATA: path.join(h.dir, 'Local') };
    const plain = path.join(env.APPDATA, 'Claude');
    const store = path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
    const data = path.join(env.LOCALAPPDATA, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
    for (const d of [plain, store, data]) fs.mkdirSync(d, { recursive: true });
    const cfg = (d: string) => path.join(d, 'claude_desktop_config.json');
    const c = createConnect({ home: h.dir, platform: 'win32', env, pathDirs: [] });
    const cmd = { command: 'C:\\Users\\Анна\\AppData\\Local\\Programs\\Slideria\\Slideria.exe', args: ['--mcp'] };
    await c.connect('claude-desktop', cmd);
    for (const d of [plain, data]) expect(JSON.parse(fs.readFileSync(cfg(d), 'utf8')).mcpServers.slideria).toEqual(cmd);
    // Личной копии пакета не было — и не появилось: она заслонила бы обычный файл со всеми серверами
    expect(fs.existsSync(cfg(store))).toBe(false);

    // Есть — правится и она; Claude переписал один из файлов без Slideria — «не подключена», подключить заново
    fs.writeFileSync(cfg(store), JSON.stringify({ mcpServers: { files: { command: 'npx', args: [] } } }));
    expect(state(c, 'claude-desktop').connected).toBe(false);
    await c.connect('claude-desktop', cmd);
    expect(JSON.parse(fs.readFileSync(cfg(store), 'utf8')).mcpServers).toEqual({ files: { command: 'npx', args: [] }, slideria: cmd });
    expect(state(c, 'claude-desktop').connected).toBe(true);
    // Испорчен один — не трогается ни один
    fs.writeFileSync(cfg(data), '{');
    const before = fs.readFileSync(cfg(plain), 'utf8');
    await expect(c.disconnect('claude-desktop')).rejects.toThrow(/не читаются/);
    expect(fs.readFileSync(cfg(plain), 'utf8')).toBe(before);
  } finally { h.done(); }
});

test('Claude Code и Codex: их командой mcp add (заново, если уже был), отключение — mcp remove', async () => {
  const h = home();
  try {
    const c = createConnect({ home: h.dir, pathDirs: [] });
    expect(state(c, 'claude-code')).toEqual({ id: 'claude-code', installed: false, connected: false });
    await expect(c.connect('claude-code', CMD)).rejects.toThrow(/Claude Code не найден/);

    fakeCli(h.dir, 'claude');
    fakeCli(h.dir, 'codex');
    expect(state(c, 'claude-code')).toEqual({ id: 'claude-code', installed: true, connected: false });
    expect(await c.connect('claude-code', CMD)).toEqual({ id: 'claude-code', installed: true, connected: true });
    // Ещё раз — прежний убирается и ставится заново (программу могли переставить в другое место)
    await c.connect('claude-code', CMD);
    expect(cliCalls(h.dir, 'claude')).toEqual([
      ['mcp', 'remove', '--scope', 'user', 'slideria'],
      ['mcp', 'add', '--scope', 'user', 'slideria', '--', CMD.command, ...CMD.args],
      ['mcp', 'remove', '--scope', 'user', 'slideria'],
      ['mcp', 'add', '--scope', 'user', 'slideria', '--', CMD.command, ...CMD.args],
    ]);
    expect(await c.disconnect('claude-code')).toEqual({ id: 'claude-code', installed: true, connected: false });

    expect(await c.connect('codex', CMD)).toEqual({ id: 'codex', installed: true, connected: true });
    expect(fs.readFileSync(path.join(h.dir, '.codex', 'config.toml'), 'utf8')).toContain('[mcp_servers.slideria]');
    expect(cliCalls(h.dir, 'codex').at(-1)).toEqual(['mcp', 'add', 'slideria', '--', CMD.command, ...CMD.args]);
    expect(await c.disconnect('codex')).toEqual({ id: 'codex', installed: true, connected: false });
    // Отключить уже отключённый — ошибка программы понятным текстом
    await expect(c.disconnect('codex')).rejects.toThrow(/No MCP server found/);
  } finally { h.done(); }
});

test('чужой клиент и место без команды запуска — отказ', async () => {
  const c = createConnect({ home: os.tmpdir(), pathDirs: [] });
  await expect(c.connect('cursor', CMD)).rejects.toThrow('Нет такого клиента');
  await expect(c.connect('claude-code', null)).rejects.toThrow(/недоступно/);
});
