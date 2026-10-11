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

export interface TableData { header?: unknown[]; rows: unknown[][]; widths?: number[]; align?: string[]; fills?: unknown[][]; headFills?: unknown[]; highlight?: unknown; head?: unknown; merges?: number[][]; borders?: (number | string)[][]; heights?: (number | null)[]; headHeight?: number; total?: unknown }

const mergesOf = (t: TableData | undefined): number[][] => (Array.isArray(t?.merges) ? t!.merges.filter(Array.isArray).map((m) => m.map(Number)) : []);

/**
 * Объединения при вставке (n > 0 строк или столбцов с позиции at) и удалении (n < 0: -n штук с at):
 * ниже — сдвигаются, через место вставки — растут, задетые удалением — уменьшаются
 */
export function shiftMerges(t: TableData, axis: 0 | 1, at: number, n: number): void {
  const merges = shiftRects(mergesOf(t), axis, at, n).filter(([, , rs, cs]) => rs * cs > 1);
  if (merges.length) t.merges = merges;
  else delete t.merges;
  // Границы — те же прямоугольники; высоты строк — вместе со строками
  if (Array.isArray(t.borders)) {
    const b = shiftRects(t.borders.filter(Array.isArray) as (number | string)[][], axis, at, n);
    if (b.length) t.borders = b;
    else delete t.borders;
  }
  if (!axis && Array.isArray(t.heights) && t.heights.length > at) {
    if (n > 0) t.heights.splice(at, 0, ...Array.from({ length: n }, () => null));
    else t.heights.splice(at, -n);
  }
}

/** Прямоугольники [строка, столбец, строк, столбцов, …] при вставке и удалении строк или столбцов */
function shiftRects<T extends (number | string)[]>(list: T[], axis: 0 | 1, at: number, n: number): T[] {
  const out: T[] = [];
  for (const m of list) {
    let [r, c, rs, cs] = m.slice(0, 4).map(Number);
    let s = axis ? c : r;
    let len = axis ? cs : rs;
    if (n > 0) {
      if (s >= at) s += n;
      else if (s + len > at) len += n;
    } else {
      const b = at - n;
      len -= Math.max(0, Math.min(s + len, b) - Math.max(s, at));
      if (s >= b) s += n;
      else if (s >= at) s = at;
      if (len < 1) continue;
    }
    if (axis) { c = s; cs = len; } else { r = s; rs = len; }
    out.push([r, c, rs, cs, ...m.slice(4)] as T);
  }
  return out;
}

/** Объединить ячейки диапазона: текст остальных — в первую (каждый с новой строки), как в PowerPoint */
export function mergeRange(t: TableData, r: CellRange): string | null {
  if (r.r0 === r.r1 && r.c0 === r.c1) return 'Выделите несколько ячеек';
  if (r.r0 < 0 && r.r1 >= 0) return 'Шапку нельзя объединить со строками таблицы';
  const row = (i: number) => (i < 0 ? (t.header ??= []) : t.rows[i]);
  const texts: string[] = [];
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) {
      const v = row(i)?.[j];
      if (v !== undefined && v !== null && String(v).trim()) texts.push(String(v));
      if (row(i) && (i !== r.r0 || j !== r.c0)) row(i)[j] = '';
    }
  }
  row(r.r0)[r.c0] = texts.join('\n');
  t.merges = [...mergesOf(t).filter(([mr, mc, rs, cs]) => mr + rs - 1 < r.r0 || mr > r.r1 || mc + cs - 1 < r.c0 || mc > r.c1), [r.r0, r.c0, r.r1 - r.r0 + 1, r.c1 - r.c0 + 1]];
  return null;
}

/** Разделить объединённые ячейки, задетые диапазоном */
export function splitRange(t: TableData, r: CellRange): boolean {
  const before = mergesOf(t);
  const keep = before.filter(([mr, mc, rs, cs]) => mr + rs - 1 < r.r0 || mr > r.r1 || mc + cs - 1 < r.c0 || mc > r.c1);
  if (keep.length === before.length) return false;
  if (keep.length) t.merges = keep;
  else delete t.merges;
  return true;
}

/**
 * Разбить ячейку на cols × rows, как «Разбиение ячеек» в PowerPoint. Объединённая распадается на свои
 * ячейки; если нужно больше — рядом вставляются столбцы (строки), а ячейки других строк (столбцов)
 * растягиваются через них, так что таблица выглядит как раньше, кроме разбитой ячейки. Ширина ячейки
 * делится поровну. Текст остаётся в первой части
 */
