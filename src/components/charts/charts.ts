import { defineBlock } from '../../engine/component';
import { asArray, esc, num, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { polyline, trendOf, trendPath } from './trend';
import './charts.css';

interface LineChartProps extends Block {
  values: number[];
  /** Делитель для подписей оси и единица: 1000 и «тыс» */
  scale?: number;
  unit?: string;
  /** Подписи под осью слева и справа */
  start?: string;
  end?: string;
  /** Границы оси Y (по умолчанию — по данным с запасом) */
  min?: number;
  max?: number;
  /** false — ломаная через точки (для точных данных), по умолчанию плавная */
  smooth?: boolean;
  /** Тренд пунктиром: linear — прямая по наименьшим квадратам, 2–12 — скользящее среднее по стольким точкам */
  trend?: 'linear' | number | string;
  /** Прогноз по линейному тренду на столько шагов вперёд: зона прогноза затенена */
  forecast?: number;
}


/** Плавная кривая через точки (Catmull-Rom → кубические Безье), без выбросов за данные. */
function curve(pts: [number, number][]): string {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    // Контрольные точки не выходят за пределы соседних значений: нет ложных горбов
    const c1y = Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) * t));
    const c2y = Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) * t));
    d += `C${f(p1[0] + (p2[0] - p0[0]) * t)} ${f(c1y)} ${f(p2[0] - (p3[0] - p1[0]) * t)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** Число для подписи: 53 501 → «53,5», дробные — до одного знака. */
function fmt(v: number, scale: number): string {
  const x = v / scale;
  return x.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(x) < 10 ? 1 : Math.abs(x) < 100 && scale > 1 ? 1 : 0 });
}

/** Линейный график: плавная линия прорисовывается, под ней мягкая заливка, последняя точка подписана. */
defineBlock<LineChartProps>('line-chart', {
  render(p, ctx) {
    const D = asArray(p.values).map(Number).filter((v) => Number.isFinite(v));
    if (D.length < 2) return `<div class="block-error">line-chart: нужно минимум два значения в values</div>`;
    const tr = trendOf(D, p.trend, p.forecast);
    const known = [...D, ...tr.line.filter((v): v is number => v !== null)];
    const lo = Math.min(...known);
    const hi = Math.max(...known);
    const pad = (hi - lo) * 0.14 || Math.abs(hi) * 0.1 || 1;
    const mn = p.min ?? lo - pad;
    const mx = p.max ?? hi + pad;
    const scale = p.scale ?? (hi >= 10000 ? 1000 : 1);
    const unit = p.unit ?? (scale === 1000 ? 'тыс' : '');
    const x0 = 48;
    const x1 = 520;
    const top = 26;
    const bottom = 164;
    const total = D.length + tr.ahead;
    const X = (k: number) => x0 + k * ((x1 - x0) / (total - 1));
    const Y = (v: number) => bottom - ((v - mn) / (mx - mn)) * (bottom - top);
    const pts = D.map((v, k): [number, number] => [X(k), Y(v)]);
    const straight = p.smooth === false;
    const line = straight ? polyline(pts) : curve(pts);
    const id = ctx.uid('lc');
    let grid = '';
    for (let k = 0; k < 4; k++) {
      const yy = top + k * ((bottom - top) / 3);
      const label = fmt(mx - ((mx - mn) * k) / 3, scale);
      grid += `<line class="gl" x1="${x0}" x2="${x1}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`
        + `<text class="tx" x="${x0 - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${label}</text>`;
    }
    if (unit) grid += `<text class="tx u" x="${x0 - 8}" y="${top - 12}" text-anchor="end">${esc(unit)}</text>`;
    if (p.start) grid += `<text class="tx" x="${x0}" y="186"${ea(p, 'start')}>${esc(p.start)}</text>`;
    if (p.end) grid += `<text class="tx" x="${x1}" y="186" text-anchor="end"${ea(p, 'end')}>${esc(p.end)}</text>`;
    const [lx, ly] = pts[pts.length - 1];
    // Прогноз: зона после последней точки затенена, в конце — ожидаемое значение
    let extra = '';
    if (tr.ahead) {
      const fx = X(total - 1);
      const fv = tr.line[total - 1]!;
      extra += `<rect class="fz" x="${lx.toFixed(1)}" y="${top - 6}" width="${(fx - lx).toFixed(1)}" height="${bottom - top + 6}"/>`
        + `<text class="tx fzt" x="${((lx + fx) / 2).toFixed(1)}" y="${bottom - 6}" text-anchor="middle">прогноз</text>`
        + `<circle class="fp" cx="${fx.toFixed(1)}" cy="${Y(fv).toFixed(1)}" r="4"/>`
        + `<text class="fpt" x="${fx.toFixed(1)}" y="${(Y(fv) - 10).toFixed(1)}" text-anchor="end">≈ ${fmt(fv, scale)}</text>`;
    }
    if (tr.line.length) extra += `<path class="tr" d="${trendPath(tr.line, X, Y)}"/>`;
    // Ломаная — с точками: видно, где измерения
    const dots = straight ? pts.slice(0, -1).map(([x, y], k) => `<circle class="pp" style="--k:${k}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`).join('') : '';
    const last = D[D.length - 1];
    const tag = `${fmt(last, scale)}${unit ? ` ${esc(unit)}` : ''}`;
    const tw = 12 + tag.length * 6.4;
    const tx = Math.min(x1 + 34 - tw, lx - tw / 2);
    const ty = ly - 30 < 2 ? ly + 12 : ly - 30;
    return `<svg class="line-chart" viewBox="0 0 560 192"${styleAttr(p.style)} role="img" aria-label="График: последнее значение ${tag}">`
      + `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--ac)" stop-opacity=".26"/><stop offset="1" stop-color="var(--ac)" stop-opacity="0"/></linearGradient></defs>`
      + grid
      + extra
      + `<path class="fd" d="${line}L${lx.toFixed(1)} ${bottom}L${x0} ${bottom}Z" fill="url(#${id})"/>`
      + `<path class="dr" pathLength="1" d="${line}"/>${dots}`
      + `<g class="lp"><circle class="halo" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="9"/><circle class="pt" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4.5"/>`
      + `<rect class="tag" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${tw.toFixed(1)}" height="20" rx="6"/><text class="tagt" x="${(tx + tw / 2).toFixed(1)}" y="${(ty + 14).toFixed(1)}" text-anchor="middle">${tag}</text></g>`
      + `</svg>`;
  },
});

