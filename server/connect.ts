/**
 * Подключить агента в один щелчок («Файл → Интеграции → Агенты», docs/MCP.md): MCP этой папки прописывается в
 * клиента, который уже стоит на компьютере, — с подпиской Claude или ChatGPT ключ API не нужен.
 *   Claude Desktop — в его файл настроек (claude_desktop_config.json): прежний сохраняется копией рядом,
 *                    испорченный не перезаписывается. После — перезапустить Claude Desktop.
 *   Claude Code    — его командой: claude mcp add --scope user (для всех папок).
 *   Codex          — его командой: codex mcp add.
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
const TITLE: Record<ClientId, string> = { 'claude-desktop': 'Claude Desktop', 'claude-code': 'Claude Code', codex: 'Codex' };

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

  /** Папки настроек Claude Desktop, которые есть на компьютере (на Windows из Microsoft Store — своя) */
  function desktopDirs(): string[] {
    const dirs: string[] = [];
    if (platform === 'darwin') dirs.push(path.join(home, 'Library', 'Application Support', 'Claude'));
    else if (win) {
      dirs.push(path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude'));
      const pkgs = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
      try {
        for (const d of fs.readdirSync(pkgs)) if (/^Claude_/i.test(d)) dirs.push(path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude'));
      } catch { /* нет папки пакетов */ }
    } else dirs.push(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude'));
    return dirs.filter((d) => fs.existsSync(d));
  }
  const desktopFile = (dir: string) => path.join(dir, 'claude_desktop_config.json');

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
    if (!dirs.length) throw new Error('Claude Desktop не найден на этом компьютере: установите его с claude.ai/download и откройте один раз');
    for (const dir of dirs) {
      const file = desktopFile(dir);
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

  // ---------------- Claude Code и Codex: их команды ----------------

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
  const codexConnected = () => {
    try {
      return new RegExp(`^\\[mcp_servers\\.${NAME}\\]`, 'm').test(fs.readFileSync(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'), 'utf8'));
    } catch { return false; }
  };

  // ---------------- всё вместе ----------------

  function state(): ClientState[] {
    return CLIENT_IDS.map((id) => {
      if (id === 'claude-desktop') {
        const dirs = desktopDirs();
        let connected = false;
        for (const d of dirs) { try { if (NAME in servers(readDesktop(desktopFile(d)))) connected = true; } catch { /* испорченный файл — не подключён */ } }
        return { id, installed: dirs.length > 0, connected };
      }
      if (id === 'claude-code') return { id, installed: !!findCli('claude'), connected: claudeCodeConnected() };
      return { id, installed: !!findCli('codex'), connected: codexConnected() };
    });
  }

  const one = (id: ClientId) => state().find((s) => s.id === id)!;

  async function connect(id: unknown, cmd: Cmd | null): Promise<ClientState> {
    const c = CLIENT_IDS.find((x) => x === id);
    if (!c) throw new Error('Нет такого клиента');
    if (!cmd) throw new Error('Подключение агентов здесь недоступно');
    if (c === 'claude-desktop') {
      writeDesktop(cmd);
      return one(c);
    }
    const cli = findCli(c === 'claude-code' ? 'claude' : 'codex');
    if (!cli) throw new Error(`${TITLE[c]} не найден на этом компьютере — установите его или подключите вручную командой ниже`);
    const scope = c === 'claude-code' ? ['--scope', 'user'] : [];
    // Уже подключён (возможно, к другой копии программы) — заново, с этой командой
    await run(cli, ['mcp', 'remove', ...scope, NAME]).catch(() => '');
    await run(cli, ['mcp', 'add', ...scope, NAME, '--', cmd.command, ...cmd.args]);
    return one(c);
  }

  async function disconnect(id: unknown): Promise<ClientState> {
    const c = CLIENT_IDS.find((x) => x === id);
    if (!c) throw new Error('Нет такого клиента');
    if (c === 'claude-desktop') writeDesktop(null);
    else {
      const cli = findCli(c === 'claude-code' ? 'claude' : 'codex');
      if (!cli) throw new Error(`${TITLE[c]} не найден на этом компьютере`);
      await run(cli, ['mcp', 'remove', ...(c === 'claude-code' ? ['--scope', 'user'] : []), NAME]);
    }
    return one(c);
  }

  return { state, connect, disconnect };
}

export type Connect = ReturnType<typeof createConnect>;
