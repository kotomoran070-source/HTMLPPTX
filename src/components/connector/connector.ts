/**
 * Соединитель — линия или стрелка, концы которой цепляются к объектам слайда по их именам (id), как в
 * PowerPoint: двигаете или растягиваете объект, линия идёт следом. Конец без объекта — свободная точка
 * (start, end). Прямая, ломаная под прямыми углами или кривая, стрелка на конце, на обоих или без неё,
 * подпись посередине.
 * Разметка считается по данным (миниатюры, печать), на слайде — уточняется по настоящим рамкам объектов
 * и пересчитывается, когда у них меняется место или размер (в том числе пока их тянут мышью)
 */
import { defineBlock } from '../../engine/component';
import { esc, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import { placeOf } from '../../engine/render';
import type { Block, SlideData } from '../../types';
import { shapeColor } from '../shape/shape';
import { connect, pathD, SIDES, type Box, type Geo, type Route, type Side } from './geom';
import './connector.css';

export interface ConnectorProps extends Block {
  /** Имена (id) объектов, к которым прицеплены концы: начало и конец */
  from?: string;
  to?: string;
  /** Свободные концы — точки слайда [x, y], если конец ни к чему не прицеплен */
  start?: [number, number];
  end?: [number, number];
  /** straight — прямая, elbow — ломаная (по умолчанию), curve — кривая */
  route?: Route;
  /** Стрелка: end — на конце (по умолчанию), both — на обоих, start — в начале, none — без */
  head?: 'end' | 'both' | 'start' | 'none';
  /** Стороны, от которой и к которой идёт линия: top, right, bottom, left (по умолчанию — по положению объектов) */
  fromSide?: Side;
  toSide?: Side;
  /** Подпись посередине */
  text?: string;
  /** Цвет: цвет темы (accent, text…) или #RRGGBB; толщина, px; пунктир */
  color?: string;
  width?: number;
  dash?: 'dash' | 'dot';
}

const routeOf = (v: unknown): Route => (v === 'straight' || v === 'curve' ? v : 'elbow');
const sideOf = (v: unknown): Side | undefined => (SIDES.includes(v as Side) ? v as Side : undefined);
const sidesOf = (from: unknown, to: unknown) => ({ from: sideOf(from), to: sideOf(to) });

/** Рамка объекта по данным: без высоты — оценка (у текста — строка-две, у остального — по ширине) */
function boxOf(slide: SlideData, id: unknown): Box | null {
  if (typeof id !== 'string' || !id) return null;
  const list = (Array.isArray(slide.free) ? slide.free : []) as Block[];
  const est = (b: Block, w: number) => (b.type === 'text' ? 60 : Math.max(40, Math.min(220, w * 0.5)));
  const b = list.find((x) => x?.id === id);
  if (b) {
    if (b.type === 'connector') return null;
    const p = placeOf(b);
    return { x: p.x, y: p.y, w: p.w, h: p.h ?? est(b, p.w), oval: isOval(b) };
  }
  // Объект в группе: его место — в долях размера группы
  for (const g of list) {
    const item = g?.type === 'group' && Array.isArray(g.items) ? (g.items as Block[]).find((x) => x?.id === id) : undefined;
    if (!item) continue;
    const gp = placeOf(g);
    const base = (g.base ?? {}) as { w?: number; h?: number };
    const kx = gp.w / (Number(base.w) || gp.w);
    const ky = gp.h && Number(base.h) ? gp.h / Number(base.h) : kx;
    const p = placeOf(item);
    return { x: gp.x + p.x * kx, y: gp.y + p.y * ky, w: p.w * kx, h: (p.h ?? est(item, p.w)) * ky, oval: isOval(item) };
  }
  return null;
}

const isOval = (b: Block) => b.type === 'shape' && b.kind === 'ellipse';

/** Свободный конец: точка [x, y] в пикселях слайда */
export function pointOf(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [x, y] = v.map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? [Math.max(-1280, Math.min(2560, x)), Math.max(-720, Math.min(1440, y))] : null;
}
const dot = (pt: [number, number] | null): Box | null => (pt ? { x: pt[0], y: pt[1], w: 0, h: 0 } : null);
/** Конец: прицеплен — рамка объекта (нет объекта — null), свободен — точка */
const endOf = (slide: SlideData, id: unknown, pt: unknown): Box | null => (typeof id === 'string' && id ? boxOf(slide, id) : dot(pointOf(pt)));

/** Геометрия по данным слайда; объекта или точки нет — null (соединитель не рисуется) */
export function connectorGeo(p: ConnectorProps, slide: SlideData): Geo | null {
  const a = endOf(slide, p.from, p.start);
  const b = endOf(slide, p.to, p.end);
  return a && b ? connect(a, b, routeOf(p.route), 14, sidesOf(p.fromSide, p.toSide)) : null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
/** Вид пути и опорные точки в координатах рамки соединителя */
const geoJson = (g: Geo) => JSON.stringify({ route: g.route, pts: g.pts.map(([x, y]) => [r1(x - g.box.x), r1(y - g.box.y)]) });

defineBlock<ConnectorProps>('connector', {
  /** Рамка свободного объекта — по пути, а не по place: соединитель стоит там, где его концы */
  place(p: ConnectorProps, ctx) {
    const g = connectorGeo(p, ctx.slide);
    return g ? { x: r1(g.box.x), y: r1(g.box.y), w: r1(g.box.w), h: r1(g.box.h) } : { x: 0, y: 0, w: 1, h: 1 };
  },
  render(p, ctx) {
    const g = connectorGeo(p, ctx.slide);
    const color = shapeColor(p.color) ?? 'var(--tx2, var(--mu))';
    const w = Math.max(0.5, Math.min(12, Number(p.width) || 2.5));
    const head = p.head === 'none' || p.head === 'both' || p.head === 'start' ? p.head : 'end';
    const id = ctx.uid('cn');
    const dash = p.dash === 'dot' ? `${w} ${w * 2}` : p.dash === 'dash' ? `${w * 4} ${w * 3}` : '';
    const d = g ? pathD(g) : '';
    const all = (Array.isArray(ctx.slide.free) ? ctx.slide.free : []).flatMap((x) => [x, ...((x as Block)?.type === 'group' && Array.isArray((x as Block).items) ? (x as Block).items as Block[] : [])]);
    const oval = (id: unknown) => all.some((x) => (x as Block)?.id === id && isOval(x as Block));
    const ovals = (oval(p.from) ? 'a' : '') + (oval(p.to) ? 'b' : '');
    const attrs = ` data-from="${esc(String(p.from ?? ''))}" data-to="${esc(String(p.to ?? ''))}" data-route="${routeOf(p.route)}"${ovals ? ` data-oval="${ovals}"` : ''}`
      + (sideOf(p.fromSide) || sideOf(p.toSide) ? ` data-sides="${sideOf(p.fromSide) ?? ''},${sideOf(p.toSide) ?? ''}"` : '')
      // Свободные концы — точками: на слайде их не по чему уточнять
      + (!p.from && pointOf(p.start) ? ` data-p1="${pointOf(p.start)!.join(',')}"` : '')
      + (!p.to && pointOf(p.end) ? ` data-p2="${pointOf(p.end)!.join(',')}"` : '');
    const m = (k: 's' | 'e') => `<marker id="${id}${k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="${(10 / w) * 1.6 + 2.2}" markerHeight="${(10 / w) * 1.6 + 2.2}" markerUnits="strokeWidth" orient="auto-start-reverse"><path d="M0 0.8 9.5 5 0 9.2z"/></marker>`;
    const label = p.text ? `<span class="conn-l" style="left:${g ? r1(g.mid[0] - g.box.x) : 0}px;top:${g ? r1(g.mid[1] - g.box.y) : 0}px"${ea(p, 'text')}>${t(p.text)}</span>` : '';
    // Опорные точки — для выгрузки в PowerPoint родной линией (на слайде их уточняет reroute)
    const geo = g ? ` data-geo="${esc(geoJson(g))}"` : '';
    return `<div class="conn-box${g ? '' : ' conn-off'}"${attrs}${geo} style="--cc:${esc(color)};--cw:${w}">`
      + `<svg class="conn" viewBox="0 0 ${g ? r1(g.box.w) : 1} ${g ? r1(g.box.h) : 1}" aria-hidden="true"><defs>${m('s')}${m('e')}</defs>`
      + `<path class="conn-hit" d="${d}"/>`
      + `<path class="conn-line" d="${d}"${dash ? ` stroke-dasharray="${dash}"` : ''}${head === 'end' || head === 'both' ? ` marker-end="url(#${id}e)"` : ''}${head === 'start' || head === 'both' ? ` marker-start="url(#${id}s)"` : ''}/></svg>`
      + `${label}</div>`;
  },
  mount(el) {
    // Уточнение по настоящим рамкам объектов и слежение за ними
    const slide = el.closest<HTMLElement>('.slide');
    if (!slide) return;
    const run = () => reroute(el, slide);
    let raf = 0;
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; run(); }); };
    run();
    // Место и размер объектов — в их style (редактор меняет его и пока тянут); высота текста — по содержимому
    const mo = new MutationObserver((list) => { if (list.some((m) => (m.target as Element).matches?.('.free') && !(m.target as Element).querySelector(':scope > .conn-box'))) later(); });
    mo.observe(slide, { subtree: true, attributes: true, attributeFilter: ['style'] });
    const ro = new ResizeObserver(later);
    slide.querySelectorAll<HTMLElement>(':scope > .free').forEach((f) => { if (!f.querySelector(':scope > .conn-box')) ro.observe(f); });
    return () => { mo.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); };
  },
});

