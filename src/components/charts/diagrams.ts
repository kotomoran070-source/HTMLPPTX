/**
 * Диаграммы в цветах темы: пончик и круговая (donut), рейтинг (hbars), спидометр (gauge),
 * кольца целей (rings), столбцы по группам (columns), несколько линий (lines).
 * Данные — как у bars: values + labels; у рядов — series: [{ name, values }].
 * Цвета рядов — от акцента ко второму цвету темы, каждый следующий светлее. Подписи — цветом
 * текста, не цветом ряда. Анимация — при открытии слайда; до этого диаграмма в конечном виде.
 */
import { defineBlock } from '../../engine/component';
import { asArray, esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import './diagrams.css';

/** Цвет k-го ряда из n: от акцента ко второму цвету темы, каждый следующий светлее */
export function seriesColor(k: number, n: number): string {
  if (n <= 1 || k === 0) return 'var(--ac)';
  const f = k / (n - 1);
  return `color-mix(in oklab, color-mix(in oklab, var(--ac2) ${Math.round(f * 100)}%, var(--ac)) ${100 - Math.round(f * 48)}%, var(--surf))`;
}

const nums = (v: unknown) => asArray(v as unknown[]).map(Number).map((x) => (Number.isFinite(x) ? x : 0));
const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '')) : []);

/** 1234.5 → «1 234,5»: до одного знака после запятой, если число небольшое */
export function fmtNum(v: number): string {
  return v.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(v) < 100 ? 1 : 0 });
}

/** Круглая граница оси: 1, 2, 2,5 или 5 × 10ⁿ на деление, четыре деления */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  return step * 4;
}

interface Series { name?: string; values?: unknown[] }
function seriesOf(p: { series?: unknown }): { name: string; values: number[] }[] {
  return (Array.isArray(p.series) ? p.series as Series[] : [])
    .filter((s) => s && typeof s === 'object')
    .map((s, k) => ({ name: String(s.name ?? `Ряд ${k + 1}`), values: nums(s.values) }));
}

/** Легенда рядов над диаграммой (для двух рядов и больше) */
function legend(p: Block, series: { name: string }[]): string {
  if (series.length < 2) return '';
  return `<div class="dg-leg">${series.map((s, k) =>
    `<span><i style="background:${seriesColor(k, series.length)}"></i><span${ea((p.series as unknown[])[k], 'name')}>${esc(s.name)}</span></span>`).join('')}</div>`;
}

// ---------------- пончик и круговая ----------------

interface DonutProps extends Block {
  values: number[];
  labels?: string[];
  /** Крупная надпись в центре (по умолчанию — сумма) и подпись под ней */
  center?: string;
  sub?: string;
  /** Размер отверстия: 0 — круговая, 0,62 — по умолчанию */
  hole?: number;
  /** Единица у значений в легенде: « млн», « %» */
  unit?: string;
  /** Легенда: справа (по умолчанию), снизу или без неё */
  legend?: 'right' | 'bottom' | 'none';
}

defineBlock<DonutProps>('donut', {
  render(p) {
    const vals = nums(p.values).map((v) => Math.max(0, v));
    const sum = vals.reduce((a, b) => a + b, 0);
    if (!sum) return `<div class="block-error">donut: нужны положительные значения в values</div>`;
    const labels = strs(p.labels);
    const n = vals.length;
    const hole = Math.min(0.9, Math.max(0, p.hole ?? 0.62));
    const R = 96;
    const th = R * (1 - hole);
    const r = R - th / 2;
    // Доли — дугами (не пунктиром по кругу: у толстой обводки на стыках вылезают клинья).
    // Между долями — зазор цвета фона
    const gap = n > 1 ? 0.012 : 0;
    const pt = (a: number) => `${(100 + r * Math.sin(a * 2 * Math.PI)).toFixed(2)} ${(100 - r * Math.cos(a * 2 * Math.PI)).toFixed(2)}`;
    let start = 0;
    const segs = vals.map((v, k) => {
      const f = v / sum;
      const a0 = start + (f > gap * 2 ? gap / 2 : 0);
      const a1 = start + f - (f > gap * 2 ? gap / 2 : 0);
      const d = f >= 0.9999
        ? `M${pt(0)}A${r} ${r} 0 1 1 ${pt(0.5)}A${r} ${r} 0 1 1 ${pt(0.99999)}`
        : `M${pt(a0)}A${r.toFixed(2)} ${r.toFixed(2)} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${pt(a1)}`;
      const seg = `<path class="dn-seg" data-k="${k}" d="${d}" pathLength="1" stroke-width="${th.toFixed(2)}" style="stroke:${seriesColor(k, n)};--d:${(0.3 + start * 0.9).toFixed(2)}s"/>`;
      start += f;
      return seg;
    }).join('');
    const center = p.center ?? fmtNum(sum);
    const mid = hole >= 0.4
      ? `<text class="dn-v" x="100" y="${p.sub ? 100 : 108}" text-anchor="middle"${ea(p, 'center')}>${esc(center)}</text>`
        + (p.sub ? `<text class="dn-s" x="100" y="124" text-anchor="middle"${ea(p, 'sub')}>${esc(p.sub)}</text>` : '')
      : '';
    const place = p.legend === 'bottom' ? ' bottom' : '';
    // Значения и так в процентах — доля рядом не нужна
    const pct = !String(p.unit ?? '').includes('%');
    const leg = p.legend === 'none' ? '' : `<ul class="dn-leg${pct ? '' : ' nopct'}">${vals.map((v, k) =>
      `<li data-k="${k}" style="--i:${k}"><i style="background:${seriesColor(k, n)}"></i><span${ea(p.labels, k)}>${t(labels[k] ?? '')}</span><b>${fmtNum(v)}${esc(p.unit ?? '')}</b>${pct ? `<em>${Math.round((v / sum) * 100)} %</em>` : ''}</li>`).join('')}</ul>`;
    return `<div class="donut${place}"${styleAttr(p.style)}><svg class="dn-fig" viewBox="0 0 200 200" role="img" aria-label="Доли: ${esc(labels.join(', '))}">`
      + `<circle class="dn-bg" cx="100" cy="100" r="${r.toFixed(2)}" stroke-width="${th.toFixed(2)}"/>${segs}${mid}</svg>${leg}</div>`;
  },
});

