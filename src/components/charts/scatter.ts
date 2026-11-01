/**
 * Точечная диаграмма: измерения (x; y) одним или несколькими рядами, у точки может быть размер — тогда
 * это пузырьки. Оси с «круглыми» делениями и подписями, линия тренда с уравнением и R². Под мышью —
 * точка крупнее и подсказка со значениями. Точки появляются по очереди, тренд — после них
 */
import { defineBlock } from '../../engine/component';
import { esc, styleAttr } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { legend, seriesColor } from './diagrams';
import { axisBounds, equation, linearFit, niceAxis, ruNum, trendKind } from './trend';

/** Точка: [x, y], [x, y, размер] или { x, y, size, label } */
type RawPoint = unknown;
interface ScatterSeries { name?: string; points?: RawPoint[] }
interface ScatterProps extends Block {
  /** Ряды точек; один ряд можно задать сразу полем points */
  series?: ScatterSeries[];
  points?: RawPoint[];
  /** Подписи осей: «Температура, °C», «Потребление, кВт» */
  xLabel?: string;
  yLabel?: string;
  /** Границы осей (по умолчанию — по данным, круглыми числами) */
  xMin?: number; xMax?: number; yMin?: number; yMax?: number;
  /** Линия тренда каждого ряда: linear (или true) — прямая с уравнением и R² */
  trend?: boolean | string;
  /** false — без уравнения и R² у тренда */
  equation?: boolean;
}

export interface Pt { x: number; y: number; size?: number; label?: string }

/** Точки ряда из любого вида записи; без чисел — пропускаются */
export function pointsOf(raw: unknown): Pt[] {
  return (Array.isArray(raw) ? raw : []).map((p): Pt | null => {
    if (Array.isArray(p)) {
      const [x, y, size] = p.map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y, ...(Number.isFinite(size) && size > 0 ? { size } : {}) } : null;
    }
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      const x = Number(o.x);
      const y = Number(o.y);
      const size = Number(o.size);
      return Number.isFinite(x) && Number.isFinite(y)
        ? { x, y, ...(Number.isFinite(size) && size > 0 ? { size } : {}), ...(o.label ? { label: String(o.label) } : {}) } : null;
    }
    return null;
  }).filter((p): p is Pt => !!p);
}


