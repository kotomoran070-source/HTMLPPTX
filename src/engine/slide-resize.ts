/**
 * Смена размера слайда (deck.size): высота та же (720), меняется ширина. Раскладки слайдов (body) перестраиваются
 * сами, а свободные объекты (free) переставляются по тому, к чему они прижаты:
 * - к обоим краям (заголовок или блок на всю ширину с полями, фон, полоса) — тянутся или сужаются вместе со слайдом,
 *   поля остаются;
 * - по центру — остаются по центру;
 * - у левого или правого края — остаются у своего края с тем же отступом;
 * - остальные — на то же место по ширине в долях (треть слайда — треть).
 * Сужение (16:9 → 4:3), когда содержимое слайда шире нового: fit — «Уместить» — композиция слайда уменьшается
 * целиком (места, размеры и шрифты, к центру слайда), как «Обеспечить размещение» в PowerPoint: ничего не
 * наезжает; без fit — объекты встают к краям своего размера (могут наложиться). Объекты, которые и раньше были
 * за краем (про запас), не трогаются. Чистые функции над данными — годятся и студии, и операциям агентов (ops.ts)
 */
import type { Deck, SlideData } from '../types';
import { SLIDE_H, SLIDE_SIZES, widthOf, type SlideSize } from './slide-size';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const isSlideSize = (v: unknown): v is SlideSize => typeof v === 'string' && v in SLIDE_SIZES;

/** Что получилось: сколько объектов передвинуто, на скольких слайдах композиция уменьшена, что осталось за краем */
export interface ResizeReport { moved: number; scaled: number[]; outside: number; slides: number[] }

interface Box { x: number; w: number }

/** Прижат к обоим краям: поля не больше 15 % ширины с каждой стороны */
const spans = (b: Box, from: number) => b.x <= from * 0.15 && from - (b.x + b.w) <= from * 0.15 && b.w >= from * 0.5;

/** Куда встаёт отрезок [x, x + w] при смене ширины from → to */
function place(b: Box, from: number, to: number): Box {
  const d = to - from;
  if (spans(b, from)) return { x: b.x, w: Math.max(40, b.w + d) };
  const left = b.x;
  const right = from - (b.x + b.w);
  const c = b.x + b.w / 2;
  if (Math.abs(c - from / 2) <= from * 0.05) return { x: b.x + d / 2, w: b.w };
  if (left <= from * 0.2 && left <= right) return { x: b.x, w: b.w };
  if (right <= from * 0.2 && right < left) return { x: to - right - b.w, w: b.w };
  return { x: (c * to) / from - b.w / 2, w: b.w };
}

const inside = (b: Box, w: number) => b.x >= -0.5 && b.x + b.w <= w + 0.5;

/** Свободные объекты слайда с местом */
const placed = (s: SlideData) => (Array.isArray(s?.free) ? s.free : []).filter((b) => isRec(b) && isRec(b.place) && num(b.place.x) !== undefined) as unknown as (Rec & { place: Rec })[];
const boxOf = (pl: Rec): Box => ({ x: pl.x as number, w: num(pl.w) ?? 0 });

/**
 * Содержимое слайда шире новой ширины: объекты (кроме растянутых на всю ширину) вместе занимают больше, чем есть
 * места, — встав к краям, они наложатся или выйдут за край
 */
function tight(s: SlideData, from: number, to: number): boolean {
  const boxes = placed(s).map((b) => boxOf(b.place)).filter((b) => inside(b, from) && !spans(b, from));
  if (!boxes.length) return false;
  const l = Math.min(...boxes.map((b) => b.x));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  return r - l > to;
}

/** Слайды, содержимое которых шире нового размера (только при сужении) — вопрос «Уместить?» */
export function tightSlides(d: Deck, size: SlideSize): number[] {
  const from = widthOf(d);
  const to = SLIDE_SIZES[size];
  if (to >= from) return [];
  return d.slides.flatMap((s, i) => (tight(s, from, to) ? [i + 1] : []));
}

/** Шрифты частей объекта (styles.<часть>.size) и объектов внутри группы — в k раз */
function scaleFonts(b: Rec, k: number): void {
  if (isRec(b.styles)) {
    for (const st of Object.values(b.styles)) if (isRec(st) && num(st.size) !== undefined) st.size = Math.max(6, Math.round((st.size as number) * k));
  }
  if (Array.isArray(b.items)) for (const it of b.items) if (isRec(it)) scaleFonts(it, k);
}

/** «Уместить»: вся композиция слайда — в k раз к центру слайда (места, размеры, шрифты, свободные концы соединителей) */
function scaleSlide(s: SlideData, k: number): void {
  const cy = SLIDE_H / 2;
  for (const b of Array.isArray(s.free) ? s.free : []) {
    if (!isRec(b)) continue;
    for (const key of ['start', 'end']) {
      const p = b[key];
      if (Array.isArray(p) && num(p[0]) !== undefined && num(p[1]) !== undefined) b[key] = [Math.round((p[0] as number) * k), Math.round(cy + ((p[1] as number) - cy) * k)];
    }
    const pl = b.place;
    if (!isRec(pl) || num(pl.x) === undefined) continue;
    pl.x = Math.round((pl.x as number) * k);
    if (num(pl.y) !== undefined) pl.y = Math.round(cy + ((pl.y as number) - cy) * k);
    if (num(pl.w) !== undefined) pl.w = Math.round((pl.w as number) * k);
    if (num(pl.h) !== undefined) pl.h = Math.round((pl.h as number) * k);
    scaleFonts(b, k);
  }
}