// ---------------- рейтинг: горизонтальные полосы ----------------

interface HBarsProps extends Block {
  values: number[];
  labels?: string[];
  max?: number;
  unit?: string;
  /** Выделенная полоса (с нуля), по умолчанию первая; false — все одинаковые */
  highlight?: number | false;
}

defineBlock<HBarsProps>('hbars', {
  render(p) {
    const vals = nums(p.values);
    const labels = strs(p.labels);
    const max = (p.max ?? Math.max(...vals, 0)) || 1;
    const hl = p.highlight === false ? -1 : Number.isInteger(p.highlight) ? Number(p.highlight) : 0;
    return `<div class="hbars"${styleAttr(p.style)}>${vals.map((v, k) =>
      `<div class="hb${k === hl ? ' hl' : ''}" style="--k:${k}"><span class="hb-l"${ea(p.labels, k)}>${t(labels[k] ?? '')}</span>`
      + `<span class="hb-t"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%"></i></span><b>${fmtNum(v)}${esc(p.unit ?? '')}</b></div>`).join('')}</div>`;
  },
});

// ---------------- спидометр ----------------

interface GaugeProps extends Block {
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  label?: string;
  /** Отметка цели на шкале */
  target?: number;
}

defineBlock<GaugeProps>('gauge', {
  render(p, ctx) {
    const min = Number(p.min ?? 0);
    const max = Number(p.max ?? 100);
    const v = Number(p.value ?? 0);
    const f = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
    const id = ctx.uid('gg');
    const arc = 'M24 120A96 96 0 0 1 216 120';
    let mark = '';
    if (p.target != null && max > min) {
      const a = Math.PI * (1 - Math.max(0, Math.min(1, (Number(p.target) - min) / (max - min))));
      const [c, s] = [Math.cos(a), Math.sin(a)];
      mark = `<line class="gg-tg" x1="${(120 + c * 82).toFixed(1)}" y1="${(120 - s * 82).toFixed(1)}" x2="${(120 + c * 110).toFixed(1)}" y2="${(120 - s * 110).toFixed(1)}"/>`;
    }
    return `<svg class="gauge" viewBox="0 0 240 160"${styleAttr(p.style)} role="img" aria-label="${esc(`${fmtNum(v)}${p.unit ?? ''} из ${fmtNum(max)}`)}">`
      + `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="var(--ac)"/><stop offset="1" stop-color="var(--ac2)"/></linearGradient></defs>`
      + `<path class="gg-bg" d="${arc}"/><path class="gg-v" d="${arc}" pathLength="100" stroke="url(#${id})" style="stroke-dasharray:${(f * 100).toFixed(2)} 100"/>${mark}`
      + `<text class="gg-n" x="120" y="112" text-anchor="middle"><tspan${ea(p, 'value')}>${fmtNum(v)}</tspan><tspan class="gg-u"${ea(p, 'unit')}>${esc(p.unit ?? '')}</tspan></text>`
      + (p.label ? `<text class="gg-l" x="120" y="154" text-anchor="middle"${ea(p, 'label')}>${esc(p.label)}</text>` : '')
      + `<text class="gg-m" x="24" y="138" text-anchor="middle">${fmtNum(min)}</text><text class="gg-m" x="216" y="138" text-anchor="middle">${fmtNum(max)}</text></svg>`;
  },
});

