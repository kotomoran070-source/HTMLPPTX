/**
 * Операции правки: что можно сделать с презентацией — по шагу, с проверкой и подписью («Правка объекта · слайд 3»).
 * Ими правят не руками в студии: команды сервера (`apply`) для агента, MCP и плагинов. Чистые функции над данными,
 * какими они лежат в deck.yaml (пути к файлам — ./assets/…): без страницы и без файлов — годятся и серверу, и студии.
 *
 * Адреса:
 * - слайд — номер с 1 (как «3 из 14» при показе) или id слайда;
 * - объект — свободный объект слайда (free): номер с 1 снизу вверх (больший лежит поверх) или его имя (id объекта —
 *   то же имя, что в «Области выделения» студии и у пары морфа).
 * Номера считаются после предыдущих операций того же пакета.
 *
 * Ревизия слайда (rev, slideRev) — короткий отпечаток его данных. Агент читает краткое содержание (outline) с ревизиями,
 * а в пакете перечисляет ревизии слайдов, которые собирается править (expect). Слайд с тех пор поменяли (в студии,
 * другим агентом) — пакет не применяется ни частично, ни целиком: «перечитайте». Имена объектам не раздаются:
 * имя — это пара для морфа, а у объектов без имени пару находит содержимое.
 */
import type { Block, Deck, SlideData } from '../types';
import { canon } from './merge3';

export type SlideRef = number | string;
export type ObjectRef = number | string;

/** Ошибка операции: текст для человека (и для агента) — что не так и как исправить */
export class OpError extends Error {}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------- адреса и ревизии ----------------

/** Отпечаток данных слайда: 8 знаков, от порядка полей не зависит */
export function slideRev(s: unknown): string {
  const t = canon(s);
  // cyrb53: быстрый 53-битный отпечаток без node:crypto (модуль работает и в браузере)
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(8, '0').slice(-8);
}

/** Номер слайда в списке (с 0) по адресу */
export function slideIndex(d: Deck, ref: unknown): number {
  const n = d.slides.length;
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref) || ref < 1 || ref > n) throw new OpError(`нет слайда ${ref}: слайды — с 1 по ${n}`);
    return ref - 1;
  }
  if (typeof ref === 'string' && ref) {
    const i = d.slides.findIndex((s) => s?.id === ref);
    if (i < 0) throw new OpError(`нет слайда с id «${ref}»`);
    return i;
  }
  throw new OpError('слайд — номер с 1 или id слайда');
}

/** Номер объекта в free (с 0) по адресу */
function objectIndex(s: SlideData, ref: unknown, at: number): number {
  const list = Array.isArray(s.free) ? s.free : [];
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref) || ref < 1 || ref > list.length) {
      throw new OpError(list.length ? `нет объекта ${ref} на слайде ${at + 1}: объекты — с 1 по ${list.length}` : `на слайде ${at + 1} нет свободных объектов`);
    }
    return ref - 1;
  }
  if (typeof ref === 'string' && ref) {
    const i = list.findIndex((b) => isRec(b) && b.id === ref);
    if (i < 0) throw new OpError(`на слайде ${at + 1} нет объекта с именем «${ref}»`);
    return i;
  }
  throw new OpError('объект — номер с 1 или имя объекта');
}

// ---------------- правка полей ----------------

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Правка полей (JSON Merge Patch, RFC 7386): объекты сливаются по полям, null удаляет поле, остальное — заменяет
 * (списки — целиком). { place: { x: 100 } } сдвигает объект, не трогая остальное место
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRec(patch)) return clone(patch);
  const out: Rec = isRec(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (FORBIDDEN.has(k)) throw new OpError(`поле «${k}» недопустимо`);
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

const needPatch = (v: unknown, what: string): Rec => {
  if (!isRec(v) || !Object.keys(v).length) throw new OpError(`${what}: set — поля, которые поменять, например { title: "…" }`);
  return v;
};

const needPosition = (v: unknown, max: number, what: string): number => {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max) throw new OpError(`${what} — число с 1 по ${max}`);
  return (v as number) - 1;
};

