/**
 * Соединение объектов линией (components/connector), как в PowerPoint: выделены два объекта — «Соединить»
 * связывает их сразу; иначе студия ждёт щелчков по двум объектам (за первым до мыши тянется пунктир).
 * Объектам без имени даётся имя (id): по нему линия находит их и следует за ними
 */
import { getAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { OBJ_ID } from '../engine/render';
import type { Block, Deck } from '../types';

type Path = (string | number)[];
export type ConnectorProto = { route?: 'straight' | 'elbow' | 'curve'; head?: string };

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
    at = Math.min(a, b);
    free.splice(at, 0, conn);
  }, { rebuild: true });
  if (!ok || at < 0) return false;
  ed.selectFree(i, at);
  ed.toast('Соединено: линия следует за объектами. Вид и стрелки — в свойствах', 2600);
  return true;
}

/** Режим соединения: щелчок по первому объекту, затем по второму; Esc или щелчок мимо — отмена */
export function connectTool(h: Host): { start(proto?: ConnectorProto): void; cancel(): void } {
  let proto: ConnectorProto = {};
  let first: HTMLElement | null = null;
  let on = false;
  let ghost: SVGSVGElement | null = null;

  /** Объект слайда под мышью, который можно соединить */
  const objAt = (t: EventTarget | null): HTMLElement | null => {
    const f = (t as Element | null)?.closest?.<HTMLElement>('.slide.on > .free[data-free]');
    if (!f || !h.stage().contains(f) || f.classList.contains('locked') || f.querySelector(':scope > .conn-box')) return null;
    const p = JSON.parse(f.dataset.free!) as Path;
    return p.length === 4 && p[2] === 'free' ? f : null;
  };
  const indexOf = (f: HTMLElement) => Number((JSON.parse(f.dataset.free!) as Path)[3]);

  const down = (e: PointerEvent) => {
    if (!on || e.button !== 0) return;
    const f = objAt(e.target);
    // Щелчок мимо объектов (но по слайду) — отмена; панели и лента работают как обычно
    if (!f) { if (h.stage().contains(e.target as Node)) { e.preventDefault(); e.stopPropagation(); cancel(); } return; }
    e.preventDefault();
    e.stopPropagation();
    if (!first) {
      first = f;
      f.classList.add('st-conn-from');
      h.editor.toast('Теперь щёлкните объект, к которому идёт линия. Esc — отмена', 4000);
      return;
    }
    if (f === first) return;
    const a = indexOf(first);
    const b = indexOf(f);
    const p = proto;
    cancel();
    connectObjects(h.editor, h.index(), a, b, p);
  };
  // Пунктир от первого объекта до мыши
  const move = (e: PointerEvent) => {
    if (!on) return;
    const slide = h.stage().querySelector<HTMLElement>('.slide.on');
    document.querySelectorAll('.st-conn-over').forEach((x) => x.classList.remove('st-conn-over'));
    objAt(e.target)?.classList.add('st-conn-over');
    if (!first || !slide) return;
    if (!ghost || ghost.parentElement !== slide) {
      ghost?.remove();
      ghost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ghost.setAttribute('class', 'st-conn-ghost');
      ghost.innerHTML = '<line/>';
      slide.appendChild(ghost);
    }
    const p = h.editor.toSlide(e.clientX, e.clientY);
    const l = ghost.firstElementChild!;
    l.setAttribute('x1', String(first.offsetLeft + first.offsetWidth / 2));
    l.setAttribute('y1', String(first.offsetTop + first.offsetHeight / 2));
    l.setAttribute('x2', String(p.x));
    l.setAttribute('y2', String(p.y));
  };
  const key = (e: KeyboardEvent) => {
    if (on && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  // Щелчок по объекту в режиме соединения не должен выделять его или начинать правку текста
  const swallow = (e: MouseEvent) => { if (on && objAt(e.target)) { e.preventDefault(); e.stopPropagation(); } };

  function cancel(): void {
    if (!on) return;
    on = false;
    first?.classList.remove('st-conn-from');
    first = null;
    ghost?.remove();
    ghost = null;
    document.querySelectorAll('.st-conn-over').forEach((x) => x.classList.remove('st-conn-over'));
    document.body.classList.remove('st-connecting');
    removeEventListener('pointerdown', down, true);
    removeEventListener('pointermove', move, true);
    removeEventListener('keydown', key, true);
    removeEventListener('click', swallow, true);
    removeEventListener('dblclick', swallow, true);
  }

  function start(p: ConnectorProto = {}): void {
    cancel();
    // Уже выделены два объекта — соединяются сразу
    const pair = pickedPair(h.deck, h.editor.selection);
    if (pair) { connectObjects(h.editor, h.index(), pair[0], pair[1], p); return; }
    proto = p;
    on = true;
    h.editor.clearSelection();
    document.body.classList.add('st-connecting');
    addEventListener('pointerdown', down, true);
    addEventListener('pointermove', move, true);
    addEventListener('keydown', key, true);
    addEventListener('click', swallow, true);
    addEventListener('dblclick', swallow, true);
    h.editor.toast('Щёлкните объект, от которого идёт линия, затем второй. Esc — отмена', 4000);
  }

  return { start, cancel };
}
