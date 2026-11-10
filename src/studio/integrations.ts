/**
 * Интеграции (docs/INTEGRATIONS.md): агенты по MCP, скрипты, журнал правок, плагины. Здесь — то, что рядом со
 * слайдами: группа на ленте «Инструменты» (плашка «кто на связи», меню «Скрипты», «Журнал правок»), подсказка
 * о правке агента на холсте, запуск скрипта и «Вернуть» правку агента. Настройка и журнал — раздел
 * «Файл → Интеграции» (integrations-file.ts), он грузится, когда его открыли впервые.
 */
import { icon } from '../components/icons';
import { replaceContents } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { readCheckpoint } from '../engine/editor/persist';
import { onServer } from '../engine/events';
import { merge3 } from '../engine/merge3';
import type { Change } from '../engine/ops';
import type { Deck } from '../types';
import { showMenu } from './menu';
import type { Entry } from './palette';

export interface IntegrationsHost {
  deck: Deck;
  deckKey: string;
  editor: Editor;
  go(i: number): void;
  /** Номер текущего слайда, с 0 */
  index(): number;
  /** Раздел «Файл → Интеграции»: открыть, закрыть «Файл», открыт ли «Файл» */
  file: { open(): void; close(): void; shown(): boolean };
}

export interface AgentInfo { id: string; name: string; version?: string; since: number; seen: number; online: boolean; edits: number }
/** Запись журнала; checkpoint и after — точки до и после правки (нет — уже не хранятся: «Вернуть» недоступно) */
export interface JournalEntry { t: string; deck: string; by: { kind: 'agent' | 'script'; id?: string; name: string }; changes: Change[]; checkpoint?: string; after?: string }
export interface ScriptParam { key: string; type: 'text' | 'lines' | 'number' | 'bool' | 'choice'; label: string; value: unknown; options?: { value: string; label: string }[] }
export interface ScriptInfo { id: string; name: string; description: string; params: ScriptParam[]; builtin: boolean; file: string }
export type Section = 'agents' | 'scripts' | 'log' | 'plugins' | 'connectors';

interface Command { run(): void; enabled?(): boolean }

/** Команда сервера студии (server/http.ts) */
export async function api<T>(cmd: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/__htmlpptx/${cmd}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? undefined : { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('нет связи с сервером студии');
  }
  const data = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `ошибка ${r.status}`);
  return data;
}

/** Цвет знака агента по имени: Claude — свой, остальные — по букве, но всегда одинаково */
export function agentLook(name: string): { bg: string; initials: string } {
  const n = name.toLowerCase();
  if (n.startsWith('claude')) return { bg: 'linear-gradient(135deg,#D97757,#C2410C)', initials: 'C' };
  const hues = [210, 262, 162, 24, 330, 190, 45];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hues[h % hues.length];
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  return { bg: `linear-gradient(135deg,hsl(${hue} 55% 52%),hsl(${hue} 60% 36%))`, initials };
}

/** «2 мин назад», «вчера в 18:40», «12.10 в 9:05» */
export function ago(ms: number): string {
  const d = Date.now() - ms;
  if (d < 45_000) return 'только что';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} мин назад`;
  const t = new Date(ms);
  const hm = t.toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (t.toDateString() === today.toDateString()) return `сегодня в ${hm}`;
  if (t.toDateString() === y.toDateString()) return `вчера в ${hm}`;
  return `${t.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })} в ${hm}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
export const edits = (n: number) => `${n} ${plural(n, 'правка', 'правки', 'правок')}`;

// ---------------- скрипты ----------------

const RUN_MS = 20_000;

/** Значения полей скрипта по умолчанию */
export const defaults = (s: ScriptInfo) => Object.fromEntries(s.params.map((p) => [p.key, p.value]));

/**
 * Запустить скрипт: песочница (script-worker.ts) правит копию данных операциями, итог — одним шагом отмены
 * и записью в журнал. Ответ — сколько правок и строки log() скрипта
 */
