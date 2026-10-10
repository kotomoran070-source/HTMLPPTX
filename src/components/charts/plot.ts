/**
 * График функции: y = f(x) по формуле, оси с делениями, кривая прорисовывается при открытии
 * слайда. В формуле — ползунки слайда по имени: двигаете ползунок — кривая меняется сразу.
 * Делается из формулы кнопкой «График» в правке формулы (или блоком из «Графиков»).
 */
import { defineBlock } from '../../engine/component';
import { evalFormula, type Vars } from '../../engine/formula';
import { esc, styleAttr } from '../../engine/html';
import type { Block } from '../../types';
import { shapeColor } from '../shape/shape';
import './plot.css';

export interface PlotProps extends Block {
  /** Формула через x (sin(x), a*x^2 + b) — как в ползунках: * ^ sqrt ln pi… */
  fn?: string;
  /** Переменная по горизонтали, по умолчанию x */
  var?: string;
  /** Диапазон по x: [от, до] */
  x?: number[];
  /** Диапазон по y; без него — по самой кривой */
  y?: number[];
  color?: string;
}

const W = 640;
const H = 400;
const PAD = { l: 46, r: 18, t: 16, b: 32 };
const N = 480;

/** Значения функции на отрезке; разрывы (tan, 1/x) — null */
export function sample(fn: string, v: string, vars: Vars, [a, b]: number[], n = N): { x: number; y: number | null }[] {
  const out: { x: number; y: number | null }[] = [];
  for (let k = 0; k <= n; k++) {
    const x = a + ((b - a) * k) / n;
    const y = evalFormula(fn, { ...vars, [v]: x });
    out.push({ x, y: y !== null && Number.isFinite(y) && Math.abs(y) < 1e9 ? y : null });
  }
  return out;
}

/** Диапазон по y: по кривой без выбросов (около разрывов tan, 1/x), с запасом */
export function yRange(ys: number[]): [number, number] | null {
  const s = ys.filter((y) => Number.isFinite(y)).sort((p, q) => p - q);
  if (!s.length) return null;
  const q = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))];
  let lo = s[0];
  let hi = s[s.length - 1];
  // Выбросы: края в разы дальше, чем основная часть — по 3-му и 97-му процентилю
  const mid = q(0.97) - q(0.03);
  if (mid > 0 && hi - lo > mid * 4) { lo = q(0.03); hi = q(0.97); }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/** Деления: 1, 2 или 5 × 10ⁿ, около шести на ось */
function ticks(a: number, b: number, want = 6): number[] {
  const raw = (b - a) / want;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return out;
}

/** Деления по π, если отрезок — в долях π (тригонометрия): −2π, −π, 0, π, 2π */
function piTicks(a: number, b: number): { v: number; label: string }[] | null {
  const k = (x: number) => x / (Math.PI / 2);
  if (Math.abs(k(a) - Math.round(k(a))) > 1e-3 || Math.abs(k(b) - Math.round(k(b))) > 1e-3) return null;
  const half = Math.round(k(b) - k(a)) <= 8;
  const step = half ? Math.PI / 2 : Math.PI;
  const out: { v: number; label: string }[] = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) {
    const n = Math.round(v / (Math.PI / 2));
    const label = n === 0 ? '0' : n % 2 === 0 ? `${n / 2 === 1 ? '' : n / 2 === -1 ? '−' : String(n / 2).replace('-', '−')}π` : `${n < 0 ? '−' : ''}${Math.abs(n) === 1 ? '' : Math.abs(n)}π/2`;
    out.push({ v, label });
  }
  return out;
}

const num = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 }).replace('-', '−');

