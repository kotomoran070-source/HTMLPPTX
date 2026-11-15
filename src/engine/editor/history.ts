import type { Deck } from '../../types';
import { same } from '../merge3';

/**
 * Правка поля другим окном (или агентом): slide < 0 — поле самой презентации; obj — поле свободного объекта
 * слайда с этим номером (kind — его вид и имя: в шагах истории правка ложится только на тот же объект)
 */
export interface Edit { slide: number; key: string; was: unknown; now: unknown; obj?: number; kind?: string }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const kindOf = (o: Rec) => `${String(o.type)}|${typeof o.id === 'string' ? o.id : ''}`;

/**
 * Свободные объекты слайда поменяли, не меняя состава (столько же, те же виды и имена на тех же местах): правки —
 * по полям объектов. Так отмена в студии откатывает свой сдвиг фигуры, но не чужой текст в соседнем объекте
 */
function objectEdits(a: unknown, b: unknown, slide: number): Edit[] | null {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
  const out: Edit[] = [];
  for (let k = 0; k < a.length; k++) {
    const x = a[k];
    const y = b[k];
    if (!isRec(x) || !isRec(y) || kindOf(x) !== kindOf(y)) return null;
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!same(x[key], y[key])) out.push({ slide, key, obj: k, kind: kindOf(x), was: x[key], now: y[key] });
    }
  }
  return out;
}

/** Какие поля поменяло другое окно (слайды — по номерам, если их число не менялось) */
export function edits(was: Deck, now: Deck): Edit[] | null {
  if (was.slides.length !== now.slides.length) return null;
  const out: Edit[] = [];
  const diff = (a: Record<string, unknown>, b: Record<string, unknown>, slide: number) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === 'slides' || same(a[key], b[key])) continue;
      const fine = key === 'free' && slide >= 0 ? objectEdits(a[key], b[key], slide) : null;
      if (fine) out.push(...fine);
      else out.push({ slide, key, was: a[key], now: b[key] });
    }
  };
  diff(was as unknown as Record<string, unknown>, now as unknown as Record<string, unknown>, -1);
  was.slides.forEach((s, i) => diff(s as Record<string, unknown>, now.slides[i] as Record<string, unknown>, i));
  return out;
}

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
const LOOK = new Set(['style', 'fill', 'color', 'stroke', 'width', 'dash', 'mat', 'filter', 'variant', 'size', 'align', 'density', 'radius', 'opacity', 'bright', 'contrast', 'saturate', 'shadow', 'font', 'bg', 'background', 'widths', 'accent']);

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

/** Пропорция слайда снимка (deck.size; без неё — 16:9) */
const sizeOf = (s: Snap): string => { const v = (JSON.parse(s.head) as { size?: unknown }).size; return typeof v === 'string' ? v : '16:9'; };

export class History {
  past: Snap[] = [];
  future: Snap[] = [];
  /** Контрольные точки (Ctrl+S): отпечаток данных → время; на них Ctrl+Z останавливается */
  marks = new Map<string, string>();
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

  static key(s: Snap): string {
    return hash(`${s.head}\u0000${s.slides.join('\u0000')}`);
  }

  /** Отметить данные контрольной точкой */
  mark(s: Snap, label: string): void {
    this.marks.set(History.key(s), label);
  }

  /** Время точки, если эти данные — контрольная точка */
  markOf(s: Snap): string | undefined {
    return this.marks.get(History.key(s));
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
    // Сменился размер слайда — правка всей презентации: остаёмся на своём слайде
    if (sizeOf(a) !== sizeOf(b)) return -1;
    const n = Math.max(a.slides.length, b.slides.length);
    for (let i = 0; i < n; i++) if (a.slides[i] !== b.slides[i]) return i;
    return -1;
  }