// ---------------- кольца целей ----------------

interface RingsProps extends Block {
  /** Выполнение каждой цели, % */
  values: number[];
  labels?: string[];
}

defineBlock<RingsProps>('rings', {
  render(p) {
    const vals = nums(p.values).slice(0, 4);
    const labels = strs(p.labels);
    const n = vals.length;
    const w = n > 3 ? 13 : 16;
    const rings = vals.map((v, k) => {
      const r = 92 - w / 2 - k * (w + 5);
      const c = seriesColor(k, n);
      return `<circle class="rg-bg" cx="100" cy="100" r="${r}" stroke-width="${w}" style="stroke:${c}"/>`
        + `<circle class="rg-v" cx="100" cy="100" r="${r}" stroke-width="${w}" pathLength="100" style="stroke:${c};stroke-dasharray:${Math.max(0.1, Math.min(100, v) - 0.01).toFixed(2)} 100;--k:${k}"/>`;
    }).join('');
    return `<div class="rings"${styleAttr(p.style)}><svg viewBox="0 0 200 200" role="img" aria-label="Цели"><g transform="rotate(-90 100 100)">${rings}</g></svg>`
      + `<ul class="dn-leg">${vals.map((v, k) => `<li style="--i:${k}"><i style="background:${seriesColor(k, n)}"></i><span${ea(p.labels, k)}>${t(labels[k] ?? '')}</span><b>${fmtNum(v)} %</b></li>`).join('')}</ul></div>`;
  },
});

// ---------------- столбцы по группам ----------------

interface ColumnsProps extends Block {
  labels?: string[];
  series: Series[];
  /** Ряды друг на друге, а не рядом */
  stacked?: boolean;
  unit?: string;
  max?: number;
}

/** Сетка оси Y: четыре деления с подписями */
function yGrid(min: number, max: number, x0: number, x1: number, top: number, bottom: number, unit = ''): string {
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const y = bottom - (k / 4) * (bottom - top);
    g += `<line class="${k ? 'gl' : 'gl base'}" x1="${x0}" x2="${x1}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`
      + `<text class="tx" x="${x0 - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmtNum(min + ((max - min) * k) / 4)}</text>`;
  }
  if (unit) g += `<text class="tx u" x="${x0 - 8}" y="${top - 12}" text-anchor="end">${esc(unit.trim())}</text>`;
  return g;
}

defineBlock<ColumnsProps>('columns', {
  render(p) {
    const series = seriesOf(p);
    if (!series.length) return `<div class="block-error">columns: нужен хотя бы один ряд в series</div>`;
    const labels = strs(p.labels);
    const m = Math.max(labels.length, ...series.map((s) => s.values.length));
    const top = 24;
    const bottom = 178;
    const x0 = 44;
    const x1 = 552;
    const peak = p.stacked
      ? Math.max(...Array.from({ length: m }, (_v, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0)))
      : Math.max(...series.flatMap((s) => s.values));
    const max = p.max ?? niceMax(peak);
    const gw = (x1 - x0) / m;
    const inner = gw * 0.62;
    const n = series.length;
    const bw = p.stacked ? inner : (inner - (n - 1) * 2) / n;
    const h = (v: number) => (Math.max(0, v) / max) * (bottom - top);
    let bars = '';
    for (let i = 0; i < m; i++) {
      const gx = x0 + gw * i + (gw - inner) / 2;
      let acc = 0;
      let g = '';
      series.forEach((s, k) => {
        const v = s.values[i] ?? 0;
        const hh = h(v);
        const x = p.stacked ? gx : gx + k * (bw + 2);
        const y = bottom - (p.stacked ? acc : 0) - hh;
        // Верх столбца (у стопки — верх последнего куска) скруглён, низ стоит на оси
        const topmost = !p.stacked || k === n - 1;
        const rr = Math.min(4, bw / 2, hh);
        const d = topmost && hh > 0
          ? `M${x.toFixed(1)} ${(y + hh).toFixed(1)}V${(y + rr).toFixed(1)}Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + rr).toFixed(1)} ${y.toFixed(1)}H${(x + bw - rr).toFixed(1)}Q${(x + bw).toFixed(1)} ${y.toFixed(1)} ${(x + bw).toFixed(1)} ${(y + rr).toFixed(1)}V${(y + hh).toFixed(1)}Z`
          : `M${x.toFixed(1)} ${(y + hh).toFixed(1)}V${y.toFixed(1)}H${(x + bw).toFixed(1)}V${(y + hh).toFixed(1)}Z`;
        g += `<path class="cl-b" d="${d}" style="fill:${seriesColor(k, n)}"/>`;
        if (!p.stacked) g += `<text class="cl-v" x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${fmtNum(v)}</text>`;
        // У стопки куски разделены тонкой линией цвета фона
        acc += hh + (p.stacked && hh > 0 ? 2 : 0);
      });
      if (p.stacked) {
        const total = series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0);
        g += `<text class="cl-v" x="${(gx + inner / 2).toFixed(1)}" y="${(bottom - acc - 4).toFixed(1)}" text-anchor="middle">${fmtNum(total)}</text>`;
      }
      bars += `<g class="cl-g${i === m - 1 ? ' last' : ''}" style="--k:${i}">${g}<text class="tx" x="${(x0 + gw * i + gw / 2).toFixed(1)}" y="${bottom + 18}" text-anchor="middle"${ea(p.labels, i)}>${esc(labels[i] ?? '')}</text></g>`;
    }
    return `<div class="dg${p.stacked ? ' stacked' : ''}"${styleAttr(p.style)}>${legend(p, series)}<svg class="columns" viewBox="0 0 560 200" role="img" aria-label="Столбцы: ${esc(series.map((s) => s.name).join(', '))}">${yGrid(0, max, x0, x1, top, bottom, p.unit)}${bars}</svg></div>`;
  },
});