defineBlock<PlotProps>('plot', {
  render(p, ctx) {
    const fn = String(p.fn ?? '').trim();
    const v = typeof p.var === 'string' && /^[a-z]$/.test(p.var) ? p.var : 'x';
    const xr = Array.isArray(p.x) && p.x.length === 2 && p.x.every((n) => Number.isFinite(Number(n))) && Number(p.x[0]) < Number(p.x[1]) ? p.x.map(Number) : [-5, 5];
    const pts = fn ? sample(fn, v, ctx.vars ?? {}, xr) : [];
    const given = Array.isArray(p.y) && p.y.length === 2 && Number(p.y[0]) < Number(p.y[1]) ? p.y.map(Number) as [number, number] : null;
    const yr = given ?? yRange(pts.map((q) => q.y).filter((y): y is number => y !== null));
    const color = shapeColor(p.color);
    const css = styleAttr(color ? `--plot:${color}` : '', p.style);
    if (!yr) return `<div class="plot plot-empty"${css}>${fn ? `Не получается построить: ${esc(fn)}` : 'Формула графика — поле «Функция»'}</div>`;

    const [x0, x1] = xr;
    const [y0, y1] = yr;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const X = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * iw;
    const Y = (y: number) => PAD.t + ((y1 - y) / (y1 - y0)) * ih;
    const f = (n: number) => n.toFixed(1);

    // Кривая кусками: разрыв — где нет значения или скачок через весь экран
    const segs: string[] = [];
    let d = '';
    let prev: number | null = null;
    for (const q of pts) {
      const out = q.y === null || q.y < y0 - (y1 - y0) * 4 || q.y > y1 + (y1 - y0) * 4;
      const jump = q.y !== null && prev !== null && Math.abs(q.y - prev) > (y1 - y0) * 1.5;
      if (out || jump) {
        if (d) segs.push(d);
        d = out ? '' : `M${f(X(q.x))} ${f(Y(q.y!))}`;
        prev = out ? null : q.y;
        continue;
      }
      d += `${d ? 'L' : 'M'}${f(X(q.x))} ${f(Y(q.y!))}`;
      prev = q.y;
    }
    if (d) segs.push(d);

    const xt = piTicks(x0, x1) ?? ticks(x0, x1).map((t) => ({ v: t, label: num(t) }));
    const yt = ticks(y0, y1, 5);
    const grid = xt.map((t) => `<line class="pg" x1="${f(X(t.v))}" y1="${PAD.t}" x2="${f(X(t.v))}" y2="${PAD.t + ih}"/>`).join('')
      + yt.map((t) => `<line class="pg" x1="${PAD.l}" y1="${f(Y(t))}" x2="${PAD.l + iw}" y2="${f(Y(t))}"/>`).join('');
    // Оси — там, где ноль; ноль за краем — ось по краю
    const ax = Math.min(PAD.t + ih, Math.max(PAD.t, Y(0)));
    const ay = Math.min(PAD.l + iw, Math.max(PAD.l, X(0)));
    const axes = `<line class="pa" x1="${PAD.l}" y1="${f(ax)}" x2="${PAD.l + iw}" y2="${f(ax)}"/><line class="pa" x1="${f(ay)}" y1="${PAD.t}" x2="${f(ay)}" y2="${PAD.t + ih}"/>`;
    const labels = xt.filter((t) => Math.abs(t.v) > 1e-9 || (y0 > 0 || y1 < 0)).map((t) => `<text class="pt" x="${f(X(t.v))}" y="${PAD.t + ih + 20}" text-anchor="middle">${esc(t.label)}</text>`).join('')
      + yt.filter((t) => Math.abs(t) > 1e-9 || (x0 > 0 || x1 < 0)).map((t) => `<text class="pt" x="${PAD.l - 8}" y="${f(Y(t) + 4)}" text-anchor="end">${num(t)}</text>`).join('');
    const names = `<text class="pn" x="${PAD.l + iw - 2}" y="${f(ax - 8)}" text-anchor="end">${esc(v)}</text><text class="pn" x="${f(ay + 8)}" y="${PAD.t + 14}">y</text>`;
    const curve = segs.map((s) => `<path class="pc" d="${s}" pathLength="1"/>`).join('');
    const clip = ctx.uid('pclip');
    return `<div class="plot"${css}><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`График y = ${fn}`)}">`
      + `<defs><clipPath id="${clip}"><rect x="${PAD.l}" y="${PAD.t}" width="${iw}" height="${ih}"/></clipPath></defs>`
      + grid + axes + labels + names
      + `<g clip-path="url(#${clip})">${curve}</g></svg></div>`;
  },
});