  /**
   * Что поменялось от a к b по слайдам — для «Сохранить изменения?» при выходе. Слайды сопоставляются по id, без id —
   * по одинаковому содержимому (вставили слайд в середину — остальные не «изменены»), оставшиеся — по порядку.
   * changed и added — номера в b (с 1); null — ничего не поменялось
   */
  static compare(a: Snap, b: Snap): { changed: number[]; added: number[]; removed: number; deck: boolean; order: boolean } | null {
    if (History.same(a, b)) return null;
    const id = (s: string) => { const v = (JSON.parse(s) as { id?: unknown }).id; return typeof v === 'string' && v ? v : ''; };
    const byId = new Map<string, number>();
    a.slides.forEach((s, j) => { const k = id(s); if (k) byId.set(k, j); });
    const used = new Set<number>();
    const changed: number[] = [];
    const added: number[] = [];
    const rest: number[] = [];
    b.slides.forEach((s, i) => {
      const j = byId.get(id(s));
      if (j === undefined || used.has(j)) return rest.push(i);
      used.add(j);
      if (a.slides[j] !== s) changed.push(i + 1);
    });
    // Без пары по id — такой же слайд где угодно; иначе — правка ближайшего по порядку слайда без id
    const same = new Map<string, number[]>();
    a.slides.forEach((s, j) => { if (!used.has(j)) same.set(s, [...(same.get(s) ?? []), j]); });
    const loose: number[] = [];
    for (const i of rest) {
      const j = same.get(b.slides[i])?.shift();
      if (j !== undefined) used.add(j);
      else loose.push(i);
    }
    for (const i of loose) {
      const j = id(b.slides[i]) ? undefined : a.slides.findIndex((s, k) => !used.has(k) && !id(s));
      if (j !== undefined && j >= 0) {
        used.add(j);
        changed.push(i + 1);
      } else added.push(i + 1);
    }
    changed.sort((x, y) => x - y);
    const removed = a.slides.length - used.size;
    const deck = a.head !== b.head;
    return { changed, added, removed, deck, order: !changed.length && !added.length && !removed && !deck };
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
    if (sizeOf(a) !== sizeOf(b)) return `Размер слайда ${sizeOf(b)}`;
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

  /**
   * Правки другого окна — во все шаги истории (где поле было таким же): Ctrl+Z откатывает свои правки,
   * а не подтянутые чужие (иначе следующее сохранение стёрло бы их и в файле)
   */
  rebase(list: Edit[], count: number): void {
    const put = (o: Record<string, unknown>, e: Edit): boolean => {
      if (!same(o[e.key], e.was)) return false;
      if (e.now === undefined) delete o[e.key];
      else o[e.key] = e.now;
      return true;
    };
    const fix = (s: Snap): Snap => {
      if (s.slides.length !== count) return s;
      let head: Record<string, unknown> | null = null;
      const slides = s.slides.slice();
      let touched = false;
      for (const e of list) {
        if (e.slide < 0) {
          head ??= JSON.parse(s.head) as Record<string, unknown>;
          touched = put(head, e) || touched;
        } else {
          const o = JSON.parse(slides[e.slide]) as Record<string, unknown>;
          // Поле объекта: только если на этом месте в шаге — тот же объект (вид и имя)
          const target = e.obj === undefined ? o : Array.isArray(o.free) && isRec(o.free[e.obj]) && kindOf(o.free[e.obj]) === e.kind ? o.free[e.obj] as Rec : null;
          if (target && put(target, e)) { slides[e.slide] = this.intern(JSON.stringify(o)); touched = true; }
        }
      }
      return touched ? { head: head ? this.intern(JSON.stringify(head)) : s.head, slides } : s;
    };
    this.past = this.past.map(fix);
    this.future = this.future.map(fix);
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
  //
  // История вкладки лежит в sessionStorage по частям: каждая строка (слайд или «шапка» презентации) — своей
  // записью и один раз, а указатель говорит, из каких строк состоит каждый шаг (шаги — разницей с предыдущим).
  // Правка дописывает только новые строки и короткий указатель. Раньше вся история писалась одной записью
  // заново на каждую правку: на 155 слайдах и 500 шагах — 35–48 мс, на слайдах по 60 КБ — 0,2–0,3 с заминки
  // через 0,8 с после правки (docs/PERF.md).

  /** Строка → номер её записи в хранилище */
  private stored = new Map<string, number>();
  private nextId = 0;

  /** Сохранить историю вкладки (с задержкой); cur — данные сейчас */
  save(cur: Snap): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.write(cur), 800);
  }

