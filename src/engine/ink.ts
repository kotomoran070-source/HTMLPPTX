/**
 * Указка и перо: слой поверх сцены (координаты слайда 1280×720, масштабируется вместе с ним).
 * Рисует докладчик в своём окне, окно показа повторяет по сообщениям синхронизации.
 */
import './ink.css';

export type InkMsg =
  | { op: 'laser'; x: number; y: number }
  | { op: 'laser-off' }
  | { op: 'start'; id: string; x: number; y: number }
  | { op: 'pt'; id: string; x: number; y: number }
  | { op: 'clear' };

const NS = 'http://www.w3.org/2000/svg';

export class Ink {
  readonly layer: HTMLElement;
  private svg: SVGSVGElement;
  private dot: HTMLElement;
  private paths = new Map<string, { el: SVGPathElement; d: string }>();

  constructor(private stage: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'ink';
    this.layer.innerHTML = `<svg viewBox="0 0 1280 720" preserveAspectRatio="none"></svg><div class="ink-dot"></div>`;
    this.svg = this.layer.querySelector('svg')!;
    this.dot = this.layer.querySelector('.ink-dot')!;
    // Сцена перестраивается (правки, смена темы) — слой возвращается на место
    const keep = () => { if (this.layer.parentElement !== stage) stage.appendChild(this.layer); };
    new MutationObserver(keep).observe(stage, { childList: true });
    keep();
  }

  apply(m: InkMsg): void {
    if (m.op === 'laser') {
      this.dot.style.transform = `translate(${m.x}px, ${m.y}px)`;
      this.dot.classList.add('on');
    } else if (m.op === 'laser-off') {
      this.dot.classList.remove('on');
    } else if (m.op === 'start') {
      const el = document.createElementNS(NS, 'path');
      const d = `M${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
      el.setAttribute('d', d);
      this.svg.appendChild(el);
      this.paths.set(m.id, { el, d });
    } else if (m.op === 'pt') {
      const p = this.paths.get(m.id);
      if (!p) return;
      p.d += `L${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
      p.el.setAttribute('d', p.d);
    } else if (m.op === 'clear') {
      this.svg.innerHTML = '';
      this.paths.clear();
      this.dot.classList.remove('on');
    }
  }

  /** Точка экрана → координаты слайда. */
  toSlide(e: PointerEvent): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1280, y: ((e.clientY - r.top) / r.height) * 720 };
  }
}

export type InkTool = 'none' | 'laser' | 'pen';

/**
 * Рисование мышью или пальцем по области слайда (окно докладчика).
 * send — передать действие окну показа; действие сразу применяется и локально.
 */
export function inkInput(area: HTMLElement, ink: Ink, tool: () => InkTool, send: (m: InkMsg) => void): void {
  const emit = (m: InkMsg) => { ink.apply(m); send(m); };
  let stroke: string | null = null;
  let raf = 0;
  let pending: PointerEvent | null = null;
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= 1280 && p.y <= 720;

  area.addEventListener('pointerdown', (e) => {
    if (tool() !== 'pen' || e.button !== 0) return;
    const p = ink.toSlide(e);
    if (!inside(p)) return;
    e.preventDefault();
    area.setPointerCapture(e.pointerId);
    stroke = Math.random().toString(36).slice(2, 9);
    emit({ op: 'start', id: stroke, ...p });
  });
  area.addEventListener('pointermove', (e) => {
    const t = tool();
    if (t === 'none') return;
    pending = e;
    if (raf) return;
    // Не чаще кадра: сообщений между окнами не больше, чем нужно
    raf = requestAnimationFrame(() => {
      raf = 0;
      const ev = pending!;
      const p = ink.toSlide(ev);
      if (t === 'pen' && stroke) emit({ op: 'pt', id: stroke, ...p });
      else if (t === 'laser') emit(inside(p) ? { op: 'laser', ...p } : { op: 'laser-off' });
    });
  });
  const end = () => { stroke = null; };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
  area.addEventListener('pointerleave', () => { if (tool() === 'laser') emit({ op: 'laser-off' }); });
}
