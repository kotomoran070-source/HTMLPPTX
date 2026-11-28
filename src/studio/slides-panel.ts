import { icon } from '../components/icons';
import { keepStills, stillBackdrops } from '../components/backdrop/backdrop';
import { staticSlide, thumbRenderer } from '../engine/deck-view';
import { slideLabel } from '../engine/render';
import type { Deck } from '../types';

export interface SlidesHost {
  deck(): Deck;
  index(): number;
  go(i: number): void;
  reorder(order: number[]): void;
  duplicate(list: number[]): void;
  remove(list: number[]): void;
  add(after: number, anchor: HTMLElement): void;
  /** Меню слайда i (не обязательно текущего); onClose — меню закрылось */
  menu(i: number, at: { x: number; y: number }, onClose?: () => void): void;
}

interface Drag {
  from: number;
  group: number[];
  id: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  on: boolean;
  dx: number;
  dy: number;
  ghost: HTMLElement | null;
  raf: number;
}

export function shiftOrder(n: number, list: number[], dir: -1 | 1): number[] | null {
  const order = Array.from({ length: n }, (_, i) => i);
  const sel = new Set(list);
  const on = order.map((i) => sel.has(i));
  for (let k = dir < 0 ? 1 : n - 2; dir < 0 ? k < n : k >= 0; k -= dir) {
    const j = k + dir;
    if (on[k] && !on[j]) {
      [order[k], order[j]] = [order[j], order[k]];
      [on[k], on[j]] = [on[j], on[k]];
    }
  }
  return order.some((v, k) => v !== k) ? order : null;
}

function dropOrder(n: number, group: number[], gap: number): number[] | null {
  const set = new Set(group);
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !set.has(i));
  const at = rest.filter((i) => i < gap).length;
  const order = [...rest.slice(0, at), ...group, ...rest.slice(at)];
  return order.some((v, k) => v !== k) ? order : null;
}

/** Всё, что влияет на вид любого слайда, кроме самих слайдов: тема, логотип, стили, символы. */
function deckSignature(deck: Deck): string {
  const { slides: _s, ...rest } = deck;
  return JSON.stringify(rest);
}

/**
 * Лента миниатюр слева, как в PowerPoint: выбор слайда, перетаскивание для смены порядка,
 * контекстное меню, клавиатура (стрелки, Delete, Alt+стрелки — переставить).
 * Миниатюры перерисовываются только у изменившихся слайдов.
 */
export class SlidesPanel {
  private list: HTMLElement;
  private count: HTMLElement;
  private head: HTMLElement;
  private line: HTMLElement;
  private items: HTMLElement[] = [];
  private sigs: string[] = [];
  private deckSig = '';
  private drag: Drag | null = null;
  private noClick = false;
  private picked = new Set<number>();
  private anchor = -1;
  private caretEl: HTMLElement;
  private caret = -1;
  private caretAt = -1;

  constructor(private root: HTMLElement, private host: SlidesHost) {
    // Заголовок с числом слайдов и «+» — над лентой и при прокрутке остаётся на месте (studio.css, .st-slides-head)
    root.innerHTML = `<div class="st-slides-head"><b>Слайды</b><span class="st-slides-n"></span>`
      + `<button type="button" class="st-slides-plus" title="Новый слайд (Ctrl+M)" aria-label="Новый слайд">${icon('plus')}</button></div>
<div class="st-slides-list" role="listbox" aria-label="Слайды" aria-orientation="vertical" aria-multiselectable="true"><div class="st-drop-line" aria-hidden="true" hidden></div><div class="st-drop-line st-slides-caret" aria-hidden="true" hidden></div></div>
<button type="button" class="st-slides-add" title="Новый слайд (Ctrl+M)">${icon('plus')}<span>Новый слайд</span></button>`;
    this.list = root.querySelector('.st-slides-list')!;
    this.count = root.querySelector('.st-slides-n')!;
    this.head = root.querySelector('.st-slides-head')!;
    this.line = root.querySelector('.st-drop-line')!;
    this.caretEl = root.querySelector('.st-slides-caret')!;
    for (const b of root.querySelectorAll<HTMLElement>('.st-slides-add, .st-slides-plus')) b.onclick = () => host.add(host.index(), b);
    this.bind();
  }

