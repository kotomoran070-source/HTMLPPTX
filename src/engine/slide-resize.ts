/**
 * Смена размера слайда (deck.size): высота та же (720), меняется ширина. Раскладки слайдов (body) перестраиваются
 * сами, а свободные объекты (free) переставляются по тому, к чему они прижаты:
 * - к обоим краям (заголовок или блок на всю ширину с полями, фон, полоса) — тянутся или сужаются вместе со слайдом,
 *   поля остаются;
 * - по центру — остаются по центру;
 * - у левого или правого края — остаются у своего края с тем же отступом;
 * - остальные — на то же место по ширине в долях (треть слайда — треть);
 * - наложенные друг на друга (значок на картинке) — вместе, по общей рамке.
 * fit — вписать композицию в новый размер целиком (места, размеры и шрифты, к центру слайда):
 * - сужение (16:9 → 4:3), содержимое слайда шире нового — «Уместить», как «Обеспечить размещение» в PowerPoint;
 * - расширение (4:3 → 16:9, 16:9 → 21:9) — «Увеличить»: композиция холста остаётся целой — растёт, насколько
 *   позволяет высота (уменьшенная при сужении — возвращается к прежнему размеру), или встаёт целиком.
 * Фон на весь слайд при этом просто тянется по ширине. Объекты, которые и раньше были за краем (про запас), не
 * трогаются. Чистые функции над данными — годятся и студии, и операциям агентов (ops.ts)
 */
import type { Deck, SlideData } from '../types';
import { SLIDE_H, SLIDE_SIZES, widthOf, type SlideSize } from './slide-size';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const isSlideSize = (v: unknown): v is SlideSize => typeof v === 'string' && v in SLIDE_SIZES;

/** Что получилось: сколько объектов передвинуто, на каких слайдах композиция вписана целиком (уменьшена или увеличена), что осталось за краем */
export interface ResizeReport { moved: number; scaled: number[]; outside: number; slides: number[] }

interface Box { x: number; w: number }

/**
 * Прижат к обоим краям: поля не больше 15 % ширины с каждой стороны и почти равные (заголовок, полоса, фон) —
 * иначе это объект у одного края, просто широкий
 */
const spans = (b: Box, from: number) => {
  const l = b.x;
  const r = from - (b.x + b.w);
  return l <= from * 0.15 && r <= from * 0.15 && b.w >= from * 0.5 && Math.abs(l - r) <= Math.max(16, from * 0.02);
};

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



/** Шрифты частей объекта (styles.<часть>.size) и объектов внутри группы — в k раз */
function scaleFonts(b: Rec, k: number): void {
  if (isRec(b.styles)) {
    for (const st of Object.values(b.styles)) if (isRec(st) && num(st.size) !== undefined) st.size = Math.max(6, Math.round((st.size as number) * k));
  }
  if (Array.isArray(b.items)) for (const it of b.items) if (isRec(it)) scaleFonts(it, k);
}

/** Фон на весь слайд (вставка, картинка, фигура от края до края): при вписывании тянется по ширине, а не растёт */
const covers = (pl: Rec, from: number) => (pl.x as number) <= 1 && (pl.x as number) + (num(pl.w) ?? 0) >= from - 1
  && (num(pl.y) ?? 0) <= 1 && (num(pl.y) ?? 0) + (num(pl.h) ?? 0) >= SLIDE_H - 1;

/** У слайда — раскладка (body): она перестраивается сама, свободные объекты над ней целиком не вписываются */
const hasLayout = (s: SlideData) => (Array.isArray(s.body) ? s.body.length > 0 : !!s.body);

/**
 * Вписать композицию слайда: всё в k раз от центра старого слайда к центру нового (места, размеры, шрифты, свободные
 * концы соединителей); фон на весь слайд — по новой ширине
 */
