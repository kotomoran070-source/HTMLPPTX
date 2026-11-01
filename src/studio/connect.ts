/**
 * Соединение объектов линией (components/connector), как в PowerPoint: выделены два объекта — «Соединить»
 * связывает их сразу; иначе у объекта под мышью видны точки на сторонах — от объекта (или его точки)
 * тянут к другому объекту либо щёлкают по одному и по другому. Отпустили на точке — линия держится этой
 * стороны. Объектам без имени даётся имя (id): по нему линия находит их и следует за ними
 */
import type { Side } from '../components/connector/geom';
import { getAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { OBJ_ID } from '../engine/render';
import type { Block, Deck } from '../types';

type Path = (string | number)[];
export type ConnectorProto = { route?: 'straight' | 'elbow' | 'curve'; head?: string; fromSide?: Side; toSide?: Side };

interface Host {
  deck: Deck;
  editor: Editor;
  stage(): HTMLElement;
  index(): number;
}

const isConn = (b: unknown) => (b as Block | undefined)?.type === 'connector';

/** Номера двух выделенных объектов слайда, которые можно соединить, или null */
export function pickedPair(deck: Deck, sel: { group: Path[] } | null): [number, number] | null {
  if (!sel || sel.group.length !== 2) return null;
  const [a, b] = sel.group;
  if (a[2] !== 'free' || b[2] !== 'free' || a.length !== 4 || b.length !== 4 || a[1] !== b[1]) return null;
  if (isConn(getAt(deck, a)) || isConn(getAt(deck, b))) return null;
  return [Number(a[3]), Number(b[3])];
}

/** Соединить объекты a и b слайда i: линия встаёт под нижним из них и выделяется */
export function connectObjects(ed: Editor, i: number, a: number, b: number, proto: ConnectorProto = {}): boolean {
  let at = -1;
  const ok = ed.commit((d) => {
    const free = d.slides[i]?.free as Block[] | undefined;
    if (!free?.[a] || !free[b] || a === b) return;
    const used = new Set(free.map((x) => x?.id));
    const name = (k: number): string => {
      const t = free[k];
      if (typeof t.id === 'string' && OBJ_ID.test(t.id)) return t.id;
      let id = `obj-${k + 1}`;
      for (let n = 2; used.has(id); n++) id = `obj-${k + 1}-${n}`;
      used.add(id);
      t.id = id;
      return id;
    };
    const conn: Block = { type: 'connector', from: name(a), to: name(b) };
    if (proto.route && proto.route !== 'elbow') conn.route = proto.route;
    if (proto.head && proto.head !== 'end') conn.head = proto.head;
    if (proto.fromSide) conn.fromSide = proto.fromSide;
    if (proto.toSide) conn.toSide = proto.toSide;
    at = Math.min(a, b);
    free.splice(at, 0, conn);
  }, { rebuild: true });
  if (!ok || at < 0) return false;
  ed.selectFree(i, at);
  ed.toast('Соединено: линия следует за объектами. Вид и стрелки — на вкладке «Соединитель»', 2600);
  return true;
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** Режим соединения: точки на сторонах объекта под мышью; протянуть или два щелчка; Esc или щелчок мимо — отмена */
export function connectTool(h: Host): { start(proto?: ConnectorProto, fromSelection?: boolean): void; cancel(): void; readonly on: boolean } {
  let proto: ConnectorProto = {};
  let on = false;
  /** Первый объект и сторона, если начали с точки */
  let first: { el: HTMLElement; side?: Side } | null = null;
  let hover: HTMLElement | null = null;
  let press: { x: number; y: number } | null = null;
  let dragging = false;
  let layer: HTMLElement | null = null;
  let ghost: SVGSVGElement | null = null;

  const slideEl = () => h.stage().querySelector<HTMLElement>('.slide.on');
  /** Объект слайда, который можно соединить: под мышью или хозяин точки */
  const objAt = (t: EventTarget | null): HTMLElement | null => {
    const pt = (t as Element | null)?.closest?.<HTMLElement>('.st-conn-pt');
    const f = pt ? slideEl()?.querySelector<HTMLElement>(`:scope > .free[data-free="${CSS.escape(pt.dataset.free!)}"]`) : (t as Element | null)?.closest?.<HTMLElement>('.slide.on > .free[data-free]');
    if (!f || !h.stage().contains(f) || f.classList.contains('locked') || f.querySelector(':scope > .conn-box')) return null;
    const p = JSON.parse(f.dataset.free!) as Path;
    return p.length === 4 && p[2] === 'free' ? f : null;
  };
  const sideAt = (t: EventTarget | null): Side | undefined => (t as Element | null)?.closest?.<HTMLElement>('.st-conn-pt')?.dataset.side as Side | undefined;
  const indexOf = (f: HTMLElement) => Number((JSON.parse(f.dataset.free!) as Path)[3]);
  /** Рамка объекта в пикселях слайда (без transform: анимация появления не сбивает точки) */
  const boxOf = (f: HTMLElement) => ({ x: f.offsetLeft, y: f.offsetTop, w: f.offsetWidth, h: f.offsetHeight });
  const pointOf = (f: HTMLElement, s?: Side): [number, number] => {
    const b = boxOf(f);
    if (s === 'top') return [b.x + b.w / 2, b.y];
    if (s === 'bottom') return [b.x + b.w / 2, b.y + b.h];
    if (s === 'left') return [b.x, b.y + b.h / 2];
    if (s === 'right') return [b.x + b.w, b.y + b.h / 2];
    return [b.x + b.w / 2, b.y + b.h / 2];
  };

  /** Точки на сторонах объекта под мышью и первого выбранного */
  function draw(): void {
    const slide = slideEl();
    if (!slide) return;
    if (!layer || layer.parentElement !== slide) {
      layer?.remove();
      layer = document.createElement('div');
      layer.className = 'st-conn-pts';
      slide.appendChild(layer);
    }
    const objs = [...new Set([first?.el, hover].filter((x): x is HTMLElement => !!x && x.isConnected))];
    layer.innerHTML = objs.map((f) => SIDES.map((s) => {
      const [x, y] = pointOf(f, s);
      const picked = f === first?.el && s === first.side;
      return `<i class="st-conn-pt${picked ? ' on' : ''}" data-free="${f.dataset.free!.replace(/"/g, '&quot;')}" data-side="${s}" style="left:${x}px;top:${y}px" title="Соединить от этой стороны"></i>`;
    }).join('')).join('');
    document.querySelectorAll('.st-conn-over').forEach((x) => { if (x !== hover) x.classList.remove('st-conn-over'); });
    hover?.classList.add('st-conn-over');
  }

  /** Пунктир от первого объекта (его точки) до мыши или до точки под мышью */
  function line(e: PointerEvent): void {
    const slide = slideEl();
    if (!first || !slide) return;
    if (!ghost || ghost.parentElement !== slide) {
      ghost?.remove();
      ghost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ghost.setAttribute('class', 'st-conn-ghost');
      ghost.innerHTML = '<line/>';
      slide.appendChild(ghost);
    }
    const [x1, y1] = pointOf(first.el, first.side);
    const target = objAt(e.target);
    const side = sideAt(e.target);
    const [x2, y2] = target && side && target !== first.el ? pointOf(target, side) : (({ x, y }) => [x, y])(h.editor.toSlide(e.clientX, e.clientY));
    const l = ghost.firstElementChild!;
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
  }

  function finish(to: HTMLElement, side?: Side): void {
    if (!first) return;
    const a = indexOf(first.el);
    const b = indexOf(to);
    const p: ConnectorProto = { ...proto, fromSide: first.side, toSide: side };
    cancel();
    connectObjects(h.editor, h.index(), a, b, p);
  }

  const down = (e: PointerEvent) => {
    if (!on || e.button !== 0) return;
    const f = objAt(e.target);
    // Щелчок мимо объектов (но по слайду) — отмена; панели и лента работают как обычно
    if (!f) { if (h.stage().contains(e.target as Node)) { e.preventDefault(); e.stopPropagation(); cancel(); } return; }
    e.preventDefault();
    e.stopPropagation();
    const side = sideAt(e.target);
    if (first && f !== first.el) { finish(f, side); return; }
    // Первый объект (или другая его сторона): дальше — протянуть к второму или щёлкнуть по нему
    first = { el: f, side };
    press = { x: e.clientX, y: e.clientY };
    dragging = false;
    draw();
    h.editor.toast('Протяните к другому объекту или щёлкните по нему. Точка на стороне — линия держится её', 4000);
  };
  const move = (e: PointerEvent) => {
    if (!on) return;
    const f = objAt(e.target);
    if (f !== hover) { hover = f; draw(); }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) dragging = true;
    line(e);
  };
  const up = (e: PointerEvent) => {
    if (!on || !press) return;
    press = null;
    if (!dragging) return;
    dragging = false;
    const f = objAt(e.target);
    if (f && first && f !== first.el) finish(f, sideAt(e.target));
    else h.editor.toast('Отпустите над другим объектом — или щёлкните по нему', 2500);
  };
  const key = (e: KeyboardEvent) => {
    if (on && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  // Щелчок по объекту в режиме соединения не должен выделять его или начинать правку текста
  const swallow = (e: MouseEvent) => { if (on && objAt(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  const EVENTS: [string, EventListener][] = [['pointerdown', down as EventListener], ['pointermove', move as EventListener], ['pointerup', up as EventListener],
    ['keydown', key as EventListener], ['click', swallow as EventListener], ['dblclick', swallow as EventListener]];

  function cancel(): void {
    if (!on) return;
    on = false;
    first = hover = null;
    press = null;
    layer?.remove();
    ghost?.remove();
    layer = null;
    ghost = null;
    document.querySelectorAll('.st-conn-over').forEach((x) => x.classList.remove('st-conn-over'));
    document.body.classList.remove('st-connecting');
    EVENTS.forEach(([n, f]) => removeEventListener(n, f, true));
  }

  /** fromSelection — выделенный объект (из его вкладки на ленте) становится началом линии */
  function start(p: ConnectorProto = {}, fromSelection = false): void {
    cancel();
    // Уже выделены два объекта — соединяются сразу
    const pair = pickedPair(h.deck, h.editor.selection);
    if (pair) { connectObjects(h.editor, h.index(), pair[0], pair[1], p); return; }
    const sel = h.editor.selection;
    const one = fromSelection && sel?.free && sel.group.length <= 1 && !isConn(getAt(h.deck, sel.free))
      ? slideEl()?.querySelector<HTMLElement>(`:scope > .free[data-free="${CSS.escape(JSON.stringify(sel.free))}"]`) ?? null
      : null;
    proto = p;
    on = true;
    h.editor.clearSelection();
    document.body.classList.add('st-connecting');
    EVENTS.forEach(([n, f]) => addEventListener(n, f, true));
    if (one) {
      first = { el: one };
      draw();
      h.editor.toast('Щёлкните объект, к которому идёт линия (или точку на его стороне). Esc — отмена', 4000);
    } else h.editor.toast('Протяните от объекта к другому или щёлкните по одному и по другому. Esc — отмена', 4000);
  }

  return { start, cancel, get on() { return on; } };
}