  /**
   * Сверить миниатюры с данными: перерисовать изменившиеся, добавить и убрать лишние.
   * shared — отрисовщик холста после той же правки (DeckView.renderer): второго обхода презентации не нужно
   */
  update(shared?: ReturnType<typeof thumbRenderer>): void {
    const deck = this.host.deck();
    const all = deckSignature(deck);
    const full = all !== this.deckSig;
    this.deckSig = all;
    const n = deck.slides.length;
    if (n !== this.sigs.length) {
      this.picked.clear();
      this.caret = -1;
    }
    // Один отрисовщик на все миниатюры этого прохода (создаётся, если хоть одна перерисовывается)
    let r = shared;
    for (let i = 0; i < n; i++) {
      const sig = JSON.stringify(deck.slides[i]);
      let item = this.items[i];
      if (!item) {
        item = document.createElement('div');
        item.className = 'st-thumb';
        item.setAttribute('role', 'option');
        item.dataset.i = String(i);
        item.innerHTML = `<span class="st-num">${i + 1}<span class="st-tmarks"></span></span><div class="st-tbox"></div>`;
        this.list.appendChild(item);
        this.items[i] = item;
        this.sigs[i] = '';
      }
      if (full || this.sigs[i] !== sig) {
        const box = item.querySelector('.st-tbox')!;
        // Кадры живых фонов прежней миниатюры — новой сразу; замер цветов и сверка — в следующем кадре экрана
        const stills = keepStills(box as HTMLElement);
        box.replaceChildren(staticSlide(deck, i, undefined, r ??= thumbRenderer(deck)));
        stills();
        this.sigs[i] = sig;
      }
      item.setAttribute('aria-label', `Слайд ${i + 1}: ${slideLabel(deck.slides[i], i)}`);
      const notes = typeof deck.slides[i].notes === 'string' ? deck.slides[i].notes as string : '';
      // Записи, сделанные в окне докладчика во время показа («✎ 14:32 — …»): отдельная отметка
      // …или заметки правили там же: отметка до тех пор, пока их не поправят в студии
      const jots = notes.includes('✎') || deck.slides[i].notesEdited === true;
      const hidden = deck.slides[i].hidden === true;
      // Автопоказ: своё время слайда и повтор — значками под номером
      const after = deck.slides[i].after;
      const repeat = deck.slides[i].repeat === true;
      const box = item.querySelector<HTMLElement>('.st-tmarks')!;
      const marks = `${after ? 'clock' : ''} ${repeat ? 'cycle' : ''}`;
      if (box.dataset.k !== marks) {
        box.dataset.k = marks;
        box.innerHTML = marks.split(' ').filter(Boolean).map((n) => icon(n)).join('');
      }
      item.title = slideLabel(deck.slides[i], i) + (hidden ? ' · скрыт при показе' : '') + (after ? ` · в автопоказе ${after} с` : '')
        + (repeat ? ' · появления по кругу' : '') + (jots ? ' · заметки дописаны на показе' : '');
      item.classList.toggle('is-hidden', hidden);
      item.classList.toggle('has-notes', !!notes);
      item.classList.toggle('has-jots', jots);
    }
    this.items.splice(n).forEach((el) => el.remove());
    this.sigs.length = n;
    this.mark();
  }

  /** Сменилась тема: кадры живых фонов в миниатюрах — в новых цветах */
  repaintStills(): void {
    stillBackdrops(this.list, true);
  }

  /** Перерисовать все миниатюры (вид слайдов сменился, данные — те же) */
  redraw(): void {
    this.deckSig = '';
    this.update();
  }

  /**
   * Отметить текущий слайд и прокрутить к нему. Прокрутка — только когда текущий сменился: она замеряет
   * всю страницу, а после правки на том же слайде (отпустили объект, отмена) лента и так на месте
   */
  mark(): void {
    const cur = this.host.index();
    if (!this.picked.has(cur)) {
      this.picked = new Set([cur]);
      this.anchor = cur;
    }
    if (this.caret >= 0 && (cur !== this.caretAt || this.caret > this.items.length)) this.caret = -1;
    this.list.classList.toggle('caret', this.caret >= 0);
    this.caretEl.hidden = this.caret < 0;
    if (this.caret >= 0) this.caretEl.style.top = `${this.gapY(this.caret)}px`;
    const multi = this.picked.size > 1;
    const item = this.items[cur];
    this.items.forEach((el, i) => {
      const on = i === cur;
      el.classList.toggle('cur', on);
      el.classList.toggle('sel', multi && this.picked.has(i));
      el.setAttribute('aria-selected', String(this.picked.has(i)));
      el.tabIndex = on ? 0 : -1;
    });
    // Та же запись в текст — всё равно пересчёт стилей: пишется только новое число
    const n = String(this.items.length);
    const text = multi ? `${this.picked.size} из ${n}` : n;
    if (this.count.textContent !== text) this.count.textContent = text;
    if (item && item !== this.marked) item.scrollIntoView({ block: 'nearest' });
    this.marked = item ?? null;
  }
  private marked: HTMLElement | null = null;

  focus(): void {
    this.items[this.host.index()]?.focus({ preventScroll: true });
  }

  gap(): number {
    return this.caret;
  }