export async function runScript(h: IntegrationsHost, id: string, params?: Record<string, unknown>): Promise<{ changes: number; logs: string[] }> {
  if (!h.editor.active) h.editor.toggle(true);
  h.editor.finishText();
  const { info, code } = await api<{ info: ScriptInfo; code: string }>(`script-read?id=${encodeURIComponent(id)}`);
  // Точка до скрипта — по ней «Вернуть» в журнале и «Версиях» (Ctrl+Z живёт только до закрытия окна)
  await h.editor.settle();
  const before = await h.editor.files.checkpoint?.(h.deckKey, 'auto').catch(() => null);
  const values = { ...defaults(info), ...(params ?? {}) };
  const sel = h.editor.selection?.group ?? [];
  const at = h.index();
  const selection = sel.filter((p) => p[0] === 'slides' && p[1] === at && p[2] === 'free').map((p) => Number(p[3]) + 1);
  const worker = new Worker(new URL('./script-worker.ts', import.meta.url), { type: 'module', name: `Скрипт: ${info.name}` });
  const result = await new Promise<{ ok: boolean; deck?: Deck; details?: Change[]; logs: string[]; error?: string }>((done) => {
    const timer = setTimeout(() => { worker.terminate(); done({ ok: false, error: `Скрипт работал дольше ${RUN_MS / 1000} с — остановлен`, logs: [] }); }, RUN_MS);
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); done(e.data); };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); done({ ok: false, error: e.message || 'Скрипт не запустился', logs: [] }); };
    worker.postMessage({ code, deck: JSON.parse(JSON.stringify(h.deck)), params: values, slide: at + 1, selection });
  });
  if (!result.ok) throw new Error(result.error ?? 'Скрипт не выполнился');
  const details = result.details ?? [];
  if (details.length && result.deck) {
    // Одним шагом: Ctrl+Z отменяет весь запуск скрипта
    h.editor.commit((d) => replaceContents(d as unknown as Record<string, unknown>, result.deck as unknown as Record<string, unknown>), { rebuild: true });
    // И точка после — когда правка записана; в журнал — с обеими точками
    void (async () => {
      await h.editor.settle();
      const after = before ? await h.editor.files.checkpoint?.(h.deckKey, 'auto').catch(() => null) : null;
      await api(`journal-add?deck=${encodeURIComponent(h.deckKey)}`, { name: info.name, changes: details, ...(before && after ? { checkpoint: before.id, after: after.id } : {}) });
    })().catch(() => null);
    // Что скрипт сказал через log() — в той же подсказке (раздел «Файл» после запуска закрывается)
    const said = result.logs.length ? ` · ${result.logs.join(' · ').slice(0, 140)}` : '';
    h.editor.toast(`Скрипт «${info.name}»: ${edits(details.length)}${said} · отменить — Ctrl+Z`, said ? 5000 : 3500);
  } else h.editor.toast(`Скрипт «${info.name}» ничего не поменял`, 2500);
  return { changes: details.length, logs: result.logs };
}

// ---------------- «Вернуть» правку агента или скрипта ----------------

/**
 * Где слайд правки сейчас (с 0): по id — и после перестановок; без id — номер на момент правки; слайда больше
 * нет — -1
 */
/** Чат «Агент» студии в журнале (server/agent.ts, CHAT_AGENT) */
export const CHAT_AGENT_ID = 'studio-chat';

export function slideOf(deck: Deck, c: Change): number {
  if (c.id) return deck.slides.findIndex((s) => (s as { id?: unknown }).id === c.id);
  return c.slide && c.slide <= deck.slides.length ? c.slide - 1 : -1;
}

/** У правки есть обе точки — её можно вернуть */
export const canRevert = (e: JournalEntry) => !!(e.checkpoint && e.after);

/**
 * Вернуть правки (агента, скрипта; одну или сеанс агента), не трогая того, что поправили после них: для каждой,
 * от новой к старой, — слияние трёх версий: после правки (база), до неё (своё) и сейчас. Одним шагом отмены
 */
