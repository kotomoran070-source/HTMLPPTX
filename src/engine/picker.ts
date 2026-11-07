import { icon } from '../components/icons';
import type { Deck } from '../types';
import { accentTail, accentTokens, applyAccent, DEFAULT_ACCENT, HEX_RE, slideAccent } from './accent';
import { brandMark, updateFavicon } from './brand';
import { pageEnv } from './env';
import { onServer } from './events';
import { staticSlide } from './deck-view';
import { esc } from './html';
import { currentTheme, toggleTheme } from './theme';
import './picker.css';
import { leave, themeFade } from './motion';

type Loaders = Record<string, () => Promise<Deck>>;

/** Сводка презентации из списка сервера: карточка сразу с названием и числом слайдов, без «имени папки» */
export interface DeckInfo { name: string; mtime: number; title?: string; slides?: number; source?: string; error?: true }

/** Презентация на странице: что показано в карточке и строке списка */
interface Item { name: string; title: string; mtime: number; slides: number; source: string; error: boolean }

type View = 'grid' | 'list';
type Sort = 'date' | 'title' | 'slides';
/** Сколько показывать сразу и сколько добавляет «Показать ещё»: страница не тянет сотню миниатюр разом */
const PAGE: Record<View, number> = { grid: 16, list: 25 };
const KEY = 'slideria-picker';

/** Значки, которых нет среди значков слайдов */
const DOTS = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>';
const FOLDER = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const SHARE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>';

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** «5 минут назад», «вчера», «12 сентября» */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.round(h / 24);
  if (d === 1) return 'вчера';
  if (d < 7) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  const date = new Date(ms);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

const slidesText = (n: number) => `${n} ${plural(n, 'слайд', 'слайда', 'слайдов')}`;
/** Строка под названием карточки: число слайдов и когда правили */
const metaLine = (it: Item) => [slidesText(it.slides), ...(it.mtime ? [ago(it.mtime)] : [])].map(esc).join(' · ');
/** Папка с презентациями — для людей: «Документы/Slideria», без косой черты в конце */
const folderName = () => pageEnv().decks.replace(/[\\/]+$/, '');
const studioHref = (n: string) => `?deck=${encodeURIComponent(n)}&studio`;
const showHref = (n: string) => `?deck=${encodeURIComponent(n)}`;
const appApi = () => (window as { slideriaApp?: { reveal?: (name: string) => Promise<boolean> } }).slideriaApp;

