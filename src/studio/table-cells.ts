/**
 * Ячейки таблицы, как в PowerPoint. В выделенной таблице: протянуть мышью по ячейкам или
 * Shift+щелчок — диапазон (подсвечен), Shift+стрелки — расширить, стрелки — по ячейкам, Enter — правка.
 * С диапазоном: Delete — очистить, Ctrl+C / Ctrl+X — скопировать (табуляцией, как из Excel),
 * Ctrl+V — вставить таблицу из Excel или PowerPoint с левой верхней ячейки (и в правке ячейки,
 * если в буфере таблица). Вставка и удаление строк и столбцов, заливка, выравнивание — для всего
 * диапазона (context-tabs). Таблица двигается за край (полоса у рамки) или первым нажатием.
 */
import { getAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Deck } from '../types';

/** Диапазон ячеек: r = -1 — шапка */
export interface CellRange { table: string; r0: number; r1: number; c0: number; c1: number }
export interface At { table: string; r: number; c: number }

export interface TableData { header?: unknown[]; rows: unknown[][]; widths?: number[]; align?: string[]; fills?: unknown[][]; headFills?: unknown[]; highlight?: unknown; head?: unknown }

let range: CellRange | null = null;
let painter: (() => void) | null = null;

/** Подсветить выделенные ячейки заново (после перерисовки слайда) */
export function paintCells(): void {
  painter?.();
}
let anchor: At | null = null;
/** Второй конец диапазона: от него ходят Shift+стрелки */
let head: At | null = null;

/** Выделенный диапазон ячеек */
export function cellRange(): CellRange | null {
  return range;
}

/** Ячейка, с которой начали (щелчок, начало протягивания) */
export function cellAnchor(): At | null {
  return anchor;
}

/** Ячейка по элементу: путь таблицы, строка (-1 — шапка) и столбец */
export function cellOf(el: Element | null): At | null {
  const td = el?.closest('td[data-edit], th[data-edit]');
  const box = td?.closest('[data-type="table"][data-block]');
  if (!td || !box) return null;
  try {
    const p = JSON.parse(td.getAttribute('data-edit')!) as Path;
    const inHead = p[p.length - 2] === 'header';
    return { table: box.getAttribute('data-block')!, r: inHead ? -1 : Number(p[p.length - 2]), c: Number(p[p.length - 1]) };
  } catch {
    return null;
  }
}

export const colCount = (t: { header?: unknown[]; rows: unknown[][] }) => Math.max(t.header?.length ?? 0, ...t.rows.map((r) => (Array.isArray(r) ? r.length : 0)), 1);

/** Столбцы до n: шапка, строки, ширины и выравнивание растут вместе */
export function growCols(t: TableData, n: number): void {
  const have = colCount(t);
  for (let c = have; c < n; c++) {
    if (Array.isArray(t.header)) t.header.push('Столбец');
    if (Array.isArray(t.widths)) t.widths.push(Math.round((t.widths.reduce((a, b) => a + Number(b), 0) / t.widths.length) * 100) / 100);
    if (Array.isArray(t.align)) t.align.push('');
  }
  t.rows.forEach((r) => { while (r.length < n) r.push(''); });
}

/**
 * Удалить строки r0…r1 (-1 — шапка): заливка и выделенная строка сдвигаются вместе. Удалили шапку —
 * шапкой становится следующая строка (в PowerPoint шапка — просто первая строка). Одна строка остаётся всегда
 */
export function dropRows(t: TableData, r0: number, r1: number): void {
  const from = Math.max(0, r0);
  const n = r1 >= from ? r1 - from + 1 : 0;
  if (n) {
    t.rows.splice(from, n);
    if (Array.isArray(t.fills)) t.fills.splice(from, n);
    const hl = Number(t.highlight);
    if (Number.isInteger(t.highlight)) {
      if (hl >= from && hl < from + n) delete t.highlight;
      else if (hl >= from + n) t.highlight = hl - n;
    }
  }
  if (r0 < 0 && t.rows.length > 1) {
    t.header = t.rows.shift();
    const f = Array.isArray(t.fills) ? t.fills.shift() : undefined;
    if (Array.isArray(f)) t.headFills = f;
    else delete t.headFills;
    if (Number.isInteger(t.highlight)) t.highlight = Number(t.highlight) - 1 >= 0 ? Number(t.highlight) - 1 : undefined;
  }
  if (!t.rows.length) t.rows.push(Array.from({ length: colCount(t) }, () => ''));
}

