/**
 * Цвета исходного файла по теме (deck.origin, импорт из PowerPoint). Слайды хранят цвета файла как
 * есть, при выводе каждый такой цвет пишется переменной с ним самим про запас: var(--k-3C388D, #3C388D).
 * Пока тема — «Как в файле», переменных нет и видны цвета файла. Другая тема задаёт их своими цветами:
 *   серые и почти серые — по оси «фон — текст» темы (её оттенок и светлые / тёмные места);
 *   цветные — в акцент темы того же семейства (первое по частоте → accent, второе → accent2, …).
 * Светлота считается от фона к тексту: светлое на тёмном остаётся светлым на тёмном в любой теме,
 * и в тёмном виде слайдов всё переворачивается вместе с фоном. Расчёт — в OKLab.
 */
import type { DeckOrigin, DeckTheme } from '../types';

type Lab = [number, number, number];

const HEX6 = /^#[0-9a-f]{6}$/i;

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function toLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function rgbOf([L, A, B]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (c: [number, number, number]) => c.every((v) => v >= -0.0005 && v <= 1.0005);

/** Цвет OKLab → #RRGGBB; вне sRGB — насыщенность снижается, светлота и оттенок остаются */
function toHex(lab: Lab): string {
  let [L, A, B] = lab;
  L = Math.max(0, Math.min(1, L));
  let c = rgbOf([L, A, B]);
  for (let k = 0; k < 24 && !inGamut(c); k++) {
    A *= 0.9; B *= 0.9;
    c = rgbOf([L, A, B]);
  }
  return '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, gam(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const chroma = (x: Lab) => Math.hypot(x[1], x[2]);
const hue = (x: Lab) => Math.atan2(x[2], x[1]);
const lerp = (a: Lab, b: Lab, t: number): Lab => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
const polar = (L: number, c: number, h: number): Lab => [L, c * Math.cos(h), c * Math.sin(h)];

/** Цветной ли оттенок (иначе — серый, по оси «фон — текст») */
const CHROMA = 0.035;
/** Оттенки одного семейства — в пределах 30° по кругу */
const FAMILY = Math.PI / 6;

/**
 * Семейства цветных оттенков по частоте: первые цвета каждого семейства (до четырёх).
 * Для импорта: какие цвета файла станут accent, accent2, …
 */
export function colorFamilies(counts: Map<string, number>, limit = 4): string[] {
  const reps: { hex: string; h: number }[] = [];
  for (const [hex] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (!HEX6.test(hex)) continue;
    const lab = toLab(hex);
    if (chroma(lab) < CHROMA) continue;
    const h = hue(lab);
    if (reps.some((r) => hueGap(r.h, h) < FAMILY)) continue;
    reps.push({ hex: hex.toUpperCase(), h });
    if (reps.length >= limit) break;
  }
  return reps.map((r) => r.hex);
}

/** Светлота цвета (OKLab L, 0…1) */
export const lightness = (hex: string) => toLab(hex)[0];

/** Цвета темы, в которые перекрашивается файл */
export interface RecolorTarget {
  bg: string;
  tx: string;
  /** Карточки — то, что в файле светлее фона (на светлых слайдах) */
  surf: string;
  /** Акценты темы: --ac, --ac2 */
  accents: string[];
}

/** Акценты темы для семейств файла: свои два, следующие — соседними оттенками первого */
function targetAccents(list: string[], need: number): Lab[] {
  const out = list.filter((c) => HEX6.test(c)).map(toLab);
  if (!out.length) out.push(toLab('#2563EB'));
  // Без второго цвета (или он тот же) — второй семейство берёт соседний оттенок
  if (out.length > 1 && toHex(out[1]) === toHex(out[0])) out.pop();
  const a = out[0];
  const turns = [0.8, -0.8, 1.6, -1.6];
  for (let k = 0; out.length < need; k++) out.push(polar(a[0], chroma(a), hue(a) + turns[k % turns.length]));
  return out;
}

/**
 * Переменные --k-RRGGBB для цветов файла в цветах темы. Пустой объект — перекрашивать нечего
 */
export function recolorVars(o: DeckOrigin, t: RecolorTarget): Record<string, string> {
  if (!HEX6.test(o.bg) || !HEX6.test(o.tx) || !Array.isArray(o.colors) || !o.colors.length) return {};
  const ob = toLab(o.bg), ot = toLab(o.tx);
  const tb = toLab(t.bg), tt = toLab(t.tx), ts = toLab(t.surf);
  // Ось «фон — текст» файла; у почти одинаковых фона и текста — условная
  const span = Math.abs(ot[0] - ob[0]) < 0.2 ? (ot[0] < ob[0] ? -0.6 : 0.6) : ot[0] - ob[0];
  const fams = (o.accents ?? []).filter((c) => HEX6.test(c)).map(toLab);
  const acc = targetAccents(t.accents, fams.length);
  // Насколько файл может быть светлее своего фона (белое на бежевом): до белого (или чёрного)
  const room = Math.max(0.02, Math.abs((span < 0 ? 1 : 0) - ob[0]));
  const out: Record<string, string> = {};
  for (const raw of o.colors) {
    if (!HEX6.test(raw)) continue;
    const hex = raw.toUpperCase();
    const c = toLab(hex);
    // Место на оси: 0 — фон, 1 — текст; меньше нуля — дальше фона от текста (карточки)
    const d = (c[0] - ob[0]) / span;
    let L: number;
    let axis: Lab;
    if (d >= 0) {
      L = tb[0] + (tt[0] - tb[0]) * d;
      axis = lerp(tb, tt, Math.min(1, d));
    } else {
      const f = Math.min(1, (-d * Math.abs(span)) / room);
      axis = lerp(tb, ts, f);
      L = axis[0];
    }
    let res: Lab;
    if (chroma(c) < CHROMA || !fams.length) {
      // Серый: оттенок оси темы (у «Зимы» — голубоватый), своя светлота
      res = [L, axis[1], axis[2]];
    } else {
      // Цветной: семейство файла по оттенку → акцент темы, насыщенность — между своей и акцентом
      let k = 0;
      fams.forEach((f, i) => { if (hueGap(hue(f), hue(c)) < hueGap(hue(fams[k]), hue(c))) k = i; });
      const a = acc[k] ?? acc[0];
      res = polar(L, Math.sqrt(chroma(c) * Math.max(chroma(a), 0.02)), hue(a));
    }
    out[`--k-${hex.slice(1)}`] = toHex(res);
  }
  return out;
}

/** Цвета темы, от которых зависит перекраска: совпадают с темой файла — перекрашивать не нужно */
const LOOK_KEYS = ['accent', 'accent2', 'mode', 'light', 'dark'] as const;
export function sameColors(a: DeckTheme | undefined, b: DeckTheme | undefined): boolean {
  const pick = (t: DeckTheme | undefined) => JSON.stringify(LOOK_KEYS.map((k) => t?.[k] ?? null));
  return pick(a) === pick(b);
}

/** Атрибуты разметки с цветами: стили и цвета SVG */
const ATTR_RE = /(\s(?:style|fill|stroke|stop-color|flood-color|color)=")([^"]*)"/g;
const HEX_IN = /#[0-9a-fA-F]{6}\b/g;

/**
 * Разметка слайда: цвета файла в атрибутах → var(--k-…, цвет). Текст слайда не трогается
 */
export function recolorHtml(html: string, colors: Set<string>): string {
  if (!colors.size) return html;
  return html.replace(ATTR_RE, (_m, head: string, v: string) => `${head}${v.replace(HEX_IN, (h) => {
    const up = h.toUpperCase();
    return colors.has(up) ? `var(--k-${up.slice(1)}, ${up})` : h;
  })}"`);
}
