/**
 * Интеграции студии (docs/INTEGRATIONS.md): кто подключён (агенты по MCP), что им можно, журнал правок агентов
 * и скриптов, скрипты пользователя. Всё — в папке презентаций, в скрытой папке .slideria: она общая у студии
 * и у MCP, запущенного без студии (у них одна папка презентаций, а библиотеки и данные программы могут быть разные).
 *
 *   .slideria/settings.json        что можно агентам
 *   .slideria/agents.json          агенты, которые подключались: имя, когда были, сколько правок
 *   .slideria/journal/<имя>.jsonl  журнал правок презентации: кто, когда, что (было → стало), точка перед правкой
 *   scripts/*.js                   скрипты пользователя (встроенные — templates/scripts)
 *   plugins/<папка>/plugin.json    плагины пользователя (встроенные — templates/plugins; docs/PLUGINS.md)
 *   .slideria/plugins.json         какие плагины включены и что им разрешили
 *   .slideria/plugin-data/<id>.json  настройки плагина (его хранилище)
 */
import fs from 'node:fs';
import path from 'node:path';
import { stamp } from './deck-files';
import type { Change } from '../src/engine/ops';
import { PLUGIN_DIR, PLUGIN_PATH, missing, readManifest, type PluginManifest } from '../src/engine/plugin-manifest';

/** Что можно агентам: смотреть (читать и экспорт), править (и создавать новые презентации), всё (и сохранять скрипты) */
export type AgentAccess = 'view' | 'edit' | 'all';
const ACCESS: AgentAccess[] = ['view', 'edit', 'all'];

/** Кто правил: агент (MCP), скрипт, плагин или человек в студии */
export interface By { kind: 'agent' | 'script' | 'plugin'; id?: string; name: string }

/** Переписка чата «Агент» студии с этой презентацией (server/agent.ts): в .slideria, рядом с журналом */
export const chatsDir = (dir: string, deck: string) => path.join(dir, '.slideria', 'chats', deck);

export interface JournalEntry {
  /** Время, ISO */
  t: string;
  deck: string;
  by: By;
  changes: Change[];
  /** Контрольные точки перед правкой и после неё: «Вернуть» откатывает только эту правку */
  checkpoint?: string;
  after?: string;
  /** Отмена правок агента (MCP undo_edit): время (t) отменённых правок */
  undid?: string[];
}

export interface AgentInfo {
  id: string;
  name: string;
  version?: string;
  /** Когда подключился и когда последний раз давал о себе знать (мс) */
  since: number;
  seen: number;
  online: boolean;
  /** Правок за всё время */
  edits: number;
  /** Живых сеансов агента (два окна, два терминала); только у того, кто на связи */
  sessions?: number;
}

export interface ScriptParam { key: string; type: 'text' | 'lines' | 'number' | 'bool' | 'choice'; label: string; value: unknown; options?: { value: string; label: string }[] }
export interface ScriptInfo { id: string; name: string; description: string; params: ScriptParam[]; builtin: boolean; file: string }
/**
 * Плагин в списке: описание (или почему его не включить), включён ли, что ему разрешили и чего из нужного
 * ещё нет (тогда он не работает, пока не разрешат)
 */
export interface PluginInfo {
  id: string; folder: string; builtin: boolean;
  manifest: PluginManifest | null; error?: string;
  enabled: boolean; granted: string[]; needs: string[];
}

/** Агент на связи, если давал о себе знать не дольше этого (MCP напоминает о себе раз в 15 с) */
const ONLINE_MS = 40_000;
const SCRIPT_FILE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,80}\.js$/u;
const MAX_SCRIPT = 256 * 1024;
/** Файл плагина, который отдаёт сервер: текст панели, её код и стили, картинки и шрифты (данными) */
const PLUGIN_TEXT = /\.(html?|m?js|css|json|svg|txt)$/i;
const PLUGIN_BIN: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const MAX_PLUGIN_FILE = 2 * 1024 * 1024;
/** Хранилище настроек плагина — небольшое: это не место для файлов */
const MAX_PLUGIN_DATA = 256 * 1024;

