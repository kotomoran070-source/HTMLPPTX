/**
 * Живой ряд (и столбец): свободные объекты слайда с одной меткой row стоят друг за другом
 * с одинаковым промежутком. Ряд раскладывается заново после каждой правки — по настоящим
 * размерам объектов: стал объект шире (или текст выше) — соседи сдвигаются, удалили — промежуток
 * закрывается, перетащили один объект — меняется порядок. Весь ряд двигается, если выделить все его объекты.
 *
 * В данных: у каждого объекта ряда row: { id, gap, dir?: 'col', align?: 'center' }.
 */
import type { Block, Deck } from '../../types';

export interface RowSpec {
  id: string;
  gap: number;
  /** col — столбец (сверху вниз); без поля — ряд (слева направо) */
  dir?: 'col';
  /** center — по центру поперёк ряда; без поля — по верху (у столбца — по левому краю) */
  align?: 'center';
}

interface Member { slide: number; k: number; b: Block; spec: RowSpec }
type Size = { w: number; h: number };

export function rowOf(b: unknown): RowSpec | null {
  const r = (b as Block | null)?.row as RowSpec | undefined;
  return r && typeof r === 'object' && typeof r.id === 'string' && r.id ? r : null;
}

/** Ряды презентации: ключ — слайд и id ряда */
function rows(deck: Deck): Map<string, Member[]> {
  const out = new Map<string, Member[]>();
  deck.slides.forEach((s, slide) => {
    (Array.isArray(s.free) ? s.free as Block[] : []).forEach((b, k) => {
      const spec = rowOf(b);
      if (!spec || !b.place) return;
      const key = `${slide}|${spec.id}`;
      out.set(key, [...(out.get(key) ?? []), { slide, k, b, spec }]);
    });
  });
  return out;
}

const pl = (b: Block) => b.place as { x: number; y: number; w: number; h?: number };

/** Положение рядов до правки: по нему видно, сдвинули ряд целиком или переставили один объект */
export type RowAnchors = Map<string, { pos: number[]; cross: number[] }>;
export function rowAnchors(deck: Deck): RowAnchors {
  const out: RowAnchors = new Map();
  for (const [key, list] of rows(deck)) {
    const col = list[0].spec.dir === 'col';
    out.set(key, {
      pos: list.map((m) => Number(col ? pl(m.b).y : pl(m.b).x)).sort((a, b) => a - b),
      cross: list.map((m) => Number(col ? pl(m.b).x : pl(m.b).y)).sort((a, b) => a - b),
    });
  }
  return out;
}

/** Все сдвинуты на одно и то же — значит, двигали весь ряд */
const shifted = (now: number[], was: number[] | undefined) =>
  !!was && now.length === was.length && now.every((v, i) => Math.abs(v - was[i] - (now[0] - was[0])) < 0.5) && Math.abs(now[0] - was[0]) >= 0.5;

/**
 * Разложить ряды. size — настоящий размер объекта на слайде (null — взять из данных).
 * Меняет deck; true — что-то сдвинулось.
 */
export function layoutRows(deck: Deck, before: RowAnchors, size: (slide: number, k: number) => Size | null): boolean {
  let changed = false;
  for (const [key, list] of rows(deck)) {
    // Ряд из одного объекта — уже не ряд
    if (list.length < 2) {
      for (const m of list) { delete m.b.row; changed = true; }
      continue;
    }
    const spec = list[0].spec;
    const col = spec.dir === 'col';
    const gap = Math.max(0, Math.min(400, Number(spec.gap) || 0));
    const sz = (m: Member): Size => size(m.slide, m.k) ?? { w: Number(pl(m.b).w) || 0, h: Number(pl(m.b).h) || 0 };
    const along = (m: Member) => Number(col ? pl(m.b).y : pl(m.b).x);
    const across = (m: Member) => Number(col ? pl(m.b).x : pl(m.b).y);
    const sorted = [...list].sort((a, b) => along(a) - along(b) || a.k - b.k);
    const was = before.get(key);
    const pos = sorted.map(along);
    const cross = list.map(across).sort((a, b) => a - b);
    // Начало ряда и линия поперёк: прежние, если не двигали весь ряд
    const start = shifted(pos, was?.pos) || !was ? pos[0] : was.pos[0];
    const line = shifted(cross, was?.cross) || !was ? cross[0] : was.cross[0];
    const ext = (m: Member) => (col ? sz(m).w : sz(m).h);
    const big = Math.max(...sorted.map(ext));
    let at = start;
    for (const m of sorted) {
      const s = sz(m);
      const p = pl(m.b);
      const a = Math.round(at);
      const c = Math.round(spec.align === 'center' ? line + (big - ext(m)) / 2 : line);
      const [x, y] = col ? [c, a] : [a, c];
      if (p.x !== x || p.y !== y) {
        p.x = x;
        p.y = y;
        changed = true;
      }
      at += (col ? s.h : s.w) + gap;
    }
  }
  return changed;
}

/** Промежуток между выделенными объектами — средний (если они уже стоят с просветами), иначе 24 */
export function guessGap(items: { x: number; y: number; w: number; h: number }[], col: boolean): number {
  const s = [...items].sort((a, b) => (col ? a.y - b.y : a.x - b.x));
  const gaps = s.slice(1).map((b, i) => (col ? b.y - (s[i].y + s[i].h) : b.x - (s[i].x + s[i].w))).filter((g) => g > 0);
  return gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 24;
}