function scaleSlide(s: SlideData, k: number, from: number, to: number): void {
  const cy = SLIDE_H / 2;
  const mx = (x: number) => Math.round(to / 2 + (x - from / 2) * k);
  const my = (y: number) => Math.round(cy + (y - cy) * k);
  for (const b of Array.isArray(s.free) ? s.free : []) {
    if (!isRec(b)) continue;
    for (const key of ['start', 'end']) {
      const p = b[key];
      if (Array.isArray(p) && num(p[0]) !== undefined && num(p[1]) !== undefined) b[key] = [mx(p[0] as number), my(p[1] as number)];
    }
    const pl = b.place;
    if (!isRec(pl) || num(pl.x) === undefined) continue;
    if (covers(pl, from)) { pl.x = 0; pl.w = to; continue; }
    pl.x = mx(pl.x as number);
    if (num(pl.y) !== undefined) pl.y = my(pl.y as number);
    if (num(pl.w) !== undefined) pl.w = Math.round((pl.w as number) * k);
    if (num(pl.h) !== undefined) pl.h = Math.round((pl.h as number) * k);
    scaleFonts(b, k);
  }
}

/** Увеличивать меньше чем на 10 % — незачем (шрифты почти те же): композиция просто встаёт целиком */
const GROW_MIN = 1.1;

/**
 * Расширение, «Увеличить»: композиция холста остаётся целой — ничего не разъезжается. Композиция во всю ширину растёт:
 * не больше, чем ширина слайда, и так, чтобы осталась в его высоте (уменьшенная при сужении — к прежнему размеру);
 * не может вырасти хотя бы на 10 % или она небольшая — встаёт целиком: во всю ширину и по центру — по центру, у края
 * — у края. Ответ — во сколько раз увеличить (k) или на сколько сдвинуть (dx); слайд с раскладкой, пустой и только
 * с растянутым на всю ширину — null (объекты встают по краям, растянутое тянется)
 */
function growPlan(s: SlideData, from: number, to: number): { k: number; dx: number } | null {
  if (to <= from || hasLayout(s)) return null;
  const items = (Array.isArray(s.free) ? s.free : []).filter(isRec).map(itemOf)
    .filter((it): it is Item => !!it && inside(it, from) && !covers(it.pl, from));
  // Пусто или только растянутое на всю ширину (заголовок с полями, полоса) — оно просто тянется
  if (!items.some((it) => !spans(it, from))) return null;
  const x0 = Math.min(...items.map((it) => it.x));
  const x1 = Math.max(...items.map((it) => it.x + it.w));
  const y0 = Math.min(...items.map((it) => it.y));
  const y1 = Math.max(...items.map((it) => it.y + it.h));
  // Во всю ширину — шире from² / to: такая при сужении уменьшилась бы
  const wide = x1 - x0 >= (from * from) / to - 1;
  if (wide) {
    const cy = SLIDE_H / 2;
    let k = to / from;
    if (y0 < cy) k = Math.min(k, cy / (cy - y0));
    if (y1 > cy) k = Math.min(k, cy / (y1 - cy));
    if (k >= GROW_MIN) return { k, dx: 0 };
  }
  const d = to - from;
  const left = x0;
  const right = from - x1;
  const c = (x0 + x1) / 2;
  if (wide || Math.abs(c - from / 2) <= from * 0.05) return { k: 1, dx: d / 2 };
  if (left <= from * 0.2 && left <= right) return { k: 1, dx: 0 };
  if (right <= from * 0.2 && right < left) return { k: 1, dx: d };
  return { k: 1, dx: (c * to) / from - c };
}

/** Композиция целиком на dx: объекты (кроме тех, что за краем про запас), свободные концы соединителей; фон — по ширине */
function shiftSlide(s: SlideData, dx: number, from: number, to: number): number {
  let moved = 0;
  for (const b of Array.isArray(s.free) ? s.free : []) {
    if (!isRec(b)) continue;
    for (const key of ['start', 'end']) {
      const p = b[key];
      if (Array.isArray(p) && num(p[0]) !== undefined) b[key] = [Math.round((p[0] as number) + dx), p[1]];
    }
    const pl = b.place;
    if (!isRec(pl) || num(pl.x) === undefined) continue;
    if (covers(pl, from)) { pl.x = 0; pl.w = to; moved++; continue; }
    if (!inside(boxOf(pl), from)) continue;
    const nx = Math.round((pl.x as number) + dx);
    if (nx !== pl.x) { pl.x = nx; moved++; }
  }
  return moved;
}

