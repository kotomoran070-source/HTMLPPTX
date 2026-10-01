/**
 * Указка, перо и маркер: слой поверх сцены (координаты слайда 1280×720, масштабируется вместе с ним).
 * Рисует докладчик в своём окне, окно показа повторяет по сообщениям синхронизации.
 */
import './ink.css';

export interface StrokeStyle {
  color: string;
  /** Толщина в пикселях слайда */
  width: number;
  /** Маркер: полупрозрачный, под текстом */
  marker?: boolean;
}

export type InkMsg =
  | { op: 'laser'; x: number; y: number }
  | { op: 'laser-off' }
  | { op: 'start'; id: string; x: number; y: number; style?: StrokeStyle }
  | { op: 'pt'; id: string; x: number; y: number }
  | { op: 'clear' }
  /** Обычная мышь докладчика над слайдом: курсор и наведение у зрителей */
  | { op: 'cursor'; x: number; y: number }
  | { op: 'cursor-off' }
  | { op: 'click'; x: number; y: number };

const NS = 'http://www.w3.org/2000/svg';
/** Сколько живёт след указки, мс */
const TRAIL_MS = 220;
const DEFAULT_STYLE: StrokeStyle = { color: '#EF4444', width: 5 };

interface Stroke { el: SVGPathElement; pts: [number, number][] }

/** Сглаженный путь: кривые через середины отрезков (без «ступенек» от мыши). */
function smooth(pts: [number, number][]): string {
  const f = (n: number) => n.toFixed(1);
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (pts.length === 1 ? `l0.1 0` : '');
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + `L${f(lx)} ${f(ly)}`;
}

export class Ink {
  readonly layer: HTMLElement;
  private svg: SVGSVGElement;
  private marks: SVGGElement;
  private lines: SVGGElement;
  private trail: SVGGElement;
  private dot: HTMLElement;
  private cur: HTMLElement;
  private curTimer = 0;
  private strokes = new Map<string, Stroke>();
  private track: { x: number; y: number; t: number }[] = [];
  private raf = 0;

  constructor(private stage: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'ink';
    this.layer.innerHTML = `<svg viewBox="0 0 1280 720" preserveAspectRatio="none"><g class="ink-marks"></g><g class="ink-lines"></g><g class="ink-trail"></g></svg><div class="ink-dot"><i></i></div><div class="ink-cur" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.3 1.5L10 19z"/></svg></div>`;
    this.svg = this.layer.querySelector('svg')!;
    this.marks = this.svg.querySelector('.ink-marks')!;
    this.lines = this.svg.querySelector('.ink-lines')!;
    this.trail = this.svg.querySelector('.ink-trail')!;
    this.dot = this.layer.querySelector('.ink-dot')!;
    this.cur = this.layer.querySelector('.ink-cur')!;
    // Сцена перестраивается (правки, смена темы) — слой возвращается на место
    const keep = () => { if (this.layer.parentElement !== stage) stage.appendChild(this.layer); };
    new MutationObserver(keep).observe(stage, { childList: true });
    keep();
  }

  apply(m: InkMsg): void {
    if (m.op === 'cursor') {
      // Курсор прячется, если мышь стоит: как в PowerPoint
      this.cur.style.transform = `translate(${m.x}px, ${m.y}px)`;
      this.cur.classList.add('on');
      clearTimeout(this.curTimer);
      this.curTimer = window.setTimeout(() => this.cur.classList.remove('on'), 2500);
    } else if (m.op === 'cursor-off') {
      clearTimeout(this.curTimer);
      this.cur.classList.remove('on');
    } else if (m.op === 'click') {
      // Сам щелчок повторяет окно показа (RemoteHover); здесь — только курсор на месте
      this.apply({ op: 'cursor', x: m.x, y: m.y });
    } else if (m.op === 'laser') {
      this.dot.style.transform = `translate(${m.x}px, ${m.y}px)`;
      this.dot.classList.add('on');
      this.track.push({ x: m.x, y: m.y, t: performance.now() });
      this.animate();
    } else if (m.op === 'laser-off') {
      this.dot.classList.remove('on');
    } else if (m.op === 'start') {
      const st = m.style ?? DEFAULT_STYLE;
      const el = document.createElementNS(NS, 'path');
      el.setAttribute('stroke', st.color);
      el.setAttribute('stroke-width', String(st.width));
      if (st.marker) el.setAttribute('class', 'marker');
      const s: Stroke = { el, pts: [[m.x, m.y]] };
      el.setAttribute('d', smooth(s.pts));
      (st.marker ? this.marks : this.lines).appendChild(el);
      this.strokes.set(m.id, s);
    } else if (m.op === 'pt') {
      const s = this.strokes.get(m.id);
      if (!s) return;
      const last = s.pts[s.pts.length - 1];
      // Точки ближе полупикселя не добавляют формы, только вес
      if (Math.abs(last[0] - m.x) + Math.abs(last[1] - m.y) < 0.8) return;
      s.pts.push([m.x, m.y]);
      s.el.setAttribute('d', smooth(s.pts));
    } else if (m.op === 'clear') {
      this.marks.replaceChildren();
      this.lines.replaceChildren();
      this.strokes.clear();
      this.dot.classList.remove('on');
    }
  }