/** Подтверждение и удаление презентации (папка уходит в корзину .trash). */
async function remove(it: Item, thumb: HTMLElement | undefined, done: () => void): Promise<void> {
  const box = document.createElement('div');
  box.className = 'imp-bd';
  box.innerHTML = `<div class="imp pk-confirm" role="alertdialog" aria-modal="true" aria-labelledby="del-h" aria-describedby="del-d">
    <div class="pk-confirm-head"><span class="pk-confirm-icon">${icon('trash')}</span><h2 id="del-h">Удалить презентацию?</h2></div>
    <div class="pk-confirm-deck"><div class="pk-confirm-thumb"></div><div><b>${esc(it.title)}</b><span>${metaLine(it)}</span></div></div>
    <p class="pk-confirm-note" id="del-d">Презентация переместится в корзину — папку «.trash» в «${esc(folderName())}». Передумаете — перенесите её папку обратно.</p>
    <div class="imp-body"></div>
    <div class="imp-actions"><button type="button" class="btn pk-neutral" data-a="cancel">Отмена</button><button type="button" class="btn pk-danger" data-a="ok">${icon('trash')}Удалить</button></div>
  </div>`;
  // Миниатюра первого слайда — та же, что на карточке
  const holder = box.querySelector<HTMLElement>('.pk-confirm-thumb')!;
  if (thumb) holder.appendChild(thumb.cloneNode(true));
  document.body.append(box);
  await import('./import-ui.css');
  // Копия миниатюры не знает своего размера: масштаб под ширину окна
  const stage = holder.querySelector<HTMLElement>('.thumb-stage');
  if (stage) stage.style.transform = `scale(${holder.clientWidth / 1280})`;
  const ok = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
  const cancel = box.querySelector<HTMLButtonElement>('[data-a="cancel"]')!;
  const close = () => { leave(box, { box: '.imp' }); removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  };
  addEventListener('keydown', onKey, true);
  cancel.onclick = close;
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  cancel.focus();
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true;
    try {
      const res = await fetch(`/__htmlpptx/delete?deck=${encodeURIComponent(it.name)}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `ошибка ${res.status}`);
      close();
      // Карточка уходит на месте — страница не перезагружается
      done();
    } catch (e) {
      box.querySelector('.imp-body')!.innerHTML = `<p class="imp-err">Не удалось: ${esc((e as Error).message)}</p>`;
      ok.disabled = cancel.disabled = false;
    }
  };
}

/** Новая презентация: название и старт — пустая или с примерами; после создания открывается редактор. */
async function create(): Promise<void> {
  const box = document.createElement('div');
  box.className = 'imp-bd';
  box.innerHTML = `<div class="imp pk-create" role="dialog" aria-modal="true" aria-labelledby="new-h">
    <h2 id="new-h">Новая презентация</h2>
    <label class="imp-name">Название <input spellcheck="false" autocomplete="off" maxlength="120" placeholder="Новая презентация"></label>
    <fieldset class="imp-mode"><legend>Начать</legend>
      <label><input type="radio" name="new-kind" value="empty" checked><span><b>Пустая</b><small>Один титульный слайд с названием.</small></span></label>
      <label><input type="radio" name="new-kind" value="sample"><span><b>С примерами</b><small>Титул, ключевые числа, карточки, процесс, графики, таблица, свободный слайд и финал — чтобы заменить своим.</small></span></label>
    </fieldset>
    <div class="imp-body"></div>
    <div class="imp-actions"><button type="button" class="btn ghost" data-a="cancel">Отмена</button><button type="button" class="btn primary" data-a="ok">Создать</button></div>
  </div>`;
  document.body.append(box);
  await import('./import-ui.css');
  const input = box.querySelector('input')!;
  const ok = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
  const cancel = box.querySelector<HTMLButtonElement>('[data-a="cancel"]')!;
  const close = () => { box.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !ok.disabled) { e.preventDefault(); ok.click(); }
    e.stopPropagation();
  };
  addEventListener('keydown', onKey, true);
  cancel.onclick = close;
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  input.focus();
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true;
    const sample = box.querySelector<HTMLInputElement>('input[value="sample"]')!.checked;
    try {
      const res = await fetch(`/__htmlpptx/create?title=${encodeURIComponent(input.value.trim())}&sample=${sample ? 1 : 0}`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { name?: string; error?: string };
      if (!res.ok || !data.name) throw new Error(data.error ?? `ошибка ${res.status}`);
      close();
      location.href = `?deck=${encodeURIComponent(data.name)}&studio`;
    } catch (e) {
      box.querySelector('.imp-body')!.innerHTML = `<p class="imp-err">Не удалось: ${esc((e as Error).message)}</p>`;
      ok.disabled = cancel.disabled = false;
    }
  };
}

/** Цвета акцента презентации для её миниатюры (у каждой карточки свои). */
function accentVars(deck: Deck): string {
  const a = deck.theme?.accent;
  const a2 = deck.theme?.accent2;
  const ok = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);
  if (!ok(a) && !ok(a2)) return '';
  const t = accentTokens(ok(a) ? a : DEFAULT_ACCENT, accentTail(deck.theme))[currentTheme() === 'dark' ? 'dark' : 'light'];
  return Object.entries(t).map(([k, v]) => `${k}:${v}`).join(';');
}

/** Меню «⋯» у карточки и строки: открыть, показать, папка, удалить */
function itemMenu(btn: HTMLElement, items: { label: string; ic: string; danger?: boolean; a: string; run(): void }[]): void {
  document.querySelector('.pk-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'pk-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, k) => (it.danger ? '<hr>' : '') + `<button type="button" role="menuitem" data-k="${k}" data-a="${it.a}"${it.danger ? ' class="danger"' : ''}>${it.ic}<span>${esc(it.label)}</span></button>`).join('');
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  const up = r.bottom + 6 + menu.offsetHeight > innerHeight - 8;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))}px`;
  menu.style.top = `${up ? Math.max(8, r.top - menu.offsetHeight - 6) : r.bottom + 6}px`;
  if (up) menu.dataset.up = '';
  btn.setAttribute('aria-expanded', 'true');
  const close = () => {
    if (!menu.isConnected || menu.getRootNode() !== document) return;
    btn.setAttribute('aria-expanded', 'false');
    leave(menu);
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', close, true);
    removeEventListener('resize', close);
  };
  const outside = (e: Event) => { if (!menu.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => {
    const list = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { close(); btn.focus(); } else if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  menu.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-k]');
    if (!b) return;
    close();
    items[Number(b.dataset.k)].run();
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  addEventListener('scroll', close, true);
  addEventListener('resize', close);
  menu.querySelector('button')?.focus({ preventScroll: true });
}

/**
 * Страница выбора презентации: шапка с поиском, импортом и новой презентацией; плитки с первым слайдом или
 * список (вид и порядок запоминаются); показывается порция, остальное — «Показать ещё». Щелчок — редактор,
 * при наведении — «Показ» и «Править», в «⋯» — папка и удаление. info — сводки из списка сервера: название и
 * число слайдов видны сразу, догружаются только миниатюры. Готова (ответ), когда видимые миниатюры нарисованы
 * (не дольше 0,8 с): так страница появляется целиком, без «выпрыгивающих» миниатюр
 */
export async function showPicker(decks: Loaders, dev: boolean, info: DeckInfo[] = []): Promise<void> {
  // Свой цвет интерфейса (если включён в студии); цвета презентаций — у их миниатюр
  applyAccent(null, null);
  const about = new Map(info.map((d) => [d.name, d]));
  const items: Item[] = Object.keys(decks).map((name) => {
    const d = about.get(name);
    return { name, title: d?.title || name, mtime: d?.mtime ?? 0, slides: d?.slides ?? 0, source: d?.source ?? '', error: !!d?.error };
  });
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { view?: View; sort?: Sort }; } catch { return {}; } })();
  const st = {
    view: (saved.view === 'list' ? 'list' : 'grid') as View,
    sort: (['date', 'title', 'slides'].includes(saved.sort ?? '') ? saved.sort : 'date') as Sort,
    dir: 1,
    q: '',
    limit: 0,
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ view: st.view, sort: st.sort })); } catch { /* приватный режим */ } };
  const app = pageEnv().app;

  document.body.classList.add('picker-page');
  document.title = 'Презентации · Slideria';
  updateFavicon(undefined);
  document.body.innerHTML = `
<div class="pk">
  <header class="pk-top" id="pk-top"><div class="pk-bar">
    <div class="pk-brand"><span class="pk-mark">${brandMark()}</span><span>Slideria</span></div>
    <label class="pk-search">${icon('search')}<input id="pk-q" type="search" placeholder="Найти презентацию" aria-label="Найти презентацию" autocomplete="off" spellcheck="false"><kbd>Ctrl K</kbd></label>
    <div class="pk-acts">
      ${dev ? `<button class="pk-btn" id="pk-import" type="button" title="PowerPoint или HTML — или перетащите файл в окно">${icon('upload')}<span>Импорт</span></button>
      <button class="pk-btn primary" id="pk-new" type="button">${icon('plus')}<span>Новая презентация</span></button>` : ''}
      <button class="pk-btn pk-ibtn theme-btn" id="pk-theme" type="button" aria-label="Переключить тему (T)" title="Тема (T)">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
    </div>
  </div></header>
  <main class="pk-main">
    <section class="pk-hero">
      <div><h1>Презентации</h1><p></p></div>
      <div class="pk-tools">
        <select class="pk-sel" id="pk-sort" aria-label="Порядок">
          <option value="date">Сначала недавние</option><option value="title">По названию</option><option value="slides">По числу слайдов</option>
        </select>
        <div class="pk-seg" role="group" aria-label="Вид">
          <button type="button" data-v="grid" title="Плитки">${icon('grid')}<span>Плитки</span></button>
          <button type="button" data-v="list" title="Список">${icon('list')}<span>Список</span></button>
        </div>
      </div>
    </section>
    <div id="pk-view" class="pk-view"></div>
  </main>
  <footer class="pk-foot">${app
    // Приложение: коротко и по-человечески — что можно сделать прямо здесь
    ? `<p>${icon('upload')}<span>Перетащите в окно презентацию PowerPoint или HTML-файл — например, из Claude Design или из чата с Claude. Slideria перенесёт слайды, тексты и картинки.</span></p>
    <p>${SHARE}<span>Чтобы поделиться, выберите в редакторе «Экспорт»: получится один файл, который откроется на любом компьютере — без программы и интернета.</span></p>${appBuild()}`
    : `<p>${icon('terminal')}<span><code>yarn build имя</code> — один HTML-файл для показа и отправки: <code>dist/имя.html</code></span></p>
    <p>${icon('doc')}<span>Правила своего HTML — <code>docs/HTML.md</code>, импорт из Claude Design — <code>docs/CLAUDE-DESIGN.md</code></span></p>`}
  </footer>
</div>`;

  const view = document.getElementById('pk-view')!;
  const hero = document.querySelector<HTMLElement>('.pk-hero p')!;
  const q = document.getElementById('pk-q') as HTMLInputElement;
  const sortSel = document.getElementById('pk-sort') as HTMLSelectElement;

  // ---------- миниатюры: первый слайд, рисуется один раз и переезжает между плитками и списком ----------
  let leaving = false;
  addEventListener('beforeunload', () => { leaving = true; });
  const loaded = new Map<string, Deck>();
  const thumbs = new Map<string, HTMLElement>();
  const filling = new Map<string, Promise<void>>();
  const byName = (n: string) => items.find((x) => x.name === n);
  /** Миниатюра — на своё место в карточке или строке (если она сейчас показана) */
  const place = (name: string) => {
    const slot = view.querySelector<HTMLElement>(`.pk-thumb[data-for="${CSS.escape(name)}"]`);
    const it = byName(name);
    if (!slot || !it) return;
    const t = thumbs.get(name);
    if (it.error) slot.innerHTML = '<div class="pk-ph pk-bad">Ошибка в файле</div>';
    else if (t) { slot.replaceChildren(t); }
  };
  /** Название и число слайдов — из самой презентации (вдруг файл правили после списка) */
  const syncInfo = (it: Item) => {
    view.querySelectorAll<HTMLElement>(`[data-name="${CSS.escape(it.name)}"] .pk-title`).forEach((t) => { if (t.textContent !== it.title) t.textContent = it.title; });
    view.querySelectorAll<HTMLElement>(`[data-name="${CSS.escape(it.name)}"] .pk-when`).forEach((t) => { const s = metaLine(it); if (t.innerHTML !== s) t.innerHTML = s; });
    view.querySelectorAll<HTMLElement>(`[data-name="${CSS.escape(it.name)}"] .pk-n`).forEach((t) => { if (t.textContent !== String(it.slides)) t.textContent = String(it.slides); });
  };
  const fill = (name: string, again = false): Promise<void> => {
    if (!again && filling.has(name)) return filling.get(name)!;
    const p = (async () => {
      const it = byName(name);
      if (!it) return;
      try {
        const deck = await decks[name]();
        if ((deck as unknown as { __error?: string }).__error) { it.error = true; place(name); return; }
        it.error = false;
        loaded.set(name, deck);
        it.title = deck.title || name;
        it.slides = deck.slides?.length ?? 0;
        const src = (deck as { source?: unknown }).source;
        if (typeof src === 'string') it.source = src;
        syncInfo(it);
        if (!it.slides) { thumbs.delete(name); place(name); return; }
        const t = staticSlide(deck, 0);
        t.setAttribute('style', `${t.getAttribute('style') ?? ''};${accentVars(deck)}`);
        // Слайд карточки — в цветах своей презентации (как слайд со своими цветами, см. accent.ts):
        // так он верен и при своём цвете интерфейса, и в обеих темах
        const own = slideAccent(deck.theme);
        const sl = t.querySelector('.slide');
        if (own && sl && !sl.hasAttribute('data-accent')) sl.setAttribute('data-accent', own);
        // Миниатюра проявляется (pk-in), а не выпрыгивает
        t.classList.add('pk-in');
        thumbs.set(name, t);
        place(name);
      } catch (e) {
        if (!leaving) console.error(e);
      }
    })();
    filling.set(name, p);
    return p;
  };
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      io!.unobserve(en.target);
      void fill((en.target as HTMLElement).dataset.for!);
    }), { rootMargin: '300px' })
    : null;

  // ---------- что показано: поиск, порядок, порция ----------
  const shownList = () => {
    const needle = st.q.trim().toLocaleLowerCase('ru');
    const out = items.filter((it) => !needle || it.title.toLocaleLowerCase('ru').includes(needle) || it.name.toLowerCase().includes(needle));
    const cmp: Record<Sort, (a: Item, b: Item) => number> = {
      date: (a, b) => b.mtime - a.mtime,
      title: (a, b) => a.title.localeCompare(b.title, 'ru'),
      slides: (a, b) => b.slides - a.slides,
    };
    return out.sort((a, b) => cmp[st.sort](a, b) * st.dir || a.name.localeCompare(b.name));
  };
  const heroText = (found: number) => (items.length
    ? (st.q.trim() ? `Найдено <b>${found}</b> из ${items.length}` : `<b>${items.length}</b> ${plural(items.length, 'презентация', 'презентации', 'презентаций')}`) + ` в папке «${esc(folderName())}»`
    : 'Здесь появятся ваши презентации');
  const thumbSlot = (it: Item, cls = '') => `<div class="pk-thumb${cls}" data-for="${esc(it.name)}">${it.error ? '<div class="pk-ph pk-bad">Ошибка в файле</div>' : '<div class="pk-ph"></div>'}</div>`;
  const badge = (it: Item) => (it.source ? `<span class="pk-badge">${esc(it.source)}</span>` : '');

  function render(keepLimit = false): void {
    if (!keepLimit) st.limit = PAGE[st.view];
    const list = shownList();
    hero.innerHTML = heroText(list.length);
    document.querySelector<HTMLElement>('.pk-tools')!.hidden = !items.length;
    document.querySelectorAll<HTMLElement>('.pk-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.view)));
    sortSel.value = st.sort;
    io?.disconnect();
    if (!items.length) {
      view.innerHTML = `<div class="pk-empty"><b>Пока нет ни одной презентации</b><span>Создайте новую или перетащите в окно файл PowerPoint или HTML.</span>${dev
        ? `<div class="pk-acts"><button class="pk-btn" type="button" data-a="import">${icon('upload')}<span>Выбрать файл</span></button><button class="pk-btn primary" type="button" data-a="new">${icon('plus')}<span>Новая презентация</span></button></div>` : ''}</div>`;
      return;
    }
    if (!list.length) {
      view.innerHTML = `<div class="pk-empty"><b>Ничего не нашлось</b><span>По запросу «${esc(st.q.trim())}» нет презентаций. Проверьте написание или очистите поиск.</span></div>`;
      return;
    }
    // Одинаковые названия различаются папкой
    const count = new Map<string, number>();
    items.forEach((it) => count.set(it.title, (count.get(it.title) ?? 0) + 1));
    const folder = (it: Item) => ((count.get(it.title) ?? 0) > 1 ? `<span class="pk-folder" title="Папка в «${esc(folderName())}»">Папка: ${esc(it.name)}</span>` : '');
    const vis = list.slice(0, st.limit);
    const more = (n: string) => `<button type="button" class="pk-more" data-more="${esc(n)}" aria-label="Ещё" aria-haspopup="menu" aria-expanded="false">${DOTS}</button>`;
    if (st.view === 'grid') {
      view.innerHTML = `<div class="pk-grid" id="pk-grid">${vis.map((it) => `<div class="pk-item" data-name="${esc(it.name)}">
        <a class="pk-card${it.error ? ' pk-err' : ''}" href="${studioHref(it.name)}" data-name="${esc(it.name)}" title="Открыть в редакторе">
          ${thumbSlot(it)}
          <div class="pk-info"><b class="pk-title">${esc(it.title)}</b><span class="pk-meta"><span class="pk-when">${metaLine(it)}</span>${badge(it)}</span>${folder(it)}</div>
        </a>
        <div class="pk-hover"><a class="pk-pill" href="${showHref(it.name)}">${icon('play')}<span>Показ</span></a><a class="pk-pill ac" href="${studioHref(it.name)}">${icon('pencil')}<span>Править</span></a></div>
        ${more(it.name)}
      </div>`).join('')}</div>`;
    } else {
      const arrow = (k: Sort) => `<span class="pk-arr">${st.sort === k ? (st.dir > 0 ? '↓' : '↑') : ''}</span>`;
      view.innerHTML = `<div class="pk-table"><table>
        <thead><tr><th data-k="title">Название ${arrow('title')}</th><th data-k="slides" class="num">Слайдов ${arrow('slides')}</th><th data-k="date">Изменена ${arrow('date')}</th><th>Источник</th><th><span class="pk-sr">Действия</span></th></tr></thead>
        <tbody>${vis.map((it) => `<tr class="pk-row" data-name="${esc(it.name)}">
          <td><div class="pk-rt">${thumbSlot(it, ' sm')}<div class="pk-rt-t"><a class="pk-title" href="${studioHref(it.name)}">${esc(it.title)}</a>${folder(it)}</div></div></td>
          <td class="num pk-n">${it.slides}</td><td class="pk-date">${it.mtime ? esc(ago(it.mtime)) : '—'}</td><td>${it.source ? badge(it) : '<span class="pk-none">—</span>'}</td>
          <td><div class="pk-racts"><a class="pk-rb" href="${showHref(it.name)}">${icon('play')}<span>Показ</span></a><a class="pk-rb" href="${studioHref(it.name)}">${icon('pencil')}<span>Править</span></a>${more(it.name)}</div></td>
        </tr>`).join('')}</tbody></table></div>`;
    }
    const left = list.length - vis.length;
    if (left > 0) view.insertAdjacentHTML('beforeend', `<div class="pk-morebar"><button class="pk-btn" type="button" id="pk-showmore">Показать ещё ${Math.min(left, PAGE[st.view])} <small>· всего ${list.length}</small></button></div>`);
    // Миниатюры: готовые — сразу на место, остальные — когда покажутся
    vis.forEach((it) => {
      if (thumbs.has(it.name) || it.error) place(it.name);
      else {
        const slot = view.querySelector<HTMLElement>(`.pk-thumb[data-for="${CSS.escape(it.name)}"]`);
        if (slot) { if (io) io.observe(slot); else void fill(it.name); }
      }
    });
  }

  // ---------- действия ----------
  const theme = () => {
    // Миниатюры с акцентом презентации пересчитываются под новую тему
    thumbs.forEach((t, n) => { const d = loaded.get(n); if (d) t.setAttribute('style', `${(t.getAttribute('style') ?? '').split(';').filter((s) => !s.trim().startsWith('--')).join(';')};${accentVars(d)}`); });
  };
  const swap = () => themeFade(() => { toggleTheme(); theme(); });
  document.getElementById('pk-theme')!.onclick = swap;
  addEventListener('keydown', (e) => {
    const typing = (e.target as Element).closest('input, textarea, select');
    if ((e.key === 't' || e.key === 'е') && !e.ctrlKey && !e.metaKey && !typing) swap();
    // Поиск: Ctrl+K или «/»
    if (((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'л')) || (e.key === '/' && !typing)) { e.preventDefault(); q.focus(); q.select(); }
  });
  q.addEventListener('input', () => { st.q = q.value; render(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; st.q = ''; render(); } });
  sortSel.addEventListener('change', () => { st.sort = sortSel.value as Sort; st.dir = 1; save(); render(); });
  document.querySelector('.pk-seg')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
    if (!b || b.dataset.v === st.view) return;
    st.view = b.dataset.v as View;
    save();
    render();
  });
  // Шапка с тенью, когда страница прокручена
  const top = document.getElementById('pk-top')!;
  addEventListener('scroll', () => top.classList.toggle('scrolled', scrollY > 4), { passive: true });

  /** Удалённая презентация уходит со страницы: плавно, число в заголовке — меньше */
  const drop = (name: string) => {
    const i = items.findIndex((x) => x.name === name);
    if (i < 0) return;
    items.splice(i, 1);
    thumbs.delete(name);
    const el = view.querySelector<HTMLElement>(`[data-name="${CSS.escape(name)}"]`);
    if (!el) { render(true); return; }
    el.classList.add('pk-gone');
    setTimeout(() => render(true), 260);
  };
  const openMenu = (btn: HTMLElement) => {
    const it = byName(btn.dataset.more!);
    if (!it) return;
    const api = appApi();
    itemMenu(btn, [
      { label: 'Править', ic: icon('pencil'), a: 'edit', run: () => { location.href = studioHref(it.name); } },
      { label: 'Показ', ic: icon('play'), a: 'show', run: () => { location.href = showHref(it.name); } },
      ...(api?.reveal ? [{ label: 'Показать в папке', ic: FOLDER, a: 'folder', run: () => { void api.reveal!(it.name); } }] : []),
      ...(dev ? [{ label: 'Удалить…', ic: icon('trash'), a: 'del', danger: true, run: () => void remove(it, thumbs.get(it.name), () => drop(it.name)) }] : []),
    ]);
  };
  view.addEventListener('click', (e) => {
    const t = e.target as Element;
    const m = t.closest<HTMLElement>('.pk-more');
    if (m) { e.preventDefault(); openMenu(m); return; }
    if (t.closest('#pk-showmore')) { st.limit += PAGE[st.view]; render(true); return; }
    const a = t.closest<HTMLElement>('[data-a]');
    if (a?.dataset.a === 'new') { void create(); return; }
    if (a?.dataset.a === 'import') { document.getElementById('pk-import')?.click(); return; }
    const th = t.closest<HTMLElement>('th[data-k]');
    if (th) {
      const k = th.dataset.k as Sort;
      st.dir = st.sort === k ? -st.dir : 1;
      st.sort = k;
      save();
      render(true);
      return;
    }
    // Строка списка — целиком: щелчок мимо ссылок и кнопок открывает редактор
    const row = t.closest<HTMLElement>('.pk-row');
    if (row && !t.closest('a, button')) location.href = studioHref(row.dataset.name!);
  });

  // Удалили в другом окне (или из студии): карточка уходит и здесь, без перезагрузки
  onServer('deck-removed', (d) => drop(d.name));
  // Папку презентации положили или убрали руками — список заново (если на этой странице он и правда другой:
  // страница, открытая уже после этого, его показывает)
  onServer('decks', (e) => {
    const shown = new Set(items.map((x) => x.name));
    if (e.added.some((n) => !shown.has(n)) || e.removed.some((n) => shown.has(n))) location.reload();
  });
  // deck.yaml поправили со стороны — карточка заново (название, слайды, миниатюра)
  onServer('deck-changed', (d) => {
    const it = byName(d.name);
    if (!it) return;
    it.mtime = Date.now();
    void fill(d.name, true);
  });

  const newBtn = document.getElementById('pk-new');
  if (newBtn) newBtn.onclick = () => void create();
  // Импорт — по готовности своего кода: миниатюры его не ждут
  if (dev) {
    void import('./import-ui').then((m) => {
      const ui = m.setupImport();
      document.getElementById('pk-import')!.onclick = ui.pick;
    });
  }

  render();
  // Видимые миниатюры — до показа страницы (не дольше 0,8 с), остальные — по мере прокрутки
  const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight + 200; };
  const first = [...view.querySelectorAll<HTMLElement>('.pk-thumb[data-for]')].filter(inView).map((s) => s.dataset.for!);
  await Promise.race([Promise.all(first.map((n) => fill(n))), new Promise((r) => setTimeout(r, 800))]);
}

/** Сборка программы: установленная — снимок кода на день сборки, новое из проекта появится с новой сборкой */
function appBuild(): string {
  const b = (window as { slideriaApp?: { build?: { version?: string; date?: string; commit?: string } } }).slideriaApp?.build;
  if (!b) return '';
  return `<span class="pk-build">Slideria ${esc(b.version ?? '')} · ${b.date ? `сборка от ${esc(b.date)}${b.commit ? ` (${esc(b.commit)})` : ''}` : 'запуск из проекта'}</span>`;
}
