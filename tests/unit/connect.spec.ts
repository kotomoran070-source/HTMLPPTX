// Подключение агента в один щелчок (server/connect.ts): Claude Desktop — расширением (.mcpb: пакет, окно установки,
// установленное узнаётся, прежняя запись в настройках убирается) или файлом настроек (чужое сохраняется, копия
// рядом, испорченный не трогается), Claude Code — его командой (подставная программа), ChatGPT · Codex — его файл
// ~/.codex/config.toml (чужое на месте, копия рядом)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildBundle, createConnect, MCP_TOOLS } from '../../server/connect';
import { createDecksCore } from '../../server/core';
import { createMcp } from '../../server/mcp';
import { cliCalls, fakeCli } from '../fake-clients';

const CMD = { command: '/Applications/Slideria.app/Contents/MacOS/Slideria', args: ['--mcp'] };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

/** Пакет .mcpb: файлы и манифест */
async function unpack(file: string) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  const target = JSON.parse(await zip.file('server/target.json')!.async('string'));
  return { zip, names, manifest, target };
}

test('Claude Desktop расширением: пакет .mcpb открывается, ждём установки; установлено — подключено, прежняя запись убрана', async () => {
  const h = home();
  try {
    const opened: string[] = [];
    let noApp = false;
    const c = createConnect({ home: h.dir, platform: 'darwin', env: {}, pathDirs: [], bundle: { root: ROOT, version: '1.2.3', out: path.join(h.dir, 'Slideria.mcpb') }, open: async (f, how) => {
      if (noApp && how === 'open') throw new Error('нет программы для .mcpb');
      opened.push(`${how} ${f}`);
    } });
    await expect(c.connect('claude-desktop', CMD)).rejects.toThrow(/Claude Desktop не найден/);
    const dir = path.join(h.dir, 'Library', 'Application Support', 'Claude');
    fs.mkdirSync(dir, { recursive: true });
    // Прежнее подключение — записью в настройках
    const cfg = path.join(dir, 'claude_desktop_config.json');
    fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { files: { command: 'npx', args: [] }, slideria: { command: 'old', args: [] } } }));
    // Подключить — на macOS пакет открывается (окно установки Claude Desktop); установки ещё нет
    expect(await c.connect('claude-desktop', CMD)).toMatchObject({ id: 'claude-desktop', installed: true, pending: true, install: 'open' });
    expect(opened).toEqual([`open ${path.join(h.dir, 'Slideria.mcpb')}`]);
    // Нет программы для .mcpb — файл показывается в папке, его перетаскивают в Claude Desktop
    noApp = true;
    expect(await c.connect('claude-desktop', CMD)).toMatchObject({ pending: true, install: 'drag' });
    expect(opened.at(-1)).toBe(`reveal ${path.join(h.dir, 'Slideria.mcpb')}`);
    const b = await unpack(path.join(h.dir, 'Slideria.mcpb'));
    expect(b.names).toEqual(['icon.png', 'manifest.json', 'server/launch.cjs', 'server/target.json']);
    expect(b.manifest).toMatchObject({
      manifest_version: '0.3', name: 'slideria', display_name: 'Slideria', version: '1.2.3', icon: 'icon.png', author: { name: 'Slideria' },
      server: { type: 'node', entry_point: 'server/launch.cjs', mcp_config: { command: 'node', args: ['${__dirname}/server/launch.cjs'] } },
      compatibility: { platforms: ['darwin'] },
    });
    expect(b.target).toEqual(CMD);
    // Установили в Claude Desktop — подключено расширением; запись в настройках (второй такой же сервер) — убрана
    fs.writeFileSync(path.join(dir, 'extensions-installations.json'), JSON.stringify({ extensions: { 'local.mcpb.slideria.slideria': { manifest: { name: 'slideria', version: '1.2.3' } } } }));
    expect(state(c, 'claude-desktop')).toEqual({ id: 'claude-desktop', installed: true, connected: true, via: 'extension', install: 'open' });
    expect(JSON.parse(fs.readFileSync(cfg, 'utf8')).mcpServers).toEqual({ files: { command: 'npx', args: [] } });
    // Отключить — расширение удаляют в самом Claude Desktop
    expect(await c.disconnect('claude-desktop')).toMatchObject({ connected: true, hint: expect.stringContaining('Extensions → Slideria → Uninstall') });
  } finally {
    h.done();
  }
});

test('Claude Desktop: расширение узнаётся и по папке «Claude Extensions»; пакет не открылся — запись в настройках', async () => {
  const h = home();
  try {
    const dir = path.join(h.dir, 'AppData', 'Roaming', 'Claude');
    fs.mkdirSync(path.join(dir, 'Claude Extensions', 'ant.dir.slideria'), { recursive: true });
    const c = createConnect({ home: h.dir, platform: 'win32', env: {}, pathDirs: [], bundle: { root: ROOT, version: '0.1.0', out: path.join(h.dir, 'x.mcpb') }, open: async () => { throw new Error('нет программы для .mcpb'); } });
    // Папка без манифеста — по имени; с чужим манифестом — нет
    expect(state(c, 'claude-desktop')).toMatchObject({ connected: true, via: 'extension' });
    fs.writeFileSync(path.join(dir, 'Claude Extensions', 'ant.dir.slideria', 'manifest.json'), JSON.stringify({ name: 'other' }));
    expect(state(c, 'claude-desktop')).toMatchObject({ connected: false });
    fs.rmSync(path.join(dir, 'Claude Extensions'), { recursive: true });
    // Windows: пакет не открывается через систему (Claude получил бы короткое имя SLIDER~1.MCP) — показывается в папке
    const shown: string[] = [];
    const w = createConnect({ home: h.dir, platform: 'win32', env: {}, pathDirs: [], bundle: { root: ROOT, version: '0.1.0', out: path.join(h.dir, 'x.mcpb') }, open: async (_f, how) => { shown.push(how); } });
    expect(await w.connect('claude-desktop', CMD)).toMatchObject({ pending: true, install: 'drag' });
    expect(shown).toEqual(['reveal']);
    // И его не показать — как раньше: в файл настроек и перезапустить
    expect(await c.connect('claude-desktop', CMD)).toMatchObject({ connected: true, hint: expect.stringContaining('добавлена в файл настроек') });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'claude_desktop_config.json'), 'utf8')).mcpServers.slideria).toEqual(CMD);
  } finally {
    h.done();
  }
});

