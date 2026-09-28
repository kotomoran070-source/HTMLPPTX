/**
 * Выделение рамкой: тянуть мышью с пустого места слайда или с серого поля вокруг.
 * Выделяются свободные объекты, целиком попавшие в рамку; с Shift — добавляются к выделенным.
 */

interface MarqueeHost {
  canvas: HTMLElement;
  stage(): HTMLElement;
  /** Номер текущего слайда */
  index(): number;
  /** Номера свободных объектов, выделенных сейчас */
  selected(): number[];
  select(indexes: number[]): void;
  /** Кисть формата или просмотр: рамка не нужна */
  busy(): boolean;
}

const START = 4;

export function setupMarquee(h: MarqueeHost): void {
  const box = document.createElement('div');
  box.className = 'st-marquee';
  box.hidden = true;
  document.body.appendChild(box);
  let swallow = false;

  /** Пустое место: не объект, не блок раскладки, не текст в правке, не ручки и полосы прокрутки */
  const empty = (t: Element, e: PointerEvent): boolean => {
    if (t === h.canvas && (e.offsetX > h.canvas.clientWidth || e.offsetY > h.canvas.clientHeight)) return false;
    if (t.closest('[data-free], [contenteditable="true"], .st-guide, .st-ruler, button, input, textarea, select')) return false;
    // Блок раскладки — не пустое место; кроме вёрстки во весь слайд (фон импортированного слайда)
    const blk = t.closest<HTMLElement>('[data-block]');
    if (blk) {
      const r = blk.getBoundingClientRect();
      const s = h.stage().getBoundingClientRect();
      if (blk.classList.contains('ed-selected') || r.width * r.height < s.width * s.height * 0.85) return false;
    }
    return h.canvas.contains(t);
  };

  h.canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || h.busy()) return;
    const t = e.target as Element;
    if (!empty(t, e)) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const add = e.shiftKey;
    const before = add ? h.selected() : [];
    let on = false;
    let picked: number[] = [];
    const rect = (ev: PointerEvent) => ({
      l: Math.min(x0, ev.clientX), t: Math.min(y0, ev.clientY), r: Math.max(x0, ev.clientX), b: Math.max(y0, ev.clientY),
    });
    const move = (ev: PointerEvent) => {
      if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < START) return;
      if (!on) {
        on = true;
        document.body.classList.add('st-marqueeing');
        box.hidden = false;
      }
      const m = rect(ev);
      Object.assign(box.style, { left: `${m.l}px`, top: `${m.t}px`, width: `${m.r - m.l}px`, height: `${m.b - m.t}px` });
      // Подсветка того, что попадёт в выделение, — прямо во время протягивания
      picked = [];
      // Закреплённые и скрытые на время правки рамкой не выделяются
      h.stage().querySelectorAll<HTMLElement>(':scope > .slide.on > [data-free]:not(.locked, .st-hidden)').forEach((el) => {
        const r = el.getBoundingClientRect();
        const inside = r.width > 0 && r.left >= m.l && r.right <= m.r && r.top >= m.t && r.bottom <= m.b;
        el.classList.toggle('st-marquee-hit', inside);
        if (!inside) return;
        try {
          const path = JSON.parse(el.getAttribute('data-free') ?? '') as unknown[];
          if (Number(path[1]) === h.index()) picked.push(Number(path[3]));
        } catch { /* не свободный объект */ }
      });
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      h.stage().querySelectorAll('.st-marquee-hit').forEach((el) => el.classList.remove('st-marquee-hit'));
      if (!on) return;
      box.hidden = true;
      document.body.classList.remove('st-marqueeing');
      // Щелчок после протягивания не снимает только что сделанное выделение
      swallow = true;
      setTimeout(() => { swallow = false; }, 0);
      h.select([...new Set([...before, ...picked])].sort((a, b) => a - b));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
  addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}