/** Пересчитать соединитель по настоящим рамкам его объектов на слайде */
export function reroute(el: HTMLElement, slide: HTMLElement): void {
  const free = el.parentElement;
  const find = (id: string | undefined) => (id
    ? slide.querySelector<HTMLElement>(`:scope > .free[data-obj="${CSS.escape(id)}"]`) ?? slide.querySelector<HTMLElement>(`.grp-item[data-obj="${CSS.escape(id)}"]`)
    : null);
  const ov = el.dataset.oval ?? '';
  // Место — по offset*, а не по getBoundingClientRect: анимация появления (transform) не сбивает линию
  const box = (f: HTMLElement, k: string): Box => {
    let x = 0;
    let y = 0;
    for (let e: HTMLElement | null = f; e && e !== slide; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; }
    return { x, y, w: f.offsetWidth, h: f.offsetHeight, oval: ov.includes(k) };
  };
  /** Конец: объект по имени или свободная точка из data-p1 / data-p2 */
  const end = (id: string | undefined, pt: string | undefined, k: string): Box | null => {
    if (id) { const f = find(id); return f ? box(f, k) : null; }
    return dot(pointOf(pt?.split(',')));
  };
  const a = end(el.dataset.from, el.dataset.p1, 'a');
  const b = end(el.dataset.to, el.dataset.p2, 'b');
  el.classList.toggle('conn-off', !a || !b);
  if (!a || !b || !free) return;
  const [s1, s2] = (el.dataset.sides ?? ',').split(',');
  const g = connect(a, b, routeOf(el.dataset.route), 14, sidesOf(s1, s2));
  const d = pathD(g);
  el.querySelectorAll('path.conn-hit, path.conn-line').forEach((p) => p.setAttribute('d', d));
  el.querySelector('svg.conn')?.setAttribute('viewBox', `0 0 ${r1(g.box.w)} ${r1(g.box.h)}`);
  const l = el.querySelector<HTMLElement>('.conn-l');
  if (l) { l.style.left = `${r1(g.mid[0] - g.box.x)}px`; l.style.top = `${r1(g.mid[1] - g.box.y)}px`; }
  el.dataset.geo = geoJson(g);
  Object.assign(free.style, { left: `${r1(g.box.x)}px`, top: `${r1(g.box.y)}px`, width: `${r1(g.box.w)}px`, height: `${r1(g.box.h)}px` });
  // Студия переставляет ручки концов выделенной линии
  el.dispatchEvent(new CustomEvent('connreroute', { bubbles: true }));
}

/** Концы линии на слайде (пиксели слайда): начало и конец пути */
export function endsOf(el: HTMLElement): [[number, number], [number, number]] | null {
  const free = el.parentElement;
  let geo: { pts?: [number, number][] } = {};
  try { geo = JSON.parse(el.dataset.geo ?? '{}'); } catch { return null; }
  const pts = geo.pts;
  if (!free || !Array.isArray(pts) || pts.length < 2) return null;
  const x = free.offsetLeft;
  const y = free.offsetTop;
  const z = pts[pts.length - 1];
  return [[x + pts[0][0], y + pts[0][1]], [x + z[0], y + z[1]]];
}
