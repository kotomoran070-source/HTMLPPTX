import type { Deck } from '../../types';

/**
 * История правок: шаги отмены и повтора.
 * Шаг — презентация без слайдов (head) и слайды по отдельности. Неизменившиеся слайды у соседних
 * шагов — одна и та же строка в памяти, поэтому шаг весит примерно столько, сколько в нём изменилось.
 * История переживает перезагрузку вкладки (sessionStorage): обновился код — отмена по-прежнему работает.
 */
export interface Snap {
  head: string;
  slides: string[];
}

const LIMIT = 500;
const KEY = 'htmlpptx-history:';

/** Короткий отпечаток текста: проверка, что сохранённая история — от этих же данных */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${s.length}`;
}

/** Имена полей, которые отличаются у двух значений (с учётом вложенности); len+ / len− — в списке стало больше или меньше */
function diffKeys(a: unknown, b: unknown, out = new Set<string>(), key = ''): Set<string> {
  if (a === b) return out;
  // Списка не было или не стало: как добавление или удаление всех его элементов
  if (Array.isArray(a) !== Array.isArray(b) && (a === undefined || b === undefined)) {
    out.add(`${key}:${b !== undefined ? 'len+' : 'len-'}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.add(`${key}:${b.length > a.length ? 'len+' : 'len-'}`);
    for (let k = 0; k < Math.min(a.length, b.length); k++) diffKeys(a[k], b[k], out, key);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) {
        out.add(k);
        diffKeys(ra[k], rb[k], out, k);
      }
    }
    return out;
  }
  out.add(key || 'value');
  return out;
}

const TEXT = new Set(['title', 'lead', 'text', 'texts', 'label', 'meta', 'caption', 'badge', 'value', 'items', 'subtitle', 'footer', 'footnote', 'name', 'quote', 'author']);
const LOOK = new Set(['style', 'fill', 'color', 'stroke', 'width', 'dash', 'mat', 'filter', 'variant', 'size', 'align', 'density', 'radius', 'opacity', 'shadow', 'font', 'bg', 'background', 'widths', 'accent']);

/** Вид правки на слайде по изменившимся полям */
function slideAction(a: Record<string, unknown>, b: Record<string, unknown>): string {
  const keys = diffKeys(a, b);
  const has = (...k: string[]) => k.some((x) => keys.has(x));
  const list = (name: string) => [...keys].find((k) => k.startsWith(`${name}:len`));
  const free = list('free');
  if (free) return free.endsWith('+') ? 'Добавление объекта' : 'Удаление объекта';
  if (list('rows')) return list('rows')!.endsWith('+') ? 'Добавление строки' : 'Удаление строки';
  if (list('header') || list('widths')) return 'Столбцы таблицы';
  if (has('notes')) return 'Заметки';
  if (has('template')) return 'Макет слайда';
  if (has('locked')) return 'Закрепление';
  if (has('hidden', 'skip')) return 'Показ слайда';
  if (has('transition', 'transitionMs')) return 'Переход';
  if (has('css')) return 'CSS слайда';
  if (has('html')) return 'Код';
  const place = new Set(['x', 'y', 'w', 'h', 'place', 'rotate']);
  const own = [...keys].filter((k) => !place.has(k));
  // Кроме положения ничего не поменялось (списки-предки free и слои не в счёт)
  if (has('x', 'y', 'w', 'h', 'rotate') && !own.filter((k) => !['free', 'body', 'items', 'children'].includes(k)).length) {
    if (has('rotate')) return 'Поворот';
    return has('w', 'h') ? (has('x', 'y') ? 'Размер и положение' : 'Размер') : 'Перемещение';
  }
  if (has('rows', 'header')) return 'Текст таблицы';
  if ([...keys].some((k) => TEXT.has(k))) return 'Текст';
  if ([...keys].some((k) => LOOK.has(k))) return 'Оформление';
  if (list('body') || list('items')) return 'Состав слайда';
  return 'Правка';
}

export class History {
  past: Snap[] = [];
  future: Snap[] = [];
  /** Одинаковые строки слайдов — один экземпляр на всю историю */
  private pool = new Map<string, string>();
  private saveTimer = 0;

  constructor(private deckKey: string) {}

  private intern(s: string): string {
    const hit = this.pool.get(s);
    if (hit !== undefined) return hit;
    this.pool.set(s, s);
    return s;
  }

  /** Снимок данных; порядок полей презентации сохраняется (slides остаётся на своём месте) */
  snap(deck: Deck): Snap {
    return {
      head: this.intern(JSON.stringify({ ...deck, slides: 0 })),
      slides: deck.slides.map((s) => this.intern(JSON.stringify(s))),
    };
  }

