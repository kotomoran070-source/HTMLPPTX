/**
 * Равные промежутки при перетаскивании (как «умные направляющие» PowerPoint): объект прилипает туда, где его
 * промежуток до соседа равен промежутку между другими объектами того же ряда — или ровно посередине между
 * двумя соседями; во всех равных промежутках — стрелки (block-edit.ts, drawGuides).
 * Ряд — объекты, которые перекрываются с тянутым поперёк оси (для промежутков по горизонтали — по высоте).
 * Всё в пикселях слайда.
 */

export interface Box { x: number; y: number; w: number; h: number }
/** Стрелка промежутка: вдоль оси — от from до to, поперёк — на линии at */
export interface Gap { axis: 'x' | 'y'; from: number; to: number; at: number }

/** Промежутки, которые считаются равными: позиции округляются до целых пикселей */
const SAME = 0.75;

const axes = (axis: 'x' | 'y') => (axis === 'x'
  ? { lo: (b: Box) => b.x, hi: (b: Box) => b.x + b.w, clo: (b: Box) => b.y, chi: (b: Box) => b.y + b.h, size: (b: Box) => b.w }
  : { lo: (b: Box) => b.y, hi: (b: Box) => b.y + b.h, clo: (b: Box) => b.x, chi: (b: Box) => b.x + b.w, size: (b: Box) => b.h });

/** Промежутки между соседями ряда: между a и b ничего нет, a и b перекрываются поперёк оси */
function gapsOf(row: Box[], axis: 'x' | 'y'): { a: Box; b: Box; g: number }[] {
  const A = axes(axis);
  const cross = (p: Box, q: Box) => Math.min(A.chi(p), A.chi(q)) - Math.max(A.clo(p), A.clo(q)) > 0;
  const out: { a: Box; b: Box; g: number }[] = [];
  for (const a of row) {
    for (const b of row) {
      if (a === b || A.hi(a) > A.lo(b) || !cross(a, b)) continue;
      // В промежутке что-то есть (или заходит в него) — это не соседи
      if (row.some((c) => c !== a && c !== b && A.lo(c) < A.lo(b) && A.hi(c) > A.hi(a))) continue;
      const g = A.lo(b) - A.hi(a);
      if (g > SAME) out.push({ a, b, g });
    }
  }
  return out;
}

const rowOf = (r: Box, others: Box[], axis: 'x' | 'y') => {
  const A = axes(axis);
  return others.filter((o) => Math.min(A.chi(o), A.chi(r)) - Math.max(A.clo(o), A.clo(r)) > 0);
};

/**
 * Сдвиг тянутого объекта r по оси (в пределах snap), при котором его промежуток до соседа равен одному из
 * промежутков ряда или он стоит ровно посередине между соседями. null — такого места рядом нет
 */
export function spacingSnap(r: Box, others: Box[], axis: 'x' | 'y', snap: number): { d: number } | null {
  const A = axes(axis);
  const row = rowOf(r, others, axis);
  if (!row.length) return null;
  const gaps = gapsOf(row, axis).map((x) => x.g);
  // Ближайшие соседи слева и справа (сверху и снизу); касание в пределах snap — ещё сосед
  let left: Box | null = null;
  let right: Box | null = null;
  for (const o of row) {
    if (A.hi(o) <= A.lo(r) + snap && A.lo(o) < A.lo(r) && (!left || A.hi(o) > A.hi(left))) left = o;
    if (A.lo(o) >= A.hi(r) - snap && A.hi(o) > A.hi(r) && (!right || A.lo(o) < A.lo(right))) right = o;
  }
  const at: number[] = [];
  if (left) for (const g of gaps) at.push(A.hi(left) + g);
  if (right) for (const g of gaps) at.push(A.lo(right) - g - A.size(r));
  if (left && right) {
    const mid = (A.hi(left) + A.lo(right) - A.size(r)) / 2;
    if (mid > A.hi(left)) at.push(mid);
  }
  let best: number | null = null;
  for (const p of at) {
    const d = p - A.lo(r);
    if (Math.abs(d) <= snap && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best === null ? null : { d: best };
}

/** Стрелки: промежутки ряда, равные промежутку тянутого объекта до соседа (их хотя бы два) */
export function equalGaps(r: Box, others: Box[], axis: 'x' | 'y'): Gap[] {
  const A = axes(axis);
  const all = [...rowOf(r, others, axis), r];
  const gaps = gapsOf(all, axis);
  const mine = gaps.filter((x) => x.a === r || x.b === r);
  const shown = new Set<(typeof gaps)[number]>();
  for (const m of mine) {
    const same = gaps.filter((x) => Math.abs(x.g - m.g) <= SAME);
    if (same.length > 1) same.forEach((x) => shown.add(x));
  }
  return [...shown].map(({ a, b }) => ({
    axis,
    from: A.hi(a),
    to: A.lo(b),
    // Посередине общей части двух соседей поперёк оси
    at: (Math.max(A.clo(a), A.clo(b)) + Math.min(A.chi(a), A.chi(b))) / 2,
  }));
}