export function splitCell(t: TableData, r: number, c: number, cols: number, rows: number): string | null {
  const all = mergesOf(t);
  const own = all.find(([mr, mc]) => mr === r && mc === c);
  const rs = own?.[2] ?? 1;
  const cs = own?.[3] ?? 1;
  if (r < 0 && rows > 1) return 'Шапку можно разбить только на столбцы';
  t.merges = all.filter((m) => m !== own);
  const addC = Math.max(0, cols - cs);
  const addR = Math.max(0, rows - rs);
  const top = Array.isArray(t.header) ? -1 : 0;
  if (addC) {
    const at = c + cs;
    const n = colCount(t);
    // Ширина: столбцы ячейки делятся поровну на прежнюю ширину
    const widths = Array.isArray(t.widths) && t.widths.length === n ? t.widths.map(Number) : Array.from({ length: n }, () => 1);
    const w = widths.slice(c, at).reduce((x, y) => x + y, 0) / (cs + addC);
    widths.splice(c, cs, ...Array.from({ length: cs + addC }, () => Math.round(w * 100) / 100));
    t.widths = widths;
    t.header?.splice(at, 0, ...Array.from({ length: addC }, () => ''));
    t.rows.forEach((row) => { while (row.length < n) row.push(''); row.splice(at, 0, ...Array.from({ length: addC }, () => '')); });
    if (Array.isArray(t.align)) t.align.splice(at, 0, ...Array.from({ length: addC }, () => t.align![at - 1] ?? ''));
    for (const list of [t.headFills, ...(Array.isArray(t.fills) ? t.fills : [])]) if (Array.isArray(list) && list.length > at) list.splice(at, 0, ...Array.from({ length: addC }, () => null));
    shiftMerges(t, 1, at, addC);
    // Другие строки: ячейка у места вставки растягивается на новые столбцы
    const ms = mergesOf(t);
    for (let rr = top; rr < t.rows.length; rr++) {
      if (rr >= r && rr < r + rs) continue;
      const cover = ms.find(([mr, mc, mrs, mcs]) => rr >= mr && rr < mr + mrs && at - 1 >= mc && at - 1 < mc + mcs);
      if (cover) { if (cover[0] === rr && cover[1] + cover[3] === at) cover[3] += addC; }
      else ms.push([rr, at - 1, 1, 1 + addC]);
    }
    t.merges = ms;
  }
  if (addR) {
    const at = r + rs;
    const n = colCount(t);
    t.rows.splice(at, 0, ...Array.from({ length: addR }, () => Array.from({ length: n }, () => '')));
    if (Array.isArray(t.fills) && t.fills.length > at) t.fills.splice(at, 0, ...Array.from({ length: addR }, () => []));
    shiftMerges(t, 0, at, addR);
    // Другие столбцы: ячейка над местом вставки растягивается на новые строки
    const ms = mergesOf(t);
    const c1 = c + Math.max(cs, cols);
    for (let cc = 0; cc < n; cc++) {
      if (cc >= c && cc < c1) continue;
      const cover = ms.find(([mr, mc, mrs, mcs]) => at - 1 >= mr && at - 1 < mr + mrs && cc >= mc && cc < mc + mcs);
      if (cover) { if (cover[1] === cc && cover[0] + cover[2] === at) cover[2] += addR; }
      else ms.push([at - 1, cc, 1 + addR, 1]);
    }
    t.merges = ms;
  }
  const keep = mergesOf(t).filter(([, , a, b]) => a * b > 1);
  if (keep.length) t.merges = keep;
  else delete t.merges;
  return null;
}

/** Размер ячейки: [строк, столбцов] (объединённая — её размах) */
export function cellSpan(t: TableData | undefined, r: number, c: number): [number, number] {
  const m = mergesOf(t).find(([mr, mc]) => mr === r && mc === c);
  return m ? [m[2], m[3]] : [1, 1];
}

/** Число из ячейки: «1 234,5 ₽», «12 %», «−3» — для сортировки; не число — null */
function numberOf(v: unknown): number | null {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[\s\u00a0]/g, '').replace(/[−–]/g, '-').replace(',', '.').replace(/[^\d.+-]+$/g, '').replace(/^[^\d.+-]+/, '');
  return s && /^[+-]?\d*\.?\d+$/.test(s) ? Number(s) : null;
}

/**
 * Сортировать строки по столбцу c: числа — по значению, текст — по алфавиту (числа раньше текста,
 * пустые — в конце). Шапка и строка итогов остаются на месте; заливка, высота и выделенная строка —
 * вместе со строками. С объединёнными ячейками в строках — нельзя (ошибка)
 */
export function sortRows(t: TableData, c: number, desc: boolean): string | null {
  if (mergesOf(t).some(([r]) => r >= 0)) return 'Сначала разделите объединённые ячейки — с ними строки не переставить';
  const n = t.rows.length - (t.total && t.rows.length > 1 ? 1 : 0);
  if (n < 2) return null;
  const idx = Array.from({ length: n }, (_, k) => k);
  const key = (k: number) => t.rows[k]?.[c];
  const empty = (v: unknown) => v === undefined || v === null || !String(v).trim();
  idx.sort((a, b) => {
    const va = key(a);
    const vb = key(b);
    if (empty(va) || empty(vb)) return empty(va) === empty(vb) ? a - b : empty(va) ? 1 : -1;
    const na = numberOf(va);
    const nb = numberOf(vb);
    let d: number;
    if (na !== null && nb !== null) d = na - nb;
    else if (na !== null || nb !== null) d = na !== null ? -1 : 1;
    else d = String(va).localeCompare(String(vb), 'ru', { numeric: true, sensitivity: 'base' });
    return (desc ? -d : d) || a - b;
  });
  const reorder = <X>(list: X[] | undefined) => { if (Array.isArray(list)) { const head = idx.map((k) => list[k]); list.splice(0, n, ...head); } };
  reorder(t.rows);
  reorder(t.fills);
  reorder(t.heights);
  const hl = Number(t.highlight);
  if (Number.isInteger(t.highlight) && hl < n) t.highlight = idx.indexOf(hl);
  return null;
}