export async function revertEntries(h: IntegrationsHost, list: JournalEntry[], label?: string): Promise<void> {
  const todo = [...list].filter(canRevert).sort((a, b) => b.t.localeCompare(a.t));
  if (!todo.length) throw new Error('У этих правок уже нет контрольных точек');
  await h.editor.settle();
  let cur: unknown = JSON.parse(JSON.stringify(h.deck));
  for (const e of todo) {
    const [before, after] = await Promise.all([readCheckpoint(h.deckKey, e.checkpoint!), readCheckpoint(h.deckKey, e.after!)]);
    cur = merge3(after.deck, before.deck, cur).result;
  }
  if (!h.editor.active) h.editor.toggle(true);
  const done = h.editor.commit((d) => replaceContents(d as unknown as Record<string, unknown>, cur as Record<string, unknown>), { rebuild: true });
  const who = label ?? `«${todo[0].by.name}»`;
  h.editor.toast(done ? `${todo.length > 1 ? 'Правки' : 'Правка'} ${who} ${todo.length > 1 ? 'возвращены' : 'возвращена'} · Ctrl+Z — снова как было` : 'Это уже как было до этих правок', 3500);
}
/** Вернуть одну правку агента или скрипта */
export const revertAgent = (h: IntegrationsHost, e: JournalEntry) => revertEntries(h, [e]);

// ---------------- лента, подсказка на холсте, Ctrl+K ----------------

/**
 * Группа «Интеграции» на вкладке «Инструменты» (studio.ts вставляет её в ленту): плашка «кто на связи»
 * (→ «Файл → Интеграции → Агенты»), меню «Скрипты» и «Журнал правок». Группа ужата — вместо плашки кнопка «Агенты»
 */
export function integrationsRibbon(rb: (cmd: string, ic: string, label: string, o?: { big?: boolean; menu?: boolean; title?: string }) => string): string {
  return rb('int.agents', 'agent', 'Агенты', { big: true, title: 'Агенты по MCP — Claude, ChatGPT и другие: подключения, разрешения и настройка' })
      .replace('class="st-rb big"', 'class="st-rb big st-int-big"')
    + `<button type="button" class="st-int-mini" id="st-int-mini" data-cmd="int.agents" data-pal="skip" title="Агенты: подключения, разрешения и настройка — «Файл → Интеграции»">`
    + `<span class="st-int-av" id="st-int-av">${icon('agent')}</span><span class="st-int-t"><b id="st-int-name">Агентов пока нет</b><small id="st-int-sub">Подключить Claude или другой →</small></span></button>`
    + `<div class="st-rstack">${rb('int.scripts', 'script', 'Скрипты', { menu: true, title: 'Свои действия одним файлом: запустить, все скрипты' })}`
    + `${rb('int.log', 'journal', 'Журнал правок', { title: 'Что поменяли агенты и скрипты: было → стало' })}</div>`;
}