/** Объект слайда с рамкой */
interface Item { b: Rec; pl: Rec; x: number; w: number; y: number; h: number }
/**
 * Высота объекта без h — оценкой: с текстом (надпись, цитата) — строки по ширине рамки и размеру шрифта (символ ≈ 0,55
 * кегля), без текста (метки, кнопки) — одна строка
 */
function heightOf(b: Rec, pl: Rec): number {
  const h = num(pl.h);
  if (h !== undefined) return h;
  const w = num(pl.w) ?? 0;
  if (typeof b.text !== 'string') return 48;
  const st = isRec(b.styles) && isRec(b.styles.text) ? b.styles.text : null;
  const size = num(st?.size) ?? 24;
  const text = b.text.replace(/\{[^{}|]+\|([^{}]*)\}/g, '$1');
  const lines = text.split('\n').reduce((n, line) => n + (w > 0 ? Math.max(1, Math.ceil((line.length * size * 0.55) / w)) : 1), 0);
  return Math.round(Math.max(1, lines) * size * (num(st?.leading) ?? 1.35));
}
const itemOf = (b: Rec): Item | null => {
  const pl = b.place;
  if (!isRec(pl) || num(pl.x) === undefined) return null;
  return { b, pl, x: pl.x as number, w: num(pl.w) ?? 0, y: num(pl.y) ?? 0, h: heightOf(b, pl) };
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
 * Слайды, у которых «вписать целиком» и «по краям» дают разное — о них вопрос (при сужении — тесные, при расширении —
 * холсты со своей композицией). Остальные встают одинаково при любом выборе
 */
export function fitChoices(d: Deck, size: SlideSize): number[] {
  const a = JSON.parse(JSON.stringify(d)) as Deck;
  const b = JSON.parse(JSON.stringify(d)) as Deck;
  resizeDeck(a, size, { fit: true });
  resizeDeck(b, size, { fit: false });
  return a.slides.flatMap((s, i) => (JSON.stringify(s) !== JSON.stringify(b.slides[i]) ? [i + 1] : []));
}

/**
 * Поменять размер слайдов презентации на месте (d меняется). fit — вписать целиком (true — все слайды, список —
 * эти, номера с 1): при сужении тесные слайды уменьшаются; при расширении композиция холста остаётся целой — растёт,
 * насколько позволяет высота, или встаёт целиком. Без fit — объекты встают по краям и центру своего размера.
 * Тот же размер — ничего
 */
export function resizeDeck(d: Deck, size: SlideSize, o: { fit?: boolean | number[] } = {}): ResizeReport {
  const from = widthOf(d);
  const to = SLIDE_SIZES[size];
  const report: ResizeReport = { moved: 0, scaled: [], outside: 0, slides: [] };
  if (size === '16:9') delete d.size;
  else d.size = size;
  if (from === to) return report;
  d.slides.forEach((s, i) => {
    if (!s) return;
    // Вписать целиком: тесный при сужении — уменьшить; холст при расширении — целиком крупнее или сдвинуть
    const fit = o.fit === true || (Array.isArray(o.fit) && o.fit.includes(i + 1));
    if (fit && to < from && tight(s, from, to)) {
      scaleSlide(s, to / from, from, to);
      report.scaled.push(i + 1);
      report.slides.push(i + 1);
      return;
    }
    const plan = fit ? growPlan(s, from, to) : null;
    if (plan && plan.k > 1) {
      scaleSlide(s, plan.k, from, to);
      report.scaled.push(i + 1);
      report.slides.push(i + 1);
      return;
    }
    if (plan) {
      const n = shiftSlide(s, plan.dx, from, to);
      report.moved += n;
      if (n) report.slides.push(i + 1);
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
