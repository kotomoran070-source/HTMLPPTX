/**
 * Перетаскивание строк в списке — как в ленте слайдов (slides-panel.ts): своё, на событиях указателя.
 * Системное (draggable) не отдаёт колёсико и не прокручивает список у края — длинный список было не перетащить
 * дальше видимого. Здесь: копия строки за курсором, линия в зазоре, куда она встанет, колёсико и край списка
 * прокручивают его на ходу, Esc и отпускание мимо списка — отмена. Область выделения и «Порядок» анимаций
 */

export interface RowDrag<T> {
  /** Список строк: на нём ловится нажатие */
  list: HTMLElement;
  /** Что прокручивается (может быть самим списком) */
  scroller: HTMLElement;
  /** Селектор строки */
  row: string;
  /** Взяли строку: какие строки едут (приглушаются) и сколько их; null — эту не тянуть */
  pick(row: HTMLElement): { rows: HTMLElement[]; count: number } | null;
  /** Куда встанет при отпускании на высоте y: строка и до/после неё; null — некуда (нельзя или ничего не изменится) */
  aim(y: number): { row: HTMLElement; after: boolean; data: T } | null;
  drop(data: T): void;
  /** Перетаскивание кончилось (отпустили или отменили) */
  end?(): void;
}

/** Сдвиг до начала перетаскивания: меньше — это щелчок */
const SLOP = 5;
/** Полоса у верхнего и нижнего края, где список едет сам, и наибольшая скорость, пикселей за кадр */
const EDGE = 40;
const SPEED = 18;

export function rowDrag<T>(o: RowDrag<T>): void {
  type State = {
    id: number; x: number; y: number; cx: number; cy: number; dx: number; dy: number;
    row: HTMLElement; on: boolean; ghost: HTMLElement | null; line: HTMLElement | null; moved: HTMLElement[]; raf: number;
  };
  let d: State | null = null;
  let noClick = false;

  // Отпускание после перетаскивания — не щелчок по строке (не выделять её, не жать её кнопки)
  o.list.addEventListener('click', (e) => {
    if (!noClick) return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
  // Системное перетаскивание (картинки, выделенный текст в строке) — не начинать
  o.list.addEventListener('dragstart', (e) => { if ((e.target as Element).closest?.(o.row)) e.preventDefault(); });

  o.list.addEventListener('pointerdown', (e) => {
    const row = (e.target as Element).closest<HTMLElement>(o.row);
    // С Shift и Ctrl — выделение, не перетаскивание; пальцем — прокрутка списка
    if (!row || !o.list.contains(row) || e.button !== 0 || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.metaKey || d) return;
    d = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0, row, on: false, ghost: null, line: null, moved: [], raf: 0 };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
  });

  const move = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.id) return;
    if (!(e.buttons & 1)) return finish(false);
    d.cx = e.clientX;
    d.cy = e.clientY;
    if (!d.on) {
      if (Math.hypot(d.cx - d.x, d.cy - d.y) < SLOP) return;
      if (!lift(d)) return finish(false);
    }
    queue();
  };
  const up = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.id) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    finish(true);
  };
  const cancel = () => finish(false);
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !d?.on) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(false);
  };
  const onScroll = () => queue();

  function lift(s: State): boolean {
    const got = o.pick(s.row);
    if (!got) return false;
    s.on = true;
    const r = s.row.getBoundingClientRect();
    s.dx = s.x - r.left;
    s.dy = s.y - r.top;
    const g = s.row.cloneNode(true) as HTMLElement;
    g.className = `${s.row.className} st-row-ghost`;
    g.classList.remove('dragging');
    g.removeAttribute('id');
    g.setAttribute('aria-hidden', 'true');
    g.style.width = `${r.width}px`;
    if (got.count > 1) g.dataset.count = String(got.count);
    document.body.appendChild(g);
    s.ghost = g;
    const line = document.createElement('div');
    line.className = 'st-row-line';
    line.hidden = true;
    document.body.appendChild(line);
    s.line = line;
    s.moved = got.rows;
    for (const el of got.rows) el.classList.add('dragging');
    document.documentElement.classList.add('st-row-drag');
    o.scroller.addEventListener('scroll', onScroll);
    if (!o.list.hasPointerCapture(s.id)) o.list.setPointerCapture(s.id);
    return true;
  }

  function queue(): void {
    const s = d;
    if (s?.on && !s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; frame(s); });
  }

  /** Где указатель: мимо списка (сбоку) — отпускание ничего не меняет; у края — скорость прокрутки */
  function where(s: State): { out: boolean; v: number; y: number } {
    const r = o.scroller.getBoundingClientRect();
    if (s.cx < r.left - 24 || s.cx > r.right + 24) return { out: true, v: 0, y: s.cy };
    const zone = Math.min(EDGE, r.height / 4);
    const k = s.cy < r.top + zone ? s.cy - r.top - zone : s.cy > r.bottom - zone ? s.cy - r.bottom + zone : 0;
    const v = Math.sign(k) * Math.ceil(Math.min(1, Math.abs(k) / zone) ** 2 * SPEED);
    return { out: false, v, y: Math.min(Math.max(s.cy, r.top), r.bottom) };
  }

  function frame(s: State): void {
    if (d !== s) return;
    s.ghost!.style.transform = `translate(${s.cx - s.dx}px, ${s.cy - s.dy}px)`;
    const w = where(s);
    if (w.v) {
      const was = o.scroller.scrollTop;
      o.scroller.scrollTop += w.v;
      if (o.scroller.scrollTop !== was) queue();
    }
    s.ghost!.classList.toggle('out', w.out);
    document.documentElement.classList.toggle('st-row-drag-out', w.out);
    const t = w.out ? null : o.aim(w.y);
    s.line!.hidden = !t;
    if (t) place(s.line!, t.row, t.after);
  }

  /** Линия — посередине зазора у строки (до или после неё), в видимой части списка */
  function place(line: HTMLElement, row: HTMLElement, after: boolean): void {
    const rows = [...o.list.querySelectorAll<HTMLElement>(o.row)];
    const k = rows.indexOf(row);
    const r = row.getBoundingClientRect();
    const near = rows[after ? k + 1 : k - 1]?.getBoundingClientRect();
    const y = after ? (near ? (r.bottom + near.top) / 2 : r.bottom + 1) : (near ? (near.bottom + r.top) / 2 : r.top - 1);
    const box = o.scroller.getBoundingClientRect();
    // Кружки на концах линии выступают на 6 px — линия чуть уже строки, чтобы не вылезать за край панели
    line.style.left = `${r.left + 6}px`;
    line.style.width = `${Math.max(0, r.width - 12)}px`;
    line.style.top = `${Math.min(Math.max(y, box.top + 1), box.bottom - 1)}px`;
  }

  function finish(drop: boolean): void {
    const s = d;
    if (!s) return;
    d = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', key, true);
    if (!s.on) return;
    cancelAnimationFrame(s.raf);
    const w = where(s);
    const t = drop && !w.out ? o.aim(w.y) : null;
    s.ghost?.remove();
    s.line?.remove();
    for (const el of s.moved) el.classList.remove('dragging');
    document.documentElement.classList.remove('st-row-drag', 'st-row-drag-out');
    o.scroller.removeEventListener('scroll', onScroll);
    if (o.list.hasPointerCapture(s.id)) o.list.releasePointerCapture(s.id);
    noClick = true;
    setTimeout(() => { noClick = false; });
    if (t) o.drop(t.data);
    o.end?.();
  }
}
