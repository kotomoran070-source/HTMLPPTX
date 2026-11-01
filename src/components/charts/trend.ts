/**
 * Тренды и оси графиков без вёрстки: линейная регрессия (y = a + b·x, R²), скользящее среднее,
 * «круглые» деления оси для точечной диаграммы. Общие для line-chart, lines и scatter
 */

export interface Fit { a: number; b: number; r2: number }

/** Наименьшие квадраты: прямая через точки; меньше двух точек или все x одинаковые — null */
export function linearFit(xs: number[], ys: number[]): Fit | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  // Все y одинаковые — прямая проходит точно: R² = 1
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2 };
}

/** Скользящее среднее по n точкам (как в Excel): первые n − 1 точек без значения */
export function movingAverage(values: number[], n: number): (number | null)[] {
  const w = Math.max(2, Math.round(n));
  return values.map((_v, i) => {
    if (i < w - 1) return null;
    let s = 0;
    for (let j = i - w + 1; j <= i; j++) s += values[j];
    return s / w;
  });
}

/** Тренд графика из поля trend: linear — прямая, число 2–12 — скользящее среднее; иначе — без тренда */
export function trendKind(v: unknown): 'linear' | number | null {
  if (v === true || v === 'linear') return 'linear';
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 2 && n <= 12 ? n : null;
}

/** Ось от lo до hi с «круглыми» делениями (1, 2, 2,5 или 5 × 10ⁿ), около четырёх делений */
export function niceAxis(lo: number, hi: number, ticks = 4): { min: number; max: number; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 0.25 };
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  const raw = (hi - lo) / ticks;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  return { min, max: max > min ? max : min + step, step };
}

/** Число по-русски: «1 234,5», до двух значащих знаков после запятой у малых */
export function ruNum(v: number): string {
  const abs = Math.abs(v);
  // Минус — типографский, как в остальных подписях
  return v.toLocaleString('ru-RU', { maximumFractionDigits: abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3 }).replace(/^-/, '−');
}

/** Уравнение прямой для подписи: «y = 2,1x + 15» */
export function equation(f: Fit): string {
  const b = ruNum(f.b);
  const a = Math.abs(f.a) < 1e-9 ? '' : f.a < 0 ? ` − ${ruNum(-f.a)}` : ` + ${ruNum(f.a)}`;
  return `y = ${b}x${a}`;
}

/** Прямые отрезки через точки */
export function polyline(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
}

/**
 * Тренд и прогноз ряда: линия тренда (значения по номерам точек, у скользящего среднего — с пропусками)
 * и сколько шагов прогноза. Прогноз — всегда по линейному тренду
 */
export function trendOf(values: number[], trend: unknown, forecast: unknown): { line: (number | null)[]; ahead: number } {
  const ahead = Math.max(0, Math.min(24, Math.round(Number(forecast) || 0)));
  const kind = trendKind(trend) ?? (ahead ? 'linear' : null);
  if (!kind || values.length < 2) return { line: [], ahead: 0 };
  if (kind === 'linear') {
    const f = linearFit(values.map((_v, i) => i), values);
    return f ? { line: Array.from({ length: values.length + ahead }, (_x, i) => f.a + f.b * i), ahead } : { line: [], ahead: 0 };
  }
  return { line: movingAverage(values, kind), ahead: 0 };
}

/** Путь тренда по точкам с пропусками: только непрерывные куски */
export function trendPath(line: (number | null)[], X: (i: number) => number, Y: (v: number) => number): string {
  let d = '';
  let open = false;
  line.forEach((v, i) => {
    if (v === null) { open = false; return; }
    d += `${open ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
    open = true;
  });
  return d;
}
