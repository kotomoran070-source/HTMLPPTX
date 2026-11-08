/**
 * «Файл → Интеграции» (docs/INTEGRATIONS.md): подразделы Агенты, Скрипты, Журнал правок, Плагины, Коннекторы.
 * Здесь — то, что настраивают и смотрят; рядом со слайдами остаются плашка «кто на связи», меню «Скрипты»
 * и подсказка о правке агента (integrations.ts). Грузится, когда раздел открыли впервые.
 */
import { icon } from '../components/icons';
import './integrations.css';
import { agentLook, ago, api, canRevert, defaults, edits, revertAgent, runScript, slideOf, type AgentInfo, type IntegrationsCtx, type JournalEntry, type ScriptInfo, type ScriptParam, type Section } from './integrations';

type Access = 'view' | 'edit' | 'all';
interface Info { access: Access; agents: AgentInfo[]; mcp: { command: string; args: string[] } | null; scripts: string }
type Cmd = { command: string; args: string[] };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Аргумент командной строки: в кавычках, если в нём пробелы и прочее */
const q = (s: string) => (/^[\w./:=@\\-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`);
/** Строка TOML: буквальная ('C:\путь' — без экранирования), с кавычкой внутри — обычная */
const toml = (s: string) => (s.includes("'") ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `'${s}'`);
const jsonCfg = (key: string, extra: Record<string, string> = {}) => (c: Cmd) => JSON.stringify({ [key]: { slideria: { ...extra, command: c.command, args: c.args } } }, null, 2);
const shell = (cli: string) => (c: Cmd) => `${cli} mcp add slideria -- ${[c.command, ...c.args].map(q).join(' ')}`;

interface Variant { label: string; where: string; snippet(c: Cmd): string }
interface Client { id: string; name: string; mono: string; bg: string; step: string; variants: Variant[]; note?: string }
const CLAUDE = agentLook('Claude').bg;
/** Клиенты MCP: как выглядит подключение у каждого (без своих знаков — буквы на плашке) */
const CLIENTS: Client[] = [
  { id: 'claude-code', name: 'Claude Code', mono: 'C', bg: CLAUDE, step: 'Выполните в терминале',
    variants: [{ label: 'Команда', where: 'Выполните в терминале', snippet: shell('claude') }] },
  { id: 'claude-desktop', name: 'Claude Desktop', mono: 'C', bg: CLAUDE, step: 'Вставьте в настройки и перезапустите Claude',
    variants: [{ label: 'Настройки', where: 'Claude → Настройки → Разработчик → Изменить конфигурацию; добавьте в mcpServers и перезапустите', snippet: jsonCfg('mcpServers') }] },
  { id: 'codex', name: 'ChatGPT · Codex', mono: 'AI', bg: 'linear-gradient(135deg,#475569,#0F172A)', step: 'Выполните — Codex в терминале, приложении и редакторе подключит Slideria сам',
    variants: [
      { label: 'Команда', where: 'Codex от OpenAI — вход тем же аккаунтом ChatGPT. Выполните в терминале', snippet: shell('codex') },
      { label: 'config.toml', where: 'Или добавьте в файл ~/.codex/config.toml', snippet: (c) => `[mcp_servers.slideria]\ncommand = ${toml(c.command)}\nargs = [${c.args.map(toml).join(', ')}]` },
    ],
    note: 'В окне самого ChatGPT свои коннекторы подключаются только по адресу в интернете (режим разработчика → коннекторы) — до Slideria на этом компьютере оно не дотянется. Это придёт вместе с облаком Slideria, а пока с вашим аккаунтом ChatGPT работает Codex.' },
  { id: 'cursor', name: 'Cursor', mono: 'CU', bg: 'linear-gradient(135deg,#334155,#0B1220)', step: 'Вставьте в настройки MCP',
    variants: [{ label: 'mcp.json', where: 'Cursor → Settings → MCP → Add new global MCP server (файл ~/.cursor/mcp.json)', snippet: jsonCfg('mcpServers') }] },
  { id: 'vscode', name: 'VS Code', mono: 'VS', bg: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', step: 'Вставьте в mcp.json',
    variants: [{ label: 'mcp.json', where: 'Файл .vscode/mcp.json в папке проекта или «MCP: Add Server» в палитре команд', snippet: jsonCfg('servers', { type: 'stdio' }) }] },
  { id: 'other', name: 'Другой клиент', mono: '…', bg: 'linear-gradient(135deg,#94A3B8,#64748B)', step: 'Укажите команду в настройках клиента',
    variants: [{ label: 'Команда', where: 'Любой клиент MCP с запуском по команде (stdio)', snippet: (c) => `Команда:   ${c.command}\nАргументы: ${c.args.join(' ')}\nПротокол:  MCP, stdin/stdout` }] },
];
const CLIENT_KEY = 'slideria-mcp-client';

const ASK = ['Подставь компанию и дату на титул', 'Сделай слайды из этих заметок', 'Переведи презентацию на английский', 'Сократи текст на слайдах 3–5', 'Напиши скрипт, который нумерует слайды'];
const ACCESS: { id: Access; icon: string; name: string; sub: string }[] = [
  { id: 'view', icon: 'eye', name: 'Смотреть', sub: 'Читать презентации и сохранять в PDF, PowerPoint, HTML' },
  { id: 'edit', icon: 'pencil', name: 'Править', sub: 'И менять слайды, создавать новые презентации' },
  { id: 'all', icon: 'script', name: 'Всё', sub: 'И сохранять свои скрипты в папку скриптов' },
];
const SUBS: [Section, string, string][] = [['agents', 'agent', 'Агенты'], ['scripts', 'script', 'Скрипты'], ['log', 'journal', 'Журнал правок'], ['plugins', 'plug', 'Плагины'], ['connectors', 'cloud', 'Коннекторы']];

const NEW_SCRIPT = `// @name Мой скрипт
// @description Что делает — одной строкой: видно в списке скриптов
// @param text: text = "Привет" — Подпись поля
export default async function ({ deck, outline, apply, slide, selection, params, log }) {
  // outline() — слайды и объекты с номерами; apply — операции (docs/OPS.md), одним шагом отмены
  apply({ op: 'slide.set', slide, set: { notes: params.text } });
  log('Готово');
}
`;

let root: HTMLElement | null = null;
let ctx: IntegrationsCtx | null = null;
const state = {
  info: null as Info | null,
  journal: [] as JournalEntry[],
  scope: 'deck' as 'deck' | 'all',
  client: (() => { try { const c = localStorage.getItem(CLIENT_KEY); if (CLIENTS.some((x) => x.id === c)) return c!; } catch { /* нет доступа */ } return 'claude-code'; })(),
  variant: 0,
  /** Итог последнего запуска скрипта; «!» в начале — ошибка */
  results: {} as Record<string, string>,
  busy: '',
  shown: '' as Section | '',
};
/** Значения полей скриптов, пока раздел открыт */
const values = new Map<string, Record<string, unknown>>();
/** Развёрнутые длинные пакеты журнала */
const expanded = new Set<string>();
const bound = new WeakSet<HTMLElement>();

/** Нарисовать раздел в el (file-panel.ts перерисовывает «Файл» — el каждый раз новый) */
export function mount(el: HTMLElement, c: IntegrationsCtx): void {
  ctx = c;
  root = el;
  state.shown = '';
  if (!bound.has(el)) {
    bound.add(el);
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKey);
  }
  render();
  void load();
}

/** Сервер сообщил новое: раздел открыт — обновить то, что видно */
export function update(c: IntegrationsCtx, what: 'agents' | 'log'): void {
  ctx = c;
  if (!root?.isConnected) return;
  if (what === 'log') void loadJournal().then(() => (c.view.sub === 'log' ? render() : paintTabs()));
  else if (c.view.sub === 'agents') render();
  else paintTabs();
}

async function load(): Promise<void> {
  try {
    const [info, scripts] = await Promise.all([api<Info>('integrations'), api<ScriptInfo[]>('scripts')]);
    state.info = info;
    ctx?.setAgents(info.agents);
    ctx?.setScripts(scripts);
    await loadJournal();
  } catch (e) {
    ctx?.host.editor.toast(`Интеграции: ${(e as Error).message}`, 4000, true);
  }
  if (root?.isConnected) render();
}

async function loadJournal(): Promise<void> {
  const h = ctx!.host;
  state.journal = await api<JournalEntry[]>(`journal${state.scope === 'deck' ? `?deck=${encodeURIComponent(h.deckKey)}` : ''}`).catch(() => []);
}

// ---------------- разметка ----------------

function tabsHtml(): string {
  const c = ctx!;
  const online = c.agents().filter((a) => a.online).length;
  const badge: Record<Section, string> = {
    agents: online ? `<i class="live">${online} на связи</i>` : '',
    scripts: c.scripts().length ? `<i>${c.scripts().length}</i>` : '',
    log: c.recent() ? `<i title="Правки агентов за сутки">${c.recent()}</i>` : '',
    plugins: '<i class="soon">скоро</i>',
    connectors: '<i class="soon">с облаком</i>',
  };
  return SUBS.map(([id, ic, name]) => `<button type="button" class="ig-tab" role="tab" id="ig-t-${id}" data-sub="${id}" aria-controls="ig-pane" aria-selected="${c.view.sub === id}" tabindex="${c.view.sub === id ? 0 : -1}">${icon(ic)}${name}${badge[id]}</button>`).join('');
}
function paintTabs(): void {
  const t = root?.querySelector('.ig-tabs');
  if (!t) return;
  const had = t.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.sub : '';
  t.innerHTML = tabsHtml();
  if (had) t.querySelector<HTMLElement>(`[data-sub="${had}"]`)?.focus({ preventScroll: true });
}

function render(): void {
  if (!root || !ctx) return;
  const sub = ctx.view.sub;
  const fresh = state.shown !== sub;
  const focus = focusKey();
  const body = { agents: agentsHtml, scripts: scriptsHtml, log: logHtml, plugins: pluginsHtml, connectors: connectorsHtml }[sub]();
  root.innerHTML = `<div class="fp-head ig-head"><div><h2>Интеграции</h2><p>Агенты, скрипты и плагины правят презентацию теми же операциями, что и вы: с проверкой, журналом и «Вернуть».</p></div>
      <span class="ig-local">${icon('lock')}Всё на этом компьютере, без интернета</span></div>
    <div class="ig-tabs" role="tablist" aria-label="Интеграции">${tabsHtml()}</div>
    <div class="ig-pane${fresh ? ' in' : ''}" id="ig-pane" role="tabpanel" aria-labelledby="ig-t-${sub}">${body}</div>`;
  state.shown = sub;
  if (focus) root.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
}

/** Фокус на элементе раздела — вернуть его после перерисовки (клавиатура) */
function focusKey(): string {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !root?.contains(a)) return '';
  for (const k of ['sub', 'access', 'client', 'variant', 'script', 'scope', 'p']) {
    const v = a.dataset[k];
    if (v !== undefined) return `[data-${k}="${CSS.escape(v)}"]`;
  }
  if (a.hasAttribute('data-run')) return '[data-run]';
  return '';
}

function avatar(name: string, online?: boolean, size = '', script = false): string {
  if (script) return `<span class="ig-av k ${size}">${icon('script')}</span>`;
  const l = agentLook(name);
  return `<span class="ig-av ${size}${online === undefined ? '' : online ? ' on' : ' off'}" style="background:${l.bg}">${esc(l.initials)}<i></i></span>`;
}
const hm = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

function agentsHtml(): string {
  const info = state.info;
  const agents = ctx!.agents();
  const on = agents.filter((a) => a.online);
  const off = agents.filter((a) => !a.online);
  // Последняя правка агента — из журнала (он загружен для этой презентации или всех)
  const lastEdit = (name: string) => state.journal.find((e) => e.by.kind === 'agent' && e.by.name === name);
  const live = (a: AgentInfo) => {
    const last = lastEdit(a.name);
    return `<div class="ig-live">${avatar(a.name, true)}
      <div class="ig-live-n">${esc(a.name)}<span class="ig-pill">на связи с ${hm(a.since)}</span></div>
      <button type="button" class="fp-btn" data-sub="log">${icon('journal')}Его правки</button>
      <div class="ig-stats"><div><b>${a.edits}</b><span>${plural(a.edits, 'правка', 'правки', 'правок')}</span></div>
        ${last ? `<div><b>${hm(Date.parse(last.t))}</b><span>последняя правка</span></div>` : ''}
        ${a.version ? `<div><b>${esc(a.version)}</b><span>версия</span></div>` : ''}</div>
    </div>`;
  };
  const row = (a: AgentInfo) => `<div class="ig-ag">${avatar(a.name, false, 's')}<div><div class="ig-n">${esc(a.name)}</div><div class="ig-m">был ${ago(a.seen)}${a.version ? ` · ${esc(a.version)}` : ''}</div></div><div class="ig-m">${edits(a.edits)}</div></div>`;
  const who = agents.length ? on.map(live).join('') + off.map(row).join('')
    : `<div class="ig-none">${icon('agent')}<div><b>Пока никто не подключался</b><span>Подключите агента ниже — он появится здесь, а его правки — в журнале.</span></div></div>`;
  const access = info?.access ?? 'edit';
  return `<div class="ig-top">
      <section class="fp-card ig-who"><h3 class="fp-k ig-cap">Подключены <button type="button" class="fp-link" data-sub="log">Журнал правок →</button></h3>${who}</section>
      <section class="fp-card ig-access"><h3 class="fp-k">Что можно агентам</h3>
        <div class="ig-acc" role="radiogroup" aria-label="Что можно агентам">${ACCESS.map((a) => `<button type="button" role="radio" data-access="${a.id}" aria-checked="${a.id === access}"><span class="ig-ai">${icon(a.icon)}</span><b>${a.name}</b><small>${a.sub}</small><span class="ig-rd"></span></button>`).join('')}</div>
        <div class="ig-note">${icon('shield')}<span>Удалить презентацию агент не может. Каждая правка проверяется и применяется целиком — или не применяется; перед ней — контрольная точка.</span></div>
      </section>
    </div>
    <section class="fp-card ig-connect"><h3 class="fp-k">Подключить агента</h3>${connectHtml(info)}</section>`;
}

function connectHtml(info: Info | null): string {
  if (!info) return '<div class="ig-m">Загрузка…</div>';
  if (!info.mcp) {
    return `<div class="ig-none">${icon('clock')}<div><b>Подключение агентов к установленной программе — в ближайшем обновлении</b><span>Сейчас агенты подключаются к Slideria, запущенной из папки проекта (docs/MCP.md).</span></div></div>`;
  }
  const c = CLIENTS.find((x) => x.id === state.client) ?? CLIENTS[0];
  const v = c.variants[Math.min(state.variant, c.variants.length - 1)];
  const snippet = v.snippet(info.mcp);
  return `<div class="ig-clients" role="tablist" aria-label="Агент">${CLIENTS.map((x) => `<button type="button" class="ig-client" role="tab" data-client="${x.id}" aria-selected="${x.id === c.id}"><span class="ig-mono" style="background:${x.bg}">${esc(x.mono)}</span>${esc(x.name)}</button>`).join('')}</div>
    <div class="ig-code">
      <div class="ig-code-h"><span>${esc(v.where)}</span>
        ${c.variants.length > 1 ? `<span class="ig-vars" role="radiogroup" aria-label="Вид">${c.variants.map((x, i) => `<button type="button" role="radio" data-variant="${i}" aria-checked="${x === v}">${esc(x.label)}</button>`).join('')}</span>` : ''}
        <button type="button" class="ig-copy" data-copy="${esc(snippet)}">${icon('copy')}<span>Скопировать</span></button></div>
      <pre>${esc(snippet)}</pre>
    </div>
    ${c.note ? `<div class="ig-callout">${icon('cloud')}<span>${esc(c.note)}</span></div>` : ''}
    <ol class="ig-steps"><li><b>1</b><span>Скопируйте — путь к Slideria на этом компьютере уже в строке</span></li><li><b>2</b><span>${esc(c.step)}</span></li><li><b>3</b><span>Попросите агента о чём-нибудь — он появится в «Подключены»</span></li></ol>
    <h3 class="fp-k ig-mt">Можно попросить</h3>
    <div class="ig-asks">${ASK.map((t) => `<button type="button" class="ig-ask" data-copy="${esc(t)}" title="Скопировать">${icon('copy')}${esc(t)}</button>`).join('')}</div>`;
}

function field(sid: string, p: ScriptParam, v: unknown): string {
  const name = esc(`${sid}::${p.key}`);
  if (p.type === 'bool') return `<label class="ig-fb"><input type="checkbox" data-p="${name}"${v ? ' checked' : ''}>${esc(p.label)}</label>`;
  const label = `<span>${esc(p.label)}</span>`;
  if (p.type === 'lines') return `<label class="ig-f">${label}<textarea rows="4" data-p="${name}">${esc(v)}</textarea></label>`;
  if (p.type === 'choice') return `<label class="ig-f">${label}<select data-p="${name}">${(p.options ?? []).map((o) => `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
  return `<label class="ig-f">${label}<input type="${p.type === 'number' ? 'number' : 'text'}" value="${esc(v)}" data-p="${name}"></label>`;
}

function scriptsHtml(): string {
  const list = ctx!.scripts();
  const dir = state.info?.scripts ?? '';
  const view = ctx!.view;
  if (!list.some((s) => s.id === view.script)) view.script = list[0]?.id ?? null;
  const s = list.find((x) => x.id === view.script);
  const cards = list.map((x) => `<button type="button" class="ig-sc" role="radio" data-script="${esc(x.id)}" aria-checked="${x.id === view.script}"><span class="ig-si">${icon('script')}</span>
      <span class="ig-n">${esc(x.name)}<i class="ig-tag">${x.builtin ? 'встроенный' : 'свой'}</i></span><small>${esc(x.description || x.file)}</small><span class="ig-rd"></span></button>`).join('');
  const res = s ? state.results[s.id] : '';
  const v = s ? (values.get(s.id) ?? defaults(s)) : {};
  const side = s ? `<aside class="fp-card ig-side">
      <h3>${esc(s.name)}</h3>${s.description ? `<p>${esc(s.description)}</p>` : ''}
      ${s.params.map((p) => field(s.id, p, v[p.key])).join('')}
      ${res ? `<div class="ig-res${res.startsWith('!') ? ' err' : ''}">${esc(res.replace(/^!/, ''))}</div>` : ''}
      <button type="button" class="fp-btn go" data-run="${esc(s.id)}"${state.busy === s.id ? ' disabled' : ''}>${icon('play')}${state.busy === s.id ? 'Выполняется…' : 'Запустить'}</button>
      <div class="ig-hint">${icon('undo')}<span>«Файл» закроется — результат сразу на слайдах. Весь запуск — один шаг Ctrl+Z, запись — в журнале.</span></div>
    </aside>` : '';
  const openDir = (window as unknown as { slideriaApp?: { openPath?: unknown } }).slideriaApp?.openPath;
  return `<div class="ig-sx">
      <div class="ig-scs" role="radiogroup" aria-label="Скрипт">${cards}<button type="button" class="ig-sc add" data-a="new-script">${icon('plus')}<span>Новый скрипт</span></button></div>
      ${side}
    </div>
    <section class="fp-card ig-how"><span class="ig-hi">${icon('agent')}</span>
      <div><b>Скрипт может написать агент</b><span class="ig-m">«Напиши скрипт для Slideria, который…» — он сохранит его сюда (нужно разрешение «Всё»). Свои — файлы .js в папке</span>${dir ? `<code>${esc(dir)}</code>` : ''}</div>
      <div class="ig-acts"><button type="button" class="fp-btn" data-a="new-script">${icon('plus')}Новый скрипт</button>${openDir ? `<button type="button" class="fp-btn" data-a="open-dir">${icon('frame')}Открыть папку</button>` : `<button type="button" class="fp-btn" data-copy="${esc(dir)}">${icon('copy')}<span>Путь к папке</span></button>`}</div>
    </section>`;
}

/** «Сегодня», «Вчера», «5 ноября» */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

function logHtml(): string {
  const h = ctx!.host;
  const scope = `<div class="fp-seg" role="radiogroup" aria-label="Чьи правки">${[['deck', 'Эта презентация'], ['all', 'Все презентации']].map(([id, n]) => `<button type="button" role="radio" data-scope="${id}" aria-checked="${state.scope === id}">${n}</button>`).join('')}</div>`;
  const bar = `<div class="ig-lbar">${scope}<span class="ig-m">«Вернуть» откатывает одну правку агента и не трогает того, что поправили после неё.</span></div>`;
  if (!state.journal.length) {
    return `${bar}<div class="fp-card ig-empty">${icon('journal')}<div><b>Пока пусто</b><span>Здесь появятся правки агентов и скриптов — с тем, что было и что стало.</span></div></div>`;
  }
  const days = new Map<string, string[]>();
  state.journal.forEach((e, k) => {
    const here = e.deck === h.deckKey;
    const key = `${e.t}|${e.by.name}`;
    const canUndo = here && canRevert(e);
    // Длинный пакет (скрипт на все слайды) — первые три и «Ещё N»
    const long = e.changes.length > 5 && !expanded.has(key);
    const rows = (long ? e.changes.slice(0, 3) : e.changes).map((c) => `<div class="ig-row"><div><div class="ig-rl">${esc(c.label)}</div>${c.was || c.now ? `<div class="ig-diff">${c.was ? `<del>${esc(c.was)}</del>` : ''}${c.was && c.now ? '<span>→</span>' : ''}${c.now ? `<ins>${esc(c.now)}</ins>` : ''}</div>` : ''}</div>`
      + `${(() => { const at = here ? slideOf(h.deck, c) : -1; return at >= 0 ? `<button type="button" class="ig-sl" data-go="${at + 1}" title="Перейти к слайду">${icon('frame')}Слайд ${at + 1}</button>` : '<span></span>'; })()}</div>`).join('');
    const html = `<section class="fp-card ig-entry">
      <div class="ig-eh">${avatar(e.by.name, undefined, 's', e.by.kind === 'script')}<div class="ig-who2"><b>${esc(e.by.name)}</b><span class="ig-m">${e.by.kind === 'script' ? 'скрипт · ' : ''}${hm(Date.parse(e.t))}${here ? '' : ` · «${esc(e.deck)}»`} · ${edits(e.changes.length)}</span></div>
        ${canUndo ? `<button type="button" class="fp-btn" data-undo="${k}">${icon('undo')}Вернуть</button>` : ''}</div>
      <div class="ig-rows">${rows}</div>
      ${long ? `<button type="button" class="ig-more" data-more="${esc(key)}">Ещё ${edits(e.changes.length - 3)}</button>` : ''}
    </section>`;
    const day = dayLabel(Date.parse(e.t));
    days.set(day, [...(days.get(day) ?? []), html]);
  });
  return `${bar}${[...days].map(([d, list]) => `<div class="ig-day"><h3 class="fp-k">${esc(d)}</h3>${list.join('')}</div>`).join('')}`;
}

const kind = (ic: string, n: string, p: string, eg: string) => `<div class="fp-card ig-kind"><span class="ig-si">${icon(ic)}</span><b>${n}</b><p>${p}</p><div class="ig-eg"><span>например:</span> ${eg}</div></div>`;
function pluginsHtml(): string {
  return `<section class="fp-card ig-hero"><span class="ig-hero-i">${icon('plug')}</span><div><h3>Плагины — следующий шаг</h3><p>Как скрипт, но пакетом: свои блоки на слайдах, кнопки на ленте и форматы. Установка — из папки и каталога, с разрешениями, как у расширений браузера. Правят теми же операциями, что агенты: каждая правка видна в журнале и отменяется.</p></div></section>
    <div class="ig-kinds">${kind('grid', 'Свой блок', 'Новый вид объекта или слайда: со своими полями в «Свойствах», в PowerPoint и PDF.', 'карта офисов, таймлайн из задач')}${kind('script', 'Команда', 'Кнопка на ленте или в Ctrl+K: действие над презентацией операциями правки.', '«Проверить фирменный стиль»')}${kind('cycle', 'Импорт и экспорт', 'Свой формат на входе или выходе: из таблицы, из базы знаний, в свою систему.', 'слайды из таблицы')}</div>
    <div class="ig-callout">${icon('agent')}<span>Плагин со своим MCP-сервером подключается как агент — в «Агенты», а его команды появятся здесь.</span></div>`;
}
function connectorsHtml(): string {
  return `<section class="fp-card ig-hero"><span class="ig-hero-i">${icon('cloud')}</span><div><h3>Коннекторы — вместе с облаком</h3><p>Данные из других сервисов прямо на слайдах: вход один раз, обновление по кнопке или перед показом, а в экспорт — снимок на момент сохранения.</p></div></section>
    <div class="ig-kinds">${kind('database', 'Таблицы и базы', 'Цифры для графиков и таблиц — из таблицы или базы, всегда свежие.', 'выручка по месяцам')}${kind('users', 'Рабочие сервисы', 'Задачи, сделки, люди — карточками и списками на слайде.', 'статус проекта на планёрку')}${kind('link', 'Через агента', 'Агент по MCP умеет это уже сейчас: возьмёт данные и поправит слайды. Коннекторы сделают это без него.', '«возьми цифры из отчёта»')}</div>`;
}

// ---------------- действия ----------------

function show(sub: Section): void {
  ctx!.view.sub = sub;
  render();
  // Скрипт мог появиться, пока раздел открыт (сохранил агент, положили в папку) — список заново
  if (sub === 'scripts') void api<ScriptInfo[]>('scripts').then((list) => { ctx?.setScripts(list); if (root?.isConnected && ctx?.view.sub === 'scripts') render(); }, () => null);
}

function copy(text: string, b: HTMLElement): void {
  const label = b.querySelector('span');
  const was = label?.textContent;
  void navigator.clipboard?.writeText(text).then(() => {
    if (label && was) { label.textContent = 'Скопировано'; setTimeout(() => { if (label.isConnected) label.textContent = was; }, 1400); } else ctx?.host.editor.toast('Скопировано', 1500);
  }, () => ctx?.host.editor.toast('Не удалось скопировать: выделите и скопируйте вручную', 3000, true));
}

function onClick(e: MouseEvent): void {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!t || !ctx || !root?.contains(t)) return;
  const h = ctx.host;
  const d = t.dataset;
  if (d.sub) return show(d.sub as Section);
  if (d.copy !== undefined) return copy(d.copy, t);
  if (d.client) {
    state.client = d.client;
    state.variant = 0;
    try { localStorage.setItem(CLIENT_KEY, d.client); } catch { /* нет доступа */ }
    return render();
  }
  if (d.variant) { state.variant = Number(d.variant); return render(); }
  if (d.access) {
    void api<{ access: Access }>('integrations-set', { agents: d.access }).then((r) => {
      if (state.info) state.info.access = r.access;
      if (root?.isConnected) render();
      h.editor.toast(`Агентам можно: ${ACCESS.find((a) => a.id === r.access)?.name.toLowerCase()}`, 2000);
    }, (err) => h.editor.toast((err as Error).message, 4000, true));
    return;
  }
  if (d.script) { ctx.view.script = d.script; return render(); }
  if (d.scope) { state.scope = d.scope as 'deck' | 'all'; expanded.clear(); void loadJournal().then(render); return; }
  if (d.more) { expanded.add(d.more); return render(); }
  if (d.go) { ctx.close(); h.go(Number(d.go) - 1); return; }
  if (d.undo) {
    const entry = state.journal[Number(d.undo)];
    if (entry) void revertAgent(h, entry).catch((err) => h.editor.toast(`Не удалось вернуть: ${(err as Error).message}`, 4000, true));
    return;
  }
  if (d.run) return void run(d.run);
  if (d.a === 'new-script') return void newScript();
  if (d.a === 'open-dir') void (window as unknown as { slideriaApp: { openPath(p: string): Promise<void> } }).slideriaApp.openPath(state.info?.scripts ?? '');
}

/** Поле скрипта поменяли — значение запоминается (до запуска и после перерисовки) */
function onChange(e: Event): void {
  const el = e.target as HTMLInputElement;
  const key = el.dataset.p;
  if (!key) return;
  const [sid, pk] = key.split('::');
  const s = ctx?.scripts().find((x) => x.id === sid);
  if (!s) return;
  const p = s.params.find((x) => x.key === pk);
  const v = values.get(sid) ?? defaults(s);
  v[pk] = p?.type === 'bool' ? el.checked : p?.type === 'number' ? Number(el.value) : el.value;
  values.set(sid, v);
}

/** Подразделы — стрелками влево и вправо, как вкладки */
function onKey(e: KeyboardEvent): void {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('.ig-tab');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const ids = SUBS.map(([id]) => id);
  const i = ids.indexOf(tab.dataset.sub as Section);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
  show(ids[next]);
  root?.querySelector<HTMLElement>(`.ig-tab[data-sub="${ids[next]}"]`)?.focus();
}

async function run(id: string): Promise<void> {
  const c = ctx!;
  const s = c.scripts().find((x) => x.id === id);
  if (!s || state.busy) return;
  // Значения из формы — и те, что не трогали (поле без change)
  root?.querySelectorAll<HTMLInputElement>(`[data-p^="${CSS.escape(id)}::"]`).forEach((el) => onChange({ target: el } as unknown as Event));
  state.busy = id;
  render();
  try {
    const r = await runScript(c.host, id, values.get(id));
    const logs = r.logs.length ? ` · ${r.logs.join(' · ')}` : '';
    state.results[id] = r.changes ? `Готово: ${edits(r.changes)} · отменить — Ctrl+Z${logs}` : `Ничего не поменялось${logs}`;
    void loadJournal();
    // Поменял — «Файл» закрывается: результат на слайдах, итог — в подсказке студии
    if (r.changes) { state.busy = ''; c.close(); return; }
  } catch (err) {
    state.results[id] = `!${(err as Error).message}`;
  }
  state.busy = '';
  if (!root?.isConnected) return;
  render();
  // Кнопка на время запуска выключалась — фокус к ней обратно (Esc, Tab — дальше с неё)
  root.querySelector<HTMLElement>('[data-run]')?.focus({ preventScroll: true });
}

async function newScript(): Promise<void> {
  const c = ctx!;
  const taken = new Set(c.scripts().map((s) => s.file));
  let file = 'мой скрипт.js';
  for (let i = 2; taken.has(file); i++) file = `мой скрипт ${i}.js`;
  try {
    const s = await api<ScriptInfo>('script-save', { file, code: NEW_SCRIPT });
    c.setScripts(await api<ScriptInfo[]>('scripts'));
    c.view.sub = 'scripts';
    c.view.script = s.id;
    state.results[s.id] = `Создан: ${state.info?.scripts ?? ''}/${file} — откройте его в редакторе кода и поправьте`;
    if (root?.isConnected) render();
  } catch (e) {
    c.host.editor.toast((e as Error).message, 4000, true);
  }
}
