import { defineBlock } from '../../engine/component';
import { asArray, esc, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import './table.css';

type Cell = string | number | null | undefined;

interface TableProps extends Block {
  /** Заголовки столбцов (необязательно) */
  header?: Cell[];
  /** Строки: списки ячеек */
  rows: Cell[][];
  /**
   * Вид: lines — тонкие линии между строками (по умолчанию), stripes — зебра,
   * boxed — сетка в рамке, accent — шапка акцентного цвета
   */
  variant?: 'lines' | 'stripes' | 'boxed' | 'accent';
  /** Доли ширины столбцов: [1, 4, 2]; без них — поровну, первый уже */
  widths?: number[];
  /** Выравнивание столбцов: left, center, right. Без него числа — вправо */
  align?: string[];
  /** Номер выделенной строки (с нуля) */
  highlight?: number;
  /** Размер текста, px (по умолчанию 17) */
  size?: number;
  /** Первый столбец — жирным, как подписи строк */
  labels?: boolean;
  /** false — шапку не показывать (данные шапки сохраняются) */
  head?: boolean;
}

const NUMERIC = /^[\s+−–-]?[\d\s.,]+\s?(%|₽|\$|€|млн|тыс|млрд|с|мс|ч|шт|дБм|°C)?$/i;

/** Таблица: шапка, строки, выравнивание чисел, выделенная строка; каждая ячейка правится на месте. */
defineBlock<TableProps>('table', {
  render(p) {
    const header = Array.isArray(p.header) ? p.header : [];
    const rows = asArray(p.rows).filter(Array.isArray) as Cell[][];
    const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
    const widths = Array.isArray(p.widths) && p.widths.length === cols ? p.widths.map((w) => Math.max(0.2, Number(w) || 1)) : null;
    const align = (c: number) => {
      const a = Array.isArray(p.align) ? p.align[c] : undefined;
      if (a === 'center' || a === 'right' || a === 'left') return a;
      // Столбец из чисел — вправо, чтобы разряды стояли друг под другом
      const vals = rows.map((r) => r[c]).filter((v) => v !== undefined && v !== null && String(v).trim());
      return vals.length && vals.every((v) => typeof v === 'number' || NUMERIC.test(String(v))) ? 'right' : 'left';
    };
    const cell = (tag: 'th' | 'td', list: Cell[], c: number, extra = '') => {
      const v = list[c];
      return `<${tag} class="a-${align(c)}"${extra}${ea(list, c)}>${v === undefined || v === null ? '' : t(v)}</${tag}>`;
    };
    const variant = ['stripes', 'boxed', 'accent'].includes(String(p.variant)) ? p.variant : 'lines';
    const size = Number(p.size) >= 10 && Number(p.size) <= 40 ? Number(p.size) : 0;
    const colgroup = widths ? `<colgroup>${widths.map((w) => `<col style="width:${((w / widths.reduce((a, b) => a + b, 0)) * 100).toFixed(2)}%">`).join('')}</colgroup>` : '';
    return `<div class="tbl r tbl-${variant}${p.labels ? ' tbl-labels' : ''}"${size || p.style ? ` style="${size ? `--ts:${size}px;` : ''}${esc(p.style ?? '')}"` : ''}>`
      + `<table>${colgroup}`
      + (header.length && p.head !== false ? `<thead><tr>${Array.from({ length: cols }, (_x, c) => cell('th', header, c)).join('')}</tr></thead>` : '')
      + `<tbody>${rows.map((r, k) => `<tr${k === p.highlight ? ' class="hl"' : ''} style="--k:${k}">${Array.from({ length: cols }, (_x, c) => cell('td', r, c)).join('')}</tr>`).join('')}</tbody>`
      + `</table></div>`;
  },
});