/** Удалить столбцы c0…c1 вместе с ширинами, выравниванием и заливкой. Один столбец остаётся всегда */
export function dropCols(t: TableData, c0: number, c1: number): void {
  const n = Math.min(c1 - c0 + 1, colCount(t) - 1);
  if (n < 1) return;
  t.header?.splice(c0, n);
  t.rows.forEach((r) => r.splice(c0, n));
  for (const list of [t.widths, t.align, t.headFills, ...(Array.isArray(t.fills) ? t.fills : [])]) if (Array.isArray(list)) list.splice(c0, n);
}

/** Текст из буфера → ячейки: табуляции и строки, как копирует Excel (с кавычками у многострочных) */
export function parseGrid(text: string): string[][] {
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [[]];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && cell === '') {
      // Ячейка в кавычках: внутри могут быть переносы и табуляции, "" — сама кавычка
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

/** Ячейки → текст для буфера: табуляции и строки; ячейка с переносом — в кавычках */
export function gridText(grid: string[][]): string {
  const q = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return grid.map((r) => r.map(q).join('\t')).join('\n');
}

export interface CellsHost {
  deck(): Deck;
  editor(): Editor;
  stage(): HTMLElement;
}

export function tableCells(h: CellsHost): { paint(): void; select(r: CellRange | null): void } {
  const box = (table: string) => h.stage().querySelector<HTMLElement>(`.slide.on [data-type="table"][data-block="${CSS.escape(table)}"]`);
  const data = (table: string) => getAt(h.deck(), JSON.parse(table) as Path) as TableData | undefined;
  const selected = (table: string) => {
    const ed = h.editor();
    const editing = ed.editingField;
    return JSON.stringify(ed.selection?.block) === table || (!!editing && !!box(table)?.contains(editing));
  };

  const paint = () => {
    h.stage().querySelectorAll('.tbl-csel').forEach((x) => x.classList.remove('tbl-csel'));
    if (!range) return;
    const el = box(range.table);
    const t = data(range.table);
    if (!el || !t || !selected(range.table)) { range = null; return; }
    const table = el.querySelector('table');
    if (!table) return;
    const hasHead = !!table.tHead;
    [...table.rows].forEach((tr, k) => {
      const r = hasHead ? k - 1 : k;
      if (r < range!.r0 || r > range!.r1) return;
      [...tr.cells].forEach((td, c) => { if (c >= range!.c0 && c <= range!.c1) td.classList.add('tbl-csel'); });
    });
  };
  const set = (a: At, b: At) => {
    anchor = a;
    head = b;
    range = { table: a.table, r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
    paint();
  };
  const select = (r: CellRange | null) => {
    range = r;
    if (r) { anchor = { table: r.table, r: r.r0, c: r.c0 }; head = { table: r.table, r: r.r1, c: r.c1 }; }
    paint();
  };
  const clear = () => {
    if (!range) return;
    range = null;
    paint();
  };

  // ---------------- мышь ----------------
  let swallow = false;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !h.stage().contains(e.target as Node)) return;
    const at = cellOf(e.target as Element);
    if (!at) return clear();
    const ed = h.editor();
    if (!selected(at.table)) return clear();
    // Край таблицы — перемещение, как у любого объекта
    const r = box(at.table)!.getBoundingClientRect();
    const edge = 7;
    if (e.clientX - r.left < edge || r.right - e.clientX < edge || e.clientY - r.top < edge || r.bottom - e.clientY < edge) return clear();
    e.stopPropagation();
    const editingHere = ed.editingField?.contains(e.target as Node);
    // Не в правке — без выделения текста страницы; в правке своей ячейки — обычный курсор
    if (!editingHere) e.preventDefault();
    // Щелчок после протягивания приходит сразу за отпусканием; не пришёл — флажок не ждёт следующего
    const settle = () => {
      removeEventListener('pointerup', settle);
      setTimeout(() => { swallow = false; }, 0);
    };
    addEventListener('pointerup', settle);
    if (e.shiftKey && anchor?.table === at.table) {
      ed.finishText();
      getSelection()?.removeAllRanges();
      set(anchor, at);
      swallow = true;
      return;
    }
    anchor = at;
    head = at;
    clear();
    const move = (ev: PointerEvent) => {
      const to = cellOf(document.elementFromPoint(ev.clientX, ev.clientY));
      if (!to || to.table !== at.table || (!range && to.r === at.r && to.c === at.c)) return;
      if (!range) ed.finishText();
      getSelection()?.removeAllRanges();
      set(at, to);
      swallow = true;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }, true);
  // Протянули по ячейкам — щелчок в конце не начинает правку текста
  document.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // ---------------- данные ----------------
  const commit = (fn: (t: TableData) => void) => {
    if (!range) return;
    const p = JSON.parse(range.table) as Path;
    h.editor().commit((d) => {
      const t = getAt(d, p) as TableData;
      if (!t) return;
      t.rows = Array.isArray(t.rows) ? t.rows : [];
      fn(t);
    }, { rebuild: true });
  };
  const each = (fn: (r: number, c: number) => void) => {
    for (let r = range!.r0; r <= range!.r1; r++) for (let c = range!.c0; c <= range!.c1; c++) fn(r, c);
  };
  const clearCells = () => commit((t) => each((r, c) => {
    const row = r < 0 ? t.header : t.rows[r];
    if (Array.isArray(row) && c < row.length) row[c] = '';
  }));
  const copyText = (): string => {
    const t = range && data(range.table);
    if (!t) return '';
    const grid: string[][] = [];
    for (let r = range!.r0; r <= range!.r1; r++) {
      const row = (r < 0 ? t.header : t.rows[r]) ?? [];
      const out: string[] = [];
      for (let c = range!.c0; c <= range!.c1; c++) out.push(row[c] === undefined || row[c] === null ? '' : String(row[c]));
      grid.push(out);
    }
    return gridText(grid);
  };
  const paste = (at: At, grid: string[][]) => {
    const width = Math.max(...grid.map((r) => r.length));
    range = { table: at.table, r0: at.r, r1: at.r, c0: at.c, c1: at.c };
    commit((t) => {
      growCols(t, at.c + width);
      const n = colCount(t);
      grid.forEach((cells, i) => {
        const r = at.r + i;
        let row: unknown[];
        if (r < 0) row = Array.isArray(t.header) ? t.header : (t.header = Array.from({ length: n }, () => ''));
        else {
          while (t.rows.length <= r) t.rows.push(Array.from({ length: n }, () => ''));
          row = t.rows[r];
        }
        cells.forEach((v, j) => { row[at.c + j] = v; });
      });
    });
    set(at, { table: at.table, r: at.r + grid.length - 1, c: at.c + width - 1 });
    h.editor().toast(`Вставлено ячеек: ${grid.length} × ${width}. Отменить — Ctrl+Z`, 2400);
  };

  // ---------------- клавиши и буфер ----------------
  document.addEventListener('keydown', (e) => {
    if (!range || h.editor().editingField) return;
    const t = data(range.table);
    if (!t) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const rows = t.rows.length;
    const cols = colCount(t);
    const top = Array.isArray(t.header) && box(range.table)?.querySelector('thead') ? -1 : 0;
    if (e.key === 'Escape') { stop(); return clear(); }
    // Выделены строки или столбцы целиком — Delete и Backspace их удаляют (вся таблица — таблицу),
    // часть ячеек — очищают, как в PowerPoint
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
      stop();
      const r = range;
      const wide = r.c0 === 0 && r.c1 === cols - 1;
      const tall = r.r0 <= top && r.r1 === rows - 1;
      if (wide && tall) { range = null; return h.editor().blockEditor.remove(); }
      if (wide) { commit((x) => dropRows(x, r.r0, r.r1)); range = null; return paint(); }
      if (tall) { commit((x) => dropCols(x, r.c0, r.c1)); range = null; return paint(); }
      return clearCells();
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      stop();
      const a = anchor ?? { table: range.table, r: range.r0, c: range.c0 };
      const cell = box(range.table)?.querySelector<HTMLElement>(`[data-edit="${CSS.escape(JSON.stringify([...(JSON.parse(range.table) as Path), ...(a.r < 0 ? ['header'] : ['rows', a.r]), a.c]))}"]`);
      clear();
      if (cell) h.editor().editField(cell, { keep: true, selectAll: true });
      return;
    }
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (d && !e.ctrlKey && !e.metaKey && !e.altKey) {
      stop();
      const from = e.shiftKey ? head ?? anchor! : anchor!;
      const to = { table: range.table, r: Math.max(top, Math.min(rows - 1, from.r + d[0])), c: Math.max(0, Math.min(cols - 1, from.c + d[1])) };
      if (e.shiftKey) set(anchor!, to);
      else set(to, to);
    }
  }, true);
  document.addEventListener('copy', (e) => {
    if (!range || h.editor().editingField || getSelection()?.toString()) return;
    e.clipboardData?.setData('text/plain', copyText());
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('cut', (e) => {
    if (!range || h.editor().editingField) return;
    e.clipboardData?.setData('text/plain', copyText());
    e.preventDefault();
    e.stopImmediatePropagation();
    clearCells();
  }, true);
  document.addEventListener('paste', (e) => {
    const ed = h.editor();
    const editing = ed.editingField;
    const at = editing ? cellOf(editing) : range ? { table: range.table, r: range.r0, c: range.c0 } : null;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!at || !text) return;
    // В правке ячейки обычный текст вставляется в неё; таблица (с табуляциями) — по ячейкам
    if (editing && !text.includes('\t')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (editing) ed.finishText();
    paste(at, parseGrid(text));
  }, true);

  painter = paint;
  return { paint, select };
}

