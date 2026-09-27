import type { Path } from '../engine/data';
import { getAt } from '../engine/data';
import type { TextStyle } from '../engine/text-style';
import type { Block, Deck } from '../types';

/**
 * Формат по образцу: оформление одного объекта переносится на другие.
 * Объект того же типа получает всё оформление; другого типа — оформление основного текста.
 * Содержимое, размер, место и анимация не переносятся.
 */

/** Свойства оформления по типам блоков */
const LOOK: Record<string, string[]> = {
  shape: ['fill', 'stroke', 'width', 'dash', 'radius', 'shadow', 'opacity', 'valign'],
  table: ['variant', 'labels', 'total', 'density', 'size', 'head'],
  text: ['size'],
  image: ['fit'],
};
/** У остальных блоков — общие поля вида, если они есть */
const COMMON = ['variant', 'tone', 'style'];
/** Главное текстовое поле блока: его оформление переносится между разными типами */
const MAIN_TEXT = ['text', 'title', 'value', 'label', 'caption'];

export interface Format {
  type: string;
  props: Record<string, unknown>;
  styles: Record<string, TextStyle>;
  /** Оформление главного текста — для блоков другого типа */
  text: TextStyle | null;
}

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function takeFormat(b: Block): Format {
  const keys = [...(LOOK[b.type] ?? []), ...COMMON];
  const props: Record<string, unknown> = {};
  for (const k of new Set(keys)) props[k] = copy(b[k]);
  const styles = (b.styles && typeof b.styles === 'object' ? copy(b.styles) : {}) as Record<string, TextStyle>;
  const main = MAIN_TEXT.find((k) => styles[k]) ?? Object.keys(styles)[0];
  return { type: b.type, props, styles, text: main ? styles[main] : null };
}

/** Можно ли что-то перенести: иначе кисть не включается. */
export function hasFormat(f: Format): boolean {
  return Object.values(f.props).some((v) => v !== undefined) || Object.keys(f.styles).length > 0;
}

/** Применить к блоку в черновике данных. Возвращает false, если переносить нечего. */
export function applyFormat(d: Deck, path: Path, f: Format): boolean {
  const b = getAt(d, path) as Block | undefined;
  if (!b || typeof b !== 'object') return false;
  if (b.type === f.type) {
    for (const [k, v] of Object.entries(f.props)) {
      if (v === undefined) delete b[k];
      else b[k] = copy(v);
    }
    if (Object.keys(f.styles).length) b.styles = copy(f.styles);
    else delete b.styles;
    return true;
  }
  // Другой тип: только оформление главного текста
  const field = MAIN_TEXT.find((k) => typeof b[k] === 'string' || typeof b[k] === 'number');
  if (!field || !f.text) return false;
  const styles = { ...((b.styles as Record<string, TextStyle> | undefined) ?? {}) };
  styles[field] = copy(f.text);
  b.styles = styles;
  return true;
}
