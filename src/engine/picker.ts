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
const PAGE: Record<View, number> = { grid: 24, list: 30 };
const KEY = 'slideria-picker';

/** Значки, которых нет среди значков слайдов */
const DOTS = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>';
const FOLDER = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const PLAY = '<svg class="ic pk-tri" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
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

/** Свечение под колодой — цветом акцента презентации */
function glowOf(deck: Deck, alpha: number): string {
  const a = deck.theme?.accent;
  const hex = typeof a === 'string' && HEX_RE.test(a) ? a : DEFAULT_ACCENT;
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex.slice(0, 7);
  const n = parseInt(full.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Меню «⋯» у карточки и строки: папка, удаление */
function itemMenu(btn: HTMLElement, items: { label: string; ic: string; danger?: boolean; a: string; run(): void }[]): void {
  document.querySelector('.pk-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'pk-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, k) => (it.danger && k ? '<hr>' : '') + `<button type="button" role="menuitem" data-k="${k}" data-a="${it.a}"${it.danger ? ' class="danger"' : ''}>${it.ic}<span>${esc(it.label)}</span></button>`).join('');
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
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', close);
  };
  const outside = (e: Event) => { if (!menu.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); };
  // Прокрутка закрывает меню, только если увела его кнопку (событие прокрутки, начатой до щелчка, приходит позже)
  const onScroll = () => { const now = btn.getBoundingClientRect(); if (Math.abs(now.top - r.top) > 2 || Math.abs(now.left - r.left) > 2) close(); };
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
  addEventListener('scroll', onScroll, true);
  addEventListener('resize', close);
  menu.querySelector('button')?.focus({ preventScroll: true });
}

/** Группа по времени правки — для порядка «Недавние» */
function bucket(ms: number): string {
  if (!ms) return 'Ранее';
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= day) return 'Сегодня';
  if (ms >= day - 6 * 864e5) return 'На этой неделе';
  if (ms >= day - 30 * 864e5) return 'В этом месяце';
  return 'Ранее';
}

/** Переключатель с переезжающей подложкой (порядок, вид) */
const segHtml = (id: string, label: string, opts: [string, string, string?][], icons = false) => `<div class="pk-seg${icons ? ' pk-icons' : ''}" id="${id}" role="group" aria-label="${label}"><span class="pk-seg-pill" aria-hidden="true"></span>${opts.map(([v, t, ic]) => `<button type="button" data-v="${v}" title="${t}"${icons ? ` aria-label="${t}"` : ''}>${ic ?? ''}${icons ? '' : `<span>${t}</span>`}</button>`).join('')}</div>`;