// ---------------- несколько линий ----------------

interface LinesProps extends Block {
  labels?: string[];
  series: Series[];
  unit?: string;
  min?: number;
  max?: number;
}

/** Плавная кривая без горбов за пределами данных (как у line-chart) */
function smooth(pts: [number, number][]): string {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const c1y = Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) * 0.18));
    const c2y = Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) * 0.18));
    d += `C${f(p1[0] + (p2[0] - p0[0]) * 0.18)} ${f(c1y)} ${f(p2[0] - (p3[0] - p1[0]) * 0.18)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

defineBlock<LinesProps>('lines', {
  render(p, ctx) {
    const series = seriesOf(p).filter((s) => s.values.length >= 2);
    if (!series.length) return `<div class="block-error">lines: нужен ряд хотя бы из двух значений</div>`;
    const labels = strs(p.labels);
    const m = Math.max(...series.map((s) => s.values.length));
    const all = series.flatMap((s) => s.values);
    const max = p.max ?? niceMax(Math.max(...all));
    const min = p.min ?? 0;
    const top = 24;
    const bottom = 178;
    const x0 = 44;
    const x1 = 470;
    const X = (i: number) => x0 + (i * (x1 - x0)) / (m - 1);
    const Y = (v: number) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
    const id = ctx.uid('ln');
    const n = series.length;
    // Подписи концов линий не наезжают друг на друга
    const ends = series.map((s, k) => ({ k, y: Y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 26);
    const endY = new Map(ends.map((e) => [e.k, e.y]));
    let g = '';
    series.forEach((s, k) => {
      const pts = s.values.map((v, i): [number, number] => [X(i), Y(v)]);
      const d = smooth(pts);
      const c = seriesColor(k, n);
      const [lx, ly] = pts[pts.length - 1];
      if (k === 0) g += `<path class="ln-a" d="${d}L${lx.toFixed(1)} ${bottom}L${x0} ${bottom}Z" fill="url(#${id})"/>`;
      g += `<path class="ln-l" pathLength="1" d="${d}" style="stroke:${c};--k:${k}"/>`
        + `<g class="ln-e" style="--k:${k}"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5" style="stroke:${c}"/>`
        + `<text class="ln-t" x="${lx + 12}" y="${(endY.get(k)! - 2).toFixed(1)}">${fmtNum(s.values[s.values.length - 1])}${esc(p.unit ?? '')}</text>`
        + `<text class="ln-n" x="${lx + 12}" y="${(endY.get(k)! + 11).toFixed(1)}"${ea((p.series as unknown[])[k], 'name')}>${esc(s.name)}</text></g>`;
    });
    const step = Math.ceil(m / 8);
    let xl = '';
    for (let i = 0; i < m; i += step) if (labels[i]) xl += `<text class="tx" x="${X(i).toFixed(1)}" y="${bottom + 18}" text-anchor="middle"${ea(p.labels, i)}>${esc(labels[i])}</text>`;
    return `<div class="dg"${styleAttr(p.style)}>${legend(p, series)}<svg class="lines" viewBox="0 0 560 200" role="img" aria-label="Линии: ${esc(series.map((s) => s.name).join(', '))}">`
      + `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--ac)" stop-opacity=".2"/><stop offset="1" stop-color="var(--ac)" stop-opacity="0"/></linearGradient></defs>`
      + `${yGrid(min, max, x0, x1, top, bottom, p.unit)}${xl}${g}</svg></div>`;
  },
});
