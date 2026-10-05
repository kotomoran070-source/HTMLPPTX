/**
 * «Привести в порядок»: находит почти одинаковые значения, которые должны совпадать, — и только их.
 * Правила, чтобы не сломать задуманное:
 * - размеры и положения сравниваются между разными слайдами (на одном слайде разница — это иерархия);
 * - правка — только к значению, которое встречается чаще всех (явное большинство), и только если
 *   отличие маленькое (38 → 40, но не 28 → 40);
 * - обложка и последний слайд, закреплённые объекты не трогаются;
 * - цвета — только неотличимые на глаз (#1F2937 / #1F2938).
 * Найденное показывается списком с галочками, применяется одним действием (Ctrl+Z — как было).
 */
import type { Deck } from '../types';

export interface Fix {
  id: string;
  what: string;
  from: string;
  to: string;
  slides: number[];
  apply(d: Deck): void;
}

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);

interface Sample<T> { value: T; slide: number; set(d: Deck, v: T): void }

/** Значение большинства и отклонения от него в пределах допуска; нет явного большинства — ничего */
function outliers<T extends number | string>(list: Sample<T>[], close: (a: T, b: T) => boolean): { to: T; off: Sample<T>[] }[] {
  const count = new Map<T, number>();
  for (const s of list) count.set(s.value, (count.get(s.value) ?? 0) + 1);
  const ranked = [...count].sort((a, b) => b[1] - a[1]);
  const out: { to: T; off: Sample<T>[] }[] = [];
  const used = new Set<T>();
  for (const [mode, n] of ranked) {
    if (used.has(mode) || n < 2) continue;
    const near = ranked.filter(([v]) => v !== mode && !used.has(v) && close(v, mode));
    // Явное большинство: у близкого значения встречаемость меньше
    const off = near.filter(([, c]) => c < n);
    if (!off.length) continue;
    used.add(mode);
    off.forEach(([v]) => used.add(v));
    out.push({ to: mode, off: list.filter((s) => off.some(([v]) => v === s.value)) });
  }
  return out;
}

/** Свободные объекты слайдов (без закреплённых и без растянутых на весь слайд) */
function freeObjects(deck: Deck): { slide: number; k: number; o: Obj; x: number; y: number }[] {
  const out: { slide: number; k: number; o: Obj; x: number; y: number }[] = [];
  deck.slides.forEach((s, slide) => {
    (Array.isArray(s.free) ? s.free : []).forEach((b, k) => {
      const o = obj(b);
      const place = obj(o?.place);
      const x = num(place?.x);
      const y = num(place?.y);
      if (!o || x === null || y === null || o.locked === true) return;
      if (x <= 4 && (num(place?.w) ?? 0) >= 1200) return;
      out.push({ slide, k, o, x, y });
    });
  });
  return out;
}

const textSize = (o: Obj) => num(obj(obj(o.styles)?.text)?.size);

/** Заголовок слайда-холста: самый верхний крупный текст в верхней части слайда */
function headings(deck: Deck): { slide: number; k: number; o: Obj; x: number; y: number }[] {
  const by = new Map<number, { slide: number; k: number; o: Obj; x: number; y: number }>();
  const last = deck.slides.length - 1;
  for (const f of freeObjects(deck)) {
    // Обложка и финал свёрстаны иначе — их заголовки не сравниваются
    if (f.slide === 0 || f.slide === last) continue;
    if (f.o.type !== 'text' || f.y > 160 || (textSize(f.o) ?? 0) < 24) continue;
    const cur = by.get(f.slide);
    if (!cur || f.y < cur.y) by.set(f.slide, f);
  }
  return [...by.values()];
}

const placeAt = (d: Deck, slide: number, k: number) => obj(obj((d.slides[slide].free as unknown[])?.[k])?.place);

export function findFixes(deck: Deck): Fix[] {
  const fixes: Fix[] = [];
  const add = (what: string, unit: string, groups: { to: number | string; off: Sample<number | string>[] }[]) => {
    for (const g of groups) {
      const byValue = new Map<number | string, Sample<number | string>[]>();
      for (const s of g.off) byValue.set(s.value, [...(byValue.get(s.value) ?? []), s]);
      for (const [v, list] of byValue) {
        fixes.push({
          id: `${what}:${v}`,
          what,
          from: `${v}${unit}`,
          to: `${g.to}${unit}`,
          slides: [...new Set(list.map((s) => s.slide))].sort((a, b) => a - b),
          apply: (d) => list.forEach((s) => s.set(d, g.to)),
        });
      }
    }
  };
  const nearPx = (tol: number) => (a: number | string, b: number | string) => Math.abs(Number(a) - Number(b)) <= tol;
  // Размер: разница до 2 px или до 6 % (38 и 40 — да, 28 и 40 — нет)
  const nearSize = (a: number | string, b: number | string) => Math.abs(Number(a) - Number(b)) <= Math.max(2, Number(b) * 0.06);

  // 1. Заголовки слайдов-холстов: размер, отступ слева и сверху
  const heads = headings(deck);
  add('Размер заголовков', ' px', outliers(heads.flatMap((h) => {
    const v = textSize(h.o);
    return v === null ? [] : [{ value: v, slide: h.slide, set: (d: Deck, to: number | string) => {
      const st = obj(obj(obj((d.slides[h.slide].free as unknown[])[h.k])?.styles)?.text);
      if (st) st.size = Number(to);
    } }];
  }), nearSize));
  for (const axis of ['x', 'y'] as const) {
    add(axis === 'x' ? 'Заголовки: отступ слева' : 'Заголовки: отступ сверху', ' px', outliers(heads.map((h) => ({
      value: h[axis], slide: h.slide, set: (d: Deck, to: number | string) => { const p = placeAt(d, h.slide, h.k); if (p) p[axis] = Number(to); },
    })), nearPx(8)));
  }

  // 2. Цвета, неотличимые на глаз: каждый канал отличается не больше чем на 4
  const colors: Sample<string>[] = [];
  const walk = (v: unknown, path: (string | number)[], slide: number) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i], slide));
    else if (obj(v)) {
      for (const [k, x] of Object.entries(v as Obj)) {
        if (typeof x === 'string' && /^(color|fill|stroke|bg)$/.test(k) && /^#[0-9a-f]{6}$/i.test(x)) {
          const p = [...path];
          colors.push({ value: x.toUpperCase(), slide, set: (d, to) => { const owner = p.reduce<unknown>((a, s) => (a as Obj)?.[s as string], d) as Obj; if (owner) owner[k] = to; } });
        } else walk(x, [...path, k], slide);
      }
    }
  };
  deck.slides.forEach((s, i) => walk(s, ['slides', i], i));
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const sameColor = (a: string, b: string) => { const x = rgb(a); const y = rgb(b); return x.every((c, i) => Math.abs(c - y[i]) <= 4); };
  add('Цвет', '', outliers(colors, (a, b) => sameColor(String(a), String(b))) as { to: number | string; off: Sample<number | string>[] }[]);

  return fixes;
}