  /** Записи хранилища этой истории, кроме указателя: «ключ:номер» */
  private strayKeys(store: Storage): string[] {
    const prefix = `${KEY}${this.deckKey}:`;
    const out: string[] = [];
    for (let k = 0; k < store.length; k++) {
      const key = store.key(k);
      if (key?.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length))) out.push(key);
    }
    return out;
  }

  /** Убрать историю из хранилища целиком */
  private drop(store: Storage): void {
    try {
      store.removeItem(KEY + this.deckKey);
      this.strayKeys(store).forEach((k) => store.removeItem(k));
    } catch { /* нет доступа */ }
    this.stored.clear();
  }

  /** Записать историю сейчас (save — то же с задержкой) */
  write(cur: Snap): void {
    let store: Storage;
    try { store = sessionStorage; } catch { return; }
    const base = KEY + this.deckKey;
    const curKey = History.key(cur);
    // Не влезает в хранилище — отбрасываем самые старые шаги
    for (let keep = this.past.length; keep >= 0; keep = keep > 8 ? Math.floor(keep / 2) : keep - 1) {
      const past = this.past.slice(this.past.length - keep);
      const need = new Set<string>();
      for (const snap of [...past, ...this.future]) { need.add(snap.head); for (const x of snap.slides) need.add(x); }
      try {
        // Сначала лишнее (освобождает место), потом новое
        for (const [text, n] of this.stored) {
          if (need.has(text)) continue;
          store.removeItem(`${base}:${n}`);
          this.stored.delete(text);
        }
        for (const text of need) {
          if (this.stored.has(text)) continue;
          const n = this.nextId++;
          store.setItem(`${base}:${n}`, text);
          this.stored.set(text, n);
        }
        store.setItem(base, JSON.stringify({ v: 2, cur: curKey, n: this.nextId, past: this.pack(past), future: this.pack(this.future), marks: [...this.marks] }));
        return;
      } catch { /* переполнено — меньше шагов */ }
    }
    this.drop(store);
  }

  /**
   * Шаги — номерами строк: первый целиком [шапка, слайды…], следующие — разницей с предыдущим
   * { d: [место, строка, …] } (место −1 — шапка), если число слайдов то же; иначе снова целиком
   */
  private pack(list: Snap[]): (number[] | { d: number[] })[] {
    const id = (x: string) => this.stored.get(x)!;
    let prev: Snap | null = null;
    return list.map((snap) => {
      const was = prev;
      prev = snap;
      if (!was || was.slides.length !== snap.slides.length) return [id(snap.head), ...snap.slides.map(id)];
      const d: number[] = [];
      if (was.head !== snap.head) d.push(-1, id(snap.head));
      snap.slides.forEach((x, i) => { if (x !== was.slides[i]) d.push(i, id(x)); });
      return { d };
    });
  }

  /** Восстановить историю вкладки, если она от этих же данных */
  load(cur: Snap): void {
    let store: Storage;
    try { store = sessionStorage; } catch { return; }
    const base = KEY + this.deckKey;
    try {
      const raw = store.getItem(base);
      const data = raw ? JSON.parse(raw) as { v: number; cur: string; n: number; past: (number[] | { d: number[] })[]; future: (number[] | { d: number[] })[]; marks?: [string, string][] } : null;
      if (!data || data.v !== 2 || data.cur !== History.key(cur)) throw new Error('не та история');
      const texts = new Map<number, string>();
      const text = (n: number) => {
        let x = texts.get(n);
        if (x === undefined) {
          const got = store.getItem(`${base}:${n}`);
          if (got === null) throw new Error('нет строки');
          x = this.intern(got);
          texts.set(n, x);
        }
        return x;
      };
      const unpack = (list: (number[] | { d: number[] })[]) => {
        let prev: Snap | null = null;
        return list.map((e) => {
          let snap: Snap;
          if (Array.isArray(e)) snap = { head: text(e[0]), slides: e.slice(1).map(text) };
          else {
            if (!prev) throw new Error('разница без начала');
            snap = { head: prev.head, slides: prev.slides.slice() };
            for (let k = 0; k + 1 < e.d.length; k += 2) {
              if (e.d[k] < 0) snap.head = text(e.d[k + 1]);
              else snap.slides[e.d[k]] = text(e.d[k + 1]);
            }
          }
          prev = snap;
          return snap;
        });
      };
      const past = unpack(data.past);
      const future = unpack(data.future);
      this.past = past;
      this.future = future;
      this.marks = new Map(data.marks ?? []);
      this.stored = new Map([...texts].map(([n, x]) => [x, n]));
      this.nextId = Number(data.n) || 0;
      // Строки, на которые указатель не ссылается (запись оборвалась), — убрать
      const prefix = `${base}:`;
      for (const key of this.strayKeys(store)) if (!texts.has(Number(key.slice(prefix.length)))) store.removeItem(key);
    } catch {
      // Нет истории, она от других данных, старого вида или повреждена — с нуля, место в хранилище освобождается
      this.drop(store);
    }
  }
}