interface UptimeProps extends Block {
  /** Доступность по дням, % */
  values: number[];
  /** Порог «хорошего» дня, % */
  threshold?: number;
}

/** Полоса доступности: ячейка на каждый день, слабые дни бледнее. */
defineBlock<UptimeProps>('uptime', {
  render(p) {
    const vals = asArray(p.values).map(Number);
    const th = p.threshold ?? 99.5;
    const cells = vals.map((q) =>
      `<i title="${num(q, 1)}%" style="opacity:${q >= th ? 1 : 0.35}"></i>`).join('');
    return `<div class="strip"${styleAttr(`grid-template-columns:repeat(${vals.length || 1},1fr)`, p.style)}>${cells}</div>`;
  },
});

interface BarsProps extends Block {
  values: number[];
  /** Подписи под столбцами (необязательно) */
  labels?: string[];
  /** Значение, соответствующее полной высоте */
  max?: number;
  height?: number;
  /** Номер выделенного столбца (с нуля); false — все одинаковые. По умолчанию последний */
  highlight?: number | false;
}

/** Столбцы, вырастающие по очереди. */
defineBlock<BarsProps>('bars', {
  render(p) {
    const vals = asArray(p.values).map(Number);
    const max = p.max ?? Math.max(...vals) * 1.05;
    const labels = Array.isArray(p.labels) ? p.labels : [];
    // Выделен один столбец (по умолчанию последний), остальные спокойнее
    const hl = p.highlight === false ? -1 : Number.isInteger(p.highlight) ? Number(p.highlight) : vals.length - 1;
    const bars = vals.map((v, k) =>
      `<div class="${k === hl ? 'hl' : ''}" style="--k:${k};height:${Math.min(100, (v / max) * 100).toFixed(1)}%"><small>${num(v)}</small>`
      + (labels[k] ? `<em${ea(labels, k)}>${t(labels[k])}</em>` : '') + `</div>`).join('');
    return `<div class="bars${labels.length ? ' labeled' : ''}"${styleAttr(p.height && `height:${p.height}px`, p.style)}>${bars}</div>`;
  },
});