/** Красивое имя клиента MCP по его clientInfo.name */
const CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code', 'claude-ai': 'Claude', 'claude desktop': 'Claude', cursor: 'Cursor', 'cursor-vscode': 'Cursor',
  'visual studio code': 'VS Code', vscode: 'VS Code', windsurf: 'Windsurf', zed: 'Zed', 'slideria-test': 'Тест',
};
export const clientTitle = (name: string, title?: string) => {
  const n = name.toLowerCase();
  // Агентский режим настольного приложения (local-agent-mode-<сервер>): в нём может работать любой агент
  if (n.startsWith('local-agent-mode')) return 'Локальный агент';
  return CLIENTS[n] ?? (title || name);
};

/** Заголовок скрипта: // @name, // @description, // @param ключ: вид = значение — подпись */
export function parseScript(code: string, id: string, builtin: boolean, file: string): ScriptInfo {
  const head = code.slice(0, 4000).split('\n').filter((l) => /^\s*\/\//.test(l)).map((l) => l.replace(/^\s*\/\/\s?/, ''));
  const tag = (t: string) => head.filter((l) => l.startsWith(`@${t} `)).map((l) => l.slice(t.length + 2).trim());
  const params: ScriptParam[] = [];
  for (const p of tag('param')) {
    const m = /^([A-Za-z_]\w*)\s*:\s*(text|lines|number|bool|choice\(([^)]*)\))\s*(?:=\s*("(?:[^"\\]|\\.)*"|[^—]*?))?\s*(?:—\s*(.+))?$/.exec(p);
    if (!m) continue;
    const type = (m[2].startsWith('choice') ? 'choice' : m[2]) as ScriptParam['type'];
    const raw = (m[4] ?? '').trim();
    let value: unknown = raw.startsWith('"') ? JSON.parse(raw) : raw;
    if (type === 'number') value = Number(raw) || 0;
    if (type === 'bool') value = raw === 'true';
    if (type === 'lines' && typeof value === 'string') value = value.replace(/\\n/g, '\n');
    const options = type === 'choice' ? (m[3] ?? '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => {
      const [v, l] = o.split('=').map((x) => x.trim());
      return { value: v, label: l || v };
    }) : undefined;
    if (type === 'choice' && options?.length && !options.some((o) => o.value === value)) value = options[0].value;
    params.push({ key: m[1], type, label: (m[5] ?? m[1]).trim(), value, ...(options ? { options } : {}) });
  }
  return { id, name: tag('name')[0] || file.replace(/\.js$/, ''), description: tag('description')[0] || '', params, builtin, file };
}

export interface IntegrationsOptions {
  /** Папка презентаций */
  dir: string;
  /** Корень программы: встроенные скрипты (templates/scripts) */
  root: string;
  /** Что-то поменялось: список агентов (agents) или журнал (journal) — хозяин рассылает страницам */
  emit?: (type: 'agents', e: AgentInfo[]) => void;
}

