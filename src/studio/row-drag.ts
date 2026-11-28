/**
 * Перетаскивание строк в списке — как в ленте слайдов (slides-panel.ts): своё, на событиях указателя.
 * Системное (draggable) не отдаёт колёсико и не прокручивает список у края — длинный список было не перетащить
 * дальше видимого. Здесь: копия строки за курсором, строки у зазора расходятся, в зазоре — гнездо, куда она
 * встанет; колёсико и край списка прокручивают его на ходу, Esc и отпускание мимо списка — отмена.
 * Область выделения и «Порядок» анимаций
 */

export interface RowDrag<T> {
  /** Список строк: на нём ловится нажатие */
  list: HTMLElement;
  /** Что прокручивается (может быть самим списком) */
  scroller: HTMLElement;
  /** Селектор строки */
  row: string;
  /** Что расходится у зазора вместе со строками (заголовки групп, подписи); по умолчанию — сами строки */
  shift?: string;
  /** Взяли строку: какие строки едут (приглушаются) и сколько их; null — эту не тянуть */
  pick(row: HTMLElement): { rows: HTMLElement[]; count: number } | null;
  /** Можно ли встать до или после строки row: данные для drop или null (нельзя, или ничего не изменится) */
  allow(row: HTMLElement, after: boolean): T | null;
  drop(data: T): void;
  /** Перетаскивание кончилось (отпустили или отменили) */
  end?(): void;
}

/** Сдвиг до начала перетаскивания: меньше — это щелчок */
const SLOP = 5;
/** Полоса у верхнего и нижнего края, где список едет сам, и наибольшая скорость, пикселей за кадр */
const EDGE = 40;
const SPEED = 18;
/** На сколько расходятся строки у зазора: в нём гнездо 10 px */
const PART = 7;

/** Место элемента в содержимом прокрутки (не зависит от прокрутки и от сдвига transform) */
type Spot = { el: HTMLElement; top: number; bottom: number };

export function rowDrag<T>(o: RowDrag<T>): void {
  type State = {
    id: number; x: number; y: number; cx: number; cy: number; dx: number; dy: number;
    row: HTMLElement; on: boolean; ghost: HTMLElement | null; line: HTMLElement | null; moved: HTMLElement[]; raf: number;
    rows: Spot[]; shifts: Spot[]; parted: number;
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
    d = {
      id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0,
      row, on: false, ghost: null, line: null, moved: [], raf: 0, rows: [], shifts: [], parted: -2,
    };
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

  /** Места элементов в содержимом прокрутки — до сдвигов: по ним считается зазор, сдвиги его не сбивают */
  const spots = (sel: string): Spot[] => {
    const box = o.scroller.getBoundingClientRect();
    return [...o.list.querySelectorAll<HTMLElement>(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      const top = r.top - box.top + o.scroller.scrollTop;
      return { el, top, bottom: top + r.height };
    });
  };

  function lift(s: State): boolean {
    // Между нажатием и сдвигом список могли перерисовать (смена выделения, запись правки): взятая строка уже не на
    // странице, её размеры нулевые — копия встала бы в левый верхний угол. Строка — та, что теперь под точкой нажатия
    if (!s.row.isConnected) {
      const now = document.elementFromPoint(s.x, s.y)?.closest<HTMLElement>(o.row);
      if (!now || !o.list.contains(now)) return false;
      s.row = now;
    }
    const got = o.pick(s.row);
    if (!got) return false;
    s.on = true;
    s.rows = spots(o.row);
    s.shifts = spots(o.shift ?? o.row);
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
    for (const { el } of s.shifts) el.style.transition = 'transform .2s cubic-bezier(.2, .8, .2, 1)';
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

  /**
   * Строка под высотой y экрана и её половина: верхняя — встать перед ней, нижняя — после. Именно строка, а не
   * просто зазор: на границе групп «после последней строки группы» и «перед первой следующей» — разные места
   * («Порядок» анимаций: при открытии или по щелчку). Можно ли туда — решает список
   */
  function target(s: State, y: number): { gap: number; mid: number; data: T } | null {
    const rs = s.rows;
    if (!rs.length) return null;
    const yc = y - o.scroller.getBoundingClientRect().top + o.scroller.scrollTop;
    let k = rs.findIndex((p) => yc < p.bottom);
    const after = k < 0 || yc >= (rs[k].top + rs[k].bottom) / 2;
    if (k < 0) k = rs.length - 1;
    const gap = k + (after ? 1 : 0);
    const data = o.allow(rs[k].el, after);
    if (data === null) return null;
    const mid = gap === 0 ? rs[0].top - 2 : after ? rs[gap - 1].bottom + 2 : (rs[gap - 1].bottom + rs[gap].top) / 2;
    return { gap, mid, data };
  }

  /** Строки (и всё, что с ними едет) расходятся у зазора; стиль пишется только при его смене */
  function part(s: State, mid: number | null, gap: number): void {
    if (gap === s.parted) return;
    s.parted = gap;
    for (const p of s.shifts) {
      const t = mid === null ? '' : `translateY(${(p.top + p.bottom) / 2 < mid ? -PART : PART}px)`;
      if (p.el.style.transform !== t) p.el.style.transform = t;
    }
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
    const t = w.out ? null : target(s, w.y);
    s.line!.hidden = !t;
    part(s, t ? t.mid : null, t ? t.gap : -1);
    if (!t) return;
    // Гнездо — посередине зазора, чуть уже строки, в видимой части списка
    const box = o.scroller.getBoundingClientRect();
    const r = s.rows[Math.min(t.gap, s.rows.length - 1)].el.getBoundingClientRect();
    s.line!.style.left = `${r.left + 4}px`;
    s.line!.style.width = `${Math.max(0, r.width - 8)}px`;
    s.line!.style.top = `${Math.min(Math.max(box.top + t.mid - o.scroller.scrollTop, box.top + 6), box.bottom - 6)}px`;
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
    const t = drop && !w.out ? target(s, w.y) : null;
    s.ghost?.remove();
    s.line?.remove();
    for (const el of s.moved) el.classList.remove('dragging');
    // Строки возвращаются на место плавно; после — без перехода (обычная работа со списком)
    part(s, null, -1);
    const back = s.shifts.map((p) => p.el);
    setTimeout(() => back.forEach((el) => { el.style.transition = ''; }), 220);
    document.documentElement.classList.remove('st-row-drag', 'st-row-drag-out');
    o.scroller.removeEventListener('scroll', onScroll);
    if (o.list.hasPointerCapture(s.id)) o.list.releasePointerCapture(s.id);
    noClick = true;
    setTimeout(() => { noClick = false; });
    if (t) o.drop(t.data);
    o.end?.();
  }
}