/** Свободное id слайда: как у студии — slide-2, slide-3… (или основа-2 у копии) */
function freeSlideId(d: Deck, base: string): string {
  const ids = new Set(d.slides.map((s) => s?.id));
  const stem = (base || 'slide').replace(/-\d+$/, '');
  for (let i = 2; ; i++) if (!ids.has(`${stem}-${i}`)) return `${stem}-${i}`;
}

// ---------------- текст ----------------

/** Поля с текстом слайда и объектов: в них ищет «Заменить текст» (пути к файлам, имена, стили не трогаются) */
const TEXT = new Set(['title', 'lead', 'text', 'texts', 'label', 'meta', 'caption', 'badge', 'value', 'items', 'subtitle',
  'footer', 'footnote', 'quote', 'author', 'role', 'notes', 'center', 'sub', 'note', 'question', 'answer', 'header', 'rows', 'front', 'back', 'delta']);

function replaceIn(v: unknown, find: string, to: string, text: boolean, count: { n: number }): unknown {
  if (typeof v === 'string') {
    if (!text || !v.includes(find)) return v;
    count.n += v.split(find).length - 1;
    return v.split(find).join(to);
  }
  if (Array.isArray(v)) return v.map((x) => replaceIn(x, find, to, text, count));
  if (isRec(v)) {
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) out[k] = replaceIn(x, find, to, TEXT.has(k), count);
    return out;
  }
  return v;
}

// ---------------- операции ----------------

interface OpDef {
  /** Что делает — для описания команд (MCP) и документации */
  summary: string;
  /** Поля операции: имя → описание */
  params: Record<string, string>;
  /** Применить к черновику; ответ — подпись правки */
  run(d: Deck, a: Rec): string;
}

