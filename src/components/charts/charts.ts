import { defineBlock } from '../../engine/component';
import { asArray, esc, num, styleAttr, t } from '../../engine/html';
import type { Block } from '../../types';
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
}

/** Линейный график, который прорисовывается при появлении слайда. */
defineBlock<LineChartProps>('line-chart', {
  render(p) {
    const D = asArray(p.values).map(Number).filter((v) => Number.isFinite(v));
    if (D.length < 2) return `<div class="block-error">line-chart: нужно минимум два значения в values</div>`;
    const lo = Math.min(...D);
    const hi = Math.max(...D);
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
    const mn = p.min ?? lo - pad;
    const mx = p.max ?? hi + pad;
    const scale = p.scale ?? (hi >= 10000 ? 1000 : 1);
    const unit = p.unit ?? (scale === 1000 ? 'тыс' : '');
    const x0 = 44;
    const x1 = 544;
    let path = '';
    D.forEach((v, k) => {
      const x = x0 + k * ((x1 - x0) / (D.length - 1));
      const y = 160 - ((v - mn) / (mx - mn)) * 140;
      path += (k ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    let grid = '';
    for (let k = 0; k < 4; k++) {
      const yy = 20 + k * 46.7;
      const label = Math.round((mx - ((mx - mn) * k) / 3) / scale);
      grid += `<line x1="${x0}" x2="${x1}" y1="${yy}" y2="${yy}" stroke="var(--bd)"/>`
        + `<text class="tx" x="0" y="${yy + 3}">${label}${unit ? ' ' + esc(unit) : ''}</text>`;
    }
    if (p.start) grid += `<text class="tx" x="${x0}" y="184">${esc(p.start)}</text>`;
    if (p.end) grid += `<text class="tx" x="${x1}" y="184" text-anchor="end">${esc(p.end)}</text>`;
    return `<svg class="line-chart" viewBox="0 0 560 190"${styleAttr(p.style)} role="img" aria-label="График">${grid}`
      + `<path class="fd" d="${path}L${x1} 160L${x0} 160Z" fill="var(--acs)"/>`
      + `<path class="dr" pathLength="1" d="${path}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
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
}

/** Столбцы, вырастающие по очереди. */
defineBlock<BarsProps>('bars', {
  render(p) {
    const vals = asArray(p.values).map(Number);
    const max = p.max ?? Math.max(...vals) * 1.05;
    const labels = asArray(p.labels);
    const bars = vals.map((v, k) =>
      `<div style="--k:${k};height:${((v / max) * 100).toFixed(1)}%"><small>${num(v)}</small>`
      + (labels[k] ? `<em>${t(labels[k])}</em>` : '') + `</div>`).join('');
    return `<div class="bars${labels.length ? ' labeled' : ''}"${styleAttr(p.height && `height:${p.height}px`, p.style)}>${bars}</div>`;
  },
});