export function startIntegrations(h: IntegrationsHost) {
  let agents: AgentInfo[] = [];
  let scripts: ScriptInfo[] = [];
  let todayChanges = 0;
  let panel: typeof import('./integrations-file') | null = null;

  /** «Файл → Интеграции» на подразделе (и скрипте) */
  const open = (section: Section, script?: string) => {
    ctx.view.sub = section;
    if (script) ctx.view.script = script;
    h.file.open();
  };
  /** «Файл» нарисовал раздел — содержимое отсюда */
  const mount = async (el: HTMLElement) => {
    panel ??= await import('./integrations-file');
    if (el.isConnected) panel.mount(el, ctx);
  };

  /** Плашка на ленте: кто на связи, сколько правок */
  function paintMini(): void {
    const name = document.getElementById('st-int-name');
    const sub = document.getElementById('st-int-sub');
    const av = document.getElementById('st-int-av');
    const mini = document.getElementById('st-int-mini');
    const on = agents.filter((a) => a.online);
    // Агент на связи — точка у «Интеграций» в «Файле»
    document.querySelector('.fp [data-fs="int"]')?.classList.toggle('live', on.length > 0);
    if (!name || !sub || !av || !mini) return;
    const a = on[0] ?? agents[0];
    mini.classList.toggle('empty', !a);
    if (!a) {
      av.innerHTML = icon('agent');
      av.removeAttribute('style');
      name.textContent = 'Агентов пока нет';
      sub.textContent = 'Подключить Claude или другой →';
      return;
    }
    const look = agentLook(a.name);
    av.textContent = look.initials;
    av.style.background = look.bg;
    av.classList.toggle('on', a.online);
    name.textContent = a.online ? `${a.name} на связи${on.length > 1 ? ` и ещё ${on.length - 1}` : ''}` : `${a.name} — не на связи`;
    sub.textContent = a.online ? `${edits(a.edits)} · ${a.edits ? 'последняя ' : 'с '}${ago(a.edits ? a.seen : a.since)}` : `был ${ago(a.seen)}`;
  }

  /** Число правок за сутки на «Журнале правок» */
  function paintCount(): void {
    const b = document.querySelector<HTMLElement>('.st-ribbon [data-cmd="int.log"]');
    if (!b) return;
    let c = b.querySelector<HTMLElement>('.st-int-cnt');
    if (!todayChanges) { c?.remove(); return; }
    if (!c) {
      c = document.createElement('i');
      c.className = 'st-int-cnt';
      b.append(c);
    }
    c.textContent = String(todayChanges);
  }

  /** Подсказка о правке агента на холсте — с «Вернуть» */
  let toastTimer = 0;
  function agentToast(e: JournalEntry): void {
    let el = document.getElementById('st-int-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'st-int-toast';
      el.className = 'st-int-toast';
      el.setAttribute('role', 'status');
      document.body.append(el);
    }
    const first = e.changes[0];
    const more = e.changes.length > 1 ? ` и ещё ${e.changes.length - 1}` : '';
    el.innerHTML = `<b>${esc(e.by.name)}:</b><span>${esc(first?.label ?? 'правка')}${esc(more)}</span>`
      + (e.checkpoint && e.after ? '<button type="button" data-a="undo">Вернуть</button>' : '')
      + '<button type="button" data-a="log">Журнал</button>';
    el.onclick = (ev) => {
      const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'undo') void revertAgent(h, e).catch((err) => h.editor.toast(`Не удалось вернуть: ${(err as Error).message}`, 4000, true));
      if (a === 'log') open('log');
      if (a) el!.classList.remove('on');
    };
    const canvas = document.getElementById('st-canvas')?.getBoundingClientRect();
    if (canvas) el.style.left = `${canvas.left + canvas.width / 2}px`;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el!.classList.remove('on'), 7000);
  }

  /** Правка внешнего агента (MCP): чат «Агент» студии показывает свои правки сам, в своей панели */
  const external = (e: JournalEntry) => e.by.kind === 'agent' && e.by.id !== CHAT_AGENT_ID;

  async function refresh(): Promise<void> {
    try {
      const info = await api<{ agents: AgentInfo[] }>('integrations');
      agents = info.agents;
      paintMini();
      const log = await api<JournalEntry[]>(`journal?deck=${encodeURIComponent(h.deckKey)}&limit=200`);
      const day = Date.now() - 86_400_000;
      // На «Журнале правок» — правки агентов за сутки (скрипты запускали сами — о них знаете)
      todayChanges = log.filter((e) => external(e) && Date.parse(e.t) > day).reduce((n, e) => n + e.changes.length, 0);
      paintCount();
      scripts = await api<ScriptInfo[]>('scripts');
    } catch { /* файл с диска — интеграций нет */ }
  }

  // Сервер сообщает: агент подключился, замолчал или правил; агент или скрипт записал правку
  onServer('agents', (list) => { agents = list as AgentInfo[]; paintMini(); panel?.update(ctx, 'agents'); });
  onServer('journal', (x) => {
    const e = x as JournalEntry;
    if (e.deck !== h.deckKey) return;
    if (external(e)) {
      todayChanges += e.changes.length;
      paintCount();
      // «Файл» открыт — подсказка не нужна: правка видна в «Интеграциях», журнал обновится сам
      if (!h.file.shown()) agentToast(e);
    }
    panel?.update(ctx, 'log');
  });

  const runOrAsk = (s: ScriptInfo) => {
    if (s.params.length) return open('scripts', s.id);
    void runScript(h, s.id).catch((e) => h.editor.toast(`Скрипт «${s.name}»: ${(e as Error).message}`, 6000, true));
  };

  const ctx: IntegrationsCtx = {
    host: h,
    agents: () => agents,
    setAgents: (list: AgentInfo[]) => { agents = list; paintMini(); },
    scripts: () => scripts,
    setScripts: (list: ScriptInfo[]) => { scripts = list; },
    recent: () => todayChanges,
    view: { sub: 'agents', script: null },
    close: () => h.file.close(),
  };

  const commands: Record<string, Command> = {
    'int.agents': { run: () => open('agents'), enabled: () => location.protocol.startsWith('http') },
    'int.log': { run: () => open('log'), enabled: () => location.protocol.startsWith('http') },
    'int.plugins': { run: () => open('plugins'), enabled: () => location.protocol.startsWith('http') },
    'int.scripts': {
      enabled: () => location.protocol.startsWith('http'),
      run: async () => {
        const at = document.querySelector<HTMLElement>('.st-ribbon [data-cmd="int.scripts"]')!;
        // Свежий список: скрипт мог появиться только что (сохранил агент, положили в папку)
        scripts = await api<ScriptInfo[]>('scripts').catch(() => scripts);
        showMenu(at, [
          { head: 'Запустить' },
          ...scripts.map((s) => ({ label: s.name, sub: s.description || (s.builtin ? 'встроенный' : s.file), icon: 'script', run: () => runOrAsk(s) })),
          null,
          { label: 'Все скрипты и новый…', sub: '«Файл → Интеграции»', icon: 'list', run: () => open('scripts') },
        ]);
      },
    },
  };

  /** Скрипты в Ctrl+K: «Скрипт: Оглавление»; плагинов на ленте нет — их раздел тоже здесь */
  const palette = (): Entry[] => [
    ...scripts.map((s) => ({
      id: `script.${s.id}`, label: `Скрипт: ${s.name}`, path: 'Инструменты · Интеграции', words: `скрипт запустить ${s.description}`, key: '',
      ico: icon('script'), run: () => runOrAsk(s), enabled: () => true,
    })),
    { id: 'int.plugins', label: 'Плагины', path: 'Файл · Интеграции', words: 'расширения блоки команды форматы', key: '', ico: icon('plug'), run: () => open('plugins'), enabled: () => location.protocol.startsWith('http') },
    { id: 'int.connectors', label: 'Коннекторы', path: 'Файл · Интеграции', words: 'данные сервисы облако таблицы', key: '', ico: icon('cloud'), run: () => open('connectors'), enabled: () => location.protocol.startsWith('http') },
  ];

  // Не мешаем открытию студии: сведения — когда она уже готова (через пару секунд, в простое браузера);
  // агент, который правит, о себе сообщит и сам — событием
  const later = (window as unknown as { requestIdleCallback?: (f: () => void, o?: object) => void }).requestIdleCallback;
  if (location.protocol.startsWith('http')) setTimeout(() => (later ? later(() => void refresh(), { timeout: 3000 }) : void refresh()), 2500);

  return {
    commands, palette, refresh, mount, open,
    live: () => agents.some((a) => a.online),
    /** Журнал этой презентации и «Вернуть» правки — для «Файл → Версии» */
    journal: () => api<JournalEntry[]>(`journal?deck=${encodeURIComponent(h.deckKey)}&limit=500`),
    revert: (list: JournalEntry[], label: string) => revertEntries(h, list, label),
  };
}

export type IntegrationsCtx = {
  host: IntegrationsHost;
  agents(): AgentInfo[];
  setAgents(list: AgentInfo[]): void;
  scripts(): ScriptInfo[];
  setScripts(list: ScriptInfo[]): void;
  /** Правки агентов в этой презентации за сутки */
  recent(): number;
  /** Что открыто в «Файл → Интеграции»: подраздел и выбранный скрипт */
  view: { sub: Section; script: string | null };
  /** Закрыть «Файл» (результат скрипта, переход к слайду) */
  close(): void;
};