/**
 * Страница выбора презентации: шапка (поиск, импорт, создать, тема); «Продолжить работу» — последняя
 * презентация крупно, с лентой её слайдов; библиотека — колоды по группам времени или список (вид и порядок
 * запоминаются), показывается порция, остальное — «Показать ещё». Щелчок — редактор, на колоде — «Показ»,
 * в «⋯» — папка и удаление. info — сводки из списка сервера: название и число слайдов видны сразу, догружаются
 * только миниатюры. Готова (ответ), когда видимые миниатюры нарисованы (не дольше 0,8 с): страница появляется
 * целиком, без «выпрыгивающих» миниатюр
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
  const reveal = appApi()?.reveal;
  const hasMenu = dev || !!reveal;

  document.body.classList.add('picker-page');
  document.title = 'Презентации · Slideria';
  updateFavicon(undefined);
  document.body.innerHTML = `
<div class="pk">
  <header class="pk-top" id="pk-top" data-titlebar><div class="pk-bar pk-wide">
    <div class="pk-lead">
      <div class="pk-brand"><span class="pk-mark">${brandMark()}</span><span>Slideria</span></div>
      <div class="pk-acts">
        ${dev ? `<button class="pk-btn" id="pk-import" type="button" title="PowerPoint или HTML — или перетащите файл в окно">${icon('upload')}<span>Импорт</span></button>
        <button class="pk-btn go" id="pk-new" type="button">${icon('plus')}<span>Создать</span></button>` : ''}
        <button class="pk-btn pk-ibtn theme-btn" id="pk-theme" type="button" aria-label="Переключить тему (T)" title="Тема (T)">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
      </div>
    </div>
    <label class="pk-search">${icon('search')}<input id="pk-q" type="search" placeholder="Найти презентацию" aria-label="Найти презентацию" autocomplete="off" spellcheck="false"><kbd>Ctrl K</kbd><button class="pk-clear" id="pk-clear" type="button" aria-label="Очистить поиск" title="Очистить (Esc)" hidden>${icon('close')}</button></label>
  </div></header>
  <main class="pk-main pk-wide">
    <section class="pk-cont" id="pk-cont" hidden></section>
    <section class="pk-lib-head" id="pk-lib-head">
      <div><h2><span id="pk-lib-t">Библиотека</span> <span class="pk-count" id="pk-count"></span></h2><p class="pk-where" id="pk-where"></p></div>
      <div class="pk-tools" id="pk-tools">
        ${segHtml('pk-sort', 'Порядок', [['date', 'Недавние'], ['title', 'А–Я'], ['slides', 'Больше слайдов']])}
        ${segHtml('pk-viewsw', 'Вид', [['grid', 'Плитки', icon('grid')], ['list', 'Список', icon('list')]], true)}
      </div>
    </section>
    <div id="pk-view" class="pk-view pk-deal"></div>
  </main>
  <footer class="pk-foot pk-wide">${app
    // Приложение: коротко и по-человечески — что можно сделать прямо здесь
    ? `<p>${icon('upload')}<span>Перетащите в окно презентацию PowerPoint или HTML-файл — например, из Claude Design или из чата с Claude. Slideria перенесёт слайды, тексты и картинки.</span></p>
    <p>${SHARE}<span>Чтобы поделиться, выберите в редакторе «Экспорт»: получится один файл, который откроется на любом компьютере — без программы и интернета.</span></p>${appBuild()}`
    : `<p>${icon('terminal')}<span><code>yarn build имя</code> — один HTML-файл для показа и отправки: <code>dist/имя.html</code></span></p>
    <p>${icon('doc')}<span>Правила своего HTML — <code>docs/HTML.md</code>, импорт из Claude Design — <code>docs/CLAUDE-DESIGN.md</code></span></p>`}
  </footer>
</div>`;

  const view = document.getElementById('pk-view')!;
  const cont = document.getElementById('pk-cont')!;
  const q = document.getElementById('pk-q') as HTMLInputElement;
  // Первое появление — колоды «раздаются» по очереди; дальше (поиск, порядок) — сразу
  setTimeout(() => view.classList.remove('pk-deal'), 900);

  // ---------- миниатюры: первый слайд, рисуется один раз и переезжает между колодой и строкой списка ----------
  let leaving = false;
  addEventListener('beforeunload', () => { leaving = true; });
  const loaded = new Map<string, Deck>();
  const thumbs = new Map<string, HTMLElement>();
  const filling = new Map<string, Promise<void>>();
  const byName = (n: string) => items.find((x) => x.name === n);
  const slideOf = (deck: Deck, k: number) => {
    const t = staticSlide(deck, k);
    t.setAttribute('style', `${t.getAttribute('style') ?? ''};${accentVars(deck)}`);
    // Слайд — в цветах своей презентации (как слайд со своими цветами, см. accent.ts): так он верен и при
    // своём цвете интерфейса, и в обеих темах
    const own = slideAccent(deck.theme);
    const sl = t.querySelector('.slide');
    if (own && sl && !sl.hasAttribute('data-accent')) sl.setAttribute('data-accent', own);
    // Миниатюра проявляется (pk-in), а не выпрыгивает
    t.classList.add('pk-in');
    return t;
  };
  /** Миниатюра и свечение — на своё место в колоде или строке (если она сейчас показана) */
  const place = (name: string) => {
    const it = byName(name);
    if (!it) return;
    const d = loaded.get(name);
    view.querySelectorAll<HTMLElement>(`[data-name="${CSS.escape(name)}"]`).forEach((el) => { if (d) el.style.setProperty('--glow', glowOf(d, 0.55)); });
    const slot = view.querySelector<HTMLElement>(`.pk-thumb[data-for="${CSS.escape(name)}"]`);
    if (!slot) return;
    const t = thumbs.get(name);
    if (it.error) slot.innerHTML = '<div class="pk-ph pk-bad">Ошибка в файле</div>';
    else if (t) slot.replaceChildren(t);
  };
  /** Название и число слайдов — из самой презентации (вдруг файл правили после списка) */
  const syncInfo = (it: Item) => {
    const sel = `[data-name="${CSS.escape(it.name)}"]`;
    view.querySelectorAll<HTMLElement>(`${sel} .pk-title`).forEach((t) => { if (t.textContent !== it.title) t.textContent = it.title; });
    view.querySelectorAll<HTMLElement>(`${sel} .pk-when`).forEach((t) => { const s = metaLine(it); if (t.innerHTML !== s) t.innerHTML = s; });
    view.querySelectorAll<HTMLElement>(`${sel} .pk-n`).forEach((t) => { if (t.textContent !== String(it.slides)) t.textContent = String(it.slides); });
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
        if (it.slides) thumbs.set(name, slideOf(deck, 0));
        else thumbs.delete(name);
        place(name);
        if (cont.dataset.name === name) continueFill(deck);
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

  // ---------- «Продолжить работу»: последняя презентация крупно и лента всех её слайдов ----------
  /** Больше в ленте не рисуем: дальше — в редакторе */
  const FILM_MAX = 300;
  /** Презентация, чьи слайды в ленте; миниатюры рисуются, когда подъезжают к виду */
  let filmDeck: Deck | null = null;
  let filmIo: IntersectionObserver | null = null;
  /** Миниатюры ленты рисуются по одной в свободное время — прокрутка не подтормаживает */
  const filmQueue: HTMLElement[] = [];
  let filmBusy = false;
  const idle = (cb: (budget: () => number) => void) => ('requestIdleCallback' in window
    ? requestIdleCallback((d) => cb(() => d.timeRemaining()), { timeout: 300 })
    : setTimeout(() => { const end = performance.now() + 8; cb(() => end - performance.now()); }, 16));
  const filmPump = (left: () => number) => {
    do { const a = filmQueue.shift(); if (a?.isConnected) filmThumb(a); } while (filmQueue.length && left() > 4);
    if (filmQueue.length) idle(filmPump); else filmBusy = false;
  };
  const filmLater = (a: HTMLElement) => {
    filmQueue.push(a);
    if (!filmBusy) { filmBusy = true; idle(filmPump); }
  };
  const filmThumb = (a: HTMLElement) => {
    const k = Number(a.dataset.k);
    if (!filmDeck?.slides?.[k] || a.dataset.done) return;
    a.dataset.done = '1';
    a.querySelector('.pk-thumb')!.replaceChildren(slideOf(filmDeck, k));
  };
  /** Лента листается вбок: колесом мыши (дошла до края — листается страница), стрелками по краям, тачпадом */
  function filmSetup(wrap: HTMLElement): void {
    const strip = wrap.querySelector<HTMLElement>('.pk-film')!;
    const edges = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      wrap.classList.toggle('can-l', strip.scrollLeft > 2);
      wrap.classList.toggle('can-r', strip.scrollLeft < max - 2);
    };
    strip.addEventListener('scroll', edges, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(edges).observe(strip);
    edges();
    // Плавно и без потерь: следующий щелчок колеса продолжает от цели, а не от того места, где лента сейчас
    let target = -1;
    let settle = 0;
    const go = (d: number) => {
      const max = strip.scrollWidth - strip.clientWidth;
      target = Math.max(0, Math.min(max, (target >= 0 ? target : strip.scrollLeft) + d));
      strip.scrollTo({ left: target, behavior: 'smooth' });
      clearTimeout(settle);
      settle = window.setTimeout(() => { target = -1; }, 600);
    };
    strip.addEventListener('wheel', (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = strip.scrollWidth - strip.clientWidth;
      const at = target >= 0 ? target : strip.scrollLeft;
      if (max <= 0 || (e.deltaY < 0 && at <= 0) || (e.deltaY > 0 && at >= max - 1)) return;
      e.preventDefault();
      go(e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? strip.clientWidth : 1));
    }, { passive: false });
    wrap.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-go]');
      if (b) go(Number(b.dataset.go) * strip.clientWidth * 0.8);
    });
    filmIo?.disconnect();
    const items = strip.querySelectorAll<HTMLElement>('.pk-film-s');
    if (!('IntersectionObserver' in window)) { items.forEach((a) => { a.dataset.seen = '1'; filmThumb(a); }); return; }
    filmIo = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const a = en.target as HTMLElement;
      filmIo!.unobserve(a);
      a.dataset.seen = '1';
      filmLater(a);
    }), { root: strip, rootMargin: '0px 360px' });
    items.forEach((a) => filmIo!.observe(a));
  }
  function continueRender(): void {
    const recent = [...items].filter((x) => !x.error).sort((a, b) => b.mtime - a.mtime)[0];
    const show = !!recent && !st.q.trim();
    cont.hidden = !show;
    if (!show) return;
    if (cont.dataset.name === recent.name && cont.dataset.n === String(recent.slides) && cont.childElementCount) return;
    cont.dataset.name = recent.name;
    cont.dataset.n = String(recent.slides);
    cont.innerHTML = `<a class="pk-cont-stack pk-stack" href="${studioHref(recent.name)}" aria-label="Открыть «${esc(recent.title)}» в редакторе"><div class="pk-thumb" data-cont><div class="pk-ph"></div></div></a>
      <div class="pk-cont-info">
        <div class="pk-eyebrow">Продолжить работу</div>
        <h1 class="pk-cont-title">${esc(recent.title)}</h1>
        <div class="pk-cont-meta">${esc(slidesText(recent.slides))}${recent.mtime ? ` · изменена ${esc(ago(recent.mtime))}` : ''}</div>
        <div class="pk-cont-acts"><a class="pk-btn go" href="${studioHref(recent.name)}">Открыть</a><a class="pk-btn" href="${showHref(recent.name)}" data-show="${esc(recent.name)}">${PLAY}<span>Показ</span></a></div>
        <div class="pk-film-wrap"><div class="pk-film" aria-label="Слайды">${Array.from({ length: Math.min(FILM_MAX, Math.max(recent.slides, 1)) }, (_v, k) => `<a class="pk-film-s" href="${studioHref(recent.name)}#${k + 1}" title="Слайд ${k + 1}" data-k="${k}"><div class="pk-thumb"><div class="pk-ph"></div></div><small>${k + 1}</small></a>`).join('')}</div>
          <button class="pk-film-go" type="button" data-go="-1" tabindex="-1" aria-label="Предыдущие слайды">${icon('prev')}</button><button class="pk-film-go" type="button" data-go="1" tabindex="-1" aria-label="Следующие слайды">${icon('next')}</button></div>
      </div>`;
    filmDeck = null;
    filmSetup(cont.querySelector<HTMLElement>('.pk-film-wrap')!);
    const d = loaded.get(recent.name);
    if (d) continueFill(d);
    else void fill(recent.name);
  }
  function continueFill(deck: Deck): void {
    cont.style.setProperty('--glow', glowOf(deck, 0.6));
    cont.style.setProperty('--glow-soft', glowOf(deck, 0.2));
    const big = cont.querySelector<HTMLElement>('[data-cont]');
    if (big && deck.slides?.length) big.replaceChildren(slideOf(deck, 0));
    const meta = cont.querySelector('.pk-cont-title');
    if (meta && deck.title) meta.textContent = deck.title;
    // Лента: заново — уже показанные миниатюры, остальные — когда подъедут к виду
    filmDeck = deck;
    cont.querySelectorAll<HTMLElement>('.pk-film-s').forEach((a) => { delete a.dataset.done; if (a.dataset.seen) filmLater(a); });
  }

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
  const thumbSlot = (it: Item) => `<div class="pk-thumb" data-for="${esc(it.name)}">${it.error ? '<div class="pk-ph pk-bad">Ошибка в файле</div>' : '<div class="pk-ph"></div>'}</div>`;
  const tag = (it: Item) => (it.source ? `<span class="pk-tag">${esc(it.source)}</span>` : '');
  const more = (n: string) => (hasMenu ? `<button type="button" class="pk-more" data-more="${esc(n)}" aria-label="Ещё" aria-haspopup="menu" aria-expanded="false">${DOTS}</button>` : '');
  /** Переезжающая подложка переключателей — под выбранной кнопкой */
  const pills = () => document.querySelectorAll<HTMLElement>('.pk-seg').forEach((s) => {
    const on = s.querySelector<HTMLElement>('[aria-pressed="true"]');
    const p = s.querySelector<HTMLElement>('.pk-seg-pill');
    if (on && p) { p.style.width = `${on.offsetWidth}px`; p.style.transform = `translateX(${on.offsetLeft}px)`; }
  });

  function render(keepLimit = false): void {
    if (!keepLimit) st.limit = PAGE[st.view];
    const list = shownList();
    const searching = !!st.q.trim();
    continueRender();
    document.getElementById('pk-lib-t')!.textContent = searching ? 'Найдено' : 'Библиотека';
    document.getElementById('pk-count')!.textContent = searching ? `${list.length} из ${items.length}` : String(items.length);
    document.getElementById('pk-where')!.innerHTML = items.length
      ? `${items.length} ${plural(items.length, 'презентация', 'презентации', 'презентаций')} в папке «${esc(folderName())}»`
      : `Здесь появятся ваши презентации — папка «${esc(folderName())}»`;
    document.getElementById('pk-tools')!.hidden = !items.length;
    document.querySelectorAll<HTMLElement>('#pk-sort button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.sort)));
    document.querySelectorAll<HTMLElement>('#pk-viewsw button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.view)));
    pills();
    io?.disconnect();
    if (!items.length) {
      view.innerHTML = `<div class="pk-empty"><div class="pk-stack pk-empty-stack"><div class="pk-thumb pk-empty-slide">${brandMark()}</div></div><b>Первая презентация — за минуту</b><span>Создайте новую — с нуля или с примерами слайдов, — или перетащите в окно файл PowerPoint или HTML.</span>${dev
        ? `<div class="pk-acts"><button class="pk-btn" type="button" data-a="import">${icon('upload')}<span>Выбрать файл</span></button><button class="pk-btn go" type="button" data-a="new">${icon('plus')}<span>Создать презентацию</span></button></div>` : ''}</div>`;
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
    let n = 0;
    const deckCard = (it: Item) => `<div class="pk-item" data-name="${esc(it.name)}" style="--i:${Math.min(n++, 14)}">
        <a class="pk-card${it.error ? ' pk-err' : ''}" href="${studioHref(it.name)}" data-name="${esc(it.name)}" title="Открыть в редакторе">
          <div class="pk-stack">${thumbSlot(it)}</div>
          <div class="pk-info"><b class="pk-title">${esc(it.title)}</b><span class="pk-meta"><span class="pk-when">${metaLine(it)}</span>${tag(it)}</span>${folder(it)}</div>
        </a>
        <div class="pk-over"><a class="pk-play" href="${showHref(it.name)}" data-show="${esc(it.name)}" title="Показ с первого слайда">${PLAY}<span>Показ</span></a>${more(it.name)}</div>
      </div>`;
    if (st.view === 'grid') {
      if (st.sort === 'date' && st.dir > 0 && !searching) {
        const groups: { b: string; items: Item[] }[] = [];
        for (const it of vis) {
          const b = bucket(it.mtime);
          if (groups.at(-1)?.b !== b) groups.push({ b, items: [] });
          groups.at(-1)!.items.push(it);
        }
        view.innerHTML = groups.map((g) => `<section class="pk-group"><h3>${g.b}</h3><div class="pk-grid">${g.items.map(deckCard).join('')}</div></section>`).join('');
      } else {
        view.innerHTML = `<section class="pk-group"><div class="pk-grid">${vis.map(deckCard).join('')}</div></section>`;
      }
    } else {
      const arrow = (k: Sort) => (st.sort === k ? ` ${st.dir > 0 ? '↓' : '↑'}` : '');
      view.innerHTML = `<div class="pk-list" role="table" aria-label="Презентации">
        <div class="pk-lrow pk-lhead" role="row"><span role="columnheader"><span class="pk-sr">Миниатюра</span></span><span role="columnheader" data-k="title"${st.sort === 'title' ? ' class="on"' : ''}>Название${arrow('title')}</span><span role="columnheader" data-k="slides" class="num${st.sort === 'slides' ? ' on' : ''}">Слайдов${arrow('slides')}</span><span role="columnheader" data-k="date"${st.sort === 'date' ? ' class="on"' : ''}>Изменена${arrow('date')}</span><span role="columnheader">Источник</span><span role="columnheader"><span class="pk-sr">Действия</span></span></div>
        ${vis.map((it) => `<div class="pk-lrow pk-row" role="row" data-name="${esc(it.name)}" style="--i:${Math.min(n++, 20)}">
          <div class="pk-stack" role="cell">${thumbSlot(it)}</div>
          <div class="pk-lt" role="cell"><a class="pk-title" href="${studioHref(it.name)}">${esc(it.title)}</a>${folder(it)}</div>
          <span class="num pk-n" role="cell">${it.slides}</span><span class="pk-date" role="cell">${it.mtime ? esc(ago(it.mtime)) : '—'}</span><span role="cell">${it.source ? tag(it) : '<span class="pk-none">—</span>'}</span>
          <div class="pk-racts" role="cell"><a class="pk-rplay" href="${showHref(it.name)}" data-show="${esc(it.name)}">${PLAY}<span>Показ</span></a>${more(it.name)}</div>
        </div>`).join('')}</div>`;
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
  const retheme = () => {
    // Миниатюры с акцентом презентации пересчитываются под новую тему
    const fix = (t: HTMLElement, d: Deck) => t.setAttribute('style', `${(t.getAttribute('style') ?? '').split(';').filter((s) => s.trim() && !s.trim().startsWith('--')).join(';')};${accentVars(d)}`);
    thumbs.forEach((t, nm) => { const d = loaded.get(nm); if (d) fix(t, d); });
    const d = loaded.get(cont.dataset.name ?? '');
    if (d) cont.querySelectorAll<HTMLElement>('.thumb').forEach((t) => fix(t, d));
  };
  const swap = () => themeFade(() => { toggleTheme(); retheme(); });
  document.getElementById('pk-theme')!.onclick = swap;
  addEventListener('keydown', (e) => {
    const typing = (e.target as Element).closest('input, textarea, select');
    if ((e.key === 't' || e.key === 'е') && !e.ctrlKey && !e.metaKey && !typing) swap();
    // Поиск: Ctrl+K или «/»
    if (((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'л')) || (e.key === '/' && !typing)) { e.preventDefault(); q.focus(); q.select(); }
  });
  // Поиск: свой крестик вместо системного (тот — в цвет акцента и не на своём месте)
  const clear = document.getElementById('pk-clear') as HTMLButtonElement;
  const search = (v: string) => { st.q = v; clear.hidden = !v; render(); };
  q.addEventListener('input', () => search(q.value));
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; search(''); } });
  clear.addEventListener('click', (e) => { e.preventDefault(); q.value = ''; search(''); q.focus(); });
  document.getElementById('pk-sort')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
    if (!b) return;
    st.sort = b.dataset.v as Sort;
    st.dir = 1;
    save();
    render();
  });
  document.getElementById('pk-viewsw')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
    if (!b || b.dataset.v === st.view) return;
    st.view = b.dataset.v as View;
    save();
    render();
  });
  addEventListener('resize', pills);
  void document.fonts?.ready.then(pills);
  // Шапка с тенью, когда страница прокручена
  const top = document.getElementById('pk-top')!;
  // Прокручивается страница (браузер) или область под шапкой (программа, picker.css)
  const pk = document.querySelector<HTMLElement>('.pk')!;
  addEventListener('scroll', () => top.classList.toggle('scrolled', (scrollY || pk.scrollTop) > 4), { capture: true, passive: true });

  /** Удалённая презентация уходит со страницы: плавно, число в заголовке — меньше */
  const drop = (name: string) => {
    const i = items.findIndex((x) => x.name === name);
    if (i < 0) return;
    items.splice(i, 1);
    thumbs.delete(name);
    if (cont.dataset.name === name) { cont.dataset.name = ''; cont.innerHTML = ''; }
    const el = view.querySelector<HTMLElement>(`[data-name="${CSS.escape(name)}"]`);
    if (!el) { render(true); return; }
    el.classList.add('pk-gone');
    setTimeout(() => render(true), 260);
  };
  const openMenu = (btn: HTMLElement) => {
    const it = byName(btn.dataset.more!);
    if (!it) return;
    itemMenu(btn, [
      ...(reveal ? [{ label: 'Показать в папке', ic: FOLDER, a: 'folder', run: () => { void reveal(it.name); } }] : []),
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
    const th = t.closest<HTMLElement>('.pk-lhead [data-k]');
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

  // Программа: показ — своим окном, как из студии (главное окно — страница выбора и студия)
  if (app) {
    document.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-show]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      window.open(a.href, `htmlpptx-show-${a.dataset.show}`);
    });
  }

  // Удалили в другом окне (или из студии): карточка уходит и здесь, без перезагрузки
  onServer('deck-removed', (d) => drop(d.name));
  // Папку презентации положили или убрали руками — список заново (если на этой странице он и правда другой:
  // страница, открытая уже после этого, его показывает)
  onServer('decks', (e) => {
    const shown = new Set(items.map((x) => x.name));
    if (e.added.some((nm) => !shown.has(nm)) || e.removed.some((nm) => shown.has(nm))) location.reload();
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
  if (cont.dataset.name) first.push(cont.dataset.name);
  await Promise.race([Promise.all(first.map((nm) => fill(nm))), new Promise((r) => setTimeout(r, 800))]);
}

/** Сборка программы: установленная — снимок кода на день сборки, новое из проекта появится с новой сборкой */
function appBuild(): string {
  const b = (window as { slideriaApp?: { build?: { version?: string; date?: string; commit?: string } } }).slideriaApp?.build;
  if (!b) return '';
  return `<span class="pk-build">Slideria ${esc(b.version ?? '')}${b.date ? ` · сборка от ${esc(b.date)}${b.commit ? ` (${esc(b.commit)})` : ''}` : ''}</span>`;
}
