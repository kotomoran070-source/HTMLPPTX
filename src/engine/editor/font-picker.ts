/**
 * Выбор шрифта со строкой поиска: шрифты темы, шрифты презентации, шрифты компьютера.
 * Один на страницу, открывается под кнопкой (панель текста, «Шрифт презентации»).
 * Каждый шрифт в списке написан самим собой — шрифт подключается, когда строка видна.
 */
import { loadLocalFonts, localFontsState } from '../local-fonts';

export interface FontItem {
  value: string;
  label: string;
  /** CSS font-family для предпросмотра */
  css: string;
  group: string;
  /** Сколько у шрифта начертаний (толщин) */
  weights?: number;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class FontPicker {
  readonly el: HTMLElement;
  private q: HTMLInputElement;
  private list: HTMLElement;
  private anchor: HTMLElement | null = null;
  private cur = '';
  private pick: ((v: string) => void) | null = null;
  /** Примерка: шрифт под указателем или под стрелками (null — вернуть как было) */
  private hover: ((f: FontItem | null) => void) | null = null;
  private tried = false;
  private items: () => FontItem[] = () => [];
  private shown: FontItem[] = [];
  private at = -1;
  private seen: IntersectionObserver;

  constructor() {
    this.el = document.createElement('div');
    // edpop: фокус в поиске не завершает правку текста; data-ed-keep: клик не снимает выделение
    this.el.className = 'edpop fontpick';
    this.el.setAttribute('data-ed-keep', '');
    this.el.innerHTML = `<input type="search" placeholder="Найти шрифт" aria-label="Найти шрифт" spellcheck="false" autocomplete="off">
<div class="fontpick-list" role="listbox" aria-label="Шрифты"></div>`;
    document.body.appendChild(this.el);
    this.q = this.el.querySelector('input')!;
    this.list = this.el.querySelector('.fontpick-list')!;
    this.seen = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const o = e.target as HTMLElement;
        if (o.dataset.css) { o.style.fontFamily = o.dataset.css; delete o.dataset.css; }
        this.seen.unobserve(o);
      }
    }, { root: this.list, rootMargin: '120px' });
    this.q.addEventListener('input', () => this.render(true));
    this.q.addEventListener('keydown', (e) => this.key(e));
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const ask = (e.target as Element).closest('[data-ask]');
      if (ask) {
        // Клик — действие пользователя: браузер может спросить разрешение
        void loadLocalFonts(true).then(() => { this.render(false); this.place(); this.q.focus(); });
        return;
      }
      const o = (e.target as Element).closest<HTMLElement>('[data-i]');
      if (o) this.choose(Number(o.dataset.i));
    });
    this.list.addEventListener('pointermove', (e) => {
      const o = (e.target as Element).closest<HTMLElement>('[data-i]');
      if (o && Number(o.dataset.i) !== this.at) this.mark(Number(o.dataset.i), false);
      if (o) this.try(Number(o.dataset.i));
    });
    // Указатель ушёл со списка — примерка снимается (выбранный стрелками остаётся отмеченным)
    this.list.addEventListener('pointerleave', () => this.untry());
    document.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      const t = e.target as Node;
      if (!this.el.contains(t) && !this.anchor?.contains(t)) this.close();
    }, true);
    addEventListener('resize', () => this.close());
  }

  get open(): boolean { return this.el.classList.contains('on'); }

  contains(node: Node | null): boolean { return !!node && this.el.contains(node); }

  /** Открыть под кнопкой; повторный клик по той же кнопке — закрыть */
  toggle(anchor: HTMLElement, items: () => FontItem[], cur: string, pick: (v: string) => void, hover?: (f: FontItem | null) => void): void {
    if (this.open && this.anchor === anchor) { this.close(); return; }
    this.untry();
    this.anchor = anchor;
    this.items = items;
    this.cur = cur;
    this.pick = pick;
    this.hover = hover ?? null;
    this.q.value = '';
    this.el.classList.add('on');
    anchor.setAttribute('aria-expanded', 'true');
    this.render(false);
    this.place();
    this.q.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.open) return;
    this.untry();
    this.el.classList.remove('on');
    this.anchor?.setAttribute('aria-expanded', 'false');
    // Фокус возвращается кнопке: правка текста (если идёт) продолжается
    if (this.el.contains(document.activeElement)) this.anchor?.focus({ preventScroll: true });
  }

  /** Под кнопкой; не помещается — над ней */
  private place(): void {
    const r = this.anchor!.getBoundingClientRect();
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const down = below >= 280 || below >= above;
    this.el.style.maxHeight = `${Math.min(420, down ? below : above)}px`;
    this.el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - this.el.offsetWidth - 8))}px`;
    this.el.style.top = `${down ? r.bottom + 4 : r.top - 4 - this.el.offsetHeight}px`;
  }

  /** Список по запросу: совпадение в начале названия — выше */
  private render(fromQuery: boolean): void {
    const q = this.q.value.trim().toLowerCase();
    const all = this.items();
    this.shown = q
      ? all.filter((f) => f.label.toLowerCase().includes(q)).sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)))
      : all;
    this.seen.disconnect();
    let html = '';
    let group = '';
    this.shown.forEach((f, i) => {
      // С запросом группы не делят список: лучшие совпадения сверху
      // Группы (тема, презентация, компьютер) разделены линией — без подписей
      if (!q && f.group !== group) { if (group) html += '<div class="fontpick-sep" role="separator"></div>'; group = f.group; }
      // Начертания — тремя буквами самого шрифта от тонкой к жирной: сразу видно, что толщины есть
      const w = (f.weights ?? 0) > 1 ? `<small class="fontpick-w" title="${f.weights} ${plural(f.weights!, 'начертание', 'начертания', 'начертаний')}"><i style="font-weight:200">а</i><i style="font-weight:500">а</i><i style="font-weight:800">а</i></small>` : '';
      html += `<div class="fontpick-o${f.value === this.cur ? ' cur' : ''}" role="option" data-i="${i}" data-css="${esc(f.css)}" aria-selected="${f.value === this.cur}"><span>${esc(f.label)}</span>${w}</div>`;
    });
    if (!this.shown.length) html = `<div class="fontpick-none">Нет шрифта «${esc(this.q.value.trim())}»</div>`;
    if (localFontsState() === 'ask') html += `<button type="button" class="fontpick-ask" data-ask>Показать шрифты компьютера…</button>`;
    this.list.innerHTML = html;
    this.list.querySelectorAll('[data-css]').forEach((o) => this.seen.observe(o));
    const cur = this.shown.findIndex((f) => f.value === this.cur);
    this.mark(fromQuery || cur < 0 ? (this.shown.length ? 0 : -1) : cur, true);
  }

  private mark(i: number, scroll: boolean): void {
    this.list.querySelector('.on')?.classList.remove('on');
    this.at = i;
    const o = this.list.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!o) return;
    o.classList.add('on');
    if (scroll) o.scrollIntoView({ block: 'nearest' });
  }

  /** Примерить шрифт пункта на тексте */
  private try(i: number): void {
    const f = this.shown[i];
    if (!f || !this.hover) return;
    this.tried = true;
    this.hover(f);
  }

  private untry(): void {
    if (!this.tried) return;
    this.tried = false;
    this.hover?.(null);
  }

  private choose(i: number): void {
    const f = this.shown[i];
    if (!f) return;
    const pick = this.pick;
    this.close();
    pick?.(f.value);
  }

  private key(e: KeyboardEvent): void {
    // Клавиши поиска не уходят в студию (Delete, стрелки, Ctrl+Z)
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.shown.length) {
        this.mark((this.at + (e.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % this.shown.length, true);
        this.try(this.at);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.choose(this.at);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Tab') {
      this.close();
    }
  }
}

/** Названия толщин: по-русски и привычное английское, как в файлах шрифтов и в Figma */
export const WEIGHT_NAMES: Record<number, [string, string]> = {
  100: ['Тонкий', 'Thin'], 200: ['Сверхсветлый', 'ExtraLight'], 300: ['Светлый', 'Light'], 350: ['Полусветлый', 'SemiLight'],
  400: ['Обычный', 'Regular'], 500: ['Средний', 'Medium'], 600: ['Полужирный', 'SemiBold'], 700: ['Жирный', 'Bold'],
  800: ['Сверхжирный', 'ExtraBold'], 900: ['Тяжёлый', 'Black'], 950: ['Сверхтяжёлый', 'ExtraBlack'],
};
export const weightName = (w: number) => WEIGHT_NAMES[w]?.[0] ?? String(w);
export const weightNameEn = (w: number) => WEIGHT_NAMES[w]?.[1] ?? String(w);

let shared: FontPicker | null = null;
/** Один список выбора шрифта на страницу */
export function fontPicker(): FontPicker {
  return (shared ??= new FontPicker());
}

/** Пункты списка: сначала шрифты темы, затем шрифты презентации и библиотеки, затем шрифты компьютера */
export function fontItems(head: FontItem[], choices: { name: string; sys?: boolean; theme?: boolean; weights?: number }[], stack: (n: string) => string): FontItem[] {
  const names = new Set(head.map((f) => f.value));
  const item = (group: string) => (f: (typeof choices)[number]): FontItem => ({ value: f.name, label: f.name, css: stack(f.name), group, weights: f.weights });
  return [
    ...head,
    ...choices.filter((f) => !f.sys && !f.theme && !names.has(f.name)).map(item('Шрифты презентации')),
    ...choices.filter((f) => f.theme && !names.has(f.name)).map(item('Шрифты тем')),
    ...choices.filter((f) => f.sys && !names.has(f.name)).map(item('Шрифты компьютера')),
  ];
}

/**
 * Примерка шрифта на элементе: CSS-свойство (font-family или переменная --font) ставится
 * на время, прежнее значение возвращается при css === null
 */
const before = new WeakMap<HTMLElement, Map<string, string>>();
export function tryFontOn(el: HTMLElement | null | undefined, prop: string, css: string | null): void {
  if (!el) return;
  let saved = before.get(el);
  if (css === null) {
    const old = saved?.get(prop);
    if (old === undefined) return;
    if (old) el.style.setProperty(prop, old);
    else el.style.removeProperty(prop);
    saved!.delete(prop);
    return;
  }
  if (!saved) before.set(el, (saved = new Map()));
  if (!saved.has(prop)) saved.set(prop, el.style.getPropertyValue(prop));
  el.style.setProperty(prop, css);
}
