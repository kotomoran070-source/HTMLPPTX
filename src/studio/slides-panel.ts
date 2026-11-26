import { icon } from '../components/icons';
import { keepStills, stillBackdrops } from '../components/backdrop/backdrop';
import { staticSlide, thumbRenderer } from '../engine/deck-view';
import { slideLabel } from '../engine/render';
import type { Deck } from '../types';

export interface SlidesHost {
  deck(): Deck;
  index(): number;
  go(i: number): void;
  move(from: number, to: number): void;
  duplicate(i: number): void;
  remove(i: number): void;
  add(after: number, anchor: HTMLElement): void;
  /** Меню слайда i (не обязательно текущего); onClose — меню закрылось */
  menu(i: number, at: { x: number; y: number }, onClose?: () => void): void;
}

interface Drag {
  from: number;
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

  constructor(private root: HTMLElement, private host: SlidesHost) {
    // Заголовок с числом слайдов и «+» — над лентой и при прокрутке остаётся на месте (studio.css, .st-slides-head)
    root.innerHTML = `<div class="st-slides-head"><b>Слайды</b><span class="st-slides-n"></span>`
      + `<button type="button" class="st-slides-plus" title="Новый слайд (Ctrl+M)" aria-label="Новый слайд">${icon('plus')}</button></div>
<div class="st-slides-list" role="listbox" aria-label="Слайды" aria-orientation="vertical"><div class="st-drop-line" aria-hidden="true" hidden></div></div>
<button type="button" class="st-slides-add" title="Новый слайд (Ctrl+M)">${icon('plus')}<span>Новый слайд</span></button>`;
    this.list = root.querySelector('.st-slides-list')!;
    this.count = root.querySelector('.st-slides-n')!;
    this.head = root.querySelector('.st-slides-head')!;
    this.line = root.querySelector('.st-drop-line')!;
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
    // Та же запись в текст — всё равно пересчёт стилей: пишется только новое число
    if (this.count.textContent !== String(n)) this.count.textContent = String(n);
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
    const item = this.items[cur];
    this.items.forEach((el, i) => {
      const on = i === cur;
      el.classList.toggle('cur', on);
      el.setAttribute('aria-selected', String(on));
      el.tabIndex = on ? 0 : -1;
    });
    if (item && item !== this.marked) item.scrollIntoView({ block: 'nearest' });
    this.marked = item ?? null;
  }
  private marked: HTMLElement | null = null;

  focus(): void {
    this.items[this.host.index()]?.focus({ preventScroll: true });
  }

  private at(e: Event): number {
    const el = (e.target as Element).closest<HTMLElement>('.st-thumb');
    return el ? Number(el.dataset.i) : -1;
  }

  private bind(): void {
    const h = this.host;
    this.list.addEventListener('click', (e) => {
      if (this.noClick) return;
      const i = this.at(e);
      if (i >= 0) h.go(i);
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
      let handled = true;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        h.move(i, i + (e.key === 'ArrowUp' ? -1 : 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') h.go(Math.max(0, i - 1));
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') h.go(Math.min(n - 1, i + 1));
      else if (e.key === 'Home') h.go(0);
      else if (e.key === 'End') h.go(n - 1);
      else if (e.key === 'Delete' || e.key === 'Backspace') h.remove(i);
      else if (mod && (k === 'd' || k === 'в')) h.duplicate(i);
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
      if (i < 0 || e.button !== 0 || e.pointerType === 'touch' || this.drag) return;
      this.drag = { from: i, id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, on: false, dx: 0, dy: 0, ghost: null, raf: 0 };
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
    document.body.appendChild(g);
    d.ghost = g;
    item.classList.add('dragging');
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
    const y = Math.min(Math.max(d.cy, top), r.bottom);
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      const b = this.items[m].getBoundingClientRect();
      if (y < b.top + b.height / 2) hi = m;
      else lo = m + 1;
    }
    return { gap: lo === d.from || lo === d.from + 1 ? -1 : lo, v, out: false };
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
    const to = drop ? this.aim(d).gap : -1;
    d.ghost?.remove();
    this.line.hidden = true;
    this.items[d.from]?.classList.remove('dragging');
    document.documentElement.classList.remove('st-slide-drag', 'st-slide-drag-out');
    if (this.list.hasPointerCapture(d.id)) this.list.releasePointerCapture(d.id);
    this.noClick = true;
    setTimeout(() => { this.noClick = false; });
    if (to < 0) return;
    this.host.move(d.from, to > d.from ? to - 1 : to);
    requestAnimationFrame(() => this.focus());
  }
}
