/**
 * Линии и стрелки, которые цепляются к объектам (components/connector), как в PowerPoint.
 * - Рисование: «Линия» или «Стрелка» — протянуть по слайду (или два щелчка). Начали или закончили на
 *   объекте — конец прицеплен к нему; на точке его стороны — держится этой стороны; в пустом месте — свободен.
 * - Ручки концов у выделенной линии: конец тянут на объект — прицепляется, в пустое место — отцепляется.
 * - Свободную линию тянут целиком; прицепленные концы остаются на своих объектах.
 * Объектам без имени даётся имя (id): по нему линия находит их и следует за ними
 */
import { endsOf } from '../components/connector/connector';
import type { Side } from '../components/connector/geom';
import { getAt, setAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { OBJ_ID } from '../engine/render';
import type { Block, Deck } from '../types';

type Path = (string | number)[];
type Pt = [number, number];
export type ConnectorProto = { route?: 'straight' | 'elbow' | 'curve'; head?: string };
/** Конец линии: объект (номер на слайде) и сторона — или свободная точка */
export interface End { k?: number; side?: Side; pt?: Pt }

interface Host {
  deck: Deck;
  editor: Editor;
  stage(): HTMLElement;
  index(): number;
}

const isConn = (b: unknown) => (b as Block | undefined)?.type === 'connector';
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Номера двух выделенных объектов слайда, которые можно соединить, или null */
export function pickedPair(deck: Deck, sel: { group: Path[] } | null): [number, number] | null {
  if (!sel || sel.group.length !== 2) return null;
  const [a, b] = sel.group;
  if (a[2] !== 'free' || b[2] !== 'free' || a.length !== 4 || b.length !== 4 || a[1] !== b[1]) return null;
  if (isConn(getAt(deck, a)) || isConn(getAt(deck, b))) return null;
  return [Number(a[3]), Number(b[3])];
}

/** Имя объекта k на слайде: есть — его, нет — новое, свободное */
function nameOf(free: Block[], k: number): string {
  const t = free[k];
  if (typeof t.id === 'string' && OBJ_ID.test(t.id)) return t.id;
  const used = new Set(free.map((x) => x?.id));
  let id = `obj-${k + 1}`;
  for (let n = 2; used.has(id); n++) id = `obj-${k + 1}-${n}`;
  t.id = id;
  return id;
}

/** Записать конец линии: прицеплен к объекту (и стороне) или свободная точка */
function putEnd(c: Block, free: Block[], which: 0 | 1, e: End): void {
  const [id, side, pt] = which ? ['to', 'toSide', 'end'] : ['from', 'fromSide', 'start'];
  delete c[id];
  delete c[side];
  delete c[pt];
  if (e.k !== undefined && free[e.k]) {
    c[id] = nameOf(free, e.k);
    if (e.side) c[side] = e.side;
  } else if (e.pt) c[pt] = [r1(e.pt[0]), r1(e.pt[1])];
}

/** Новая линия слайда i от a к b: встаёт под нижним из прицепленных объектов (иначе — поверх всех) и выделяется */
export function connectObjects(ed: Editor, i: number, a: End, b: End, proto: ConnectorProto = {}): boolean {
  let at = -1;
  const ok = ed.commit((d) => {
    const s = d.slides[i];
    if (!s) return;
    s.free = Array.isArray(s.free) ? s.free : [];
    const free = s.free as Block[];
    if (a.k !== undefined && a.k === b.k) return;
    const conn: Block = { type: 'connector' };
    putEnd(conn, free, 0, a);
    putEnd(conn, free, 1, b);
    if (proto.route && proto.route !== 'elbow') conn.route = proto.route;
    if (proto.head && proto.head !== 'end') conn.head = proto.head;
    const ks = [a.k, b.k].filter((k): k is number => k !== undefined);
    at = ks.length ? Math.min(...ks) : free.length;
    free.splice(at, 0, conn);
  }, { rebuild: true });
  if (!ok || at < 0) return false;
  ed.selectFree(i, at);
  return true;
}

/** Точки на сторонах объектов и поиск объекта под мышью — общие для рисования и ручек концов */
function pointsKit(h: Host) {
  let layer: HTMLElement | null = null;
  const slideEl = () => h.stage().querySelector<HTMLElement>('.slide.on');
  /** Объект слайда, к которому можно прицепить конец: под мышью или хозяин точки */
  const objAt = (t: EventTarget | null, skip?: HTMLElement | null): HTMLElement | null => {
    const pt = (t as Element | null)?.closest?.<HTMLElement>('.st-conn-pt');
    const f = pt
      ? slideEl()?.querySelector<HTMLElement>(`:scope > .free[data-free="${CSS.escape(pt.dataset.free!)}"]`)
      : (t as Element | null)?.closest?.<HTMLElement>('.slide.on > .free[data-free]');
    if (!f || f === skip || !h.stage().contains(f) || f.classList.contains('locked') || f.querySelector(':scope > .conn-box')) return null;
    const p = JSON.parse(f.dataset.free!) as Path;
    return p.length === 4 && p[2] === 'free' ? f : null;
  };
  const sideAt = (t: EventTarget | null): Side | undefined => (t as Element | null)?.closest?.<HTMLElement>('.st-conn-pt')?.dataset.side as Side | undefined;
  const indexOf = (f: HTMLElement) => Number((JSON.parse(f.dataset.free!) as Path)[3]);
  /** Точка стороны объекта в пикселях слайда (без transform: анимация появления не сбивает) */
  const pointOf = (f: HTMLElement, s?: Side): Pt => {
    const [x, y, w, hh] = [f.offsetLeft, f.offsetTop, f.offsetWidth, f.offsetHeight];
    if (s === 'top') return [x + w / 2, y];
    if (s === 'bottom') return [x + w / 2, y + hh];
    if (s === 'left') return [x, y + hh / 2];
    if (s === 'right') return [x + w, y + hh / 2];
    return [x + w / 2, y + hh / 2];
  };
  /** Мышь → пиксели слайда */
  const at = (e: PointerEvent): Pt => { const p = h.editor.toSlide(e.clientX, e.clientY); return [p.x, p.y]; };
  /** Показать точки на сторонах объектов; picked — уже выбранная */
  const show = (objs: (HTMLElement | null | undefined)[], picked?: { el: HTMLElement; side?: Side }): void => {
    const slide = slideEl();
    if (!slide) return;
    if (!layer || layer.parentElement !== slide) {
      layer?.remove();
      layer = document.createElement('div');
      layer.className = 'st-conn-pts';
      slide.appendChild(layer);
    }
    const list = [...new Set(objs.filter((x): x is HTMLElement => !!x && x.isConnected))];
    layer.innerHTML = list.map((f) => SIDES.map((s) => {
      const on = f === picked?.el && s === picked.side;
      const [x, y] = pointOf(f, s);
      return `<i class="st-conn-pt${on ? ' on' : ''}" data-free="${f.dataset.free!.replace(/"/g, '&quot;')}" data-side="${s}" style="left:${x}px;top:${y}px"></i>`;
    }).join('')).join('');
    document.querySelectorAll('.st-conn-over').forEach((x) => { if (!list.includes(x as HTMLElement)) x.classList.remove('st-conn-over'); });
    list.forEach((f) => f.classList.add('st-conn-over'));
  };
  const clear = () => {
    layer?.remove();
    layer = null;
    document.querySelectorAll('.st-conn-over').forEach((x) => x.classList.remove('st-conn-over'));
  };
  /** Пунктир от точки до точки (пока рисуют или тянут конец) */
  let ghost: SVGSVGElement | null = null;
  const line = (a: Pt, b: Pt): void => {
    const slide = slideEl();
    if (!slide) return;
    if (!ghost || ghost.parentElement !== slide) {
      ghost?.remove();
      ghost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ghost.setAttribute('class', 'st-conn-ghost');
      ghost.innerHTML = '<line/>';
      slide.appendChild(ghost);
    }
    const l = ghost.firstElementChild!;
    ([['x1', a[0]], ['y1', a[1]], ['x2', b[0]], ['y2', b[1]]] as const).forEach(([k, v]) => l.setAttribute(k, String(v)));
  };
  const unline = () => { ghost?.remove(); ghost = null; };
  /** Конец там, где мышь: точка стороны, объект или пустое место */
  const endAt = (e: PointerEvent, skip?: HTMLElement | null): { end: End; el: HTMLElement | null; xy: Pt } => {
    const f = objAt(e.target, skip);
    const side = f ? sideAt(e.target) : undefined;
    if (f) return { end: { k: indexOf(f), side }, el: f, xy: side ? pointOf(f, side) : at(e) };
    return { end: { pt: at(e) }, el: null, xy: at(e) };
  };
  return { slideEl, objAt, sideAt, indexOf, pointOf, at, show, clear, line, unline, endAt };
}

/** Рисование линии: протянуть или два щелчка; Esc или щелчок вне слайда — отмена */
export function connectTool(h: Host): { start(proto?: ConnectorProto, fromSelection?: boolean): void; cancel(): void; readonly on: boolean } {
  const kit = pointsKit(h);
  let proto: ConnectorProto = {};
  let on = false;
  /** Начало: объект (и сторона) или свободная точка */
  let first: { end: End; el: HTMLElement | null; xy: Pt } | null = null;
  let hover: HTMLElement | null = null;
  let press: { x: number; y: number } | null = null;
  let dragging = false;

  const draw = () => kit.show([first?.el, hover], first?.el ? { el: first.el, side: first.end.side } : undefined);
  function finish(e: PointerEvent): void {
    if (!first) return;
    const b = kit.endAt(e, first.el);
    const a = first;
    const p = proto;
    cancel();
    // Нулевая длина — не линия
    if (!a.el && !b.el && Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) < 4) return;
    if (connectObjects(h.editor, h.index(), a.end, b.end, p)) h.editor.toast('Концы линии — ручками: тяните на объект или в пустое место', 2200);
  }
  const onSlide = (e: PointerEvent) => !!kit.slideEl()?.contains(e.target as Node);
  const down = (e: PointerEvent) => {
    if (!on || e.button !== 0) return;
    // Вне слайда (но на холсте) — отмена; панели и лента работают как обычно
    if (!onSlide(e)) { if (h.stage().contains(e.target as Node)) { e.preventDefault(); e.stopPropagation(); cancel(); } return; }
    e.preventDefault();
    e.stopPropagation();
    if (first) { finish(e); return; }
    first = kit.endAt(e);
    press = { x: e.clientX, y: e.clientY };
    dragging = false;
    draw();
  };
  const move = (e: PointerEvent) => {
    if (!on) return;
    const f = kit.objAt(e.target, first?.el);
    if (f !== hover) { hover = f; draw(); }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) dragging = true;
    if (first) kit.line(first.xy, kit.endAt(e, first.el).xy);
  };
  const up = (e: PointerEvent) => {
    if (!on || !press) return;
    press = null;
    // Протянули — линия готова; щёлкнули — ждём второй щелчок
    if (dragging) finish(e);
    else h.editor.toast('Теперь щёлкните конец линии: объект, точку на его стороне или пустое место', 3500);
  };
  const key = (e: KeyboardEvent) => {
    if (on && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  // Щелчок по слайду в режиме рисования не выделяет объект и не начинает правку текста
  const swallow = (e: MouseEvent) => { if (on && kit.slideEl()?.contains(e.target as Node)) { e.preventDefault(); e.stopPropagation(); } };
  const EVENTS: [string, EventListener][] = [['pointerdown', down as EventListener], ['pointermove', move as EventListener], ['pointerup', up as EventListener],
    ['keydown', key as EventListener], ['click', swallow as EventListener], ['dblclick', swallow as EventListener]];

  function cancel(): void {
    if (!on) return;
    on = false;
    first = null;
    hover = null;
    press = null;
    kit.clear();
    kit.unline();
    document.body.classList.remove('st-connecting');
    EVENTS.forEach(([n, f]) => removeEventListener(n, f, true));
  }

  /** fromSelection — выделенный объект (кнопка на его вкладке) становится началом линии */
  function start(p: ConnectorProto = {}, fromSelection = false): void {
    cancel();
    // Уже выделены два объекта — соединяются сразу
    const pair = pickedPair(h.deck, h.editor.selection);
    if (pair) { connectObjects(h.editor, h.index(), { k: pair[0] }, { k: pair[1] }, p); return; }
    const sel = h.editor.selection;
    const one = fromSelection && sel?.free && sel.group.length <= 1 && !isConn(getAt(h.deck, sel.free))
      ? kit.slideEl()?.querySelector<HTMLElement>(`:scope > .free[data-free="${CSS.escape(JSON.stringify(sel.free))}"]`) ?? null
      : null;
    proto = p;
    on = true;
    h.editor.clearSelection();
    document.body.classList.add('st-connecting');
    EVENTS.forEach(([n, f]) => addEventListener(n, f, true));
    if (one) {
      first = { end: { k: kit.indexOf(one) }, el: one, xy: kit.pointOf(one) };
      draw();
      h.editor.toast('Щёлкните, куда идёт линия: объект, точку на его стороне или пустое место. Esc — отмена', 4000);
    } else h.editor.toast('Проведите линию по слайду: от объекта к объекту — концы прицепятся. Esc — отмена', 4000);
  }

  return { start, cancel, get on() { return on; } };
}

/**
 * Ручки концов у выделенной линии: тянут конец на объект — прицепляется (к точке — этой стороной),
 * в пустое место — свободен. Свободную линию тянут целиком: прицепленные концы остаются на месте
 */
export function lineEnds(h: Host): { sync(): void } {
  const kit = pointsKit(h);
  let layer: HTMLElement | null = null;
  /** Выделенная линия: путь и её элемент на слайде */
  const picked = (): { path: Path; el: HTMLElement } | null => {
    const sel = h.editor.selection;
    if (!sel?.free || sel.group.length > 1 || !isConn(getAt(h.deck, sel.free))) return null;
    const wrap = kit.slideEl()?.querySelector<HTMLElement>(`:scope > .free[data-free="${CSS.escape(JSON.stringify(sel.free))}"]`);
    const el = wrap?.querySelector<HTMLElement>(':scope > .conn-box');
    return el ? { path: sel.free, el } : null;
  };
  function sync(): void {
    const p = picked();
    const ends = p ? endsOf(p.el) : null;
    const slide = kit.slideEl();
    if (!p || !ends || !slide || p.el.classList.contains('conn-off')) { layer?.remove(); layer = null; return; }
    if (!layer || layer.parentElement !== slide) {
      layer?.remove();
      layer = document.createElement('div');
      layer.className = 'st-lends';
      slide.appendChild(layer);
    }
    const c = getAt(h.deck, p.path) as Block;
    layer.innerHTML = ends.map(([x, y], k) => {
      const tied = !!(k ? c.to : c.from);
      return `<i class="st-lend${tied ? ' tied' : ''}" data-end="${k}" style="left:${x}px;top:${y}px" title="${tied ? 'Конец прицеплен: потяните на другой объект или в пустое место' : 'Потяните на объект — конец прицепится'}"></i>`;
    }).join('');
  }
  // Линия перестроилась (объект двигают) — ручки следом
  document.addEventListener('connreroute', (e) => { if (layer && picked()?.el === e.target) sync(); });

  /** Тянут конец k: пунктир от другого конца, точки у объекта под мышью */
  function dragEnd(e: PointerEvent, k: 0 | 1, p: { path: Path; el: HTMLElement }): void {
    const ends = endsOf(p.el);
    if (!ends) return;
    const c = getAt(h.deck, p.path) as Block;
    const otherId = k ? c.from : c.to;
    const other = typeof otherId === 'string' ? kit.slideEl()?.querySelector<HTMLElement>(`:scope > .free[data-obj="${CSS.escape(otherId)}"]`) ?? null : null;
    const fixed = ends[k ? 0 : 1];
    p.el.classList.add('st-lend-drag');
    let last: PointerEvent = e;
    const handle = layer?.querySelector<HTMLElement>(`[data-end="${k}"]`);
    // Ручка едет за мышью, но не заслоняет объект под ней
    handle?.classList.add('drag');
    const move = (ev: PointerEvent) => {
      last = ev;
      const hit = kit.endAt(ev, other);
      kit.show([hit.el], hit.el ? { el: hit.el, side: hit.end.side } : undefined);
      kit.line(fixed, hit.xy);
      handle?.style.setProperty('left', `${hit.xy[0]}px`);
      handle?.style.setProperty('top', `${hit.xy[1]}px`);
    };
    const up = () => {
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', up, true);
      p.el.classList.remove('st-lend-drag');
      kit.clear();
      kit.unline();
      if (Math.hypot(last.clientX - e.clientX, last.clientY - e.clientY) < 3) { sync(); return; }
      const hit = kit.endAt(last, other);
      const i = h.index();
      h.editor.commit((d) => {
        const free = d.slides[i]?.free as Block[] | undefined;
        const cc = getAt(d, p.path) as Block | undefined;
        if (free && cc) putEnd(cc, free, k, hit.end);
      }, { rebuild: true });
      h.editor.selectFree(i, Number(p.path[3]));
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
  }

  /** Свободную линию тянут целиком: свободные концы едут, прицепленные остаются */
  function dragBody(e: PointerEvent, p: { path: Path; el: HTMLElement }, loose: [boolean, boolean]): void {
    const wrap = p.el.parentElement!;
    const k0 = h.editor.toSlide(e.clientX, e.clientY);
    let d: Pt = [0, 0];
    const move = (ev: PointerEvent) => {
      const k = h.editor.toSlide(ev.clientX, ev.clientY);
      d = [Math.round(k.x - k0.x), Math.round(k.y - k0.y)];
      // Пока тянут — сдвигом (у наполовину прицепленной точная форма — после отпускания)
      wrap.style.translate = `${d[0]}px ${d[1]}px`;
      layer?.style.setProperty('translate', `${d[0]}px ${d[1]}px`);
    };
    const up = () => {
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', up, true);
      wrap.style.translate = '';
      layer?.style.removeProperty('translate');
      if (!d[0] && !d[1]) return;
      const i = h.index();
      h.editor.commit((dk) => {
        const cc = getAt(dk, p.path) as Block | undefined;
        if (!cc) return;
        (['start', 'end'] as const).forEach((key, n) => {
          const pt = cc[key];
          if (loose[n] && Array.isArray(pt)) setAt(dk, [...p.path, key], [r1(Number(pt[0]) + d[0]), r1(Number(pt[1]) + d[1])]);
        });
      }, { rebuild: true });
      h.editor.selectFree(i, Number(p.path[3]));
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
  }

  addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.shiftKey || document.body.classList.contains('st-connecting')) return;
    const t = e.target as Element;
    const end = t.closest?.<HTMLElement>('.st-lend');
    const p = picked();
    if (end && p) {
      e.preventDefault();
      e.stopPropagation();
      dragEnd(e, Number(end.dataset.end) as 0 | 1, p);
      return;
    }
    // Линия под мышью со свободным концом — её тянут сразу, как фигуру (выделенную или нет)
    const box = t.closest?.<HTMLElement>('.slide.on > .free > .conn-box');
    if (!box || !h.stage().contains(box)) return;
    const path = JSON.parse(box.parentElement!.dataset.free ?? 'null') as Path | null;
    const c = path ? getAt(h.deck, path) as Block | undefined : undefined;
    if (!path || !c) return;
    const loose: [boolean, boolean] = [!c.from && Array.isArray(c.start), !c.to && Array.isArray(c.end)];
    if (!loose[0] && !loose[1]) return;
    e.preventDefault();
    e.stopPropagation();
    if (p?.el !== box) h.editor.selectFree(h.index(), Number(path[3]));
    dragBody(e, { path, el: box }, loose);
  }, true);

  return { sync };
}