export function createIntegrations(o: IntegrationsOptions) {
  const base = path.join(o.dir, '.slideria');
  const settingsFile = path.join(base, 'settings.json');
  const agentsFile = path.join(base, 'agents.json');
  const journalDir = path.join(base, 'journal');
  const scriptsDir = path.join(o.dir, 'scripts');
  const builtinDir = path.join(o.root, 'templates', 'scripts');
  const pluginsDir = path.join(o.dir, 'plugins');
  const builtinPluginsDir = path.join(o.root, 'templates', 'plugins');
  const pluginsFile = path.join(base, 'plugins.json');
  const pluginDataDir = path.join(base, 'plugin-data');

  const readJson = <T>(file: string, fallback: T): T => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
  };
  const writeJson = (file: string, v: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(v, null, 2));
  };

  // ---------------- что можно агентам ----------------

  function access(): AgentAccess {
    const v = readJson<{ agents?: string }>(settingsFile, {}).agents;
    return ACCESS.includes(v as AgentAccess) ? v as AgentAccess : 'edit';
  }

  function setAccess(v: unknown): AgentAccess {
    if (!ACCESS.includes(v as AgentAccess)) throw new Error('Доступ агентов: view, edit или all');
    writeJson(settingsFile, { ...readJson<object>(settingsFile, {}), agents: v });
    return v as AgentAccess;
  }

  /** Агенту можно это? Нет — понятная ошибка: что разрешено и где поменять */
  function allow(by: By | undefined, need: 'edit' | 'all'): void {
    if (by?.kind !== 'agent') return;
    const a = access();
    if (a === 'all' || (need === 'edit' && a === 'edit')) return;
    const now = a === 'view' ? 'только смотреть' : 'править и создавать презентации, но не сохранять скрипты';
    throw new Error(`В Slideria агентам разрешено ${now}. Поменять — в студии: «Файл → Интеграции → Агенты»`);
  }

  // ---------------- агенты на связи ----------------

  /** Сеанс на связи. Правок у сеанса нет: они считаются по имени агента (agents.json) — два сеанса одного агента
   *  (два окна, дубль после переподключения) иначе затирали бы счёт друг друга */
  interface Known { name: string; version?: string; since: number; seen: number }
  const live = new Map<string, Known>();
  /** Подключавшиеся агенты; записанные под прежним именем клиента — под нынешним (clientTitle), с их правками */
  const known = () => {
    const all = readJson<Record<string, { name: string; seen: number; edits: number }>>(agentsFile, {});
    let moved = false;
    for (const [name, k] of Object.entries(all)) {
      const now = clientTitle(name);
      if (now === name) continue;
      const to = all[now];
      all[now] = { name: now, seen: Math.max(k.seen, to?.seen ?? 0), edits: k.edits + (to?.edits ?? 0) };
      delete all[name];
      moved = true;
    }
    if (moved) writeJson(agentsFile, all);
    return all;
  };

  /**
   * Агенты — строкой на агента (по имени): сеансы одного агента — два окна или дубль после переподключения,
   * когда прежний сеанс ушёл без «пока», — одна строка. На связи, если жив хоть один сеанс (sessions — сколько);
   * «на связи с» — от самого раннего из живых, версия — у самого свежего
   */
  function list(): AgentInfo[] {
    const now = Date.now();
    const all = known();
    const groups = new Map<string, [string, Known][]>();
    for (const [id, a] of live) groups.set(a.name, [...(groups.get(a.name) ?? []), [id, a]]);
    const out: AgentInfo[] = [];
    for (const [name, ss] of groups) {
      const on = ss.filter(([, a]) => now - a.seen < ONLINE_MS).sort((x, y) => y[1].seen - x[1].seen);
      const edits = all[name]?.edits ?? 0;
      if (on.length) {
        const [id, fresh] = on[0];
        out.push({ id, name, version: fresh.version, since: Math.min(...on.map(([, a]) => a.since)), seen: fresh.seen, online: true, edits, sessions: on.length });
      } else {
        const seen = Math.max(all[name]?.seen ?? 0, ...ss.map(([, a]) => a.seen));
        out.push({ id: `known:${name}`, name, version: ss.sort((x, y) => y[1].seen - x[1].seen)[0][1].version, since: seen, seen, online: false, edits });
      }
    }
    // Подключались раньше — по имени: «Cursor, последний раз на связи вчера»
    for (const [name, k] of Object.entries(all)) {
      if (!groups.has(name)) out.push({ id: `known:${name}`, name, since: k.seen, seen: k.seen, online: false, edits: k.edits });
    }
    return out.sort((a, b) => Number(b.online) - Number(a.online) || b.seen - a.seen).slice(0, 8);
  }

  const changed = () => o.emit?.('agents', list());

  /** Агент подключился или напомнил о себе */
  function hello(a: { id: string; name: string; version?: string }): void {
    if (typeof a?.id !== 'string' || !a.id || typeof a.name !== 'string') throw new Error('Агент: id и name');
    const was = live.get(a.id);
    const now = Date.now();
    const name = a.name.slice(0, 60);
    live.set(a.id, { name, version: a.version?.slice(0, 30), since: was?.since ?? now, seen: now });
    if (!was || now - was.seen > ONLINE_MS) {
      remember(name);
      changed();
    }
  }

  function bye(id: string): void {
    const a = live.get(id);
    if (!a) return;
    remember(a.name);
    live.delete(id);
    changed();
  }

  /** Агент давал о себе знать (seen; по умолчанию — сейчас); added — новые правки (прибавляются к счёту по имени) */
  function remember(name: string, added = 0, seen = Date.now()): void {
    const all = known();
    all[name] = { name, seen: Math.max(all[name]?.seen ?? 0, seen), edits: (all[name]?.edits ?? 0) + added };
    writeJson(agentsFile, all);
  }

  /**
   * Замолчавшие дольше срока — «не на связи» (страницам — один раз, и когда меняется число живых сеансов).
   * Сеанс, ушедший без «пока» (приложение закрыли, компьютер уснул), — из памяти: его время — в записи агента
   */
  const onlineKey = () => list().filter((a) => a.online).map((a) => `${a.name}:${a.sessions}`).sort().join('|');
  let wasOnline = '';
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, a] of live) {
      if (now - a.seen < ONLINE_MS) continue;
      remember(a.name, 0, a.seen);
      live.delete(id);
    }
    const key = onlineKey();
    if (key !== wasOnline) changed();
    wasOnline = key;
  }, 10_000);
  sweep.unref?.();

  // ---------------- журнал ----------------

  const journalFile = (deck: string) => path.join(journalDir, `${deck}.jsonl`);
  /** Журнал хранит JOURNAL_DAYS дней, но не больше JOURNAL_MAX записей; проверяется, когда файл перерос JOURNAL_TRIM */
  const JOURNAL_DAYS = 90;
  const JOURNAL_MAX = 2000;
  const JOURNAL_TRIM = 256 * 1024;

  function record(e: JournalEntry): void {
    if (!e.changes.length) return;
    fs.mkdirSync(journalDir, { recursive: true });
    const file = journalFile(e.deck);
    fs.appendFileSync(file, JSON.stringify(e) + '\n');
    try { if (fs.statSync(file).size > JOURNAL_TRIM) trim(file); } catch { /* не страшно: обрежется в следующий раз */ }
    if (e.by.kind === 'agent') {
      remember(e.by.name, e.changes.length);
      changed();
    }
  }

  /** Старше JOURNAL_DAYS и сверх JOURNAL_MAX — прочь; файл переписывается целиком через временный */
  function trim(file: string): void {
    const old = new Date(Date.now() - JOURNAL_DAYS * 86_400_000).toISOString();
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => {
      if (!line) return false;
      try { return (JSON.parse(line) as JournalEntry).t >= old; } catch { return false; }
    }).slice(-JOURNAL_MAX);
    fs.writeFileSync(`${file}.tmp`, lines.length ? lines.join('\n') + '\n' : '');
    fs.renameSync(`${file}.tmp`, file);
  }

  /** Журнал презентации — в её корзину (to) и обратно, когда её вернули (from): уже есть свой — не трогается */
  function takeJournal(deck: string, to: string): void {
    const file = journalFile(deck);
    if (!fs.existsSync(file)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(file, to); } catch { fs.copyFileSync(file, to); fs.rmSync(file, { force: true }); }
  }
  function adoptJournal(deck: string, from: string): void {
    if (!fs.existsSync(from) || fs.existsSync(journalFile(deck))) return;
    fs.mkdirSync(journalDir, { recursive: true });
    try { fs.renameSync(from, journalFile(deck)); } catch { fs.copyFileSync(from, journalFile(deck)); }
  }

  /**
   * «Версии»: убрать из журнала правки со временем из ts — их строки дописываются в to (корзина истории),
   * restoreJournal возвращает их оттуда. Недописанные строки остаются как были
   */
  function dropJournal(deck: string, ts: Set<string>, to: string): JournalEntry[] {
    const file = journalFile(deck);
    if (!fs.existsSync(file)) return [];
    const keep: string[] = [];
    const gone: string[] = [];
    const out: JournalEntry[] = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      let e: JournalEntry | null = null;
      try { e = JSON.parse(line) as JournalEntry; } catch { /* недописанная */ }
      if (e && ts.has(e.t)) {
        gone.push(line);
        out.push(e);
      } else keep.push(line);
    }
    if (!gone.length) return [];
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.appendFileSync(to, gone.join('\n') + '\n');
    fs.writeFileSync(`${file}.tmp`, keep.length ? keep.join('\n') + '\n' : '');
    fs.renameSync(`${file}.tmp`, file);
    return out;
  }
  /** Строки журнала из корзины — обратно (уже записанные не повторяются); сколько правок вернулось */
  function restoreJournal(deck: string, from: string): number {
    if (!fs.existsSync(from)) return 0;
    const file = journalFile(deck);
    const have = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : []);
    const add = fs.readFileSync(from, 'utf8').split('\n').filter((line) => line && !have.has(line));
    if (!add.length) return 0;
    fs.mkdirSync(journalDir, { recursive: true });
    fs.appendFileSync(file, add.join('\n') + '\n');
    return add.reduce((n, line) => { try { return n + ((JSON.parse(line) as JournalEntry).changes?.length ?? 0); } catch { return n; } }, 0);
  }
  const journalBytes = (deck: string): number => { try { return fs.statSync(journalFile(deck)).size; } catch { return 0; } };

  /** Журнал: новые первыми; deck — одной презентации, без него — всех */
  function journal(deck?: string, limit = 200): JournalEntry[] {
    const files = deck ? [journalFile(deck)] : (fs.existsSync(journalDir) ? fs.readdirSync(journalDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(journalDir, f)) : []);
    const out: JournalEntry[] = [];
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as JournalEntry;
          // Агент под прежним именем клиента — под нынешним, как в списке агентов
          if (e.by?.kind === 'agent') e.by.name = clientTitle(e.by.name);
          out.push(e);
        } catch { /* недописанная строка */ }
      }
    }
    // Новые первыми; записанные в ту же миллисекунду — тоже (в файле они идут по порядку записи)
    return out.reverse().sort((a, b) => b.t.localeCompare(a.t)).slice(0, limit);
  }

  // ---------------- скрипты ----------------

  function scripts(): ScriptInfo[] {
    const read = (dir: string, builtin: boolean) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .filter((f) => SCRIPT_FILE.test(f))
      .sort()
      .map((f) => parseScript(fs.readFileSync(path.join(dir, f), 'utf8'), `${builtin ? 'builtin' : 'user'}:${f}`, builtin, f));
    return [...read(builtinDir, true), ...read(scriptsDir, false)];
  }

  function scriptCode(id: string): { info: ScriptInfo; code: string } {
    const m = /^(builtin|user):(.+)$/.exec(id ?? '');
    if (!m || !SCRIPT_FILE.test(m[2])) throw new Error('Нет такого скрипта');
    const file = path.join(m[1] === 'builtin' ? builtinDir : scriptsDir, m[2]);
    if (!fs.existsSync(file)) throw new Error(`Скрипт «${m[2]}» не найден в папке скриптов`);
    const code = fs.readFileSync(file, 'utf8');
    return { info: parseScript(code, id, m[1] === 'builtin', m[2]), code };
  }

  /** Сохранить скрипт в папку пользователя (его написал агент или студия — «Новый скрипт») */
  function saveScript(file: string, code: string, o2: { by?: By; replace?: boolean } = {}): ScriptInfo {
    allow(o2.by, 'all');
    const name = String(file ?? '').trim().replace(/\.js$/i, '') + '.js';
    if (!SCRIPT_FILE.test(name)) throw new Error('Имя файла скрипта: буквы, цифры, пробел, точка, дефис; например «оглавление.js»');
    if (typeof code !== 'string' || !code.trim()) throw new Error('Пустой скрипт');
    if (code.length > MAX_SCRIPT) throw new Error('Скрипт больше 256 КБ');
    if (!/export\s+default/.test(code)) throw new Error('В скрипте нет export default — главной функции (docs/SCRIPTS.md)');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const target = path.join(scriptsDir, name);
    if (fs.existsSync(target) && !o2.replace) throw new Error(`Скрипт «${name}» уже есть`);
    fs.writeFileSync(target, code);
    return parseScript(code, `user:${name}`, false, name);
  }

  /**
   * Удалить свой скрипт: файл не стирается, а уходит в корзину проекта (.trash/scripts-<время>/) — вернуть можно,
   * перенеся его обратно в папку скриптов. Встроенные скрипты не удаляются
   */
  function deleteScript(id: string): { trashed: string } {
    const m = /^user:(.+)$/.exec(id ?? '');
    if (!m || !SCRIPT_FILE.test(m[1])) throw new Error('Удалить можно только свой скрипт');
    const file = path.join(scriptsDir, m[1]);
    if (!fs.existsSync(file)) throw new Error(`Скрипт «${m[1]}» не найден в папке скриптов`);
    const to = path.join(o.dir, '.trash', `scripts-${stamp()}`);
    fs.mkdirSync(to, { recursive: true });
    fs.renameSync(file, path.join(to, m[1]));
    return { trashed: path.relative(o.dir, path.join(to, m[1])).split(path.sep).join('/') };
  }

  // ---------------- плагины ----------------

  type PluginState = Record<string, { enabled?: boolean; granted?: string[] }>;
  const pluginState = () => readJson<PluginState>(pluginsFile, {});

  /** Папка плагина по id (builtin:<папка> или user:<папка>) — только существующая и с допустимым именем */
  function pluginDir(id: string): { dir: string; folder: string; builtin: boolean } {
    const m = /^(builtin|user):(.+)$/.exec(id ?? '');
    if (!m || !PLUGIN_DIR.test(m[2])) throw new Error('Нет такого плагина');
    const dir = path.join(m[1] === 'builtin' ? builtinPluginsDir : pluginsDir, m[2]);
    if (!fs.existsSync(path.join(dir, 'plugin.json'))) throw new Error(`Плагин «${m[2]}» не найден в папке плагинов`);
    return { dir, folder: m[2], builtin: m[1] === 'builtin' };
  }

  function pluginInfo(id: string, folder: string, builtin: boolean, dir: string, st: PluginState): PluginInfo {
    let manifest: PluginManifest | null = null;
    let error: string | undefined;
    try {
      const r = readManifest(JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')));
      if ('error' in r) error = r.error;
      else manifest = r.manifest;
    } catch (e) {
      error = `plugin.json не читается: ${(e as Error).message}`;
    }
    const granted = (st[id]?.granted ?? []).filter((g) => typeof g === 'string');
    const needs = manifest ? missing(manifest, granted) : [];
    return { id, folder, builtin, manifest, ...(error ? { error } : {}), enabled: !!manifest && st[id]?.enabled === true, granted, needs };
  }

  /** Плагины: встроенные, затем свои — папки с plugin.json */
  function plugins(): PluginInfo[] {
    const st = pluginState();
    const read = (root: string, builtin: boolean) => (fs.existsSync(root) ? fs.readdirSync(root) : [])
      .filter((f) => PLUGIN_DIR.test(f) && fs.existsSync(path.join(root, f, 'plugin.json')))
      .sort()
      .map((f) => pluginInfo(`${builtin ? 'builtin' : 'user'}:${f}`, f, builtin, path.join(root, f), st));
    return [...read(builtinPluginsDir, true), ...read(pluginsDir, false)];
  }

  /**
   * Файл плагина для его панели: текст (HTML, код, стили) или данные (картинка, шрифт) — только из его папки.
   * Панель сама сервер не спрашивает: файлы ей встраивает студия (src/studio/plugin-pane.ts)
   */
  function pluginFile(id: string, rel: string): { text: string } | { data: string; type: string } {
    const { dir } = pluginDir(id);
    if (typeof rel !== 'string' || !PLUGIN_PATH.test(rel)) throw new Error('Путь файла плагина: внутри его папки, без «..»');
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Нет файла «${rel}» в папке плагина`);
    if (fs.statSync(file).size > MAX_PLUGIN_FILE) throw new Error(`Файл «${rel}» больше 2 МБ`);
    if (PLUGIN_TEXT.test(rel)) return { text: fs.readFileSync(file, 'utf8') };
    const type = PLUGIN_BIN[path.extname(rel).toLowerCase()];
    if (!type) throw new Error(`Файл «${rel}»: такие плагину не отдаются`);
    return { data: fs.readFileSync(file).toString('base64'), type };
  }

  /**
   * Включить или выключить плагин. Включить — с разрешениями, которые показали человеку: их сервер и запоминает.
   * Выключили — разрешения остаются: включить снова можно без вопросов, пока плагин не попросит нового
   */
  function setPlugin(id: string, v: { enabled?: unknown; granted?: unknown }): PluginInfo {
    const { dir, folder, builtin } = pluginDir(id);
    const st = pluginState();
    const cur = st[id] ?? {};
    if (Array.isArray(v.granted)) cur.granted = [...new Set([...(cur.granted ?? []), ...v.granted.filter((g): g is string => typeof g === 'string' && g.length < 300)])];
    if (typeof v.enabled === 'boolean') cur.enabled = v.enabled;
    st[id] = cur;
    const info = pluginInfo(id, folder, builtin, dir, st);
    if (info.enabled && info.needs.length) throw new Error('Плагину не разрешено всё, что ему нужно');
    if (v.enabled === true && !info.manifest) throw new Error(info.error ?? 'Плагин не включить');
    writeJson(pluginsFile, st);
    return info;
  }

  const dataFile = (id: string) => path.join(pluginDataDir, `${id.replace(/[^\p{L}\p{N}._-]/gu, '_')}.json`);
  /** Настройки плагина: прочитать все или записать одну (значение null — убрать) */
  function pluginData(id: string, set?: { key?: unknown; value?: unknown }): Record<string, unknown> {
    pluginDir(id);
    const file = dataFile(id);
    const data = readJson<Record<string, unknown>>(file, {});
    if (!set) return data;
    const key = typeof set.key === 'string' ? set.key.slice(0, 100) : '';
    if (!key) throw new Error('Настройка плагина: нужен ключ');
    if (set.value === null || set.value === undefined) delete data[key];
    else data[key] = set.value;
    if (JSON.stringify(data).length > MAX_PLUGIN_DATA) throw new Error('Настройки плагина больше 256 КБ');
    writeJson(file, data);
    return data;
  }

  /**
   * Удалить свой плагин: папка не стирается, а уходит в корзину проекта (.trash/plugins-<время>/) — вернуть можно,
   * перенеся её обратно в папку плагинов. Встроенные плагины не удаляются
   */
  function deletePlugin(id: string): { trashed: string } {
    const { dir, folder, builtin } = pluginDir(id);
    if (builtin) throw new Error('Встроенный плагин не удаляется — его можно выключить');
    const to = path.join(o.dir, '.trash', `plugins-${stamp()}`);
    fs.mkdirSync(to, { recursive: true });
    fs.renameSync(dir, path.join(to, folder));
    const st = pluginState();
    delete st[id];
    writeJson(pluginsFile, st);
    fs.rmSync(dataFile(id), { force: true });
    return { trashed: path.relative(o.dir, path.join(to, folder)).split(path.sep).join('/') };
  }

  return {
    access, setAccess, allow,
    agents: list, hello, bye,
    record, journal, takeJournal, adoptJournal, dropJournal, restoreJournal, journalBytes,
    scripts, scriptCode, saveScript, deleteScript,
    plugins, pluginFile, setPlugin, pluginData, deletePlugin,
    scriptsDir, pluginsDir,
    close: () => clearInterval(sweep),
  };
}

export type Integrations = ReturnType<typeof createIntegrations>;