/** Есть ли объединённые ячейки в диапазоне */
export function hasMerge(t: TableData | undefined, r: CellRange): boolean {
  return mergesOf(t).some(([mr, mc, rs, cs]) => !(mr + rs - 1 < r.r0 || mr > r.r1 || mc + cs - 1 < r.c0 || mc > r.c1));
}

/** Диапазон с объединёнными ячейками целиком (как выделение в PowerPoint) */
export function expandRange(t: TableData | undefined, r: CellRange): CellRange {
  const out = { ...r };
  for (let changed = true; changed;) {
    changed = false;
    for (const [mr, mc, rs, cs] of mergesOf(t)) {
      if (mr + rs - 1 < out.r0 || mr > out.r1 || mc + cs - 1 < out.c0 || mc > out.c1) continue;
      const next = { r0: Math.min(out.r0, mr), r1: Math.max(out.r1, mr + rs - 1), c0: Math.min(out.c0, mc), c1: Math.max(out.c1, mc + cs - 1) };
      if (next.r0 !== out.r0 || next.r1 !== out.r1 || next.c0 !== out.c0 || next.c1 !== out.c1) { Object.assign(out, next); changed = true; }
    }
  }
  return out;
}

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
    shiftMerges(t, 0, from, -n);
    const hl = Number(t.highlight);
    if (Number.isInteger(t.highlight)) {
      if (hl >= from && hl < from + n) delete t.highlight;
      else if (hl >= from + n) t.highlight = hl - n;
    }
  }
  if (r0 < 0 && t.rows.length > 1) {
    // Объединения шапки уходят вместе с ней; первой строки — становятся объединениями шапки (если в одну строку)
    const ms = mergesOf(t).filter((m) => m[0] >= 0 && !(m[0] === 0 && m[2] > 1)).map(([r, c, rs, cs]) => [r - 1, c, rs, cs]);
    if (ms.length) t.merges = ms;
    else delete t.merges;
    t.header = t.rows.shift();
    // Высота и границы — вместе со строкой, ставшей шапкой
    const hh = Array.isArray(t.heights) ? t.heights.shift() : undefined;
    if (hh) t.headHeight = hh;
    else delete t.headHeight;
    if (Array.isArray(t.borders)) {
      const b = shiftRects(t.borders.filter(Array.isArray) as (number | string)[][], 0, -1, -1);
      if (b.length) t.borders = b;
      else delete t.borders;
    }
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
  shiftMerges(t, 1, c0, -n);
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
  /** Выделение ячеек поменялось — обновить ленту */
  refresh?(): void;
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
    // Ячейки по их месту в данных: объединённая подсвечена, если задета диапазоном
    const R = range;
    el.querySelectorAll<HTMLTableCellElement>('td[data-edit], th[data-edit]').forEach((td) => {
      const at = cellOf(td);
      if (!at) return;
      const r1 = at.r + Math.max(1, td.rowSpan) - 1;
      const c1 = at.c + Math.max(1, td.colSpan) - 1;
      if (r1 >= R.r0 && at.r <= R.r1 && c1 >= R.c0 && at.c <= R.c1) td.classList.add('tbl-csel');
    });
  };
  const set = (a: At, b: At) => {
    anchor = a;
    head = b;
    range = expandRange(data(a.table), { table: a.table, r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) });
    paint();
    h.refresh?.();
  };
  const select = (r: CellRange | null) => {
    range = r;
    if (r) { anchor = { table: r.table, r: r.r0, c: r.c0 }; head = { table: r.table, r: r.r1, c: r.c1 }; }
    paint();
    h.refresh?.();
  };
  const clear = () => {
    if (!range) return;
    range = null;
    paint();
    h.refresh?.();
  };

  // ---------------- мышь ----------------
  let swallow = false;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !h.stage().contains(e.target as Node)) return;
    const at = cellOf(e.target as Element);
    if (!at) return clear();
    const ed = h.editor();
    // Таблица ещё не выделена: щелчок выделит её; ячейка запоминается — команды ленты работают с ней
    if (!selected(at.table)) {
      anchor = at;
      head = at;
      return clear();
    }
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
    // Ячейка с курсором поменялась — кнопки ленты («Разделить», вставка) — по ней
    h.refresh?.();
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
    // Backspace — очистить ячейки. Delete — строки или столбцы целиком удалить вместе с содержимым
    // (вся таблица — таблицу); часть ячеек — очистить
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
      stop();
      if (e.key === 'Backspace') return clearCells();
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

