/**
 * Таблица из Excel, Google Таблиц, Word или со страницы — таблицей Slideria (как PowerPoint вставляет диапазон
 * Excel). Источник — HTML буфера (<table> со стилями) или, если его нет, текст с табуляциями.
 *   theme  — «Использовать тему»: ячейки, объединения, ширины столбцов, жирный; вид — стиль таблицы темы;
 *   source — «Сохранить исходное форматирование»: ещё заливка ячеек, цвет текста и выравнивание — так, чтобы
 *            текст читался (на заливке — контрастный ей, без заливки — по правилам текста, paste-html.ts paintOf);
 *            белая заливка «по умолчанию» не переносится — в тёмной теме она бы светилась пятнами.
 * Шрифты и размеры ячеек не переносятся: у таблицы свой размер текста, иначе она не помещается на слайд.
 */
import { contrast, hexOf, lum, paintOf, prop, styleOf } from './paste-html';
import { escapeText } from './serialize';

export interface PastedTable {
  type: 'table';
  header: string[];
  rows: string[][];
  widths?: number[];
  merges?: number[][];
  fills?: (string | null)[][];
  headFills?: (string | null)[];
  cellStyles?: (Record<string, unknown> | null)[][];
  headStyles?: (Record<string, unknown> | null)[];
}

interface Cell { text: string; bold?: boolean; color?: string; fill?: string; align?: string }

/** Не больше: таблица на слайде, а не лист Excel */
const MAX_ROWS = 60;
const MAX_COLS = 20;

/** Ячейки из текста с табуляциями (Excel без HTML, своя таблица Slideria): кавычки — ячейка с переносами */
export function parseGrid(text: string): string[][] {
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [[]];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && cell === '') {
      let j = i + 1;
      let v = '';
      for (; j < s.length; j++) {
        if (s[j] === '"' && s[j + 1] === '"') { v += '"'; j++; } else if (s[j] === '"') break;
        else v += s[j];
      }
      if (j < s.length && (s[j + 1] === undefined || s[j + 1] === '\t' || s[j + 1] === '\n')) { cell = v; i = j; continue; }
    }
    if (ch === '\t') { rows[rows.length - 1].push(cell); cell = ''; }
    else if (ch === '\n') { rows[rows.length - 1].push(cell); cell = ''; rows.push([]); }
    else cell += ch;
  }
  rows[rows.length - 1].push(cell);
  return rows;
}

/** Текст с табуляциями — таблица (не меньше двух строк и двух столбцов); иначе пусто */
export function gridOf(text: string): string[][] {
  const grid = text.includes('\t') ? parseGrid(text.replace(/\n+$/, '')) : [];
  return grid.length > 1 && grid[0].length > 1 ? grid : [];
}

/** Заливка ячейки: background-color или первый цвет background; прозрачная и белая «по умолчанию» — нет */
function fillOf(style: string): string | undefined {
  const v = prop(style, 'background-color') ?? prop(style, 'background');
  if (!v) return undefined;
  const tok = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b[a-z]+\b/i.exec(v)?.[0];
  const hex = tok ? hexOf(tok) : null;
  if (!hex || lum(hex) > 0.92) return undefined;
  return hex;
}

/** Цвет текста ячейки при «исходном»: на заливке — свой, если читается, иначе чёрный или белый по заливке */
function textOn(color: string | undefined, fill: string | undefined): string | undefined {
  if (!fill) return paintOf(color);
  const lf = lum(fill);
  const hex = color ? hexOf(color) : null;
  if (hex && contrast(lum(hex), lf) >= 3) return hex;
  return contrast(lum('#111827'), lf) >= contrast(1, lf) ? '#111827' : '#ffffff';
}