/** Объект слайда с рамкой: высота без h — по шрифту (одна строка текста) */
interface Item { b: Rec; pl: Rec; x: number; w: number; y: number; h: number }
const itemOf = (b: Rec): Item | null => {
  const pl = b.place;
  if (!isRec(pl) || num(pl.x) === undefined) return null;
  const st = isRec(b.styles) && isRec(b.styles.text) ? b.styles.text : null;
  const h = num(pl.h) ?? Math.round((num(st?.size) ?? 24) * 1.5);
  return { b, pl, x: pl.x as number, w: num(pl.w) ?? 0, y: num(pl.y) ?? 0, h };
};
/** Накладываются (или касаются): значок на картинке, подпись на фигуре */
const touch = (a: Item, c: Item) => a.x <= c.x + c.w + 2 && c.x <= a.x + a.w + 2 && a.y <= c.y + c.h + 2 && c.y <= a.y + a.h + 2;

/**
 * Группы объектов, которые накладываются друг на друга: двигаются вместе, по общей рамке — значки и подписи поверх
 * картинки не отрываются от неё. Растянутые на всю ширину (фон, полоса) — не в группах: под ними всё
 */
function clusters(items: Item[]): Item[][] {
  const parent = items.map((_, k) => k);
  const root = (k: number): number => (parent[k] === k ? k : (parent[k] = root(parent[k])));
  for (let a = 0; a < items.length; a++) {
    for (let c = a + 1; c < items.length; c++) if (touch(items[a], items[c])) parent[root(a)] = root(c);
  }
  const groups = new Map<number, Item[]>();
  items.forEach((it, k) => { const r = root(k); groups.set(r, [...(groups.get(r) ?? []), it]); });
  return [...groups.values()];
}

/**
 * Поменять размер слайдов презентации на месте (d меняется). fit — при сужении слайды, содержимое которых шире
 * нового размера, уменьшаются целиком; без fit — объекты встают к краям своего размера. Тот же размер — ничего
 */
export function resizeDeck(d: Deck, size: SlideSize, o: { fit?: boolean } = {}): ResizeReport {
  const from = widthOf(d);
  const to = SLIDE_SIZES[size];
  const report: ResizeReport = { moved: 0, scaled: [], outside: 0, slides: [] };
  if (size === '16:9') delete d.size;
  else d.size = size;
  if (from === to) return report;
  d.slides.forEach((s, i) => {
    if (!s) return;
    if (o.fit && to < from && tight(s, from, to)) {
      scaleSlide(s, to / from);
      report.scaled.push(i + 1);
      report.slides.push(i + 1);
      return;
    }
    let touched = false;
    const free = (Array.isArray(s.free) ? s.free : []).filter(isRec) as Rec[];
    // Соединитель со свободными концами: концы — точки (у привязанных к фигурам концы едут с фигурами)
    for (const b of free) {
      for (const k of ['start', 'end']) {
        const p = b[k];
        if (!Array.isArray(p) || num(p[0]) === undefined) continue;
        const x = Math.round(place({ x: p[0] as number, w: 0 }, from, to).x);
        if (x !== p[0]) { b[k] = [x, p[1]]; touched = true; }
      }
    }
    // Был за краем (про запас) — так и остаётся
    const items = free.map(itemOf).filter((it): it is Item => !!it && inside(it, from));
    const move = (it: Item, x: number, w: number) => {
      const nx = Math.round(x);
      const nw = Math.round(w);
      if (nx === it.pl.x && (num(it.pl.w) === undefined || nw === it.pl.w)) return;
      it.pl.x = nx;
      if (num(it.pl.w) !== undefined) it.pl.w = nw;
      report.moved++;
      touched = true;
    };
    // На всю ширину — тянутся вместе со слайдом
    const wide = items.filter((it) => spans(it, from));
    for (const it of wide) { const now = place(it, from, to); move(it, now.x, now.w); }
    // Остальные — группами наложенных друг на друга, по общей рамке
    for (const group of clusters(items.filter((it) => !wide.includes(it)))) {
      const x0 = Math.min(...group.map((it) => it.x));
      const x1 = Math.max(...group.map((it) => it.x + it.w));
      const box: Box = { x: x0, w: x1 - x0 };
      let now = place(box, from, to);
      // Помещается по ширине — к краю, внутрь слайда; шире слайда — как есть, за краем
      if (!inside(now, to) && now.w <= to) now = { x: Math.max(0, Math.min(to - now.w, now.x)), w: now.w };
      if (!inside(now, to)) report.outside += group.length;
      const dx = now.x - x0;
      for (const it of group) move(it, it.x + dx, it.w);
    }
    if (touched) report.slides.push(i + 1);
  });
  return report;
}
