// Подключение агента в один щелчок (server/connect.ts): Claude Desktop — файл настроек (чужое сохраняется,
// копия рядом, испорченный не трогается), Claude Code — его командой (подставная программа), ChatGPT · Codex —
// его файл ~/.codex/config.toml (чужое на месте, копия рядом)
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

test('Claude Code: его командой mcp add (заново, если уже был), отключение — mcp remove', async () => {
  const h = home();
  try {
    const c = createConnect({ home: h.dir, pathDirs: [] });
    expect(state(c, 'claude-code')).toEqual({ id: 'claude-code', installed: false, connected: false });
    await expect(c.connect('claude-code', CMD)).rejects.toThrow(/Claude Code не найден/);

    fakeCli(h.dir, 'claude');
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
  } finally { h.done(); }
});

test('ChatGPT · Codex: Slideria — в ~/.codex/config.toml без программы codex; чужие серверы и настройки на месте', async () => {
  const h = home();
  try {
    const c = createConnect({ home: h.dir, platform: 'linux', env: {}, pathDirs: [] });
    // Нет ни ChatGPT, ни ~/.codex, ни программы codex
    expect(state(c, 'codex')).toEqual({ id: 'codex', installed: false, connected: false });
    // Codex открывали (ChatGPT, терминал или редактор) — есть его папка
    const file = path.join(h.dir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    expect(state(c, 'codex')).toEqual({ id: 'codex', installed: true, connected: false });
    // Файла ещё нет — создаётся
    expect(await c.connect('codex', CMD)).toEqual({ id: 'codex', installed: true, connected: true });
    expect(fs.readFileSync(file, 'utf8')).toBe(`[mcp_servers.slideria]\ncommand = '${CMD.command}'\nargs = ['--mcp']\n`);

    // Свои настройки и серверы пользователя, прежняя Slideria с подтаблицей и строки Windows — прежняя заменяется, остальное на месте
    const mine = ['model = "gpt-5"', '', '[mcp_servers.docs]', 'command = "npx"', 'args = ["-y", "docs-mcp"]', '', '[mcp_servers.slideria]', 'command = "/old/Slideria"', 'args = ["--mcp"]', '', '[mcp_servers.slideria.env]', 'A = "1"', '', '[profiles.fast]', 'model = "gpt-5-mini"'].join('\r\n');
    fs.writeFileSync(file, mine);
    const win = { command: "C:\\Users\\Анна\\AppData\\Local\\Programs\\Slideria\\Slideria.exe", args: ['--mcp', "O'Brien"] };
    await c.connect('codex', win);
    expect(fs.readFileSync(file, 'utf8')).toBe([
      'model = "gpt-5"', '', '[mcp_servers.docs]', 'command = "npx"', 'args = ["-y", "docs-mcp"]', '', '[profiles.fast]', 'model = "gpt-5-mini"', '',
      // Путь Windows — буквальной строкой (обратные косые как есть), с апострофом — обычной
      "[mcp_servers.slideria]", "command = 'C:\\Users\\Анна\\AppData\\Local\\Programs\\Slideria\\Slideria.exe'", `args = ['--mcp', "O'Brien"]`, '',
    ].join('\n'));
    // Прежний файл — копией рядом
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe(mine);

    // Slideria строкой в [mcp_servers] — тоже прежняя (иначе ключ задан дважды и Codex не прочтёт файл)
    fs.writeFileSync(file, '[mcp_servers]\nslideria = { command = "/old", args = [] }\ndocs = { command = "npx" }\n');
    expect(state(c, 'codex').connected).toBe(true);
    await c.connect('codex', CMD);
    expect(fs.readFileSync(file, 'utf8')).toBe(`[mcp_servers]\ndocs = { command = "npx" }\n\n[mcp_servers.slideria]\ncommand = '${CMD.command}'\nargs = ['--mcp']\n`);

    // Отключить — уходит только Slideria; ещё раз — ничего не меняется
    expect(await c.disconnect('codex')).toEqual({ id: 'codex', installed: true, connected: false });
    expect(fs.readFileSync(file, 'utf8')).toBe('[mcp_servers]\ndocs = { command = "npx" }\n');
    expect(await c.disconnect('codex')).toEqual({ id: 'codex', installed: true, connected: false });
  } finally { h.done(); }
});

test('ChatGPT · Codex: своя папка CODEX_HOME; ChatGPT на macOS и из Microsoft Store — «установлен»', async () => {
  const h = home();
  try {
    const own = path.join(h.dir, 'codex-home');
    fs.mkdirSync(own);
    const c = createConnect({ home: h.dir, platform: 'linux', env: { CODEX_HOME: own }, pathDirs: [] });
    expect(state(c, 'codex').installed).toBe(true);
    await c.connect('codex', CMD);
    expect(fs.readFileSync(path.join(own, 'config.toml'), 'utf8')).toContain('[mcp_servers.slideria]');
    expect(fs.existsSync(path.join(h.dir, '.codex'))).toBe(false);

    const mac = createConnect({ home: h.dir, platform: 'darwin', env: {}, pathDirs: [] });
    expect(state(mac, 'codex').installed).toBe(false);
    fs.mkdirSync(path.join(h.dir, 'Applications', 'ChatGPT.app'), { recursive: true });
    expect(state(mac, 'codex').installed).toBe(true);

    const local = path.join(h.dir, 'AppData', 'Local');
    const pc = createConnect({ home: h.dir, platform: 'win32', env: { LOCALAPPDATA: local }, pathDirs: [] });
    expect(state(pc, 'codex').installed).toBe(false);
    fs.mkdirSync(path.join(local, 'Packages', 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0'), { recursive: true });
    expect(state(pc, 'codex').installed).toBe(true);
  } finally { h.done(); }
});

test('чужой клиент и место без команды запуска — отказ', async () => {
  const c = createConnect({ home: os.tmpdir(), pathDirs: [] });
  await expect(c.connect('cursor', CMD)).rejects.toThrow('Нет такого клиента');
  await expect(c.connect('claude-code', null)).rejects.toThrow(/недоступно/);
});