export const OPS: Record<string, OpDef> = {
  'deck.set': {
    summary: 'Поля самой презентации: название, язык, бренд, тема, шрифты',
    params: { set: 'поля (Merge Patch): { title: "…", theme: { preset: "midnight" } }; null — удалить поле' },
    run(d, a) {
      const set = needPatch(a.set, 'set');
      if ('slides' in set) throw new OpError('слайды правятся операциями slide.*');
      const next = mergePatch(d, set) as Deck;
      Object.keys(d).forEach((k) => { if (!(k in next)) delete (d as unknown as Rec)[k]; });
      Object.assign(d, next);
      return 'Настройки презентации';
    },
  },
  'slide.add': {
    summary: 'Новый слайд',
    params: { slide: 'данные слайда, как в deck.yaml (без поля — пустой холст); id без повторов, без id — выдаётся', at: 'место, с 1 (без поля — в конец)' },
    run(d, a) {
      const s = (a.slide === undefined ? { template: 'canvas' } : clone(a.slide)) as SlideData;
      if (!isRec(s)) throw new OpError('slide — данные слайда, например { title: "…", body: [...] }');
      const at = a.at === undefined ? d.slides.length : needPosition(a.at, d.slides.length + 1, 'at');
      if (typeof s.id !== 'string' || !s.id || d.slides.some((x) => x?.id === s.id)) s.id = freeSlideId(d, typeof s.id === 'string' ? s.id : 'slide');
      d.slides.splice(at, 0, s);
      return `Новый слайд ${at + 1}`;
    },
  },
  'slide.remove': {
    summary: 'Удалить слайд',
    params: { slide: 'слайд' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      if (d.slides.length <= 1) throw new OpError('единственный слайд удалить нельзя');
      d.slides.splice(i, 1);
      return `Удалён слайд ${i + 1}`;
    },
  },
  'slide.move': {
    summary: 'Переставить слайд',
    params: { slide: 'слайд', to: 'новое место, с 1' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const to = needPosition(a.to, d.slides.length, 'to');
      const [s] = d.slides.splice(i, 1);
      d.slides.splice(to, 0, s);
      return `Слайд ${i + 1} → ${to + 1}`;
    },
  },
  'slide.duplicate': {
    summary: 'Копия слайда (имена объектов — те же: морф между оригиналом и копией работает сразу)',
    params: { slide: 'слайд', at: 'место копии, с 1 (без поля — сразу за оригиналом)' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const copy = clone(d.slides[i]);
      copy.id = freeSlideId(d, typeof copy.id === 'string' ? copy.id : 'slide');
      const at = a.at === undefined ? i + 1 : needPosition(a.at, d.slides.length + 1, 'at');
      d.slides.splice(at, 0, copy);
      return `Копия слайда ${i + 1} → ${at + 1}`;
    },
  },
  'slide.set': {
    summary: 'Поля слайда: заголовок, заметки, шаблон, переход, блоки раскладки (body), скрытие',
    params: { slide: 'слайд', set: 'поля (Merge Patch): { title: "…", notes: "…" }; null — удалить; свободные объекты — операциями object.*' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const set = needPatch(a.set, 'set');
      if ('free' in set) throw new OpError('свободные объекты правятся операциями object.*');
      d.slides[i] = mergePatch(d.slides[i], set) as SlideData;
      return `Правка слайда ${i + 1}`;
    },
  },
  'object.add': {
    summary: 'Новый свободный объект на слайде (текст, фигура, картинка, график… — как в free у deck.yaml)',
    params: { slide: 'слайд', object: 'данные объекта: { type: "text", text: "…", place: { x, y, w, h } }', at: 'место в стопке, с 1 (без поля — поверх всех)' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const o = clone(a.object) as Block;
      if (!isRec(o) || typeof o.type !== 'string' || !o.type) throw new OpError('object — данные объекта с type, например { type: "text", text: "…", place: { x: 80, y: 80, w: 400 } }');
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      const at = a.at === undefined ? s.free.length : needPosition(a.at, s.free.length + 1, 'at');
      s.free.splice(at, 0, o);
      return `Новый объект · слайд ${i + 1}`;
    },
  },
  'object.set': {
    summary: 'Поля объекта: место (place), текст, оформление, анимация',
    params: { slide: 'слайд', object: 'объект', set: 'поля (Merge Patch): { place: { x: 100 } } — сдвинуть, не меняя размер; null — удалить поле' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const k = objectIndex(d.slides[i], a.object, i);
      const set = needPatch(a.set, 'set');
      const list = d.slides[i].free!;
      list[k] = mergePatch(list[k], set) as Block;
      const keys = Object.keys(set);
      return `${keys.every((x) => x === 'place' || x === 'angle') ? 'Место объекта' : 'Правка объекта'} · слайд ${i + 1}`;
    },
  },
  'object.remove': {
    summary: 'Удалить объект',
    params: { slide: 'слайд', object: 'объект' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const s = d.slides[i];
      s.free!.splice(objectIndex(s, a.object, i), 1);
      // Пустой список в данных не нужен — как у студии
      if (!s.free!.length) delete s.free;
      return `Удалён объект · слайд ${i + 1}`;
    },
  },
  'object.order': {
    summary: 'Место объекта в стопке: поверх всех, под всеми или на номер',
    params: { slide: 'слайд', object: 'объект', to: '"front" — поверх всех, "back" — под всеми, или место с 1' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const s = d.slides[i];
      const list = s.free!;
      const k = objectIndex(s, a.object, i);
      let to: number;
      if (a.to === 'front') to = list.length - 1;
      else if (a.to === 'back') to = 0;
      else if (Number.isInteger(a.to) && (a.to as number) >= 1 && (a.to as number) <= list.length) to = (a.to as number) - 1;
      else throw new OpError(`to — "front", "back" или место с 1 по ${list.length}`);
      const [o] = list.splice(k, 1);
      list.splice(to, 0, o);
      return `Порядок объектов · слайд ${i + 1}`;
    },
  },
  'text.replace': {
    summary: 'Заменить текст во всей презентации или на одном слайде: заголовки, тексты, пункты, ячейки, заметки (точное совпадение)',
    params: { find: 'что найти', replace: 'на что заменить', slide: 'только этот слайд (без поля — везде, и в названии презентации)' },
    run(d, a) {
      if (typeof a.find !== 'string' || !a.find) throw new OpError('find — непустой текст');
      if (typeof a.replace !== 'string') throw new OpError('replace — текст (пустой — удалить)');
      const count = { n: 0 };
      const only = a.slide === undefined ? -1 : slideIndex(d, a.slide);
      d.slides = d.slides.map((s, i) => (only < 0 || i === only ? replaceIn(s, a.find as string, a.replace as string, false, count) as SlideData : s));
      if (only < 0 && typeof d.title === 'string') d.title = replaceIn(d.title, a.find, a.replace, true, count) as string;
      return `Замена текста: ${count.n}`;
    },
  },
};