  selected(): number[] {
    if (this.caret >= 0) return [];
    const cur = this.host.index();
    return this.picked.has(cur) ? [...this.picked].sort((a, b) => a - b) : [cur];
  }

  select(list: number[]): void {
    this.caret = -1;
    this.picked = new Set(list.filter((i) => i >= 0 && i < this.items.length));
    this.mark();
  }

  single(): void {
    if (this.picked.size > 1 || this.caret >= 0) this.select([this.host.index()]);
  }

  private place(g: number): void {
    this.caret = g;
    this.caretAt = this.host.index();
    this.picked = new Set([this.caretAt]);
    this.mark();
  }

  private gapAt(y: number): number {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      const b = this.items[m].getBoundingClientRect();
      if (y < b.top + b.height / 2) hi = m;
      else lo = m + 1;
    }
    return lo;
  }

  shift(list: number[], dir: -1 | 1): void {
    const order = shiftOrder(this.items.length, list, dir);
    if (order) this.reorder(order, list);
  }

  private reorder(order: number[], group: number[]): void {
    this.host.reorder(order);
    this.select(group.map((i) => order.indexOf(i)));
  }

  private pick(i: number, how: 'one' | 'add' | 'range'): void {
    this.caret = -1;
    const cur = this.host.index();
    let to = i;
    if (how === 'range') {
      const a = this.anchor >= 0 && this.anchor < this.items.length ? this.anchor : cur;
      this.picked = new Set(Array.from({ length: Math.abs(i - a) + 1 }, (_, k) => Math.min(a, i) + k));
    } else if (how === 'add') {
      if (!this.picked.has(cur)) this.picked = new Set([cur]);
      if (this.picked.has(i) && this.picked.size > 1) {
        this.picked.delete(i);
        const rest = [...this.picked].sort((a, b) => a - b);
        if (i === cur) to = rest.filter((k) => k < i).pop() ?? rest[0];
        else to = cur;
      } else this.picked.add(i);
      this.anchor = i;
    } else {
      this.picked = new Set([i]);
      this.anchor = i;
    }
    this.host.go(to);
    this.mark();
  }

  private at(e: Event): number {
    const el = (e.target as Element).closest<HTMLElement>('.st-thumb');
    return el ? Number(el.dataset.i) : -1;
  }

  private bind(): void {
    const h = this.host;
    this.root.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (this.noClick || !this.items.length || t.closest('button, .st-slides-head')) return;
      const el = t.closest<HTMLElement>('.st-thumb');
      const box = el?.querySelector('.st-tbox')?.getBoundingClientRect();
      if (el && box && e.clientY >= box.top && e.clientY <= box.bottom) {
        this.pick(Number(el.dataset.i), e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'add' : 'one');
      } else this.place(this.gapAt(e.clientY));
    });
    // Правый щелчок — только меню этого слайда: на него не переходит. Пока меню открыто, миниатюра обведена —
    // видно, к какому слайду команды
    this.list.addEventListener('contextmenu', (e) => {
      const i = this.at(e);
      if (i < 0) return;
      e.preventDefault();
      const item = this.items[i];
      item?.classList.add('ctx');
      h.menu(i, { x: e.clientX, y: e.clientY }, () => item?.classList.remove('ctx'));
    });
    this.list.addEventListener('keydown', (e) => {
      const i = this.at(e);
      if (i < 0) return;
      const n = h.deck().slides.length;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const how = e.shiftKey ? 'range' : 'one';
      let handled = true;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        this.shift(this.selected(), e.key === 'ArrowUp' ? -1 : 1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') this.pick(Math.max(0, i - 1), how);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') this.pick(Math.min(n - 1, i + 1), how);
      else if (e.key === 'Home') this.pick(0, how);
      else if (e.key === 'End') this.pick(n - 1, how);
      else if (mod && !e.shiftKey && (k === 'a' || k === 'ф')) this.select([...Array(n).keys()]);
      else if (e.key === 'Escape' && this.picked.size > 1) this.single();
      else if (e.key === 'Delete' || e.key === 'Backspace') h.remove(this.selected());
      else if (mod && (k === 'd' || k === 'в')) h.duplicate(this.selected());
      else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const r = this.items[i].getBoundingClientRect();
        h.menu(i, { x: r.left + 24, y: r.top + 24 });
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        requestAnimationFrame(() => this.focus());
      }
    });

    // Перетаскивание: линия-указатель до или после слайда
    this.list.addEventListener('dragstart', (e) => e.preventDefault());
    this.list.addEventListener('pointerdown', (e) => {
      const i = this.at(e);
      if (i < 0 || e.button !== 0 || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.metaKey || this.drag) return;
      this.drag = { from: i, group: [i], id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, on: false, dx: 0, dy: 0, ghost: null, raf: 0 };
      window.addEventListener('pointermove', this.onMove);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onCancel);
      window.addEventListener('blur', this.onCancel);
      window.addEventListener('keydown', this.onKey, true);
    });
    this.root.addEventListener('scroll', () => this.queue());
  }

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!(e.buttons & 1)) {
      this.endDrag(false);
      return;
    }
    d.cx = e.clientX;
    d.cy = e.clientY;
    if (!d.on) {
      if (Math.hypot(d.cx - d.x, d.cy - d.y) < 5) return;
      this.lift(d);
    }
    this.queue();
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    this.endDrag(true);
  };

  private onCancel = (): void => this.endDrag(false);

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.drag?.on) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.endDrag(false);
  };

  private lift(d: Drag): void {
    d.on = true;
    const item = this.items[d.from];
    const box = item.querySelector<HTMLElement>('.st-tbox')!;
    const r = box.getBoundingClientRect();
    const g = box.cloneNode(true) as HTMLElement;
    g.className = 'st-tbox st-drag-ghost';
    g.setAttribute('aria-hidden', 'true');
    g.style.width = `${r.width}px`;
    d.dx = d.x - r.left;
    d.dy = d.y - r.top;
    g.style.transformOrigin = `${d.dx}px ${d.dy}px`;
    if (this.caret >= 0) {
      this.caret = -1;
      this.mark();
    }
    if (this.picked.has(d.from) && this.picked.size > 1) d.group = this.selected();
    if (d.group.length > 1) {
      g.classList.add('multi');
      g.dataset.n = String(d.group.length);
    }
    document.body.appendChild(g);
    d.ghost = g;
    for (const k of d.group) this.items[k]?.classList.add('dragging');
    document.documentElement.classList.add('st-slide-drag');
    this.list.setPointerCapture(d.id);
  }

  private queue(): void {
    const d = this.drag;
    if (d?.on && !d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; this.frame(d); });
  }

  private frame(d: Drag): void {
    if (this.drag !== d) return;
    d.ghost!.style.transform = `translate(${d.cx - d.dx}px, ${d.cy - d.dy}px) scale(.7)`;
    let a = this.aim(d);
    if (a.v) {
      const was = this.root.scrollTop;
      this.root.scrollTop += a.v;
      if (this.root.scrollTop !== was) {
        a = this.aim(d);
        this.queue();
      }
    }
    d.ghost!.classList.toggle('out', a.out);
    document.documentElement.classList.toggle('st-slide-drag-out', a.out);
    this.line.hidden = a.gap < 0;
    if (a.gap >= 0) this.line.style.top = `${this.gapY(a.gap)}px`;
  }

  private aim(d: Drag): { gap: number; v: number; out: boolean } {
    const r = this.root.getBoundingClientRect();
    if (d.cx < r.left - 24 || d.cx > r.right + 24) return { gap: -1, v: 0, out: true };
    const top = this.head.getBoundingClientRect().bottom;
    const zone = Math.min(48, (r.bottom - top) / 4);
    const k = d.cy < top + zone ? d.cy - top - zone : d.cy > r.bottom - zone ? d.cy - r.bottom + zone : 0;
    const v = Math.sign(k) * Math.ceil(Math.min(1, Math.abs(k) / zone) ** 2 * 22);
    const lo = this.gapAt(Math.min(Math.max(d.cy, top), r.bottom));
    return { gap: dropOrder(this.items.length, d.group, lo) ? lo : -1, v, out: false };
  }

  private gapY(g: number): number {
    const it = this.items;
    const end = (el: HTMLElement) => el.offsetTop + el.offsetHeight;
    const half = it.length > 1 ? (it[1].offsetTop - end(it[0])) / 2 : 4;
    if (g === 0) return it[0].offsetTop - half;
    if (g === it.length) return end(it[g - 1]) + half;
    return (end(it[g - 1]) + it[g].offsetTop) / 2;
  }

  private endDrag(drop: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('blur', this.onCancel);
    window.removeEventListener('keydown', this.onKey, true);
    if (!d.on) return;
    cancelAnimationFrame(d.raf);
    const gap = drop ? this.aim(d).gap : -1;
    d.ghost?.remove();
    this.line.hidden = true;
    this.items.forEach((el) => el.classList.remove('dragging'));
    document.documentElement.classList.remove('st-slide-drag', 'st-slide-drag-out');
    if (this.list.hasPointerCapture(d.id)) this.list.releasePointerCapture(d.id);
    this.noClick = true;
    setTimeout(() => { this.noClick = false; });
    const order = gap < 0 ? null : dropOrder(this.items.length, d.group, gap);
    if (!order) return;
    this.reorder(order, d.group);
    requestAnimationFrame(() => this.focus());
  }
}
