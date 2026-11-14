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
import { isSlideSize, resizeDeck } from './slide-resize';
import { SLIDE_H, widthOf } from './slide-size';
import { TRANSITIONS } from './transitions';

/** Название перехода для журнала: push → «Сдвиг» */
const trName = (v: unknown) => TRANSITIONS.find(([k]) => k === (v ?? ''))?.[1] ?? String(v);

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

const needPatch = (v: unknown): Rec => {
  if (!isRec(v) || !Object.keys(v).length) throw new OpError('set — поля, которые поменять, например { title: "…" }');
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

/** Найденный текст (findText): где он — адресами операций — и кусок вокруг */
export interface TextHit {
  /** Слайд — номер с 1; нет — название презентации */
  slide?: number;
  id?: string;
  rev?: string;
  /** Свободный объект — номер с 1 (как в outline) и имя */
  object?: number;
  name?: string;
  /** Блок раскладки (body) — номер с 1 */
  block?: number;
  /** Поле внутри слайда, объекта или блока: title, notes, items[2].text, rows[1][0] */
  field: string;
  text: string;
}

/** Для сравнения: без регистра, ё = е */
const fold = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е');

/**
 * Поиск текста там же, где его меняет text.replace: заголовки, тексты, пункты, ячейки, заметки — без учёта регистра
 * (ё = е). Ответ — места по порядку слайдов (не больше limit) и сколько их всего
 */
export function findText(d: Deck, query: string, o: { slide?: SlideRef; limit?: number } = {}): { hits: TextHit[]; total: number } {
  const q = fold(query.trim());
  if (!q) throw new OpError('query — непустой текст');
  const limit = o.limit ?? 100;
  const hits: TextHit[] = [];
  let total = 0;
  const snip = (s: string, at: number) => {
    const from = Math.max(0, at - 40);
    const to = Math.min(s.length, at + q.length + 40);
    return `${from ? '…' : ''}${s.slice(from, to).replace(/\s+/g, ' ')}${to < s.length ? '…' : ''}`;
  };
  const hit = (s: string, where: Omit<TextHit, 'text'>) => {
    const f = fold(s);
    for (let at = f.indexOf(q); at >= 0; at = f.indexOf(q, at + q.length)) {
      total++;
      if (hits.length < limit) hits.push({ ...where, text: snip(s, at) });
    }
  };
  // Как replaceIn: строка — текст, если её поле из TEXT (в списке — по полю списка)
  const walk = (v: unknown, field: string, text: boolean, where: Omit<TextHit, 'text' | 'field'>) => {
    if (typeof v === 'string') { if (text) hit(v, { ...where, field }); return; }
    if (Array.isArray(v)) { v.forEach((x, k) => walk(x, `${field}[${k}]`, text, where)); return; }
    if (isRec(v)) for (const [k, x] of Object.entries(v)) walk(x, field ? `${field}.${k}` : k, TEXT.has(k), where);
  };
  const only = o.slide === undefined ? -1 : slideIndex(d, o.slide);
  if (only < 0 && typeof d.title === 'string') hit(d.title, { field: 'title' });
  d.slides.forEach((s, i) => {
    if ((only >= 0 && i !== only) || !isRec(s)) return;
    const at = { slide: i + 1, ...(typeof s.id === 'string' ? { id: s.id } : {}), rev: slideRev(s) };
    for (const [k, v] of Object.entries(s)) {
      if (k === 'free' && Array.isArray(v)) {
        v.forEach((b, n) => walk(b, '', false, { ...at, object: n + 1, ...(isRec(b) && typeof b.id === 'string' ? { name: b.id } : {}) }));
      } else if (k === 'body') {
        (Array.isArray(v) ? v : [v]).forEach((b, n) => walk(b, '', false, { ...at, block: n + 1 }));
      } else walk(v, k, TEXT.has(k), at);
    }
  });
  return { hits, total };
}

// ---------------- операции ----------------

/** Правка для журнала: подпись, слайд (номер с 1 в ту минуту), было → стало — коротко, текстом */
/** Правка для журнала: slide — номер слайда тогда, id — сам слайд (если у него есть id): по нему он находится и после перестановок */
export interface Change { label: string; slide?: number; id?: string; was?: string; now?: string }

const change = (label: string, slide?: number, was?: string, now?: string): Change => ({
  label, ...(slide !== undefined ? { slide } : {}), ...(was ? { was } : {}), ...(now ? { now } : {}),
});
/** Было → стало, если текст поменялся */
const diffText = (label: string, slide: number | undefined, a: string | undefined, b: string | undefined): Change => (a !== b ? change(label, slide, a ?? '—', b ?? '—') : change(label, slide));

interface OpDef {
  /** Что делает — для описания команд (MCP) и документации */
  summary: string;
  /** Поля операции: имя → описание */
  params: Record<string, string>;
  /** Применить к черновику; ответ — что поменялось */
  run(d: Deck, a: Rec): Change;
}

export const OPS: Record<string, OpDef> = {
  'deck.set': {
    summary: 'Поля самой презентации: название, язык, бренд, тема, шрифты',
    params: { set: 'поля (Merge Patch): { title: "…", theme: { preset: "midnight" } }; null — удалить поле' },
    run(d, a) {
      const set = needPatch(a.set);
      if ('slides' in set) throw new OpError('слайды правятся операциями slide.*');
      // Размер слайда — с перестановкой объектов, как deck.size
      if ('size' in set) {
        const size = set.size ?? '16:9';
        if (!isSlideSize(size)) throw new OpError('size — "16:9", "4:3" или "21:9"');
        resizeDeck(d, size);
        const { size: _s, ...rest } = set;
        if (!Object.keys(rest).length) return change(`Размер слайда: ${size}`);
        return OPS['deck.set'].run(d, { ...a, set: rest });
      }
      const was = plain(d.title);
      const next = mergePatch(d, set) as Deck;
      Object.keys(d).forEach((k) => { if (!(k in next)) delete (d as unknown as Rec)[k]; });
      Object.assign(d, next);
      return 'title' in set ? diffText('Название презентации', undefined, was, plain(d.title)) : change('Настройки презентации');
    },
  },
  'deck.size': {
    summary: 'Размер слайда: 16:9 (1280×720), 4:3 (960×720 — старые проекторы) или 21:9 (1680×720 — широкие экраны). '
      + 'Высота та же, раскладки перестраиваются сами, свободные объекты остаются у своего края или по центру, на всю ширину — растягиваются',
    params: { size: '"16:9", "4:3" или "21:9"', fit: 'true — при сужении слайды, содержимое которых шире нового размера, уменьшить целиком (места, размеры, шрифты); иначе объекты встают к краям своего размера и могут наложиться' },
    run(d, a) {
      if (!isSlideSize(a.size)) throw new OpError('size — "16:9", "4:3" или "21:9"');
      const r = resizeDeck(d, a.size, { fit: a.fit === true });
      const tail = [r.moved ? `передвинуто объектов ${r.moved}` : '', r.scaled.length ? `уменьшено слайдов ${r.scaled.length}` : '', r.outside ? `за краем ${r.outside}` : ''].filter(Boolean).join(', ');
      return change(`Размер слайда: ${a.size}${tail ? ` (${tail})` : ''}`);
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
      return change(`Новый слайд ${at + 1}`, at + 1, undefined, plain(s.label ?? s.title) ?? textOf(s));
    },
  },
  'slide.remove': {
    summary: 'Удалить слайд',
    params: { slide: 'слайд' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      if (d.slides.length <= 1) throw new OpError('единственный слайд удалить нельзя');
      const [gone] = d.slides.splice(i, 1);
      return change(`Удалён слайд ${i + 1}`, i + 1, plain(gone.label ?? gone.title) ?? `слайд ${i + 1}`);
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
      return change(`Слайд ${i + 1} → ${to + 1}`, to + 1);
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
      return change(`Копия слайда ${i + 1} → ${at + 1}`, at + 1);
    },
  },
  'slide.set': {
    summary: 'Поля слайда: заголовок, заметки, шаблон, переход, блоки раскладки (body), скрытие',
    params: { slide: 'слайд', set: 'поля (Merge Patch): { title: "…", notes: "…" }; null — удалить; свободные объекты — операциями object.*' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const set = needPatch(a.set);
      if ('free' in set) throw new OpError('свободные объекты правятся операциями object.*');
      const old = d.slides[i];
      d.slides[i] = mergePatch(old, set) as SlideData;
      const now = d.slides[i];
      if ('title' in set || 'label' in set) return diffText(`Заголовок · слайд ${i + 1}`, i + 1, plain(old.label ?? old.title), plain(now.label ?? now.title));
      if ('notes' in set) return diffText(`Заметки · слайд ${i + 1}`, i + 1, plain(old.notes), plain(now.notes));
      const keys = Object.keys(set);
      const only = (...k: string[]) => keys.every((x) => k.includes(x));
      if (only('transition', 'transitionMs', 'transitionDir')) return diffText(`Переход · слайд ${i + 1}`, i + 1, trName(old.transition), trName(now.transition));
      if (only('hidden')) return change(`${now.hidden ? 'Скрыт' : 'Показан'} слайд ${i + 1}`, i + 1);
      if (only('template')) return diffText(`Макет · слайд ${i + 1}`, i + 1, String(old.template ?? 'content'), String(now.template ?? 'content'));
      if (only('body')) return change(`Блоки раскладки · слайд ${i + 1}`, i + 1);
      return change(`Правка слайда ${i + 1}`, i + 1);
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
      return change(`Новый объект · слайд ${i + 1}`, i + 1, undefined, textOf(o) ?? o.type);
    },
  },
  'object.set': {
    summary: 'Поля объекта: место (place), текст, оформление, анимация',
    params: { slide: 'слайд', object: 'объект', set: 'поля (Merge Patch): { place: { x: 100 } } — сдвинуть, не меняя размер; null — удалить поле' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const k = objectIndex(d.slides[i], a.object, i);
      const set = needPatch(a.set);
      const list = d.slides[i].free!;
      const old = list[k];
      list[k] = mergePatch(old, set) as Block;
      const keys = Object.keys(set);
      if (keys.every((x) => x === 'place' || x === 'angle')) return change(`Место объекта · слайд ${i + 1}`, i + 1);
      return diffText(`Правка объекта · слайд ${i + 1}`, i + 1, textOf(old), textOf(list[k]));
    },
  },
  'object.remove': {
    summary: 'Удалить объект',
    params: { slide: 'слайд', object: 'объект' },
    run(d, a) {
      const i = slideIndex(d, a.slide);
      const s = d.slides[i];
      const [gone] = s.free!.splice(objectIndex(s, a.object, i), 1);
      // Пустой список в данных не нужен — как у студии
      if (!s.free!.length) delete s.free;
      return change(`Удалён объект · слайд ${i + 1}`, i + 1, textOf(gone) ?? gone.type);
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
      return change(`Порядок объектов · слайд ${i + 1}`, i + 1);
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
      return change(`Замена текста: ${count.n}`, only < 0 ? undefined : only + 1, a.find as string, (a.replace as string) || '(пусто)');
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
  if (d.size !== undefined && !isSlideSize(d.size)) throw new OpError('size — "16:9", "4:3" или "21:9"');
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
  /** Они же подробно — для журнала: слайд, было → стало */
  details: Change[];
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
  const details = ops.map((op, n) => {
    const a = op as Rec;
    const def = isRec(a) && typeof a.op === 'string' ? OPS[a.op] : undefined;
    if (!def) throw new OpError(`Операция ${n + 1}: неизвестная${isRec(a) && a.op ? ` «${String(a.op)}»` : ''}. Есть: ${Object.keys(OPS).join(', ')}`);
    try {
      const c = def.run(d, a);
      // Слайд правки — и по id: номер после перестановок уже не тот (удалённого слайда нет — и id нет)
      const sid = c.slide && a.op !== 'slide.remove' ? d.slides[c.slide - 1]?.id : undefined;
      return typeof sid === 'string' && sid ? { ...c, id: sid } : c;
    } catch (e) {
      throw new OpError(`Операция ${n + 1} (${a.op}): ${(e as Error).message}`);
    }
  });
  try { checkDeck(d, new Set(deck.slides.map(canon))); } catch (e) { throw new OpError(`После операций: ${(e as Error).message}`); }
  return { deck: d, changes: details.map((c) => c.label), details };
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
  /** Размер слайда: пропорция и пиксели (place объектов — в них) */
  canvas: { size: string; w: number; h: number };
  slides: SlideOutline[];
}

/** Краткое содержание для агента: слайды с ревизиями, блоки и объекты с номерами — по ним адресуются операции */
export function outline(d: Deck): DeckOutline {
  const preset = isRec(d.theme) ? (d.theme as Rec).preset : undefined;
  return {
    title: typeof d.title === 'string' ? d.title : '',
    ...(typeof d.lang === 'string' ? { lang: d.lang } : {}),
    ...(typeof preset === 'string' ? { theme: preset } : {}),
    canvas: { size: isSlideSize(d.size) ? d.size : '16:9', w: widthOf(d), h: SLIDE_H },
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
