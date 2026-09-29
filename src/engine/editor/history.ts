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