  /** След указки: хвост из точек, тающий за доли секунды. */
  private animate(): void {
    if (this.raf) return;
    const frame = () => {
      const now = performance.now();
      this.track = this.track.filter((p) => now - p.t < TRAIL_MS);
      if (this.track.length < 2) {
        this.trail.replaceChildren();
        this.raf = 0;
        return;
      }
      let html = '';
      for (let i = 1; i < this.track.length; i++) {
        const a = this.track[i - 1];
        const b = this.track[i];
        const life = 1 - (now - b.t) / TRAIL_MS;
        html += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-width="${(1 + 4 * life).toFixed(1)}" stroke-opacity="${(0.4 * life * life).toFixed(2)}"/>`;
      }
      this.trail.innerHTML = html;
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Точка экрана → координаты слайда. */
  toSlide(e: PointerEvent): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1280, y: ((e.clientY - r.top) / r.height) * 720 };
  }
}

export type InkTool = 'none' | 'laser' | 'pen' | 'marker';

/**
 * Рисование мышью или пальцем по области слайда (окно докладчика).
 * send — передать действие окну показа; действие сразу применяется и локально.
 */
export function inkInput(area: HTMLElement, ink: Ink, tool: () => InkTool, style: () => StrokeStyle, send: (m: InkMsg) => void, mirror: () => boolean = () => true): void {
  const emit = (m: InkMsg) => { ink.apply(m); send(m); };
  let stroke: string | null = null;
  let raf = 0;
  let pending: PointerEvent | null = null;
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= 1280 && p.y <= 720;

  area.addEventListener('pointerdown', (e) => {
    const t = tool();
    // Указка пальцем: точка сразу под пальцем, а не после первого движения
    if (t === 'laser' && e.pointerType !== 'mouse') {
      const p = ink.toSlide(e);
      if (!inside(p)) return;
      e.preventDefault();
      area.setPointerCapture(e.pointerId);
      emit({ op: 'laser', ...p });
      return;
    }
    if ((t !== 'pen' && t !== 'marker') || e.button !== 0) return;
    const p = ink.toSlide(e);
    if (!inside(p)) return;
    e.preventDefault();
    area.setPointerCapture(e.pointerId);
    stroke = Math.random().toString(36).slice(2, 9);
    emit({ op: 'start', id: stroke, ...p, style: style() });
  });
  // Без инструмента — обычная мышь: зрители видят курсор и наведение (у себя не рисуем — есть свой)
  let curRaf = 0;
  let curAt: { x: number; y: number } | null = null;
  area.addEventListener('pointermove', (e) => {
    if (tool() !== 'none' || e.pointerType === 'touch' || !mirror()) return;
    curAt = ink.toSlide(e);
    if (curRaf) return;
    curRaf = requestAnimationFrame(() => {
      curRaf = 0;
      if (curAt) send(inside(curAt) ? { op: 'cursor', ...curAt } : { op: 'cursor-off' });
    });
  });
  area.addEventListener('click', (e) => {
    if (tool() !== 'none' || e.button !== 0 || !mirror()) return;
    const p = ink.toSlide(e as PointerEvent);
    if (inside(p)) send({ op: 'click', ...p });
  });
  area.addEventListener('pointerleave', () => { if (tool() === 'none' && mirror()) send({ op: 'cursor-off' }); });
  area.addEventListener('pointermove', (e) => {
    const t = tool();
    if (t === 'none') return;
    // Все промежуточные точки (при быстром движении мышь даёт их пачкой)
    const evs = (e.getCoalescedEvents?.() ?? []).length ? e.getCoalescedEvents() : [e];
    if (stroke && (t === 'pen' || t === 'marker')) {
      for (const ev of evs) emit({ op: 'pt', id: stroke, ...ink.toSlide(ev) });
      return;
    }
    pending = e;
    if (raf) return;
    // Указка — не чаще кадра: сообщений между окнами не больше, чем нужно
    raf = requestAnimationFrame(() => {
      raf = 0;
      const p = ink.toSlide(pending!);
      if (tool() === 'laser') emit(inside(p) ? { op: 'laser', ...p } : { op: 'laser-off' });
    });
  });
  const end = (e: PointerEvent) => {
    stroke = null;
    // Палец подняли — указка гаснет (у мыши она гаснет, когда курсор уходит со слайда)
    if (tool() === 'laser' && e.pointerType !== 'mouse') emit({ op: 'laser-off' });
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
  area.addEventListener('pointerleave', () => { if (tool() === 'laser') emit({ op: 'laser-off' }); });
}
