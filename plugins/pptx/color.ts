/**
 * Цвета DrawingML: srgbClr, schemeClr (через тему и clrMap образца), sysClr, prstClr, scrgbClr, hslClr
 * и модификаторы — lumMod/lumOff (как «светлее/темнее» в палитре PowerPoint), tint/shade, satMod, alpha.
 */
import { type El, attr, kids, num } from './xml';

export interface Rgba { r: number; g: number; b: number; a: number }

export interface ColorCtx {
  /** Цвета темы: dk1, lt1, dk2, lt2, accent1…6, hlink, folHlink → RRGGBB */
  scheme: Record<string, string>;
  /** clrMap образца: bg1 → lt1, tx1 → dk1, … */
  map: Record<string, string>;
  /** Цвет-заполнитель стиля фигуры (fillRef/lnRef/fontRef) */
  ph?: Rgba | null;
}

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080',
  darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080', navy: '000080', silver: 'C0C0C0', maroon: '800000',
  teal: '008080', olive: '808000', lime: '00FF00', aqua: '00FFFF', cyan: '00FFFF', fuchsia: 'FF00FF', magenta: 'FF00FF',
};

const hexToRgba = (h: string, a = 1): Rgba => {
  const v = h.replace('#', '').padStart(6, '0').slice(0, 6);
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a };
};

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const toLin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLin = (v: number) => Math.round(255 * clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));

function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v, a }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255), a };
}

function modify(c: Rgba, mods: El[]): Rgba {
  let out = { ...c };
  for (const m of mods) {
    const v = (num(m, 'val') ?? 0) / 100000;
    switch (m.localName) {
      case 'lumMod': { const [h, s, l] = rgbToHsl(out); out = hslToRgb(h, s, clamp(l * v), out.a); break; }
      case 'lumOff': { const [h, s, l] = rgbToHsl(out); out = hslToRgb(h, s, clamp(l + v), out.a); break; }
      case 'satMod': { const [h, s, l] = rgbToHsl(out); out = hslToRgb(h, clamp(s * v), l, out.a); break; }
      case 'satOff': { const [h, s, l] = rgbToHsl(out); out = hslToRgb(h, clamp(s + v), l, out.a); break; }
      case 'hueOff': { const [h, s, l] = rgbToHsl(out); out = hslToRgb((h + (num(m, 'val') ?? 0) / 21600000 + 1) % 1, s, l, out.a); break; }
      case 'tint': out = { r: fromLin(toLin(out.r) * v + (1 - v)), g: fromLin(toLin(out.g) * v + (1 - v)), b: fromLin(toLin(out.b) * v + (1 - v)), a: out.a }; break;
      case 'shade': out = { r: fromLin(toLin(out.r) * v), g: fromLin(toLin(out.g) * v), b: fromLin(toLin(out.b) * v), a: out.a }; break;
      case 'alpha': out.a = clamp(v); break;
      case 'alphaMod': out.a = clamp(out.a * v); break;
      case 'alphaOff': out.a = clamp(out.a + v); break;
      case 'inv': out = { r: 255 - out.r, g: 255 - out.g, b: 255 - out.b, a: out.a }; break;
      case 'gray': { const y = Math.round(0.299 * out.r + 0.587 * out.g + 0.114 * out.b); out = { r: y, g: y, b: y, a: out.a }; break; }
      case 'comp': { const [h, s, l] = rgbToHsl(out); out = hslToRgb((h + 0.5) % 1, s, l, out.a); break; }
      default: break;
    }
  }
  return out;
}

/** Цвет из элемента-цвета (srgbClr, schemeClr, …) */
export function colorOf(el: El | null, ctx: ColorCtx): Rgba | null {
  if (!el) return null;
  let base: Rgba | null = null;
  switch (el.localName) {
    case 'srgbClr': base = hexToRgba(attr(el, 'val') ?? '000000'); break;
    case 'sysClr': base = hexToRgba(attr(el, 'lastClr') ?? (attr(el, 'val') === 'window' ? 'FFFFFF' : '000000')); break;
    case 'prstClr': base = hexToRgba(PRESET[attr(el, 'val') ?? ''] ?? '000000'); break;
    case 'scrgbClr': base = { r: fromLin((num(el, 'r') ?? 0) / 100000), g: fromLin((num(el, 'g') ?? 0) / 100000), b: fromLin((num(el, 'b') ?? 0) / 100000), a: 1 }; break;
    case 'hslClr': base = hslToRgb((num(el, 'hue') ?? 0) / 21600000, (num(el, 'sat') ?? 0) / 100000, (num(el, 'lum') ?? 0) / 100000, 1); break;
    case 'schemeClr': {
      const v = attr(el, 'val') ?? '';
      if (v === 'phClr') { base = ctx.ph ? { ...ctx.ph } : null; break; }
      const name = ctx.map[v] ?? v;
      const hex = ctx.scheme[name];
      base = hex ? hexToRgba(hex) : null;
      break;
    }
    default: return null;
  }
  return base ? modify(base, kids(el)) : null;
}

/** Цвет из контейнера (solidFill, fontRef, …): первый дочерний цвет */
export function colorIn(container: El | null, ctx: ColorCtx): Rgba | null {
  if (!container) return null;
  for (const k of kids(container)) {
    const c = colorOf(k, ctx);
    if (c) return c;
  }
  return null;
}

const h2 = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
export const hex = (c: Rgba) => `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;
export const css = (c: Rgba) => (c.a >= 0.999 ? hex(c) : `rgba(${c.r},${c.g},${c.b},${Math.round(c.a * 1000) / 1000})`);
/** Светлый ли цвет (для подписи поверх заливки) */
export const isLight = (c: Rgba) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 150;