test('пакет .mcpb: инструменты в манифесте — те же, что у сервера MCP; запуск из пакета поднимает MCP Slideria', async () => {
  test.setTimeout(120_000);
  const h = home();
  try {
    const dir = path.join(h.dir, 'decks');
    fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - title: Первый\n');
    // Список в манифесте (окно установки) — как у самого сервера, с теми же названиями
    const core = createDecksCore({ dir, root: ROOT });
    const mcp = createMcp({ core, dir, root: ROOT, version: '0' });
    const listed = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as { result: { tools: { name: string; title: string }[] } };
    expect(MCP_TOOLS).toEqual(listed.result.tools.map((t) => ({ name: t.name, description: t.title })));
    mcp.close();
    // Пакет с командой этой папки (как в yarn dev); распаковать — как это делает Claude Desktop
    const file = await buildBundle({ command: process.execPath, args: [path.join(ROOT, 'scripts', 'mcp.mjs'), `--decks=${dir}`] }, { root: ROOT, version: '0.1.0', out: path.join(h.dir, 'p.mcpb') });
    const ext = path.join(h.dir, 'ext');
    const { zip, names } = await unpack(file);
    for (const n of names) {
      fs.mkdirSync(path.dirname(path.join(ext, n)), { recursive: true });
      fs.writeFileSync(path.join(ext, n), await zip.file(n)!.async('nodebuffer'));
    }
    // Claude Desktop запускает «node ${__dirname}/server/launch.cjs»; его Node может быть Electron в режиме Node
    const client = new Client({ name: 'claude-ai', version: '1.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ext, 'server', 'launch.cjs')], stderr: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } as Record<string, string> }));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    const r = await client.callTool({ name: 'list_presentations', arguments: {} }) as { content: { text: string }[] };
    expect(r.content[0].text).toContain('talk');
    await client.close();
    // Slideria запускается без ELECTRON_RUN_AS_NODE: иначе программа Electron стала бы просто Node
    fs.writeFileSync(path.join(ext, 'server', 'target.json'), JSON.stringify({ command: process.execPath, args: ['-e', 'process.stdout.write(String(process.env.ELECTRON_RUN_AS_NODE ?? "нет"))'] }));
    const { execFileSync } = await import('node:child_process');
    expect(execFileSync(process.execPath, [path.join(ext, 'server', 'launch.cjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).toString()).toBe('нет');
    // Встроенный Node у Claude Desktop: вход и выход — потоки внутри программы, а fd 0 и 1 пусты. Запуск переливает
    // потоками (с переданными напрямую fd Slideria видела закрытый вход и сразу выходила)
    fs.writeFileSync(path.join(ext, 'server', 'target.json'), JSON.stringify({ command: process.execPath, args: [path.join(ROOT, 'scripts', 'mcp.mjs'), `--decks=${dir}`] }));
    const harness = path.join(h.dir, 'harness.cjs');
    fs.writeFileSync(harness, `const { PassThrough, Writable } = require('node:stream');
const input = new PassThrough();
process.on('message', (m) => (m === null ? input.end() : input.write(m)));
const output = new Writable({ write(chunk, _e, done) { process.send(chunk.toString(), () => done()); } });
Object.defineProperty(process, 'stdin', { value: input, configurable: true });
Object.defineProperty(process, 'stdout', { value: output, configurable: true });
require(process.argv[2]);
`);
    const { fork } = await import('node:child_process');
    const p = fork(harness, [path.join(ext, 'server', 'launch.cjs')], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let got = '';
    p.on('message', (m) => { got += String(m); });
    const ended = new Promise<number | null>((done) => p.once('exit', done));
    p.send(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } })}\n`);
    p.send(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await expect.poll(() => got.split('\n').filter(Boolean).length, { timeout: 30_000 }).toBe(2);
    expect(JSON.parse(got.split('\n')[1]).result.tools.length).toBe(MCP_TOOLS.length);
    // Агент закрыл вход — Slideria и запуск выходят сами
    p.send(null);
    expect(await ended).toBe(0);
    // Программы нет по пути из пакета — понятная ошибка
    fs.writeFileSync(path.join(ext, 'server', 'target.json'), JSON.stringify({ command: path.join(h.dir, 'нет', 'Slideria'), args: ['--mcp'] }));
    let err = '';
    try { execFileSync(process.execPath, [path.join(ext, 'server', 'launch.cjs')], { stdio: 'pipe' }); } catch (e) { err = String((e as { stderr: Buffer }).stderr); }
    expect(err).toContain('Slideria не найдена');
  } finally {
    h.done();
  }
});