/** Ячейки из <table> буфера: текст, жирный, цвет, заливка, выравнивание; объединения и ширины столбцов */
function fromHtml(html: string): { cells: Cell[][]; merges: number[][]; widths?: number[] } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const css = styleOf(doc);
  const cells: Cell[][] = [];
  const merges: number[][] = [];
  const taken = new Set<string>();
  [...table.rows].slice(0, MAX_ROWS).forEach((tr, r) => {
    cells[r] ??= [];
    let c = 0;
    for (const td of [...tr.cells]) {
      while (taken.has(`${r},${c}`)) c++;
      if (c >= MAX_COLS) break;
      const rs = Math.max(1, Math.min(MAX_ROWS - r, Number(td.getAttribute('rowspan')) || 1));
      const cs = Math.max(1, Math.min(MAX_COLS - c, Number(td.getAttribute('colspan')) || 1));
      const style = [css(tr), css(td)].join(';');
      // Жирный, цвет — у ячейки или у единственного её содержимого (<b>, <font>, <span>)
      const inner = td.querySelectorAll('*');
      const deep = [...inner].map((x) => css(x)).join(';');
      const weight = prop(`${style};${deep}`, 'font-weight');
      const bold = td.tagName === 'TH' || !!td.querySelector('b, strong') || (weight ? /bold|[6-9]00/.test(weight) : false);
      const color = prop(`${style};${deep}`, 'color') ?? undefined;
      const align = prop(style, 'text-align') ?? td.getAttribute('align') ?? undefined;
      // Переносы внутри ячейки (Excel: <br style="mso-data-placement:same-cell">) — строками
      const clone = td.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
      clone.querySelectorAll('style, script').forEach((x) => x.remove());
      const text = (clone.textContent ?? '').split('\n').map((l) => l.replace(/[ \t\r\f ]+/g, ' ').trim()).filter((l, i, a) => l || i < a.length - 1).join('\n').trim();
      cells[r][c] = { text, bold, color, fill: fillOf(style), align: align && /^(left|center|right)$/i.test(align) ? align.toLowerCase() : undefined };
      for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) if (y !== r || x !== c) taken.add(`${y},${x}`);
      if (rs > 1 || cs > 1) merges.push([r, c, rs, cs]);
      c += cs;
    }
  });
  if (!cells.length) return null;
  const n = Math.max(...cells.map((row) => row.length));
  if (n < 1) return null;
  for (const row of cells) for (let c = 0; c < n; c++) row[c] ??= { text: '' };
  // Ширины: <col width> (Excel) или ширины ячеек первой строки
  const cols = [...table.querySelectorAll('col')].flatMap((col) => Array.from({ length: Number(col.getAttribute('span')) || 1 }, () => Number(col.getAttribute('width')) || 0));
  const first = [...(table.rows[0]?.cells ?? [])].map((td) => Number(td.getAttribute('width')) || 0);
  const w = cols.length === n && cols.every((x) => x > 0) ? cols : first.length === n && first.every((x) => x > 0) ? first : undefined;
  return { cells, merges, widths: w };
}

/**
 * Таблица вставки или null (в буфере не таблица). Первая строка — шапка. html — с <table> (Excel, Google Таблицы,
 * Word, сайт); нет его — текст с табуляциями
 */
export function pasteTable(html: string, plain: string, mode: 'theme' | 'source'): PastedTable | null {
  let parsed = html.trim() && /<table[\s>]/i.test(html) ? fromHtml(html) : null;
  if (!parsed) {
    const grid = gridOf(plain);
    if (!grid.length) return null;
    const n = Math.min(MAX_COLS, Math.max(...grid.map((r) => r.length)));
    parsed = { cells: grid.slice(0, MAX_ROWS).map((r) => Array.from({ length: n }, (_x, c) => ({ text: (r[c] ?? '').trim() }))), merges: [] };
  }
  const { cells, merges, widths } = parsed;
  // Одна строка или один столбец — не таблица (так копируют и обычный текст из таблиц сайтов)
  if (cells.length < 2 || cells[0].length < 2) return null;
  const text = (c: Cell) => c.text.split('\n').map(escapeText).join('\n');
  const out: PastedTable = { type: 'table', header: cells[0].map(text), rows: cells.slice(1).map((r) => r.map(text)) };
  if (widths) out.widths = widths.map((x) => Math.round(x));
  // Объединения: строка 0 — шапка (у нас -1, только по ширине), остальные — со сдвигом на шапку
  const mg = merges.filter(([r, , rs]) => r > 0 || rs === 1).map(([r, c, rs, cs]) => (r === 0 ? [-1, c, 1, cs] : [r - 1, c, rs, cs]));
  if (mg.length) out.merges = mg;
  const style = (c: Cell, head: boolean): Record<string, unknown> | null => {
    const st: Record<string, unknown> = {};
    // Жирный — как структура и при «теме» (у шапки он свой)
    if (c.bold && !head) st.weight = 700;
    if (mode === 'source') {
      const color = textOn(c.color, c.fill);
      if (color) st.color = color;
      if (c.align) st.align = c.align;
      if (c.bold && head) st.weight = 700;
    }
    return Object.keys(st).length ? st : null;
  };
  const head = cells[0].map((c) => style(c, true));
  const body = cells.slice(1).map((r) => r.map((c) => style(c, false)));
  if (head.some(Boolean)) out.headStyles = head;
  if (body.some((r) => r.some(Boolean))) out.cellStyles = body;
  if (mode === 'source') {
    const hf = cells[0].map((c) => c.fill ?? null);
    const bf = cells.slice(1).map((r) => r.map((c) => c.fill ?? null));
    if (hf.some(Boolean)) out.headFills = hf;
    if (bf.some((r) => r.some(Boolean))) out.fills = bf;
  }
  return out;
}

/** «Только текст» у таблицы: строки, ячейки — через широкий пробел (обычный схлопнулся бы) */
export function tableText(t: PastedTable): string {
  return [t.header, ...t.rows].map((r) => r.join(' ')).join('\n');
}
