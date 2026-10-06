/**
 * Смена вида блока: тот же набор пунктов — списком, шагами, таймлайном, карточками, вокруг центра,
 * метками или парами «ключ — значение». Общая форма — пункты «заголовок + текст»; поля, которых
 * у нового вида нет (дата таймлайна, подпись узла), остаются в пунктах и вернутся при обратной смене.
 * Место, появление, имя и прочие свойства объекта сохраняются.
 */
import type { Block } from '../types';

export interface Item { title: string; text?: string; [extra: string]: unknown }

export const VIEWS: { id: string; name: string; icon: string; group: 'Списки' | 'Схемы' }[] = [
  { id: 'list', name: 'Список', icon: 'list', group: 'Списки' },
  { id: 'numbers', name: 'Номера', icon: 'hash', group: 'Списки' },
  { id: 'icons', name: 'Иконки', icon: 'star', group: 'Списки' },
  { id: 'stats', name: 'Цифры', icon: 'chart', group: 'Списки' },
  { id: 'cards', name: 'Карточки', icon: 'grid', group: 'Списки' },
  { id: 'faq', name: 'Вопросы', icon: 'faq', group: 'Списки' },
  { id: 'chips', name: 'Метки', icon: 'text-box', group: 'Списки' },
  { id: 'kv', name: 'Пары', icon: 'eq-cols', group: 'Списки' },
  { id: 'pipeline', name: 'Шаги', icon: 'next', group: 'Схемы' },
  { id: 'timeline', name: 'Таймлайн', icon: 'dist-h', group: 'Схемы' },
  { id: 'cycle', name: 'Цикл', icon: 'cycle', group: 'Схемы' },
  { id: 'funnel', name: 'Воронка', icon: 'funnel', group: 'Схемы' },
  { id: 'pyramid', name: 'Пирамида', icon: 'pyramid', group: 'Схемы' },
  { id: 'compare', name: 'Сравнение', icon: 'columns', group: 'Схемы' },
  { id: 'matrix', name: 'Матрица', icon: 'quad', group: 'Схемы' },
  { id: 'hub', name: 'Вокруг центра', icon: 'sensor', group: 'Схемы' },
];
/** Виды с пунктами items: [{ title, text, … }] — переводятся друг в друга без потерь */
export const ITEM_VIEWS = new Set(['timeline', 'hub', 'cycle', 'funnel', 'pyramid', 'numbers', 'compare', 'matrix', 'icons', 'stats', 'faq']);

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Поля пункта, которые есть у каждого вида */
const CORE = new Set(['title', 'text', 'sub', 'type', 'body', 'place', 'cols', 'rows', 'style', 'styles']);
const extras = (o: Obj) => Object.fromEntries(Object.entries(o).filter(([k]) => !CORE.has(k)));

/** Карточки — сетка из карточек без вложенных блоков */
const isCards = (b: Obj) => b.type === 'grid' && arr(b.items).length > 0
  && arr(b.items).every((x) => !!x && typeof x === 'object' && (x as Obj).type === 'card' && !(x as Obj).body);

export function viewOf(b: unknown): string | null {
  const o = b as Obj | null;
  if (!o || typeof o !== 'object') return null;
  if (isCards(o)) return 'cards';
  return VIEWS.some((v) => v.id === o.type && v.id !== 'cards') ? String(o.type) : null;
}

/** Пункты блока в общей форме */
export function itemsOf(b: Obj): Item[] {
  switch (viewOf(b)) {
    case 'list':
      return arr(b.items).map((s) => {
        const line = str(s);
        // «**Заголовок** — текст» или «Заголовок — текст»
        const m = /^\*\*(.+?)\*\*\s*[—–:-]?\s*(.*)$/.exec(line) ?? /^(.+?)\s+[—–]\s+(.+)$/.exec(line);
        return m ? { title: m[1].trim(), ...(m[2].trim() ? { text: m[2].trim() } : {}) } : { title: line };
      });
    case 'pipeline':
      return arr(b.steps).map((s) => { const o = s as Obj; return { ...extras(o), title: str(o.title), ...(o.sub ? { text: str(o.sub) } : {}) }; });
    case 'timeline': case 'hub': case 'cycle': case 'funnel': case 'pyramid': case 'numbers': case 'compare': case 'matrix': case 'icons': case 'stats': case 'faq':
      return arr(b.items).map((s) => { const o = s as Obj; return { ...extras(o), title: str(o.title), ...(o.text ? { text: str(o.text) } : {}), ...(o.sub ? { sub: str(o.sub) } : {}) }; });
    case 'cards':
      return arr(b.items).map((s) => { const o = s as Obj; return { ...extras(o), title: str(o.title), ...(o.text ? { text: str(o.text) } : {}) }; });
    case 'chips':
      return arr(b.items).map((c) => (typeof c === 'string' ? { title: c } : { ...extras(c as Obj), title: str((c as Obj).text) }));
    case 'kv': {
      const rows = Array.isArray(b.rows) ? b.rows as unknown[][] : Object.entries((b.rows ?? {}) as Obj);
      return rows.map(([k, v]) => ({ title: str(k), ...(str(v) ? { text: str(v) } : {}) }));
    }
    default:
      return [];
  }
}

/** Свойства объекта, которые переходят в новый вид (место, появление, имя, ряд…) */
const KEEP = ['place', 'enter', 'delay', 'id', 'locked', 'hidden', 'action', 'emphasis', 'row', 'count', 'angle', 'rotate', 'keepRatio'];

export function toView(b: Obj, view: string): Block {
  const items = itemsOf(b);
  const keep = Object.fromEntries(KEEP.filter((k) => k in b).map((k) => [k, b[k]]));
  // Высота у свободного объекта — по новому содержимому
  if (keep.place && typeof keep.place === 'object') {
    const { h: _h, ...rest } = keep.place as Obj;
    keep.place = rest;
  }
  const rest = (i: Item) => { const { title: _t, text: _x, ...e } = i; return e; };
  let out: Obj;
  switch (view) {
    case 'list':
      out = { type: 'list', items: items.map((i) => (i.text ? `**${i.title}** — ${i.text}` : i.title)) };
      break;
    case 'pipeline':
      out = { type: 'pipeline', steps: items.map((i) => ({ ...rest(i), title: i.title, ...(i.text ? { sub: i.text } : {}) })) };
      break;
    case 'timeline': case 'hub': case 'cycle': case 'funnel': case 'pyramid': case 'numbers': case 'compare': case 'matrix': case 'icons': case 'stats': case 'faq':
      out = { type: view, items: items.map((i) => ({ ...rest(i), title: i.title, ...(i.text ? { text: i.text } : {}) })) };
      break;
    case 'cards': {
      const n = items.length;
      out = { type: 'grid', columns: n <= 4 ? n : n % 3 === 0 ? 3 : n === 5 ? 3 : 4, items: items.map((i) => ({ ...rest(i), type: 'card', title: i.title, ...(i.text ? { text: i.text } : {}) })) };
      break;
    }
    case 'chips':
      out = { type: 'chips', items: items.map((i) => (i.accent ? { text: i.title, accent: true } : i.title)) };
      break;
    case 'kv':
      out = { type: 'kv', rows: items.map((i) => [i.title, i.text ?? '']) };
      break;
    default:
      return b as Block;
  }
  return { ...keep, ...out } as Block;
}
