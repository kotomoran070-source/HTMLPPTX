/**
 * Оформление части текста в разметке: {цвет s:размер f:шрифт|текст}, любая часть необязательна, порядок такой.
 * Цвет — #RRGGBB, цвет темы (accent, accent2, text, text2, muted) или градиент (g:ocean, g:#F97316,#EC4899);
 * размер — в % от размера текста поля (как в PowerPoint: часть крупнее или мельче остального);
 * шрифт — последним (в имени бывают пробелы): общий (sans, serif…) или по имени.
 * {#2563EB|…}, {s:80|…}, {#2563EB s:80|…}, {g:ocean|…} — частные случаи.
 *
 * Только в правке (span.md-c внутри другого): -c — «цвет всего текста» внутри цветного куска, -f — то же для шрифта.
 */
import { fontNameOk, fontStack } from './fonts';
import { textGradientCss } from './gradients';
import { FONTS, THEME_COLORS } from './text-style';

export interface SpanAttrs {
  paint?: string;
  /** Размер, % от окружающего текста */
  size?: number;
  font?: string;
  /** Цвет — как у всего текста, хоть кусок и внутри цветного (только в правке) */
  noPaint?: true;
  noFont?: true;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|accent2?|text2?|muted)$/i;

/** Цвет или градиент текста */
export const isPaint = (c: string): boolean => COLOR_RE.test(c) || (/^g:/i.test(c) && !!textGradientCss(c));

const fontOk = (n: string) => !!FONTS[n] || fontNameOk(n);

/** Разбор: не оформление (другое слово, {mark|…}) — null. internal — допустимы -c и -f */
export function parseSpanAttrs(a: string, internal = false): SpanAttrs | null {
  const src = a.replace(/\u00a0/g, ' ').trim();
  const at = src.search(/(?:^|\s)f:/);
  const head = (at < 0 ? src : src.slice(0, at)).trim();
  const o: SpanAttrs = {};
  if (at >= 0) {
    const name = src.slice(at).trim().slice(2).trim();
    if (!name || !fontOk(name)) return null;
    o.font = name;
  }
  for (const tk of head ? head.split(/\s+/) : []) {
    // В правке размер дробный: округляется только в готовой разметке (кусок в куске — без накопленной ошибки)
    const m = (internal ? /^s:(\d{2,3}(?:\.\d{1,2})?)$/ : /^s:(\d{2,3})$/).exec(tk);
    if (m && o.size === undefined) o.size = Math.max(20, Math.min(400, Number(m[1])));
    else if (internal && tk === '-c' && !o.noPaint) o.noPaint = true;
    else if (internal && tk === '-f' && !o.noFont) o.noFont = true;
    else if (!o.paint && isPaint(tk)) o.paint = tk;
    else return null;
  }
  return o.paint || o.size !== undefined || o.font || o.noPaint || o.noFont ? o : null;
}

/** Обратно в строку; пусто — оформления нет. internal — с -c и -f (иначе они отбрасываются) */
export function formatSpanAttrs(o: SpanAttrs, internal = false): string {
  const n = o.size === undefined ? 100 : Math.max(20, Math.min(400, internal ? Math.round(o.size * 100) / 100 : Math.round(o.size)));
  const size = n !== 100 ? `s:${n}` : '';
  return [
    o.paint ?? (internal && o.noPaint ? '-c' : ''),
    size,
    internal && o.noFont && !o.font ? '-f' : '',
    o.font ? `f:${o.font}` : '',
  ].filter(Boolean).join(' ');
}

/**
 * Кусок внутри куска: внутренний цвет и шрифт главнее, размеры перемножаются (em внутри em).
 * -c и -f внутреннего снимают цвет и шрифт внешнего
 */
export function mergeSpanAttrs(outer: SpanAttrs, inner: SpanAttrs): SpanAttrs {
  const o: SpanAttrs = {};
  const paint = inner.paint ?? (inner.noPaint ? undefined : outer.paint);
  if (paint) o.paint = paint;
  else if (inner.noPaint || outer.noPaint) o.noPaint = true;
  if (outer.size !== undefined || inner.size !== undefined) o.size = ((outer.size ?? 100) * (inner.size ?? 100)) / 100;
  const font = inner.font ?? (inner.noFont ? undefined : outer.font);
  if (font) o.font = font;
  else if (inner.noFont || outer.noFont) o.noFont = true;
  return o;
}

/** CSS куска: цвет или градиент, размер в em, шрифт */
export function spanCss(o: SpanAttrs): string {
  const out: string[] = [];
  if (o.paint) out.push(textGradientCss(o.paint) ?? `color:${THEME_COLORS[o.paint.toLowerCase()]?.css ?? o.paint}`);
  if (o.size !== undefined && Math.round(o.size) !== 100) out.push(`font-size:${+(o.size / 100).toFixed(4)}em`);
  if (o.font) out.push(`font-family:${FONTS[o.font]?.css ?? fontStack(o.font)}`);
  return out.join(';');
}

/** Токен разметки целиком: {оформление|текст}; группы — оформление и текст */
export const SPAN_TOKEN = /\{([^{}|\n]+)\|([^{}]*)\}/g;
