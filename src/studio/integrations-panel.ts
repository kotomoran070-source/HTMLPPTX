/**
 * Большая панель «Интеграции» под лентой (docs/INTEGRATIONS.md): Агенты, Коннекторы (с облаком), Скрипты,
 * Плагины, Журнал правок. Грузится при первом открытии — студия открывается без неё.
 */
import { icon } from '../components/icons';
import './integrations.css';
import { agentLook, ago, api, defaults, edits, revertAgent, runScript, type AgentInfo, type IntegrationsCtx, type JournalEntry, type ScriptInfo, type ScriptParam, type Section } from './integrations';
import { leave } from '../engine/motion';

type Access = 'view' | 'edit' | 'all';
interface Info { access: Access; agents: AgentInfo[]; mcp: { command: string; args: string[] } | null; scripts: string }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Клиенты MCP: как выглядит строка подключения у каждого */
const CLIENTS: { id: string; name: string; where: string; snippet(c: { command: string; args: string[] }): string }[] = [
  {
    id: 'claude-code', name: 'Claude Code', where: 'Выполните в терминале',
    snippet: (c) => `claude mcp add slideria -- ${[c.command, ...c.args].map(q).join(' ')}`,
  },
  {
    id: 'claude-desktop', name: 'Claude Desktop', where: 'Claude → Настройки → Разработчик → Изменить конфигурацию; добавьте в mcpServers и перезапустите Claude',
    snippet: (c) => JSON.stringify({ mcpServers: { slideria: { command: c.command, args: c.args } } }, null, 2),
  },
  {
    id: 'cursor', name: 'Cursor', where: 'Cursor → Settings → MCP → Add new global MCP server (файл ~/.cursor/mcp.json)',
    snippet: (c) => JSON.stringify({ mcpServers: { slideria: { command: c.command, args: c.args } } }, null, 2),
  },
  {
    id: 'vscode', name: 'VS Code', where: 'Файл .vscode/mcp.json в папке проекта или «MCP: Add Server» в палитре команд',
    snippet: (c) => JSON.stringify({ servers: { slideria: { type: 'stdio', command: c.command, args: c.args } } }, null, 2),
  },
  {
    id: 'other', name: 'Другой MCP-клиент', where: 'Любой клиент MCP с запуском по команде (stdio)',
    snippet: (c) => `Команда:   ${c.command}\nАргументы: ${c.args.join(' ')}\nПротокол:  MCP, stdin/stdout`,
  },
];
const q = (s: string) => (/^[\w./:=@-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`);

const ASK = ['Подставь компанию и дату на титул', 'Сделай слайды из этих заметок', 'Переведи презентацию на английский', 'Сократи текст на слайдах 3–5', 'Напиши скрипт, который нумерует слайды'];

const ACCESS: { id: Access; name: string; sub: string }[] = [
  { id: 'view', name: 'Смотреть', sub: 'читать и экспорт' },
  { id: 'edit', name: 'Править', sub: 'и создавать новые' },
  { id: 'all', name: 'Всё', sub: 'и писать скрипты' },
];

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
let state: { section: Section; info: Info | null; journal: JournalEntry[]; scope: 'deck' | 'all'; client: string; open: string | null; results: Record<string, string> } = {
  section: 'agents', info: null, journal: [], scope: 'deck', client: 'claude-code', open: null, results: {},
};
let current: IntegrationsCtx | null = null;

export function openPanel(ctx: IntegrationsCtx, section: Section, script?: string): void {
  current = ctx;
  state.section = section;
  if (script) state.open = script;
  if (!root) mount();
  root!.hidden = false;
  // Подсказка о правке агента — под панелью ни к чему: всё то же — в журнале
  document.getElementById('st-int-toast')?.classList.remove('on');
  document.body.classList.add('si-open');
  syncRibbon();
  render();
  void load();
  root!.querySelector<HTMLElement>('.si')?.focus();
}

/** Сервер сообщил новое: панель открыта на этом разделе — обновить */
export function update(ctx: IntegrationsCtx, section: Section): void {
  if (!root || root.hidden) return;
  current = ctx;
  if (section === 'log') void loadJournal().then(render);
  else render();
}

function close(): void {
  if (!root) return;
  // Панель прячется сразу, гаснет её копия (engine/motion.ts)
  if (!root.hidden) leave(root, { copy: true, fade: true });
  root.hidden = true;
  document.body.classList.remove('si-open');
  syncRibbon();
}

/** Кнопка раздела на ленте — нажатой, пока панель открыта на нём */
function syncRibbon(): void {
  const open = root && !root.hidden;
  const map: Record<Section, string> = { agents: 'int.agents', scripts: 'int.scripts', plugins: 'int.plugins', log: 'int.log' };
  for (const [sec, cmd] of Object.entries(map)) {
    document.querySelector(`.st-ribbon [data-cmd="${cmd}"]`)?.classList.toggle('si-on', !!open && state.section === sec);
  }
}

async function load(): Promise<void> {
  try {
    const [info, scripts] = await Promise.all([api<Info>('integrations'), api<ScriptInfo[]>('scripts')]);
    state.info = info;
    current?.setAgents(info.agents);
    current?.setScripts(scripts);
    await loadJournal();
  } catch (e) {
    current?.host.editor.toast(`Интеграции: ${(e as Error).message}`, 4000, true);
  }
  render();
}

async function loadJournal(): Promise<void> {
  const h = current!.host;
  expanded.clear();
  state.journal = await api<JournalEntry[]>(`journal${state.scope === 'deck' ? `?deck=${encodeURIComponent(h.deckKey)}` : ''}`).catch(() => []);
}

function mount(): void {
  root = document.createElement('div');
  root.className = 'si-root';
  root.hidden = true;
  root.innerHTML = '<div class="si-dim" data-a="close"></div><div class="si" role="dialog" aria-modal="true" aria-label="Интеграции" tabindex="-1"><aside class="si-nav"></aside><main class="si-main"></main></div>';
  document.body.append(root);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  // Esc — закрыть, где бы ни был фокус (после перерисовки раздела он мог уйти на страницу); студии Esc не достаётся
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !root || root.hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }, true);
  // Лента могла поменять высоту (свернули, окно уже) — панель встаёт под неё
  addEventListener('resize', place);
}

function place(): void {
  if (!root || root.hidden) return;
  const rib = document.querySelector<HTMLElement>('.st-ribbon');
  const top = rib && rib.offsetHeight ? rib.getBoundingClientRect().bottom : (document.querySelector('.st-top')?.getBoundingClientRect().bottom ?? 0);
  root.style.setProperty('--si-top', `${Math.round(top)}px`);
}

// ---------------- разметка ----------------

function render(): void {
  if (!root || !current) return;
  place();
  const s = state.section;
  const agents = current.agents();
  const online = agents.filter((a) => a.online).length;
  const nav = (id: Section | 'connectors', ic: string, label: string, badge = '', off = false) =>
    `<button type="button" class="si-ni${s === id ? ' on' : ''}" ${off ? 'disabled' : `data-sec="${id}"`}>${icon(ic)}<span>${label}</span>${badge}</button>`;
  const dayAgo = Date.now() - 86_400_000;
  // Как на ленте: правки агентов за сутки
  const recent = state.journal.filter((e) => e.by.kind === 'agent' && e.deck === current!.host.deckKey && Date.parse(e.t) > dayAgo).reduce((n, e) => n + e.changes.length, 0);
  root.querySelector('.si-nav')!.innerHTML = `
    <h2>Интеграции</h2><p class="si-sub">Агенты и расширения студии</p>
    ${nav('agents', 'agent', 'Агенты', online ? `<i class="si-b ok">${online} на связи</i>` : '')}
    ${nav('connectors', 'link', 'Коннекторы', '<i class="si-b soon">с облаком</i>', true)}
    ${nav('scripts', 'script', 'Скрипты', current.scripts().length ? `<i class="si-b">${current.scripts().length}</i>` : '')}
    ${nav('plugins', 'plug', 'Плагины', '<i class="si-b soon">скоро</i>')}
    ${nav('log', 'journal', 'Журнал правок', recent ? `<i class="si-b">${recent}</i>` : '')}
    <div class="si-foot">${icon('lock')}<span>Всё работает на этом компьютере: агенты подключаются к студии напрямую, без интернета.</span></div>`;
  const main = { agents: agentsHtml, scripts: scriptsHtml, plugins: pluginsHtml, log: logHtml }[s]();
  const had = root.contains(document.activeElement);
  root.querySelector('.si-main')!.innerHTML = `<button type="button" class="si-x" data-a="close" aria-label="Закрыть" title="Закрыть (Esc)">${icon('close')}</button>${main}`;
  // Фокус был в панели и пропал вместе с перерисованной кнопкой — остаётся в панели (клавиатура, Tab)
  if (had && !root.contains(document.activeElement)) root.querySelector<HTMLElement>('.si')?.focus({ preventScroll: true });
  syncRibbon();
}

function head(title: string, text: string): string {
  return `<header class="si-h"><h3>${title}</h3><p>${text}</p></header>`;
}

function avatar(name: string, online?: boolean, small = false, script = false): string {
  if (script) return `<span class="si-av k${small ? ' s' : ''}">${icon('script')}</span>`;
  const l = agentLook(name);
  return `<span class="si-av${small ? ' s' : ''}${online === undefined ? '' : online ? ' on' : ' off'}" style="background:${l.bg}">${esc(l.initials)}<i></i></span>`;
}

function agentsHtml(): string {
  const info = state.info;
  const agents = current!.agents();
  const access = info?.access ?? 'edit';
  const list = agents.length ? agents.map((a) => `
    <div class="si-ag">${avatar(a.name, a.online)}
      <div><div class="si-n">${esc(a.name)}</div><div class="si-m">${a.online ? `на связи с ${new Date(a.since).toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' })}` : `был ${ago(a.seen)}`}${a.version ? ` · ${esc(a.version)}` : ''}</div></div>
      <div class="si-st">${a.online ? '<span class="si-live">на связи</span>' : '<span class="si-m">не на связи</span>'}<div class="si-m">${edits(a.edits)}</div></div>
    </div>`).join('') : `<div class="si-none">${icon('agent')}<div><b>Пока никто не подключался</b><span>Подключите агента — он появится здесь, а его правки — в журнале.</span></div></div>`;
  const client = CLIENTS.find((c) => c.id === state.client) ?? CLIENTS[0];
  const connect = info?.mcp
    ? `<div class="si-chips" role="tablist">${CLIENTS.map((c) => `<button type="button" class="si-chip${c.id === client.id ? ' on' : ''}" data-client="${c.id}" role="tab" aria-selected="${c.id === client.id}">${c.name}</button>`).join('')}</div>
       <div class="si-codebar"><span class="si-where">${esc(client.where)}</span><button type="button" class="si-btn" data-copy="${esc(client.snippet(info.mcp))}">${icon('copy')}Скопировать</button></div>
       <div class="si-code"><pre>${esc(client.snippet(info.mcp))}</pre></div>
       <div class="si-steps"><div><b>1</b><span>Скопируйте — путь к Slideria на этом компьютере уже в строке</span></div><div><b>2</b><span>${client.id === 'claude-code' ? 'Выполните в терминале' : 'Вставьте в настройки агента'}</span></div><div><b>3</b><span>Попросите агента — он появится в «Подключены»</span></div></div>`
    : `<div class="si-none">${icon('clock')}<div><b>Подключение агентов к установленной программе — в ближайшем обновлении</b><span>Сейчас агенты подключаются к Slideria, запущенной из папки проекта (docs/MCP.md).</span></div></div>`;
  return `${head('Агенты', 'Claude и любой агент с поддержкой MCP читает, правит и создаёт презентации вместе с вами. Правки агента сразу видны на слайдах, перед каждой — контрольная точка, а Ctrl+Z отменяет ваши правки, не трогая его.')}
    <div class="si-grid">
      <section class="si-card"><div class="si-cap">Подключены <button type="button" class="si-link" data-sec="log">Журнал правок →</button></div>${list}</section>
      <section class="si-card"><div class="si-cap">Что можно агентам</div>
        <div class="si-seg" role="radiogroup" aria-label="Что можно агентам">${ACCESS.map((a) => `<button type="button" role="radio" aria-checked="${a.id === access}" class="${a.id === access ? 'on' : ''}" data-access="${a.id}">${a.name}<small>${a.sub}</small></button>`).join('')}</div>
        <div class="si-note">${icon('shield')}<span>Удалить презентацию агент не может. Каждая правка проверяется и применяется целиком — или не применяется.</span></div>
      </section>
    </div>
    <section class="si-card si-mt"><div class="si-cap">Подключить агента</div>${connect}
      <div class="si-cap si-mt">Можно попросить</div>
      <div class="si-ask">${ASK.map((t) => `<button type="button" data-copy="${esc(t)}" title="Скопировать">${esc(t)}</button>`).join('')}</div>
    </section>`;
}

function field(sid: string, p: ScriptParam, v: unknown): string {
  const name = `${sid}::${p.key}`;
  const label = `<span>${esc(p.label)}</span>`;
  if (p.type === 'bool') return `<label class="si-f si-fb"><input type="checkbox" data-p="${esc(name)}"${v ? ' checked' : ''}>${label}</label>`;
  if (p.type === 'lines') return `<label class="si-f">${label}<textarea rows="3" data-p="${esc(name)}">${esc(v)}</textarea></label>`;
  if (p.type === 'choice') return `<label class="si-f">${label}<select data-p="${esc(name)}">${(p.options ?? []).map((o) => `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
  return `<label class="si-f">${label}<input type="${p.type === 'number' ? 'number' : 'text'}" value="${esc(v)}" data-p="${esc(name)}"></label>`;
}

const values = new Map<string, Record<string, unknown>>();
/** Развёрнутые длинные пакеты журнала */
const expanded = new Set<number>();

function scriptsHtml(): string {
  const list = current!.scripts();
  const dir = state.info?.scripts ?? '';
  const cards = list.map((s) => {
    const open = state.open === s.id;
    const v = values.get(s.id) ?? defaults(s);
    const res = state.results[s.id];
    return `<article class="si-sc${open ? ' open' : ''}" data-script="${esc(s.id)}">
      <div class="si-sch"><span class="si-sci">${icon('script')}</span>
        <div><div class="si-n">${esc(s.name)}${s.builtin ? '<i class="si-tag">встроенный</i>' : ''}</div><div class="si-m">${esc(s.description || s.file)}</div></div>
        <button type="button" class="si-btn p" data-run="${esc(s.id)}">${icon('play')}${s.params.length && !open ? 'Запустить…' : 'Запустить'}</button></div>
      ${open && s.params.length ? `<div class="si-form">${s.params.map((p) => field(s.id, p, v[p.key])).join('')}</div>` : ''}
      ${res ? `<div class="si-res${res.startsWith('!') ? ' err' : ''}">${esc(res.replace(/^!/, ''))}</div>` : ''}
    </article>`;
  }).join('');
  return `${head('Скрипты', 'Свои действия одним файлом — как скрипты в After Effects, только безопаснее: скрипт правит презентацию теми же операциями, что и агенты, весь запуск отменяется одним Ctrl+Z, а сеть, файлы и страница студии ему недоступны.')}
    <div class="si-scs">${cards || '<div class="si-none">Скриптов нет</div>'}</div>
    <div class="si-how si-mt">${icon('agent')}<div><b>Скрипт может написать агент</b><span>«Напиши скрипт для Slideria, который…» — он сохранит его сюда (нужно разрешение «Всё»). Свои — файлы .js в папке:</span><code>${esc(dir)}</code></div>
      <div class="si-acts"><button type="button" class="si-btn" data-a="new-script">${icon('plus')}Новый скрипт</button>${(window as unknown as { slideriaApp?: { openPath?: unknown } }).slideriaApp?.openPath ? `<button type="button" class="si-btn" data-a="open-dir">${icon('frame')}Открыть папку</button>` : `<button type="button" class="si-btn" data-copy="${esc(dir)}">${icon('copy')}Путь к папке</button>`}</div></div>`;
}

function pluginsHtml(): string {
  const kind = (ic: string, n: string, m: string, e: string) => `<div class="si-kind"><span class="si-sci">${icon(ic)}</span><div class="si-n">${n}</div><div class="si-m">${m}</div><div class="si-eg">например: ${e}</div></div>`;
  return `${head('Плагины', 'Расширяют студию своими блоками, командами и форматами. Работают через те же операции, что и агенты: каждая правка проверяется, видна в журнале и отменяется.')}
    <div class="si-empty"><span class="si-art">${icon('plug')}</span><div><b>Плагины — следующий шаг</b><span>Как скрипт, но пакетом: со своими блоками на слайдах, кнопками на ленте и форматами. Установка — из папки и каталога, с разрешениями, как у расширений браузера.</span></div></div>
    <div class="si-kinds">
      ${kind('grid', 'Свой блок', 'Новый вид объекта или слайда: со своими полями в «Свойствах», в PowerPoint и PDF.', 'карта офисов, таймлайн из задач')}
      ${kind('script', 'Команда', 'Кнопка на ленте или в Ctrl+K: действие над презентацией операциями правки.', '«Проверить фирменный стиль»')}
      ${kind('cycle', 'Импорт и экспорт', 'Свой формат на входе или выходе: из таблицы, из базы знаний, в свою систему.', 'слайды из таблицы')}
    </div>
    <div class="si-how si-mt">${icon('agent')}<div><b>Плагин может быть и агентом</b><span>Плагин со своим MCP-сервером подключается в «Агенты», а его команды появятся здесь.</span></div></div>`;
}

function logHtml(): string {
  const h = current!.host;
  const scope = `<div class="si-seg si-seg2" role="radiogroup">${[['deck', 'Эта презентация'], ['all', 'Все']].map(([id, n]) => `<button type="button" role="radio" aria-checked="${state.scope === id}" class="${state.scope === id ? 'on' : ''}" data-scope="${id}">${n}</button>`).join('')}</div>`;
  if (!state.journal.length) {
    return `${head('Журнал правок', 'Что и где поменяли агенты и скрипты: было → стало, переход к слайду, «Вернуть».')}${scope}
      <div class="si-none si-mt">${icon('journal')}<div><b>Пока пусто</b><span>Здесь появятся правки агентов и скриптов — с тем, что было и что стало.</span></div></div>`;
  }
  const entries = state.journal.map((e, k) => {
    const here = e.deck === h.deckKey;
    const canUndo = here && e.by.kind === 'agent' && e.checkpoint && e.after;
    // Длинный пакет (скрипт на все слайды) — первые три и «Ещё N»
    const long = e.changes.length > 5 && !expanded.has(k);
    const rows = (long ? e.changes.slice(0, 3) : e.changes).map((c) => `<div class="si-row"><div><div class="si-n">${esc(c.label)}</div>${c.was || c.now ? `<div class="si-diff">${c.was ? `<del>${esc(c.was)}</del>` : ''}${c.was && c.now ? '<span>→</span>' : ''}${c.now ? `<ins>${esc(c.now)}</ins>` : ''}</div>` : ''}</div>`
      + `${c.slide ? `<button type="button" class="si-sl"${here ? ` data-go="${c.slide}"` : ' disabled'}>Слайд ${c.slide}</button>` : '<span></span>'}</div>`).join('')
      + (long ? `<button type="button" class="si-more" data-more="${k}">Ещё ${edits(e.changes.length - 3)}</button>` : '');
    return `<section class="si-entry">
      <div class="si-eh">${avatar(e.by.name, undefined, true, e.by.kind === 'script')}<b>${esc(e.by.name)}</b><span class="si-m">${e.by.kind === 'script' ? 'скрипт · ' : ''}${ago(Date.parse(e.t))}${here ? '' : ` · «${esc(e.deck)}»`} · ${edits(e.changes.length)}</span>
        ${canUndo ? `<button type="button" class="si-btn" data-undo="${k}">${icon('undo')}Вернуть</button>` : ''}</div>
      ${rows}</section>`;
  }).join('');
  return `${head('Журнал правок', 'Что и где поменяли агенты и скрипты. «Вернуть» откатывает одну правку агента и не трогает того, что поправили после неё.')}${scope}<div class="si-log">${entries}</div>`;
}

// ---------------- действия ----------------

function onClick(e: MouseEvent): void {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button, [data-a]');
  if (!t || !current) return;
  const h = current.host;
  const d = t.dataset;
  if (d.a === 'close') return close();
  if (d.sec) {
    state.section = d.sec as Section;
    render();
    // Скрипт мог появиться, пока панель открыта (сохранил агент, положили в папку) — список заново
    if (d.sec === 'scripts') void api<ScriptInfo[]>('scripts').then((list) => { current?.setScripts(list); render(); }, () => null);
    return;
  }
  if (d.client) { state.client = d.client; render(); return; }
  if (d.copy !== undefined) {
    void navigator.clipboard?.writeText(d.copy).then(() => h.editor.toast('Скопировано', 1500), () => h.editor.toast('Не удалось скопировать: выделите и скопируйте вручную', 3000, true));
    return;
  }
  if (d.access) {
    void api<{ access: Access }>('integrations-set', { agents: d.access }).then((r) => {
      if (state.info) state.info.access = r.access;
      render();
      h.editor.toast(`Агентам можно: ${ACCESS.find((a) => a.id === r.access)?.name.toLowerCase()}`, 2000);
    }, (err) => h.editor.toast((err as Error).message, 4000, true));
    return;
  }
  if (d.scope) { state.scope = d.scope as 'deck' | 'all'; expanded.clear(); void loadJournal().then(render); return; }
  if (d.more) { expanded.add(Number(d.more)); render(); return; }
  if (d.go) { close(); h.go(Number(d.go) - 1); return; }
  if (d.undo) {
    const entry = state.journal[Number(d.undo)];
    if (entry) void revertAgent(h, entry).catch((err) => h.editor.toast(`Не удалось вернуть: ${(err as Error).message}`, 4000, true));
    return;
  }
  if (d.run) return void run(d.run, t as HTMLButtonElement);
  if (d.a === 'new-script') return void newScript();
  if (d.a === 'open-dir') {
    void (window as unknown as { slideriaApp: { openPath(p: string): Promise<void> } }).slideriaApp.openPath(state.info?.scripts ?? '');
  }
}

function onChange(e: Event): void {
  const el = e.target as HTMLInputElement;
  const key = el.dataset.p;
  if (!key) return;
  const [sid, pk] = key.split('::');
  const s = current?.scripts().find((x) => x.id === sid);
  if (!s) return;
  const p = s.params.find((x) => x.key === pk);
  const v = values.get(sid) ?? defaults(s);
  v[pk] = p?.type === 'bool' ? el.checked : p?.type === 'number' ? Number(el.value) : el.value;
  values.set(sid, v);
}

async function run(id: string, b: HTMLButtonElement): Promise<void> {
  const s = current!.scripts().find((x) => x.id === id);
  if (!s) return;
  // Есть поля, а форма не открыта — сначала форма
  if (s.params.length && state.open !== id) { state.open = id; render(); return; }
  // Значения из формы — и те, что не трогали (input без change)
  root!.querySelectorAll<HTMLInputElement>(`[data-p^="${CSS.escape(id)}::"]`).forEach((el) => onChange({ target: el } as unknown as Event));
  b.disabled = true;
  b.classList.add('busy');
  b.lastChild!.textContent = 'Выполняется…';
  try {
    const r = await runScript(current!.host, id, values.get(id));
    state.results[id] = r.changes ? `Готово: ${edits(r.changes)} · отменить — Ctrl+Z${r.logs.length ? ` · ${r.logs.join(' · ')}` : ''}` : `Ничего не поменялось${r.logs.length ? ` · ${r.logs.join(' · ')}` : ''}`;
    await loadJournal();
  } catch (e) {
    state.results[id] = `!${(e as Error).message}`;
  }
  render();
}

async function newScript(): Promise<void> {
  const h = current!.host;
  const taken = new Set(current!.scripts().map((s) => s.file));
  let file = 'мой скрипт.js';
  for (let i = 2; taken.has(file); i++) file = `мой скрипт ${i}.js`;
  try {
    const s = await api<ScriptInfo>('script-save', { file, code: NEW_SCRIPT });
    current!.setScripts(await api<ScriptInfo[]>('scripts'));
    state.open = s.id;
    state.results[s.id] = `Создан: ${state.info?.scripts ?? ''}/${file} — откройте его в редакторе кода и поправьте`;
    render();
  } catch (e) {
    h.editor.toast((e as Error).message, 4000, true);
  }
}
