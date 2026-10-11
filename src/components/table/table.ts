import { defineBlock } from '../../engine/component';
import { asArray, esc, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { SHAPE_COLORS } from '../shape/shape';
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
  /** Последний столбец — жирным (итог по строке) */
  lastcol?: boolean;
  /** Чередующиеся строки — зебра поверх любого вида */
  bands?: boolean;
  /** По вертикали в ячейках: top, bottom (по умолчанию — посередине) */
  valign?: 'top' | 'bottom';
  /** Заливка ячеек по строкам, как rows: цвет темы (accent, soft, alt…) или #RRGGBB; пусто — как у таблицы */
  fills?: (string | null)[][];
  /** Заливка ячеек шапки */
  headFills?: (string | null)[];
  /**
   * Объединённые ячейки: [строка, столбец, строк, столбцов]; строка -1 — шапка (только по ширине).
   * Текст и заливка — у первой ячейки, остальные скрыты (их данные не теряются)
   */
  merges?: number[][];
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

/** Заливка ячейки: цвет темы — с его цветом текста; свой #RRGGBB — тёмный получает светлый текст */
function cellFill(f: string): string {
  const role = SHAPE_COLORS[f];
  if (role) return ` style="background:${role.css};color:${role.on}"`;
  const m = /^#([0-9a-f]{6})$/i.exec(f);
  if (!m) return '';
  const n = parseInt(m[1], 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return ` style="background:${f};color:${lum < 140 ? '#fff' : '#111827'}"`;
}

/** Объединения, проверенные по размеру таблицы: первая ячейка → [строк, столбцов]; закрытые ячейки */
export function mergeMap(raw: unknown, rows: number, cols: number): { spans: Map<string, [number, number]>; covered: Set<string> } {
  const spans = new Map<string, [number, number]>();
  const covered = new Set<string>();
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(m)) continue;
    const [r, c] = [Number(m[0]), Number(m[1])];
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < -1 || r >= rows || c < 0 || c >= cols) continue;
    const rs = r < 0 ? 1 : Math.max(1, Math.min(Number(m[2]) || 1, rows - r));
    const cs = Math.max(1, Math.min(Number(m[3]) || 1, cols - c));
    const key = `${r}:${c}`;
    if ((rs === 1 && cs === 1) || covered.has(key) || spans.has(key)) continue;
    // Пересекается с уже объединёнными — пропускаем
    let clash = false;
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (covered.has(`${i}:${j}`) || spans.has(`${i}:${j}`)) clash = true;
    if (clash) continue;
    spans.set(key, [rs, cs]);
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (i !== r || j !== c) covered.add(`${i}:${j}`);
  }
  return { spans, covered };
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
    const { spans, covered } = mergeMap(p.merges, rows.length, cols);
    const cell = (tag: 'th' | 'td', list: Cell[], c: number, extra = '', r = -1) => {
      const at = `${r}:${c}`;
      if (covered.has(at)) return '';
      const sp = spans.get(at);
      if (sp) extra += `${sp[0] > 1 ? ` rowspan="${sp[0]}"` : ''}${sp[1] > 1 ? ` colspan="${sp[1]}"` : ''}`;
      const v = list[c];
      const empty = v === undefined || v === null || !String(v).trim();
      const html = empty ? '' : tag === 'td' && c === badgeCol ? badge(String(v)) : t(v);
      return `<${tag} class="a-${align(c)}"${extra}${ea(list, c)}>${html}</${tag}>`;
    };
    const fills = Array.isArray(p.fills) ? p.fills : [];
    const headFill = (c: number): string => {
      const f = Array.isArray(p.headFills) ? p.headFills[c] : null;
      return typeof f === 'string' ? cellFill(f) : '';
    };
    const fillOf = (r: number, c: number): string => {
      const f = Array.isArray(fills[r]) ? fills[r][c] : null;
      return typeof f === 'string' ? cellFill(f) : '';
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
    return `<div class="tbl r tbl-${variant}${density}${own ? ' tbl-own' : ''}${p.labels ? ' tbl-labels' : ''}${p.lastcol ? ' tbl-lastcol' : ''}${p.bands ? ' tbl-bands' : ''}${p.valign === 'top' || p.valign === 'bottom' ? ` tbl-va-${p.valign}` : ''}${p.total && rows.length > 1 ? ' tbl-total' : ''}${foot ? ' tbl-footed' : ''}"${size || own || p.style ? ` style="${size ? `--ts:${size}px;` : ''}${own}${esc(p.style ?? '')}"` : ''}>`
      + `<table>${colgroup}`
      + (header.length && p.head !== false ? `<thead><tr>${Array.from({ length: cols }, (_x, c) => cell('th', header, c, headFill(c))).join('')}</tr></thead>` : '')
      + `<tbody>${rows.map((r, k) => `<tr${k === p.highlight ? ' class="hl"' : ''} style="--k:${k}">${Array.from({ length: cols }, (_x, c) => cell('td', r, c, fillOf(k, c), k)).join('')}</tr>`).join('')}</tbody>`
      + `</table>${foot}</div>`;
  },
});
