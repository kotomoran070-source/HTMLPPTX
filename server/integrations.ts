/**
 * Интеграции студии (docs/INTEGRATIONS.md): кто подключён (агенты по MCP), что им можно, журнал правок агентов
 * и скриптов, скрипты пользователя. Всё — в папке презентаций, в скрытой папке .slideria: она общая у студии
 * и у MCP, запущенного без студии (у них одна папка презентаций, а библиотеки и данные программы могут быть разные).
 *
 *   .slideria/settings.json        что можно агентам
 *   .slideria/agents.json          агенты, которые подключались: имя, когда были, сколько правок
 *   .slideria/journal/<имя>.jsonl  журнал правок презентации: кто, когда, что (было → стало), точка перед правкой
 *   scripts/*.js                   скрипты пользователя (встроенные — templates/scripts)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Change } from '../src/engine/ops';

/** Что можно агентам: смотреть (читать и экспорт), править (и создавать новые презентации), всё (и сохранять скрипты) */
export type AgentAccess = 'view' | 'edit' | 'all';
const ACCESS: AgentAccess[] = ['view', 'edit', 'all'];

/** Кто правил: агент (MCP), скрипт или человек в студии */
export interface By { kind: 'agent' | 'script'; id?: string; name: string }

export interface JournalEntry {
  /** Время, ISO */
  t: string;
  deck: string;
  by: By;
  changes: Change[];
  /** Контрольные точки перед правкой и после неё: «Вернуть» откатывает только эту правку */
  checkpoint?: string;
  after?: string;
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
}

export interface ScriptParam { key: string; type: 'text' | 'lines' | 'number' | 'bool' | 'choice'; label: string; value: unknown; options?: { value: string; label: string }[] }
export interface ScriptInfo { id: string; name: string; description: string; params: ScriptParam[]; builtin: boolean; file: string }

/** Агент на связи, если давал о себе знать не дольше этого (MCP напоминает о себе раз в 15 с) */
const ONLINE_MS = 40_000;
const SCRIPT_FILE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,80}\.js$/u;
const MAX_SCRIPT = 256 * 1024;

/** Красивое имя клиента MCP по его clientInfo.name */
const CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code', 'claude-ai': 'Claude', 'claude desktop': 'Claude', cursor: 'Cursor', 'cursor-vscode': 'Cursor',
  'visual studio code': 'VS Code', vscode: 'VS Code', windsurf: 'Windsurf', zed: 'Zed', 'slideria-test': 'Тест',
};
export const clientTitle = (name: string, title?: string) => CLIENTS[name.toLowerCase()] ?? (title || name);

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

  interface Known { name: string; version?: string; since: number; seen: number; edits: number }
  const live = new Map<string, Known>();
  const known = () => readJson<Record<string, { name: string; seen: number; edits: number }>>(agentsFile, {});

  function list(): AgentInfo[] {
    const now = Date.now();
    const out: AgentInfo[] = [...live].map(([id, a]) => ({ id, ...a, online: now - a.seen < ONLINE_MS }));
    // Подключались раньше — по имени: «Cursor, был вчера»
    for (const [name, k] of Object.entries(known())) {
      if (!out.some((a) => a.name === name)) out.push({ id: `known:${name}`, name, since: k.seen, seen: k.seen, online: false, edits: k.edits });
    }
    return out.sort((a, b) => Number(b.online) - Number(a.online) || b.seen - a.seen).slice(0, 8);
  }

  const changed = () => o.emit?.('agents', list());

  /** Агент подключился или напомнил о себе */
  function hello(a: { id: string; name: string; version?: string }): void {
    if (typeof a?.id !== 'string' || !a.id || typeof a.name !== 'string') throw new Error('Агент: id и name');
    const was = live.get(a.id);
    const now = Date.now();
    const edits = was?.edits ?? known()[a.name]?.edits ?? 0;
    live.set(a.id, { name: a.name.slice(0, 60), version: a.version?.slice(0, 30), since: was?.since ?? now, seen: now, edits });
    if (!was || now - was.seen > ONLINE_MS) {
      remember(a.name, edits);
      changed();
    }
  }

  function bye(id: string): void {
    const a = live.get(id);
    if (!a) return;
    remember(a.name, a.edits);
    live.delete(id);
    changed();
  }

  function remember(name: string, edits: number): void {
    const all = known();
    all[name] = { name, seen: Date.now(), edits };
    writeJson(agentsFile, all);
  }

  /** Замолчавшие дольше срока — «не на связи» (страницам — один раз) */
  let wasOnline = new Set<string>();
  const sweep = setInterval(() => {
    const now = new Set(list().filter((a) => a.online).map((a) => a.id));
    if (now.size !== wasOnline.size || [...now].some((id) => !wasOnline.has(id))) changed();
    wasOnline = now;
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
      const a = e.by.id ? live.get(e.by.id) : undefined;
      if (a) a.edits += e.changes.length;
      const k = known()[e.by.name];
      remember(e.by.name, (a?.edits ?? (k?.edits ?? 0) + e.changes.length));
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

  /** Журнал: новые первыми; deck — одной презентации, без него — всех */
  function journal(deck?: string, limit = 200): JournalEntry[] {
    const files = deck ? [journalFile(deck)] : (fs.existsSync(journalDir) ? fs.readdirSync(journalDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(journalDir, f)) : []);
    const out: JournalEntry[] = [];
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        try { out.push(JSON.parse(line) as JournalEntry); } catch { /* недописанная строка */ }
      }
    }
    return out.sort((a, b) => b.t.localeCompare(a.t)).slice(0, limit);
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
    if (!fs.existsSync(file)) throw new Error(`Скрипт «${m[2]}» не найден — его удалили из папки?`);
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

  return {
    access, setAccess, allow,
    agents: list, hello, bye,
    record, journal, takeJournal, adoptJournal,
    scripts, scriptCode, saveScript,
    scriptsDir,
    close: () => clearInterval(sweep),
  };
}

export type Integrations = ReturnType<typeof createIntegrations>;
