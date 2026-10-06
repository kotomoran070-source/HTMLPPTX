/**
 * Цветокоррекция картинки (панель «Цвет»): параметры, как в DaVinci Resolve. Результат запекается
 * в новый файл; исходный путь и параметры — в поле grade у картинки, по ним правят заново.
 * Все величины — от −100 до 100 (0 — без изменений), если не сказано иначе.
 */
export type Wheel = [x: number, y: number, master: number];
export type CurvePoint = [x: number, y: number];
export const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type Band = typeof BANDS[number];

export interface Grade {
  /** Исходная картинка (путь, как в src до цветокоррекции) */
  src?: string;
  /** Баланс белого: теплее / холоднее, пурпурнее / зеленее */
  temp?: number;
  tint?: number;
  /** Экспозиция в ступенях (−3…3) */
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  saturation?: number;
  vibrance?: number;
  /** Цветовые круги: смещение цвета (x, y в круге −1…1) и яркость (−1…1) для теней, полутонов и светов */
  lift?: Wheel;
  gamma?: Wheel;
  gain?: Wheel;
  /** HSL по цветам: сдвиг оттенка, насыщенность, яркость (−1…1) */
  hsl?: Partial<Record<Band, [number, number, number]>>;
  /** Кривые: точки (0…1) — общая и по каналам */
  curves?: Partial<Record<'all' | 'r' | 'g' | 'b', CurvePoint[]>>;
  /** 3D LUT (.cube) в assets/ и его сила (0…1) */
  lut?: string;
  lutName?: string;
  lutMix?: number;
  /** Карта градиента: тени, полутона, света (#RRGGBB) и сила (0…1) — «В цвета бренда» */
  duo?: [string, string, string];
  duoMix?: number;
  vignette?: number;
  grain?: number;
}

/** Поля, у которых «без изменений» — ноль */
const ZERO = ['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'vignette', 'grain'] as const;

const near0 = (v: unknown) => !Number.isFinite(Number(v)) || Math.abs(Number(v)) < 1e-4;
const flatCurve = (c?: CurvePoint[]) => !c || c.length < 2 || c.every(([x, y]) => Math.abs(x - y) < 1e-3);

/** Ничего не меняется: картинка остаётся исходной */
export function isNeutral(g: Grade): boolean {
  if (!ZERO.every((k) => near0(g[k]))) return false;
  if ([g.lift, g.gamma, g.gain].some((w) => w && w.some((v) => !near0(v)))) return false;
  if (g.hsl && Object.values(g.hsl).some((b) => b && b.some((v) => !near0(v)))) return false;
  if (g.curves && Object.values(g.curves).some((c) => !flatCurve(c))) return false;
  if (g.lut && !near0(g.lutMix ?? 1)) return false;
  if (g.duo && !near0(g.duoMix ?? 0)) return false;
  return true;
}

/** Параметры без пустых значений — для данных и сравнения */
export function compact(g: Grade): Grade {
  const out: Grade = {};
  if (g.src) out.src = g.src;
  for (const k of ZERO) if (!near0(g[k])) out[k] = Math.round(Number(g[k]) * 100) / 100;
  for (const k of ['lift', 'gamma', 'gain'] as const) {
    const w = g[k];
    if (w && w.some((v) => !near0(v))) out[k] = w.map((v) => Math.round(v * 1000) / 1000) as Wheel;
  }
  if (g.hsl) {
    const h = Object.fromEntries(Object.entries(g.hsl).filter(([, b]) => b && b.some((v) => !near0(v))));
    if (Object.keys(h).length) out.hsl = h;
  }
  if (g.curves) {
    const c = Object.fromEntries(Object.entries(g.curves).filter(([, p]) => !flatCurve(p)).map(([k, p]) => [k, p!.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])]));
    if (Object.keys(c).length) out.curves = c;
  }
  if (g.lut) {
    out.lut = g.lut;
    if (g.lutName) out.lutName = g.lutName;
    if (g.lutMix !== undefined && Math.abs(g.lutMix - 1) > 1e-3) out.lutMix = Math.round(g.lutMix * 100) / 100;
  }
  if (g.duo && !near0(g.duoMix ?? 0)) {
    out.duo = g.duo;
    out.duoMix = Math.round((g.duoMix ?? 0) * 100) / 100;
  }
  return out;
}

/** Готовые образы: показываются плитками на самой картинке */
export interface Look {
  id: string;
  name: string;
  grade: Grade;
  /** Нужны цвета бренда (акцент презентации) */
  brand?: boolean;
}

export const LOOKS: Look[] = [
  { id: 'none', name: 'Как есть', grade: {} },
  { id: 'warm', name: 'Тёплый вечер', grade: { temp: 28, tint: 6, contrast: 12, highlights: -18, gain: [0.18, 0.3, 0], saturation: 6 } },
  { id: 'cool', name: 'Холодное утро', grade: { temp: -26, exposure: 0.12, contrast: 6, saturation: -10, lift: [-0.2, -0.25, 0.05] } },
  { id: 'teal', name: 'Кино', grade: { contrast: 22, saturation: 12, lift: [-0.45, -0.35, -0.04], gain: [0.32, 0.28, 0.02], highlights: -12, vignette: 18 } },
  { id: 'fade', name: 'Выцветшая плёнка', grade: { contrast: -14, saturation: -22, lift: [0.08, 0.1, 0.22], curves: { all: [[0, 0.07], [0.5, 0.52], [1, 0.95]] }, grain: 26, temp: 6 } },
  { id: 'mono', name: 'Ч/Б контраст', grade: { saturation: -100, contrast: 30, highlights: 10, shadows: -12, vignette: 22 } },
  { id: 'punch', name: 'Сочный', grade: { vibrance: 50, contrast: 14, saturation: 8, highlights: -10, shadows: 10 } },
  { id: 'noir', name: 'Нуар', grade: { saturation: -100, contrast: 48, exposure: -0.25, vignette: 46, grain: 22 } },
  { id: 'pastel', name: 'Пастель', grade: { exposure: 0.3, contrast: -26, saturation: -18, lift: [0.15, -0.2, 0.18], highlights: -20 } },
  { id: 'night', name: 'Ночь', grade: { temp: -38, exposure: -0.55, contrast: 12, saturation: -35, gain: [-0.3, -0.3, -0.05] } },
  { id: 'brand', name: 'В цвета бренда', grade: { duoMix: 1, contrast: 8 }, brand: true },
  { id: 'brand-tint', name: 'Оттенок бренда', grade: { duoMix: 0.42 }, brand: true },
];

/** Цвета бренда для карты градиента: тень — глубокий акцент, середина — акцент, свет — светлый второй цвет */
export function brandStops(accent: string, accent2?: string | null): [string, string, string] {
  return [mixHex(accent, '#000000', 0.72), accent.toUpperCase(), mixHex(accent2 || accent, '#FFFFFF', 0.62)];
}

function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Кривая по точкам → 256 значений (монотонный кубический сплайн: без «перехлёстов» между точками) */
export function curveTable(points: CurvePoint[] | undefined): Float32Array {
  const out = new Float32Array(256);
  const pts = (points && points.length >= 2 ? [...points] : [[0, 0], [1, 1]] as CurvePoint[]).sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  // Наклоны Фрича — Карлсона
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-9) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    if (x <= xs[0]) { out[k] = ys[0]; continue; }
    if (x >= xs[n - 1]) { out[k] = ys[n - 1]; continue; }
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    out[k] = Math.max(0, Math.min(1, (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]));
  }
  return out;
}