// ---------------- проверка итога ----------------

const OBJ_NAME = /^[\w-]+$/;

/**
 * Данные, которые студия и показ могут открыть: иначе — ошибка с понятным текстом. keep — слайды, которые
 * не менялись (canon): их не проверяем — старые данные, поправленные руками, не мешают править остальное
 */
export function checkDeck(d: unknown, keep: Set<string> = new Set()): void {
  if (!isRec(d)) throw new OpError('данные презентации — объект');
  if (d.title !== undefined && typeof d.title !== 'string') throw new OpError('title — текст');
  if (!Array.isArray(d.slides) || !d.slides.length) throw new OpError('в презентации должен быть хотя бы один слайд');
  const ids = new Set<string>();
  // Повторы id слайдов — только у новых и поправленных
  const fresh = d.slides.map((s) => !keep.has(canon(s)));
  d.slides.forEach((s, i) => { if (!fresh[i] && isRec(s) && typeof s.id === 'string') ids.add(s.id); });
  d.slides.forEach((s, i) => {
    if (!fresh[i]) return;
    const at = `слайд ${i + 1}`;
    if (!isRec(s)) throw new OpError(`${at}: данные слайда — объект`);
    if (s.id !== undefined) {
      if (typeof s.id !== 'string' || !OBJ_NAME.test(s.id)) throw new OpError(`${at}: id — латиница, цифры, дефис`);
      if (ids.has(s.id)) throw new OpError(`${at}: id «${s.id}» уже есть у другого слайда`);
      ids.add(s.id);
    }
    if (s.free === undefined) return;
    if (!Array.isArray(s.free)) throw new OpError(`${at}: free — список объектов`);
    const names = new Set<string>();
    s.free.forEach((b, k) => {
      const ob = `${at}, объект ${k + 1}`;
      if (!isRec(b) || typeof b.type !== 'string' || !b.type) throw new OpError(`${ob}: у объекта должен быть type`);
      if (b.place !== undefined && !isRec(b.place)) throw new OpError(`${ob}: place — { x, y, w, h }`);
      if (isRec(b.place)) {
        for (const [key, v] of Object.entries(b.place)) if (typeof v !== 'number' || !Number.isFinite(v)) throw new OpError(`${ob}: place.${key} — число`);
      }
      if (b.id !== undefined) {
        // Имя объекта на слайде одно (как в студии): по нему соединители, морф и адреса операций
        if (typeof b.id !== 'string' || !OBJ_NAME.test(b.id)) throw new OpError(`${ob}: имя (id) — латиница, цифры, дефис`);
        if (names.has(b.id)) throw new OpError(`${ob}: имя «${b.id}» уже есть на этом слайде`);
        names.add(b.id);
      }
    });
  });
}

// ---------------- пакет ----------------

export interface Expect { slide: SlideRef; rev: string }

export interface ApplyResult {
  deck: Deck;
  /** Подписи правок по порядку */
  changes: string[];
}

/**
 * Применить пакет операций: все или ни одной. expect — ревизии слайдов, какими их прочитали (адреса — до пакета):
 * слайд поменяли — ошибка, данные не тронуты
 */
