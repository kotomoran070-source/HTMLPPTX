import { H, W } from '../engine/deck-view';

/**
 * Линейка, сетка и направляющие вокруг слайда (вкладка «Вид»).
 * Единицы — пиксели слайда 1280×720, как в полях «Положение и размер».
 * Направляющую вытягивают из линейки: сверху — горизонтальную, слева — вертикальную;
 * утащили за край слайда — она удаляется. Объекты прилипают к направляющим и к сетке.
 */

export interface AidsState { ruler: boolean; grid: boolean; guides: boolean; step: number }

interface AidsHost {
  canvas: HTMLElement;
  paper: HTMLElement;
  stage(): HTMLElement;
  /** Выделенный объект: его границы подсвечиваются на линейке */
  selected(): HTMLElement | null;
  deckKey: string;
  changed(): void;
}

const RULER = 20;
export const GRID_STEPS = [20, 40, 80];

export class ViewAids {
  private rh: HTMLCanvasElement;
  private rv: HTMLCanvasElement;
  private corner: HTMLElement;
  private grid: HTMLElement;
  private layer: HTMLElement;
  private tip: HTMLElement;
  private lines: { v: number[]; h: number[] } = { v: [W / 2], h: [H / 2] };
  private queued = false;

  constructor(private host: AidsHost, public state: AidsState) {
    const view = host.canvas.parentElement!;
    view.insertAdjacentHTML('beforeend', `<canvas class="st-ruler h" aria-hidden="true" title="Потяните вниз — горизонтальная направляющая"></canvas>
<canvas class="st-ruler v" aria-hidden="true" title="Потяните вправо — вертикальная направляющая"></canvas><i class="st-ruler-corner" aria-hidden="true"></i>`);
    this.rh = view.querySelector('.st-ruler.h')!;
    this.rv = view.querySelector('.st-ruler.v')!;
    this.corner = view.querySelector('.st-ruler-corner')!;
    host.paper.insertAdjacentHTML('beforeend', '<div class="st-grid" aria-hidden="true"></div><div class="st-guides"></div><output class="st-guide-tip" hidden></output>');
    this.grid = host.paper.querySelector('.st-grid')!;
    this.layer = host.paper.querySelector('.st-guides')!;
    this.tip = host.paper.querySelector('.st-guide-tip')!;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key()) ?? 'null');
      if (saved && Array.isArray(saved.v) && Array.isArray(saved.h)) this.lines = { v: saved.v.filter(Number.isFinite), h: saved.h.filter(Number.isFinite) };
    } catch { /* направляющие по умолчанию */ }

    host.canvas.addEventListener('scroll', () => this.redraw(), { passive: true });
    new ResizeObserver(() => this.redraw()).observe(host.canvas);
    // Пока тянут объект, его границы на линейке едут вместе с ним
    addEventListener('pointermove', (e) => { if (e.buttons && this.state.ruler) this.redraw(); }, { passive: true });
    this.rh.addEventListener('pointerdown', (e) => this.pull('h', e));
    this.rv.addEventListener('pointerdown', (e) => this.pull('v', e));
    this.layer.addEventListener('pointerdown', (e) => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
      if (!g) return;
      const axis = g.dataset.g as 'v' | 'h';
      const i = Number(g.dataset.i);
      this.lines[axis].splice(i, 1);
      this.drag(axis, e);
    });
    this.layer.addEventListener('dblclick', (e) => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
      if (!g) return;
      this.lines[g.dataset.g as 'v' | 'h'].splice(Number(g.dataset.i), 1);
      this.save();
      this.render();
    });
    this.apply();
  }

  private key(): string {
    return `htmlpptx-guides-${this.host.deckKey}`;
  }

  private save(): void {
    try { localStorage.setItem(this.key(), JSON.stringify(this.lines)); } catch { /* нет доступа */ }
  }

  /** Линии прилипания для редактора */
  snapLines(): { v: number[]; h: number[] } {
    const v: number[] = [];
    const h: number[] = [];
    if (this.state.guides) { v.push(...this.lines.v); h.push(...this.lines.h); }
    if (this.state.grid) {
      for (let x = this.state.step; x < W; x += this.state.step) v.push(x);
      for (let y = this.state.step; y < H; y += this.state.step) h.push(y);
    }
    return { v, h };
  }

  resetGuides(): void {
    this.lines = { v: [W / 2], h: [H / 2] };
    this.save();
    this.render();
  }

  /** Состояние изменилось (включили линейку, сетку…) */
  apply(): void {
    const view = this.host.canvas.parentElement!;
    view.classList.toggle('with-rulers', this.state.ruler);
    this.rh.hidden = this.rv.hidden = !this.state.ruler;
    this.corner.hidden = !this.state.ruler;
    this.grid.hidden = !this.state.grid;
    this.layer.hidden = !this.state.guides;
    this.render();
  }

  /** Масштаб, прокрутка или выделение изменились */
  redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  private scale(): number {
    return this.host.paper.offsetWidth / W || 1;
  }

  private render(): void {
    const k = this.scale();
    this.grid.style.setProperty('--gs', `${this.state.step * k}px`);
    this.layer.innerHTML = (['v', 'h'] as const).flatMap((axis) => this.lines[axis].map((at, i) =>
      `<i class="st-guide ${axis}" data-g="${axis}" data-i="${i}" style="${axis === 'v' ? 'left' : 'top'}:${at * k}px" title="${Math.round(at)} — потяните, чтобы переместить; за край слайда — удалить"></i>`)).join('');
    if (this.state.ruler) this.drawRulers(k);
  }

  private drawRulers(k: number): void {
    const c = this.host.canvas.getBoundingClientRect();
    const view = this.host.canvas.parentElement!.getBoundingClientRect();
    const p = this.host.paper.getBoundingClientRect();
    const top = c.top - view.top;
    const left = c.left - view.left;
    Object.assign(this.rh.style, { top: `${top}px`, left: `${left + RULER}px`, width: `${c.width - RULER}px` });
    Object.assign(this.rv.style, { top: `${top + RULER}px`, left: `${left}px`, height: `${c.height - RULER}px` });
    Object.assign(this.corner.style, { top: `${top}px`, left: `${left}px` });
    const sel = this.host.selected()?.getBoundingClientRect() ?? null;
    this.drawOne(this.rh, 'h', c.width - RULER, (p.left - c.left - RULER), k, sel ? [(sel.left - p.left) / k, (sel.right - p.left) / k] : null, W);
    this.drawOne(this.rv, 'v', c.height - RULER, (p.top - c.top - RULER), k, sel ? [(sel.top - p.top) / k, (sel.bottom - p.top) / k] : null, H);
  }

  /** Одна линейка: деления каждые 10, 50 и 100 пикселей слайда (реже — при мелком масштабе) */
  private drawOne(cv: HTMLCanvasElement, dir: 'h' | 'v', len: number, origin: number, k: number, sel: [number, number] | null, max: number): void {
    const dpr = devicePixelRatio || 1;
    const wpx = dir === 'h' ? len : RULER;
    const hpx = dir === 'h' ? RULER : len;
    if (wpx <= 0 || hpx <= 0) return;
    cv.width = Math.round(wpx * dpr);
    cv.height = Math.round(hpx * dpr);
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    const cs = getComputedStyle(document.documentElement);
    const col = (v: string) => cs.getPropertyValue(v).trim();
    // Вдоль линейки: t — координата по длине, s — поперёк
    const rect = (t0: number, t1: number, s0: number, s1: number) => (dir === 'h' ? g.fillRect(t0, s0, t1 - t0, s1 - s0) : g.fillRect(s0, t0, s1 - s0, t1 - t0));
    g.fillStyle = col('--alt');
    rect(0, len, 0, RULER);
    // Сам слайд на линейке — светлее
    g.fillStyle = col('--surf');
    rect(Math.max(0, origin), Math.min(len, origin + max * k), 0, RULER);
    if (sel) {
      g.fillStyle = col('--acs');
      rect(origin + sel[0] * k, origin + sel[1] * k, 0, RULER);
    }
    const minor = [5, 10, 20, 50, 100].find((m) => m * k >= 6) ?? 100;
    const major = minor <= 10 ? 100 : minor <= 20 ? 200 : minor <= 50 ? 500 : 1000;
    const from = Math.floor(-origin / k / minor) * minor;
    const to = (len - origin) / k;
    g.fillStyle = col('--mu');
    g.font = `500 9.5px ${col('--font') || 'sans-serif'}`;
    g.textBaseline = 'top';
    for (let v = from; v <= to; v += minor) {
      const t = Math.round(origin + v * k) + 0.5;
      const isMajor = v % major === 0;
      const isMid = !isMajor && v % (major / 2) === 0;
      const size = isMajor ? RULER - 4 : isMid ? 7 : 4;
      g.globalAlpha = v < 0 || v > max ? 0.45 : 1;
      rect(t - 0.5, t + 0.5, RULER - size, RULER);
      if (isMajor) {
        if (dir === 'h') g.fillText(String(v), t + 3, 2);
        else {
          g.save();
          g.translate(2, t + 3);
          g.rotate(Math.PI / 2);
          g.fillText(String(v), 0, -9);
          g.restore();
        }
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = col('--bd');
    if (dir === 'h') g.fillRect(0, RULER - 1, len, 1);
    else g.fillRect(RULER - 1, 0, 1, len);
  }

  /** Вытянуть новую направляющую из линейки */
  private pull(from: 'h' | 'v', e: PointerEvent): void {
    if (e.button !== 0) return;
    // Сверху тянут горизонтальную, слева — вертикальную
    const axis = from === 'h' ? 'h' : 'v';
    if (!this.state.guides) {
      this.state.guides = true;
      this.apply();
      this.host.changed();
    }
    this.drag(axis, e);
  }

  private drag(axis: 'v' | 'h', e: PointerEvent): void {
    e.preventDefault();
    const k = this.scale();
    const line = document.createElement('i');
    line.className = `st-guide ${axis} moving`;
    this.layer.appendChild(line);
    const at = (ev: PointerEvent) => {
      const p = this.host.paper.getBoundingClientRect();
      return Math.round(axis === 'v' ? (ev.clientX - p.left) / k : (ev.clientY - p.top) / k);
    };
    const max = axis === 'v' ? W : H;
    const move = (ev: PointerEvent) => {
      let v = at(ev);
      // Прилипает к центру и к целым десяткам — так проще попасть в ровное место
      const center = max / 2;
      if (Math.abs(v - center) <= 6) v = center;
      const out = v < 0 || v > max;
      line.style[axis === 'v' ? 'left' : 'top'] = `${v * k}px`;
      line.classList.toggle('out', out);
      this.tip.hidden = false;
      this.tip.textContent = out ? 'Удалить' : String(v);
      this.tip.style.left = `${axis === 'v' ? v * k + 6 : 6}px`;
      this.tip.style.top = `${axis === 'v' ? 6 : v * k + 6}px`;
      line.dataset.v = String(v);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      this.tip.hidden = true;
      const v = Number(line.dataset.v);
      line.remove();
      if (line.dataset.v !== undefined && v >= 0 && v <= max) this.lines[axis].push(v);
      this.save();
      this.render();
    };
    move(e);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }
}
