/**
 * Подключить агента в один щелчок («Файл → Интеграции → Агенты», docs/MCP.md): MCP этой папки прописывается в
 * клиента, который уже стоит на компьютере, — с подпиской Claude или ChatGPT ключ API не нужен.
 *   Claude Desktop — в его файл настроек (claude_desktop_config.json): прежний сохраняется копией рядом,
 *                    испорченный не перезаписывается. После — перезапустить Claude Desktop.
 *   Claude Code    — его командой: claude mcp add --scope user (для всех папок).
 *   ChatGPT · Codex — в его файл ~/.codex/config.toml: его читают ChatGPT для компьютера (приложение Codex с июля 2026 —
 *                    его часть), Codex в терминале и в редакторе. Своя программа codex для этого не нужна.
 * Программы ищутся там, куда их ставят установщики: PATH у программы, запущенной из Dock или меню «Пуск»,
 * короче, чем в терминале.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ClientId = 'claude-desktop' | 'claude-code' | 'codex';
export const CLIENT_IDS: ClientId[] = ['claude-desktop', 'claude-code', 'codex'];
export interface ClientState { id: ClientId; installed: boolean; connected: boolean }
type Cmd = { command: string; args: string[] };

/** Имя сервера у клиентов */
const NAME = 'slideria';
const TITLE: Record<ClientId, string> = { 'claude-desktop': 'Claude Desktop', 'claude-code': 'Claude Code', codex: 'ChatGPT · Codex' };

export interface ConnectOptions {
  /** Домашний каталог (тесты — временный); по умолчанию — пользователя */
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Где ещё искать программы, кроме папок в домашнем каталоге; по умолчанию — PATH и системные (тесты — []) */
  pathDirs?: string[];
}

