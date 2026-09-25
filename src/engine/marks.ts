/**
 * Метки для режима правки. Каждый объект данных помнит свой путь в презентации,
 * а компоненты помечают элементы атрибутами:
 *   data-edit      — текст, который правят на месте;
 *   data-edit-img  — картинка, которую можно заменить;
 *   data-edit-url  — ссылка, адрес которой можно поменять.
 * Вне режима правки атрибуты ни на что не влияют.
 */
import type { ChipData } from '../types';
import { KEY, type Path } from './data';
import { esc, t } from './html';

const paths = new WeakMap<object, Path>();

/** Запоминает пути всех объектов и массивов внутри данных. Вызывается перед каждым рендером. */
export function indexPaths(value: unknown, base: Path = []): void {
  if (!value || typeof value !== 'object') return;
  paths.set(value, base);
  if (Array.isArray(value)) value.forEach((v, i) => indexPaths(v, [...base, i]));
  else for (const [k, v] of Object.entries(value)) indexPaths(v, [...base, k]);
}

export function pathOf(obj: unknown): Path | undefined {
  return obj && typeof obj === 'object' ? paths.get(obj) : undefined;
}

const attr = (name: string, p: Path) => ` ${name}="${esc(JSON.stringify(p))}"`;

/** Атрибут для элемента, всё содержимое которого — значение obj[key]. */
export function ea(obj: unknown, key: string | number, opts: { suffix?: string } = {}): string {
  const p = pathOf(obj);
  if (!p) return '';
  return attr('data-edit', [...p, key]) + (opts.suffix ? ` data-suffix="${esc(opts.suffix)}"` : '');
}

/** Текст значения в редактируемом span — для мест, где рядом есть другое содержимое. */
export function tx(obj: unknown, key: string | number): string {
  const v = (obj as Record<string | number, unknown> | undefined)?.[key];
  const a = ea(obj, key);
  return a ? `<span class="ed"${a}>${t(v)}</span>` : t(v);
}

/** Атрибут для имени ключа в словаре (например, «Доступ» в таблице ключ — значение). */
export function ekey(obj: unknown, key: string): string {
  const p = pathOf(obj);
  return p ? attr('data-edit', [...p, KEY, key]) : '';
}

/** Картинка, которую можно заменить: по пути лежит адрес изображения. */
export function eimg(obj: unknown, key: string): string {
  const p = pathOf(obj);
  return p ? attr('data-edit-img', [...p, key]) : '';
}

export function eimgPath(p: Path): string {
  return attr('data-edit-img', p);
}

/** Ссылка, адрес которой можно поменять. */
export function eurl(obj: unknown, key: string): string {
  const p = pathOf(obj);
  return p ? attr('data-edit-url', [...p, key]) : '';
}

/** Чип: строка ("Go*" — звёздочка в конце выделяет чип) или объект { text, accent }. */
export function chipAt(list: ChipData[], i: number): string {
  const c = list[i];
  if (typeof c === 'string') {
    const accent = c.endsWith('*');
    const text = accent ? c.slice(0, -1).trimEnd() : c;
    return `<span class="chip${accent ? ' a' : ''}"${ea(list, i, accent ? { suffix: '*' } : {})}>${t(text)}</span>`;
  }
  if (c && typeof c === 'object') {
    return `<span class="chip${c.accent ? ' a' : ''}"${ea(c, 'text')}>${t(c.text)}</span>`;
  }
  return '';
}

export function chips(list: ChipData[] | undefined): string {
  if (!Array.isArray(list)) return '';
  return list.map((_, i) => chipAt(list, i)).join('');
}
