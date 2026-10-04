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
   * boxed — сетка в рамке, accent — шапка акцентного цвета,
   * soft — мягкая карточка без линий, dark — тёмная шапка,
   * plan — план работ: номера «01», задача в две строки (**Задача**\nрезультат), метки приоритета
   */
  variant?: 'lines' | 'stripes' | 'boxed' | 'accent' | 'soft' | 'dark' | 'plan';
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
  /** Последняя строка — итог: жирным, с чертой сверху */
  total?: boolean;
  /** Плотность строк: compact — плотнее, roomy — свободнее */
  density?: 'compact' | 'roomy';
  /**
   * Свои цвета (#RRGGBB) вместо цветов темы — так приходят таблицы из PowerPoint:
   * head — шапка, headText — текст шапки, fill — строки, band — каждая вторая строка, text — текст, line — сетка
   */
  colors?: { head?: string; headText?: string; fill?: string; band?: string; text?: string; line?: string };
  /**
   * Столбец меток (с нуля): ячейка — бейдж с цветной точкой. Цвет по слову
   * (критический, высокий, средний, низкий; готово, идёт, план) или явно: {#16A34A|Готово}
   */
  badge?: number;
  /** Строка итога под таблицей слева; {rows} — число строк */
  footer?: string;
  /** Строка итога справа */
  footnote?: string;
}

const VARIANTS = ['stripes', 'boxed', 'accent', 'soft', 'dark', 'plan'];

/** Цвет точки метки по её слову: приоритеты и статусы */
const DOTS: [RegExp, string][] = [
  // Те же оттенки, что у меток в других таблицах галереи
  [/^крит|^блок|^срочн/i, '#DC2626'],
  [/^высок|^идёт|^идет|^в работе|^риск/i, '#CA8A04'],
  [/^готов|^сделан|^выполн|^done/i, '#16A34A'],
  [/^средн/i, 'var(--ac)'],
];
const COLOR = /^\{(#[0-9a-f]{3,8}|accent2?|text2?|muted)\|([^{}]*)\}$/i;
const NAMED: Record<string, string> = { accent: 'var(--ac)', accent2: 'var(--ac2, var(--ac))', text: 'var(--tx)', text2: 'var(--tx2)', muted: 'var(--mu)' };

/** Метка: точка цвета и текст; {цвет|текст} задаёт цвет явно */
function badge(v: string): string {
  const m = COLOR.exec(v.trim());
  const text = m ? m[2] : v;
  const color = m ? (NAMED[m[1].toLowerCase()] ?? m[1]) : DOTS.find(([re]) => re.test(text.trim()))?.[1] ?? 'var(--mu)';
  return `<span class="tbl-badge"><i style="--dot:${esc(color)}"></i>${t(text)}</span>`;
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
    const badgeCol = Number.isInteger(p.badge) ? Number(p.badge) : -1;
    const cell = (tag: 'th' | 'td', list: Cell[], c: number, extra = '') => {
      const v = list[c];
      const empty = v === undefined || v === null || !String(v).trim();
      const html = empty ? '' : tag === 'td' && c === badgeCol ? badge(String(v)) : t(v);
      return `<${tag} class="a-${align(c)}"${extra}${ea(list, c)}>${html}</${tag}>`;
    };
    const foot = typeof p.footer === 'string' || typeof p.footnote === 'string'
      ? `<div class="tbl-foot"><span${ea(p, 'footer')}>${t(String(p.footer ?? '').replace(/\{rows\}/g, String(rows.length)))}</span>`
        + `<span${ea(p, 'footnote')}>${t(String(p.footnote ?? '').replace(/\{rows\}/g, String(rows.length)))}</span></div>`
      : '';
    const variant = VARIANTS.includes(String(p.variant)) ? p.variant : 'lines';
    const density = p.density === 'compact' || p.density === 'roomy' ? ` tbl-${p.density}` : '';
    const size = Number(p.size) >= 10 && Number(p.size) <= 40 ? Number(p.size) : 0;
    const HEXC = /^#[0-9a-f]{6}$/i;
    const own = p.colors && typeof p.colors === 'object'
      ? Object.entries({ head: '--th-bg', headText: '--th-tx', fill: '--td-bg', band: '--td-band', text: '--td-tx', line: '--td-line' })
        .map(([k, v]) => { const c = (p.colors as Record<string, unknown>)[k]; return typeof c === 'string' && HEXC.test(c) ? `${v}:${c};` : ''; }).join('')
      : '';
    const colgroup = widths ? `<colgroup>${widths.map((w) => `<col style="width:${((w / widths.reduce((a, b) => a + b, 0)) * 100).toFixed(2)}%">`).join('')}</colgroup>` : '';
    return `<div class="tbl r tbl-${variant}${density}${own ? ' tbl-own' : ''}${p.labels ? ' tbl-labels' : ''}${p.total && rows.length > 1 ? ' tbl-total' : ''}${foot ? ' tbl-footed' : ''}"${size || own || p.style ? ` style="${size ? `--ts:${size}px;` : ''}${own}${esc(p.style ?? '')}"` : ''}>`
      + `<table>${colgroup}`
      + (header.length && p.head !== false ? `<thead><tr>${Array.from({ length: cols }, (_x, c) => cell('th', header, c)).join('')}</tr></thead>` : '')
      + `<tbody>${rows.map((r, k) => `<tr${k === p.highlight ? ' class="hl"' : ''} style="--k:${k}">${Array.from({ length: cols }, (_x, c) => cell('td', r, c)).join('')}</tr>`).join('')}</tbody>`
      + `</table>${foot}</div>`;
  },
});