export function createConnect(o: ConnectOptions = {}) {
  const home = o.home ?? os.homedir();
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const win = platform === 'win32';

  // ---------------- Claude Desktop ----------------

  /**
   * Папки настроек Claude Desktop, которые есть на компьютере. На Windows их бывает несколько, и какую читает
   * Claude, зависит от версии — пишем во все: обычная (%APPDATA%\Claude); из Microsoft Store — личная копия
   * пакета (…\Packages\Claude_…\LocalCache\Roaming\Claude) и, у новых версий, %LOCALAPPDATA%\Claude-Data\claude_….
   * create: false — файла там нет, и создавать его нельзя: личная копия пакета заслонила бы обычный файл
   * со всеми серверами пользователя
   */
  function desktopDirs(): { dir: string; create: boolean }[] {
    const dirs: { dir: string; create: boolean }[] = [];
    const sub = (parent: string, re: RegExp, ...rest: string[]) => {
      try { return fs.readdirSync(parent).filter((d) => re.test(d)).map((d) => path.join(parent, d, ...rest)); } catch { return []; }
    };
    if (platform === 'darwin') dirs.push({ dir: path.join(home, 'Library', 'Application Support', 'Claude'), create: true });
    else if (win) {
      const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      for (const dir of sub(path.join(local, 'Claude-Data'), /^claude_/i)) dirs.push({ dir, create: true });
      dirs.push({ dir: path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude'), create: true });
      for (const dir of sub(path.join(local, 'Packages'), /^Claude_/i, 'LocalCache', 'Roaming', 'Claude')) dirs.push({ dir, create: false });
    } else dirs.push({ dir: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude'), create: true });
    return dirs.filter((d) => fs.existsSync(d.dir));
  }
  const desktopFile = (dir: string) => path.join(dir, 'claude_desktop_config.json');
  /** Файлы настроек, которые уже есть */
  const desktopFiles = () => desktopDirs().map((d) => desktopFile(d.dir)).filter((f) => fs.existsSync(f));

  /** Настройки Claude Desktop; файла нет — пустые; испорчен — ошибка (перезаписывать нельзя) */
  function readDesktop(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return {};
    try {
      const v = JSON.parse(text) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* ниже — ошибка */ }
    throw new Error(`Настройки Claude Desktop не читаются (${file}) — поправьте файл или подключите вручную`);
  }
  const servers = (cfg: Record<string, unknown>) => (cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers as Record<string, unknown> : {});

  function writeDesktop(cmd: Cmd | null): void {
    const dirs = desktopDirs();
    if (!dirs.length) throw new Error('Claude Desktop не найден на этом компьютере. Установите приложение с claude.ai/download и запустите хотя бы один раз');
    // Сначала все файлы прочитать: испорченный где-то одном — не трогать ни одного
    const targets = dirs.map((d) => desktopFile(d.dir)).filter((f, i) => dirs[i].create || fs.existsSync(f));
    for (const file of targets) readDesktop(file);
    for (const file of targets) {
      const cfg = readDesktop(file);
      const list = { ...servers(cfg) };
      if (cmd) list[NAME] = { command: cmd.command, args: cmd.args };
      else if (!(NAME in list)) continue;
      else delete list[NAME];
      // Прежние настройки — копией рядом (один раз за подключение)
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
      fs.writeFileSync(file, `${JSON.stringify({ ...cfg, mcpServers: list }, null, 2)}\n`);
    }
  }

  // ---------------- ChatGPT · Codex: ~/.codex/config.toml ----------------

  const codexHome = () => env.CODEX_HOME || path.join(home, '.codex');
  const codexFile = () => path.join(codexHome(), 'config.toml');
  /**
   * ChatGPT или прежнее приложение Codex на компьютере: на macOS — в «Программах», на Windows — пакет Microsoft Store
   * (OpenAI.…) или установка в Programs. Ещё признаки Codex — папка ~/.codex и программа codex
   */
  function codexApp(): boolean {
    if (platform === 'darwin') {
      const dirs = [...(o.home ? [] : ['/Applications']), path.join(home, 'Applications')];
      return dirs.some((d) => ['ChatGPT.app', 'Codex.app'].some((a) => fs.existsSync(path.join(d, a))));
    }
    if (!win) return false;
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    let store = false;
    try { store = fs.readdirSync(path.join(local, 'Packages')).some((d) => /^OpenAI\./i.test(d)); } catch { /* нет папки */ }
    return store || ['ChatGPT', 'Codex'].some((a) => fs.existsSync(path.join(local, 'Programs', a)));
  }

  /** Строка TOML: буквальная ('C:\путь' — без экранирования), с кавычкой или переводом строки — обычная */
  const tomlStr = (v: string) => (/['\r\n]/.test(v) ? JSON.stringify(v) : `'${v}'`);
  const TABLE = /^\s*\[\[?\s*([^[\]]+?)\s*\]\]?\s*(#.*)?$/;
  const keyOf = (k: string) => k.replace(/["'\s]/g, '');
  /**
   * Файл без Slideria: её таблица [mcp_servers.slideria] с подтаблицами ([…slideria.env]), строка slideria = {…}
   * в таблице [mcp_servers] и ключи mcp_servers.slideria.… в начале файла. Остальное — как было
   */
  function withoutSlideria(text: string): { text: string; found: boolean } {
    const ours = `mcp_servers.${NAME}`;
    const out: string[] = [];
    let table = '';
    let skip = false;
    let found = false;
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      const m = TABLE.exec(line);
      if (m) {
        table = keyOf(m[1]);
        skip = table === ours || table.startsWith(`${ours}.`);
      } else if (!skip) {
        const key = keyOf(line.split('=')[0] ?? '');
        const dotted = line.includes('=') && (table === 'mcp_servers' ? key === NAME || key.startsWith(`${NAME}.`) : !table && (key === ours || key.startsWith(`${ours}.`)));
        if (dotted) { found = true; continue; }
      }
      if (skip) found = true;
      else out.push(line);
    }
    return { text: out.join('\n'), found };
  }
  const codexConnected = () => {
    try { return withoutSlideria(fs.readFileSync(codexFile(), 'utf8')).found; } catch { return false; }
  };
  /** Прописать (cmd) или убрать (null) Slideria; прежний файл — копией рядом */
  function writeCodex(cmd: Cmd | null): void {
    const file = codexFile();
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const { text, found } = withoutSlideria(before);
    if (!cmd && !found) return;
    let next = text.replace(/\s+$/, '');
    if (cmd) next += `${next ? '\n\n' : ''}[mcp_servers.${NAME}]\ncommand = ${tomlStr(cmd.command)}\nargs = [${cmd.args.map(tomlStr).join(', ')}]`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (before) fs.copyFileSync(file, `${file}.bak`);
    fs.writeFileSync(file, next ? `${next}\n` : '');
  }

  // ---------------- Claude Code: его команда ----------------

  const pathVar = env.PATH ?? env.Path ?? '';
  /** Папки, куда программы ставят установщики (свои у каждого: родной, npm, nvm, Volta, Bun, Homebrew) */
  function cliDirs(name: string): string[] {
    const nvm = path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node');
    let nvmBins: string[] = [];
    try { nvmBins = fs.readdirSync(nvm).sort().reverse().map((v) => path.join(nvm, v, 'bin')); } catch { /* нет nvm */ }
    return [
      ...(o.pathDirs ?? [...pathVar.split(path.delimiter), ...(win ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'])]),
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'local'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.bun', 'bin'),
      ...nvmBins,
      ...(win ? [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'), path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', name)] : []),
    ].filter(Boolean);
  }

  /** Программа командной строки: PATH и папки установщиков; нет — null */
  function findCli(name: string): string | null {
    const names = win ? [`${name}.exe`, `${name}.cmd`, name] : [name];
    for (const d of cliDirs(name)) {
      for (const n of names) {
        const f = path.join(d, n);
        try { if (fs.statSync(f).isFile()) return f; } catch { /* нет такого */ }
      }
    }
    return null;
  }

  /** Запустить команду клиента; ответ — вывод, ошибка — с её текстом */
  function run(file: string, args: string[]): Promise<string> {
    // .cmd на Windows запускается только через оболочку: аргументы — в кавычках
    const shell = win && /\.cmd$/i.test(file);
    const quote = (a: string) => (/^[\w./:=@\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
    // Программа из npm — сценарий Node: node лежит рядом с ней (nvm, Homebrew), а в PATH программы из Dock его нет
    const vars: NodeJS.ProcessEnv = { ...env, ...(o.home ? { HOME: home } : {}) };
    delete vars.Path;
    vars.PATH = [path.dirname(file), pathVar].filter(Boolean).join(path.delimiter);
    return new Promise((resolve, reject) => {
      execFile(shell ? quote(file) : file, shell ? args.map(quote) : args, { env: vars, timeout: 30_000, windowsHide: true, shell }, (err, stdout, stderr) => {
        if (err) reject(new Error((String(stderr).trim() || err.message).split('\n').slice(-3).join(' ')));
        else resolve(String(stdout));
      });
    });
  }

  const claudeCodeConnected = () => {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown> };
      return !!cfg.mcpServers && NAME in cfg.mcpServers;
    } catch { return false; }
  };

  // ---------------- всё вместе ----------------

  function state(): ClientState[] {
    return CLIENT_IDS.map((id) => {
      if (id === 'claude-desktop') {
        // Подключена — если Slideria во всех его файлах настроек: какой из них прочтёт Claude, заранее не узнать,
        // а свой файл он при выходе может переписать без неё
        const files = desktopFiles();
        let connected = files.length > 0;
        for (const f of files) { try { if (!(NAME in servers(readDesktop(f)))) connected = false; } catch { connected = false; } }
        return { id, installed: desktopDirs().length > 0, connected };
      }
      if (id === 'claude-code') return { id, installed: !!findCli('claude'), connected: claudeCodeConnected() };
      return { id, installed: fs.existsSync(codexHome()) || codexApp() || !!findCli('codex'), connected: codexConnected() };
    });
  }

  const one = (id: ClientId) => state().find((s) => s.id === id)!;

  async function connect(id: unknown, cmd: Cmd | null): Promise<ClientState> {
    const c = CLIENT_IDS.find((x) => x === id);
    if (!c) throw new Error('Нет такого клиента');
    if (!cmd) throw new Error('Подключение агентов здесь недоступно');
    if (c === 'claude-desktop') writeDesktop(cmd);
    // Уже подключена (возможно, к другой копии программы) — её строки заменяются новыми
    else if (c === 'codex') writeCodex(cmd);
    else {
      const cli = findCli('claude');
      if (!cli) throw new Error(`${TITLE[c]} не найден на этом компьютере — установите его или подключите вручную командой ниже`);
      await run(cli, ['mcp', 'remove', '--scope', 'user', NAME]).catch(() => '');
      await run(cli, ['mcp', 'add', '--scope', 'user', NAME, '--', cmd.command, ...cmd.args]);
    }
    return one(c);
  }

  async function disconnect(id: unknown): Promise<ClientState> {
    const c = CLIENT_IDS.find((x) => x === id);
    if (!c) throw new Error('Нет такого клиента');
    if (c === 'claude-desktop') writeDesktop(null);
    else if (c === 'codex') writeCodex(null);
    else {
      const cli = findCli('claude');
      if (!cli) throw new Error(`${TITLE[c]} не найден на этом компьютере`);
      await run(cli, ['mcp', 'remove', '--scope', 'user', NAME]);
    }
    return one(c);
  }

  return { state, connect, disconnect };
}

export type Connect = ReturnType<typeof createConnect>;
