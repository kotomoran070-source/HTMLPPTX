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
  shape: ['fill', 'gradient', 'stroke', 'width', 'dash', 'radius', 'shadow', 'opacity', 'valign'],
  table: ['variant', 'labels', 'total', 'density', 'size', 'head'],
  text: ['size'],
  image: ['fit', 'stroke', 'width', 'dash', 'radius', 'shadow', 'mat', 'opacity', 'filter'],
};
/** У остальных блоков — общие поля вида, если они есть */
const COMMON = ['variant', 'tone', 'style'];
/** Главное текстовое поле блока: его оформление переносится между разными типами */
const MAIN_TEXT = ['text', 'title', 'value', 'label', 'caption'];

export interface Format {
  type: string;
  props: Record<string, unknown>;
  styles: Record<string, TextStyle>;
  /** Оформление главного текста — для блоков другого типа (размер — в пикселях слайда) */
  text: TextStyle | null;
  /** Импортированная вёрстка: вид рамки и оформление текстов по порядку (размер — в пикселях слайда) */
  html?: { box: [string, string][]; texts: TextStyle[] };
}

// ---------------- импортированная вёрстка (блок html) ----------------

/** Свойства рамки, которые переносятся: фон, граница, скругление, тень, прозрачность */
const BOX = /^(background|border|box-shadow|opacity|outline)/;
const THEME_VARS: Record<string, string> = { '--ac': 'accent', '--ach': 'accent2', '--tx': 'text', '--tx2': 'text2', '--mu': 'muted' };

const htmlScale = (b: Block) => (Number(b.scale) > 0 && Number(b.scale) <= 4 ? Number(b.scale) : 1);

function parse(html: unknown): HTMLTemplateElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html ?? '');
  return tpl;
}

function hex(c: string): string | undefined {
  const v = /var\((--[\w-]+)\)/.exec(c);
  if (v) return THEME_VARS[v[1]];
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(c);
  if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return undefined;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Оформление текста из встроенных стилей вёрстки (с учётом унаследованных от родителей) */
function inlineText(el: Element, scale: number): TextStyle {
  const pick = (prop: string) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const v = (e as HTMLElement).style?.getPropertyValue(prop);
      if (v) return v.trim();
    }
    return '';
  };
  const st: TextStyle = {};
  const fs = parseFloat(pick('font-size'));
  if (fs > 0) st.size = Math.round(fs * scale);
  const w = pick('font-weight');
  const wn = w === 'bold' ? 700 : w === 'normal' ? 400 : parseInt(w, 10);
  if (wn) st.weight = wn;
  const color = hex(pick('color'));
  if (color) st.color = color;
  const ls = parseFloat(pick('letter-spacing'));
  if (Number.isFinite(ls) && fs > 0) st.spacing = Math.round((ls / fs) * 1000) / 1000;
  if (pick('text-transform') === 'uppercase') st.upper = true;
  const lh = pick('line-height');
  if (/^[\d.]+$/.test(lh)) st.leading = Number(lh);
  const ff = pick('font-family');
  if (/mono|consol|menlo/i.test(ff)) st.font = 'mono';
  else if (/serif/i.test(ff) && !/sans-serif/i.test(ff)) st.font = 'serif';
  return st;
}

function takeHtml(b: Block): Format['html'] {
  const tpl = parse(b.html);
  const root = tpl.content.firstElementChild as HTMLElement | null;
  const scale = htmlScale(b);
  const box: [string, string][] = [];
  if (root) for (let k = 0; k < root.style.length; k++) {
    const prop = root.style[k];
    if (BOX.test(prop)) box.push([prop, root.style.getPropertyValue(prop)]);
  }
  const own = (b.styles ?? {}) as Record<string, TextStyle>;
  const texts = [...tpl.content.querySelectorAll('[data-t]')]
    .sort((a, z) => Number(a.getAttribute('data-t')) - Number(z.getAttribute('data-t')))
    .map((el) => {
      const i = el.getAttribute('data-t')!;
      const set = own[i] ? { ...own[i] } : {};
      // Свои правки текста хранятся в пикселях вёрстки — переводим в пиксели слайда
      if (set.size) set.size = Math.round(set.size * scale);
      const { width: _w, ...rest } = { ...inlineText(el, scale), ...set };
      return rest;
    });
  return { box, texts };
}

function applyHtml(b: Block, f: NonNullable<Format['html']>, withBox = true): void {
  const tpl = parse(b.html);
  const root = tpl.content.firstElementChild as HTMLElement | null;
  if (root && withBox) {
    [...Array(root.style.length).keys()].map((k) => root.style[k]).filter((prop) => BOX.test(prop)).forEach((prop) => root.style.removeProperty(prop));
    f.box.forEach(([prop, v]) => root.style.setProperty(prop, v));
    b.html = tpl.innerHTML;
  }
  const scale = htmlScale(b);
  const count = tpl.content.querySelectorAll('[data-t]').length;
  const styles: Record<string, TextStyle> = {};
  for (let i = 0; i < count; i++) {
    // Тексты по порядку: заголовок — к заголовку, подпись — к подписи; лишним — оформление последнего
    const src = f.texts[Math.min(i, f.texts.length - 1)];
    if (!src) continue;
    styles[String(i)] = { ...src, ...(src.size ? { size: Math.round(src.size / scale) } : {}) };
  }
  if (Object.keys(styles).length) b.styles = styles;
}

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function takeFormat(b: Block): Format {
  if (b.type === 'html') {
    const html = takeHtml(b);
    return { type: 'html', props: {}, styles: {}, text: html?.texts[0] ?? null, html };
  }
  const keys = [...(LOOK[b.type] ?? []), ...COMMON];
  const props: Record<string, unknown> = {};
  for (const k of new Set(keys)) props[k] = copy(b[k]);
  const styles = (b.styles && typeof b.styles === 'object' ? copy(b.styles) : {}) as Record<string, TextStyle>;
  const main = MAIN_TEXT.find((k) => styles[k]) ?? Object.keys(styles)[0];
  return { type: b.type, props, styles, text: main ? styles[main] : null };
}

/** Можно ли что-то перенести: иначе кисть не включается. */
export function hasFormat(f: Format): boolean {
  if (f.html) return f.html.box.length > 0 || f.html.texts.length > 0;
  return Object.values(f.props).some((v) => v !== undefined) || Object.keys(f.styles).length > 0;
}

/** Применить к блоку в черновике данных. Возвращает false, если переносить нечего. */
export function applyFormat(d: Deck, path: Path, f: Format): boolean {
  const b = getAt(d, path) as Block | undefined;
  if (!b || typeof b !== 'object') return false;
  if (b.type === 'html' && f.html) {
    applyHtml(b, f.html);
    return true;
  }
  // В импортированную вёрстку — оформление главного текста всем её текстам
  if (b.type === 'html') {
    if (!f.text) return false;
    applyHtml(b, { box: [], texts: [f.text] }, false);
    return true;
  }
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