  static same(a: Snap, b: Snap): boolean {
    return a.head === b.head && a.slides.length === b.slides.length && a.slides.every((s, i) => s === b.slides[i]);
  }

  static restore(s: Snap): Deck {
    const d = JSON.parse(s.head) as Deck;
    d.slides = s.slides.map((x) => JSON.parse(x));
    return d;
  }

  /** Слайд, который отличается между шагами (для перехода к нему после отмены); -1 — только общее */
  static changedSlide(a: Snap, b: Snap): number {
    const n = Math.max(a.slides.length, b.slides.length);
    for (let i = 0; i < n; i++) if (a.slides[i] !== b.slides[i]) return i;
    return -1;
  }

  /** Что изменилось от a к b — коротко, для подсказки у «Отменить» и «Повторить»: «Перемещение · слайд 9» */
  static describe(a: Snap, b: Snap): string {
    const n = a.slides.length;
    const m = b.slides.length;
    if (m !== n) {
      const at = History.changedSlide(a, b);
      return m > n
        ? (m - n > 1 ? `Добавлены слайды (${m - n})` : `Добавлен слайд ${at + 1}`)
        : (n - m > 1 ? `Удалены слайды (${n - m})` : `Удалён слайд ${at + 1}`);
    }
    const changed = a.slides.map((s, i) => (s === b.slides[i] ? -1 : i)).filter((i) => i >= 0);
    if (!changed.length) {
      const keys = diffKeys(JSON.parse(a.head), JSON.parse(b.head));
      if (keys.has('theme')) return 'Тема и цвета';
      if (keys.has('css') || keys.has('scoped')) return 'CSS презентации';
      if (keys.has('title') || keys.has('brand')) return 'Название презентации';
      return 'Настройки презентации';
    }
    if (changed.length > 1) {
      const sa = changed.map((i) => a.slides[i]).sort();
      const sb = changed.map((i) => b.slides[i]).sort();
      return sa.every((s, k) => s === sb[k]) ? 'Порядок слайдов' : `Правка слайдов (${changed.length})`;
    }
    const i = changed[0];
    return `${slideAction(JSON.parse(a.slides[i]), JSON.parse(b.slides[i]))} · слайд ${i + 1}`;
  }

  push(s: Snap): void {
    this.past.push(s);
    if (this.past.length > LIMIT) {
      this.past.shift();
      // Строки, на которые больше никто не ссылается, отпускаем
      if (this.past.length % 50 === 0) this.prune();
    }
  }

  private prune(): void {
    const used = new Set<string>();
    for (const s of [...this.past, ...this.future]) { used.add(s.head); s.slides.forEach((x) => used.add(x)); }
    for (const k of this.pool.keys()) if (!used.has(k)) this.pool.delete(k);
  }

  // ---------------- между перезагрузками вкладки ----------------

  /** Сохранить историю вкладки (с задержкой); cur — данные сейчас */
  save(cur: Snap): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.write(cur), 800);
  }

  private write(cur: Snap): void {
    const strings: string[] = [];
    const index = new Map<string, number>();
    const id = (s: string) => {
      let k = index.get(s);
      if (k === undefined) { k = strings.length; strings.push(s); index.set(s, k); }
      return k;
    };
    const pack = (list: Snap[]) => list.map((s) => [id(s.head), ...s.slides.map(id)]);
    const curText = `${cur.head}\u0000${cur.slides.join('\u0000')}`;
    // Не влезает в хранилище — отбрасываем самые старые шаги
    for (let keep = this.past.length; keep >= 0; keep = keep > 8 ? Math.floor(keep / 2) : keep - 1) {
      strings.length = 0;
      index.clear();
      const data = { v: 1, cur: hash(curText), past: pack(this.past.slice(this.past.length - keep)), future: pack(this.future), strings };
      try {
        sessionStorage.setItem(KEY + this.deckKey, JSON.stringify(data));
        return;
      } catch { /* переполнено — меньше шагов */ }
    }
    try { sessionStorage.removeItem(KEY + this.deckKey); } catch { /* нет хранилища */ }
  }

  /** Восстановить историю вкладки, если она от этих же данных */
  load(cur: Snap): void {
    try {
      const raw = sessionStorage.getItem(KEY + this.deckKey);
      if (!raw) return;
      const data = JSON.parse(raw) as { v: number; cur: string; past: number[][]; future: number[][]; strings: string[] };
      if (data.v !== 1 || data.cur !== hash(`${cur.head}\u0000${cur.slides.join('\u0000')}`)) return;
      const unpack = (list: number[][]) => list.map(([h, ...sl]) => ({ head: this.intern(data.strings[h]), slides: sl.map((k) => this.intern(data.strings[k])) }));
      this.past = unpack(data.past);
      this.future = unpack(data.future);
    } catch { /* повреждено или нет доступа — история с нуля */ }
  }
}