defineBlock<ScatterProps>('scatter', {
  render(p, ctx) {
    const own = Array.isArray(p.series) && p.series.length;
    const series = (own ? p.series! : [{ name: '', points: p.points }])
      .map((s, k) => ({ name: String(s?.name ?? `Ряд ${k + 1}`), pts: pointsOf(s?.points) }));
    const all = series.flatMap((s) => s.pts);
    if (all.length < 1) return `<div class="block-error">scatter: нужны точки — points: [[x, y], …]</div>`;
    // Запас 4 % по краям: точка у границы не садится на подпись деления
    const span = (vs: number[]) => { const lo = Math.min(...vs); const hi = Math.max(...vs); const d = (hi - lo) * 0.04; return [lo - d, hi + d] as const; };
    const ax = niceAxis(...span(all.map((q) => q.x)), 5);
    const ay = niceAxis(...span(all.map((q) => q.y)), 5);
    // Свои границы — только верные («от» меньше «до»); точки за ними не рисуются, их число подписано
    const [xMin, xMax] = axisBounds(p.xMin, p.xMax, ax.min, ax.max);
    const [yMin, yMax] = axisBounds(p.yMin, p.yMax, ay.min, ay.max);
    const within = (q: Pt) => q.x >= xMin && q.x <= xMax && q.y >= yMin && q.y <= yMax;
    const hidden = all.filter((q) => !within(q)).length;
    const x0 = 52, x1 = 548, top = 22, bottom = 214;
    const X = (v: number) => x0 + ((v - xMin) / (xMax - xMin || 1)) * (x1 - x0);
    const Y = (v: number) => bottom - ((v - yMin) / (yMax - yMin || 1)) * (bottom - top);
    const f = (v: number) => v.toFixed(1);
    // Сетка по делениям обеих осей
    let grid = '';
    // Деления — те же, что дали границы; свои границы — свои деления
    const xs = xMin === ax.min && xMax === ax.max ? ax : niceAxis(xMin, xMax, 5);
    const ys = yMin === ay.min && yMax === ay.max ? ay : niceAxis(yMin, yMax, 5);
    for (let v = xs.min; v <= xMax + xs.step * 1e-6; v += xs.step) {
      if (v < xMin - xs.step * 1e-6) continue;
      grid += `<line class="gl${Math.abs(v - xMin) < 1e-9 ? ' base' : ''}" x1="${f(X(v))}" x2="${f(X(v))}" y1="${top}" y2="${bottom}"/>`
        + `<text class="tx" x="${f(X(v))}" y="${bottom + 16}" text-anchor="middle">${ruNum(Number(v.toFixed(10)))}</text>`;
    }
    for (let v = ys.min; v <= yMax + ys.step * 1e-6; v += ys.step) {
      if (v < yMin - ys.step * 1e-6) continue;
      grid += `<line class="gl${Math.abs(v - yMin) < 1e-9 ? ' base' : ''}" x1="${x0}" x2="${x1}" y1="${f(Y(v))}" y2="${f(Y(v))}"/>`
        + `<text class="tx" x="${x0 - 8}" y="${f(Y(v) + 3.5)}" text-anchor="end">${ruNum(Number(v.toFixed(10)))}</text>`;
    }
    const axes = `<text class="tx sc-ax" x="${x0 - 8}" y="${top - 10}"${ea(p, 'yLabel')}>${esc(p.yLabel ?? '')}</text>`
      + `<text class="tx sc-ax" x="${x1}" y="${bottom + 34}" text-anchor="end"${ea(p, 'xLabel')}>${esc(p.xLabel ?? '')}</text>`;
    const n = series.length;
    const sizes = all.map((q) => q.size ?? 0);
    const big = Math.max(...sizes);
    // Пузырьки: площадь — по размеру (радиус 5–18), без размера — обычная точка
    const R = (q: Pt) => (q.size && big > 0 ? 5 + 13 * Math.sqrt(q.size / big) : 5.5);
    let dots = '';
    let k = 0;
    series.forEach((s, j) => {
      const c = seriesColor(j, n);
      for (const q of s.pts) {
        if (!within(q)) continue;
        // Подсказка — с подписями осей: «Температура, °C: 12 · Потребление, кВт: 268»
        const xl = p.xLabel ? `${p.xLabel}: ` : 'x = ';
        const yl = p.yLabel ? `${p.yLabel}: ` : 'y = ';
        const tip = `${s.name && own ? `${s.name} · ` : ''}${q.label ? `${q.label} · ` : ''}${xl}${ruNum(q.x)} · ${yl}${ruNum(q.y)}${q.size ? ` · размер ${ruNum(q.size)}` : ''}`;
        dots += `<circle class="sc-p" cx="${f(X(q.x))}" cy="${f(Y(q.y))}" r="${f(R(q))}" style="fill:${c};--k:${k++}" data-tip="${esc(tip)}"/>`;
      }
    });
    // Тренд: прямая по точкам ряда на его отрезке x, уравнение и R² — у правого конца
    let trend = '';
    let eqs = '';
    if (trendKind(p.trend) === 'linear') {
      // Уравнения — стопкой в свободном углу: при росте точки идут к правому верхнему — слева, при спаде — справа
      const first = linearFit(all.map((q) => q.x), all.map((q) => q.y));
      const right = !first || first.b < 0;
      series.forEach((s, j) => {
        const fit = linearFit(s.pts.map((q) => q.x), s.pts.map((q) => q.y));
        if (!fit) return;
        const a = Math.max(xMin, Math.min(...s.pts.map((q) => q.x)));
        const b = Math.min(xMax, Math.max(...s.pts.map((q) => q.x)));
        const c = seriesColor(j, n);
        const ya = fit.a + fit.b * a;
        const yb = fit.a + fit.b * b;
        if (b <= a) return;
        const what = `${n > 1 ? `${s.name}: ` : ''}${equation(fit)} · R² = ${ruNum(Math.round(fit.r2 * 100) / 100)}`;
        trend += `<line class="sc-tr" x1="${f(X(a))}" y1="${f(Y(ya))}" x2="${f(X(b))}" y2="${f(Y(yb))}" style="stroke:${c}" data-tip="${esc(`Тренд — ${what}`)}"/>`;
        if (p.equation !== false) {
          const name = n > 1 ? `${s.name}: ` : '';
          eqs += `<text class="sc-eq" x="${right ? x1 - 6 : x0 + 8}" y="${top + 12 + j * 16}" text-anchor="${right ? 'end' : 'start'}" style="fill:${c}">${esc(name + equation(fit))} · R² = ${ruNum(Math.round(fit.r2 * 100) / 100)}</text>`;
        }
      });
    }
    const id = ctx.uid('sc');
    const out = hidden ? `<text class="tx sc-out" x="${x0}" y="${bottom + 34}">${hidden} ${hidden % 10 === 1 && hidden % 100 !== 11 ? 'точка' : [2, 3, 4].includes(hidden % 10) && ![12, 13, 14].includes(hidden % 100) ? 'точки' : 'точек'} вне осей</text>` : '';
    return `<div class="dg sc"${styleAttr(p.style)}>${own ? legend(p, series) : ''}`
      + `<svg class="scatter" viewBox="0 0 560 254" role="img" aria-label="Точечная диаграмма${p.xLabel ? `: ${esc(p.xLabel)}` : ''}${p.yLabel ? ` и ${esc(p.yLabel)}` : ''}">`
      + `<defs><clipPath id="${id}"><rect x="${x0 - 20}" y="${top - 20}" width="${x1 - x0 + 40}" height="${bottom - top + 40}"/></clipPath><clipPath id="${id}t"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bottom - top}"/></clipPath></defs>`
      + `${grid}${axes}${out}<g clip-path="url(#${id}t)">${trend}</g><g clip-path="url(#${id})">${dots}</g>${eqs}</svg></div>`;
  },
});
