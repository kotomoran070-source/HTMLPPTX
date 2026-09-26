/**
 * Метки для режима правки. Каждый объект данных помнит свой путь в презентации,
 * а компоненты помечают элементы атрибутами:
 *   data-edit       — текст, который правят на месте;
 *   data-ed-style   — у поля может быть оформление (размер, цвет…): путь к объекту-владельцу;
 *   data-edit-img   — картинка, которую можно заменить или убрать;
 *   data-img-owner  — объект с настройками картинки (fit, position, zoom, height);
 *   data-edit-url   — ссылка, адрес которой можно поменять.
 * Вне режима правки атрибуты ни на что не влияют.
 */
import type { ChipData } from '../types';
import { KEY, type Path } from './data';
import { esc, t } from './html';
import { textStyleCss } from './text-style';

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

interface EaOpts {
  /** Хвост значения, который не показывается и не правится (звёздочка у чипа) */
  suffix?: string;
  /** CSS самого компонента для этого элемента: объединяется с оформлением поля */
  style?: string;
  /** Поле не хранит оформление (например, значения словаря ключ — значение) */
  noStyle?: boolean;
}

/** Оформление поля: obj.styles[key] */
export function fieldStyle(obj: unknown, key: string | number): string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  const styles = (obj as { styles?: Record<string, unknown> }).styles;
  return styles && typeof styles === 'object' ? textStyleCss(styles[String(key)]) : '';
}

/** Атрибуты для элемента, всё содержимое которого — значение obj[key]. */
export function ea(obj: unknown, key: string | number, opts: EaOpts = {}): string {
  const p = pathOf(obj);
  const styleable = !opts.noStyle && !!obj && typeof obj === 'object' && !Array.isArray(obj);
  const css = [opts.style, styleable ? fieldStyle(obj, key) : ''].filter(Boolean).join(';');
  const style = css ? ` style="${esc(css)}"` : '';
  if (!p) return style;
  return attr('data-edit', [...p, key])
    + (styleable ? attr('data-ed-style', p) : '')
    + (opts.suffix ? ` data-suffix="${esc(opts.suffix)}"` : '')
    + style;
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

export type ImgKind = 'photo' | 'logo';

/**
 * Картинка, которую можно заменить или убрать: по пути obj[key] лежит адрес.
 * Для фото владелец (obj) хранит кадр: fit, position, zoom.
 */
export function eimg(obj: unknown, key: string, kind: ImgKind = 'photo'): string {
  const p = pathOf(obj);
  return p ? attr('data-edit-img', [...p, key]) + attr('data-img-owner', p) + ` data-img-kind="${kind}"` : '';
}

export function eimgPath(p: Path, kind: ImgKind = 'logo'): string {
  return attr('data-edit-img', p) + ` data-img-kind="${kind}"`;
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

// ---------- кадр картинки ----------

export interface ImageFrame {
  fit?: 'cover' | 'contain';
  /** Точка кадра для «заполнить»: "50% 30%" */
  position?: string;
  /** Масштаб 0.3–4: меньше 1 — картинка уменьшена внутри рамки */
  zoom?: number;
}

const POS = /^(\d{1,3}(\.\d+)?)% (\d{1,3}(\.\d+)?)%$/;

/** CSS картинки по настройкам кадра. */
export function frameCss(f: ImageFrame, defaultFit: 'cover' | 'contain' = 'cover'): string {
  const fit = f.fit === 'contain' || f.fit === 'cover' ? f.fit : defaultFit;
  const pos = typeof f.position === 'string' && POS.test(f.position) ? f.position : '50% 50%';
  const zoom = Math.max(0.3, Math.min(4, Number(f.zoom) || 1));
  let css = `object-fit:${fit};object-position:${pos}`;
  if (zoom !== 1) css += `;transform:scale(${zoom});transform-origin:${pos}`;
  return css;
}
