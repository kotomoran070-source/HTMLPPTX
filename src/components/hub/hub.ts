import { defineBlock } from '../../engine/component';
import { asArray, esc, styleAttr, t } from '../../engine/html';
import { ea, eimgPath, tx } from '../../engine/marks';
import type { Block } from '../../types';
import { linkHighlight } from '../highlight';
import './hub.css';

interface HubItem {
  /** Пункт списка слева */
  title: string;
  text?: string;
  /** Подпись узла на схеме (по умолчанию title) */
  node?: string;
  /** Мелкая подпись под узлом */
  sub?: string;
}

interface HubProps extends Block {
  items: HubItem[];
  height?: number;
}

const W = 480;
const H = 360;
const CX = 240;
const CY = 185;

/** Позиции узлов вокруг центра: для 4 пунктов — слева, сверху, справа, снизу. */
function positions(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.PI + (k / n) * Math.PI * 2;
    out.push([CX + Math.cos(a) * 158, CY + Math.sin(a) * 135]);
  }
  return out;
}

/**
 * Список результатов и схема «всё вокруг продукта».
 * Наведение на пункт подсвечивает узел схемы и наоборот.
 */
defineBlock<HubProps>('hub', {
  render(p, ctx) {
    const items = asArray(p.items);
    const pos = positions(items.length);
    const list = items.map((it, k) =>
      `<div class="hub-item r" data-k="h${k}" tabindex="0"><b${ea(it, 'title')}>${t(it.title)}</b>${it.text ? tx(it, 'text') : ''}</div>`).join('');

    let lines = '';
    let nodes = '';
    items.forEach((it, k) => {
      const [x, y] = pos[k];
      const label = it.node ?? it.title;
      const w = Math.max(150, Math.min(220, Math.max(label.length * 8.6, (it.sub ?? '').length * 6.4) + 26));
      const h = it.sub ? 54 : 40;
      const nx = Math.max(2, Math.min(W - w - 2, x - w / 2));
      const ny = y - h / 2;
      const mid = nx + w / 2;
      lines += `<line class="ln" data-k="h${k}" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      nodes += `<g class="nd" data-k="h${k}" tabindex="0"><rect x="${nx.toFixed(1)}" y="${ny.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="12"/>`
        + `<text x="${mid.toFixed(1)}" y="${(ny + (it.sub ? 24 : 25)).toFixed(1)}" text-anchor="middle"${ea(it, 'node')}>${esc(label)}</text>`
        + (it.sub ? `<text class="sb" x="${mid.toFixed(1)}" y="${(ny + 41).toFixed(1)}" text-anchor="middle"${ea(it, 'sub')}>${esc(it.sub)}</text>` : '')
        + `</g>`;
    });
    const center = `<rect class="hub-center" x="${CX - 40}" y="${CY - 40}" width="80" height="80" rx="18"/>`
      + (ctx.logo ? `<image href="${esc(ctx.logo)}" x="${CX - 28}" y="${CY - 28}" width="56" height="56"${eimgPath(['brand', 'logo'])}/>` : '');
    const svg = `<svg class="hb r" viewBox="0 0 ${W} ${H}" role="img" aria-label="Схема">${lines}${center}${nodes}</svg>`;

    return `<div class="hub"${styleAttr(p.height && `height:${p.height}px`, p.style)}><div class="hub-list">${list}</div><div>${svg}</div></div>`;
  },
  mount(el) {
    return linkHighlight(el);
  },
});