export function applyOps(deck: Deck, ops: unknown, o: { expect?: unknown } = {}): ApplyResult {
  if (!Array.isArray(ops) || !ops.length) throw new OpError('ops — список операций: [{ op: "slide.set", slide: 1, set: { title: "…" } }]');
  if (o.expect !== undefined) {
    if (!Array.isArray(o.expect)) throw new OpError('expect — список { slide, rev } из outline');
    for (const e of o.expect) {
      if (!isRec(e) || typeof e.rev !== 'string') throw new OpError('expect — список { slide, rev } из outline');
      let i: number;
      try { i = slideIndex(deck, e.slide); } catch (err) { throw new OpError(`Презентация изменилась: ${(err as Error).message}. Перечитайте (outline)`); }
      if (slideRev(deck.slides[i]) !== e.rev) throw new OpError(`Слайд ${i + 1} изменился с тех пор, как его прочитали. Перечитайте (outline) и повторите`);
    }
  }
  const d = clone(deck);
  const changes = ops.map((op, n) => {
    const a = op as Rec;
    const def = isRec(a) && typeof a.op === 'string' ? OPS[a.op] : undefined;
    if (!def) throw new OpError(`Операция ${n + 1}: неизвестная${isRec(a) && a.op ? ` «${String(a.op)}»` : ''}. Есть: ${Object.keys(OPS).join(', ')}`);
    try {
      return def.run(d, a);
    } catch (e) {
      throw new OpError(`Операция ${n + 1} (${a.op}): ${(e as Error).message}`);
    }
  });
  try { checkDeck(d, new Set(deck.slides.map(canon))); } catch (e) { throw new OpError(`После операций: ${(e as Error).message}`); }
  return { deck: d, changes };
}

// ---------------- краткое содержание ----------------

/** Текст без разметки и коротко: {g:duo|слово} → слово, без ** и ссылок */
function plain(v: unknown, max = 80): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\{[^{}|]+\|([^{}]*)\}/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*/g, (_m, a, b, c) => a ?? b ?? c).replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Первый текст блока: заголовок, текст, первый пункт */
function textOf(b: Rec): string | undefined {
  for (const k of ['text', 'title', 'label', 'value', 'caption', 'quote', 'center']) {
    const t = plain(b[k]);
    if (t) return t;
  }
  const items = Array.isArray(b.items) ? b.items : [];
  for (const it of items) {
    const t = typeof it === 'string' ? plain(it) : isRec(it) ? textOf(it) : undefined;
    if (t) return t;
  }
  return undefined;
}

export interface ObjectOutline { n: number; type: string; name?: string; text?: string; place?: Rec; locked?: true; hidden?: true }
export interface SlideOutline {
  n: number;
  id?: string;
  rev: string;
  template: string;
  title?: string;
  hidden?: true;
  notes?: string;
  /** Блоки раскладки (body): вид и первый текст */
  body?: string[];
  /** Свободные объекты, снизу вверх */
  objects?: ObjectOutline[];
}
export interface DeckOutline {
  title: string;
  lang?: string;
  theme?: string;
  slides: SlideOutline[];
}

/** Краткое содержание для агента: слайды с ревизиями, блоки и объекты с номерами — по ним адресуются операции */
export function outline(d: Deck): DeckOutline {
  const preset = isRec(d.theme) ? (d.theme as Rec).preset : undefined;
  return {
    title: typeof d.title === 'string' ? d.title : '',
    ...(typeof d.lang === 'string' ? { lang: d.lang } : {}),
    ...(typeof preset === 'string' ? { theme: preset } : {}),
    slides: d.slides.map((s, i) => slideOutline(s, i)),
  };
}

export function slideOutline(s: SlideData, i: number): SlideOutline {
  const body = (Array.isArray(s.body) ? s.body : s.body ? [s.body] : []).filter(isRec);
  const free = (Array.isArray(s.free) ? s.free : []).filter(isRec);
  const title = plain(s.label ?? s.title);
  const notes = plain(s.notes, 160);
  return {
    n: i + 1,
    ...(typeof s.id === 'string' ? { id: s.id } : {}),
    rev: slideRev(s),
    template: typeof s.template === 'string' ? s.template : 'content',
    ...(title ? { title } : {}),
    ...(s.hidden === true ? { hidden: true as const } : {}),
    ...(notes ? { notes } : {}),
    ...(body.length ? { body: body.map((b) => { const t = textOf(b); return `${String(b.type ?? '?')}${t ? `: ${t}` : ''}`; }) } : {}),
    ...(free.length ? {
      objects: free.map((b, k) => {
        const t = textOf(b);
        return {
          n: k + 1,
          type: String(b.type ?? '?'),
          ...(typeof b.id === 'string' ? { name: b.id } : {}),
          ...(t ? { text: t } : {}),
          ...(isRec(b.place) ? { place: b.place } : {}),
          ...(b.locked === true ? { locked: true as const } : {}),
          ...(b.hidden === true ? { hidden: true as const } : {}),
        };
      }),
    } : {}),
  };
}
