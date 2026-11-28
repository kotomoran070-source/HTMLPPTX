import { icon } from '../components/icons';
import { keepStills, stillBackdrops } from '../components/backdrop/backdrop';
import { staticSlide, thumbRenderer } from '../engine/deck-view';
import { slideLabel } from '../engine/render';
import type { Deck } from '../types';
import { dropOrder, shiftOrder } from './slide-order';

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

/**
 * Перетаскивание своё, на событиях указателя, а не системное (draggable): при системном браузер не отдаёт
 * колёсико и не прокручивает ленту — длинную презентацию было не перетащить дальше видимого
 */
interface Drag {
  /** Слайд, за который взяли, и вся переносимая группа (выделенные, если взяли один из них) */
  from: number;
  group: number[];
  id: number;
  /** Где нажали и где указатель сейчас */
  x: number;
  y: number;
  cx: number;
  cy: number;
  /** Сдвинули дальше порога — перетаскивание началось (до него это обычный щелчок) */
  on: boolean;
  /** Точка, за которую взяли, внутри миниатюры: копия за курсором держится за неё же */
  dx: number;
  dy: number;
  ghost: HTMLElement | null;
  raf: number;
}

/** На сколько расходятся миниатюры у зазора при перетаскивании: зазор 8 px становится 26 px — в нём гнездо 14 px */
const PART = 9;

/** Всё, что влияет на вид любого слайда, кроме самих слайдов: тема, логотип, стили, символы. */
function deckSignature(deck: Deck): string {
  const { slides: _s, ...rest } = deck;
  return JSON.stringify(rest);
}

/**
 * Лента миниатюр слева, как в PowerPoint: выбор слайда, перетаскивание для смены порядка,
 * контекстное меню, клавиатура (стрелки, Delete, Alt+стрелки — переставить).
 * Несколько слайдов: Shift — подряд, Ctrl — по одному, Ctrl+A — все; переносятся, дублируются, копируются,
 * скрываются и удаляются вместе. Щелчок между миниатюрами — место вставки (мигающая линия): туда встают
 * новый слайд и вставка из буфера.
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
  /** Сразу после перетаскивания: отпускание кнопки не считается щелчком по миниатюре */
  private noClick = false;
  /** Выделенные слайды (с текущим); anchor — откуда считается Shift-диапазон */
  private picked = new Set<number>();
  private anchor = -1;
  /** Выделение только что найдено по содержимому: текущий слайд ещё может смениться (отмена переходит к правке) */
  private follow = false;
  /** Место вставки: номер зазора (0 — перед первым) и текущий слайд, при котором его поставили; -1 — нет */
  private caretEl: HTMLElement;
  private caret = -1;
  private caretAt = -1;

  constructor(private root: HTMLElement, private host: SlidesHost) {
    // Заголовок с числом слайдов и «+» — над лентой и при прокрутке остаётся на месте (studio.css, .st-slides-head)
    // Новый слайд — кнопкой внизу ленты и «+» в месте вставки (щелчок между миниатюрами), в заголовке кнопки нет
    root.innerHTML = `<div class="st-slides-head"><b>Слайды</b><span class="st-slides-n"></span></div>`
      + `<div class="st-slides-body"><div class="st-slides-list" role="listbox" aria-label="Слайды" aria-orientation="vertical" aria-multiselectable="true"></div>`
      // Линии — рядом со списком, не в нём: в списке только слайды (и для чтения с экрана, и для подсчёта)
      + `<div class="st-drop-line" aria-hidden="true" hidden></div>`
      + `<div class="st-slides-caret" hidden><button type="button" class="st-slides-caret-add" title="Новый слайд (Ctrl+M)" aria-label="Новый слайд сюда">${icon('plus')}</button></div></div>
<button type="button" class="st-slides-add" title="Новый слайд (Ctrl+M)">${icon('plus')}<span>Новый слайд</span></button>`;
    this.list = root.querySelector('.st-slides-list')!;
    this.count = root.querySelector('.st-slides-n')!;
    this.head = root.querySelector('.st-slides-head')!;
    this.line = root.querySelector('.st-drop-line')!;
    this.caretEl = root.querySelector('.st-slides-caret')!;
    for (const b of root.querySelectorAll<HTMLElement>('.st-slides-add, .st-slides-caret-add')) {
      b.onclick = () => host.add(host.index(), b);
      // Мышью — без фокуса: у края ленты фокус докручивал её до кнопки, и меню, только что открытое, закрывалось
      // от этой прокрутки. С клавиатуры (Tab) — фокус как обычно
      b.addEventListener('pointerdown', (e) => e.preventDefault());
    }
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
    if (n !== this.sigs.length) this.caret = -1;
    // Выделенные — по содержимому: после отмены, повтора или правки агентом выделение остаётся на тех же слайдах,
    // где бы они теперь ни стояли; не нашлись все — остаётся один текущий
    const keep = this.picked.size > 1 ? [...this.picked].map((i) => this.sigs[i]) : [];
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
    if (keep.length) {
      const left = [...keep];
      const found = this.sigs.flatMap((sig, i) => {
        const k = left.indexOf(sig);
        if (k < 0) return [];
        left.splice(k, 1);
        return [i];
      });
      this.picked = new Set(left.length ? [] : found);
      if (this.picked.size) this.settle();
    }
    this.mark();
  }

  /**
   * Отмена и повтор сначала перерисовывают ленту, потом переходят к изменённому слайду. Выделение сверяется
   * с текущим после этого: текущий вне выделенных — переход к первому из них, как после отмены в PowerPoint
   */
  private settle(): void {
    if (this.follow) return;
    this.follow = true;
    queueMicrotask(() => {
      this.follow = false;
      const cur = this.host.index();
      if (this.picked.size > 1 && !this.picked.has(cur)) this.host.go(Math.min(...this.picked));
      else this.mark();
    });
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
    if (!this.picked.has(cur) && !this.follow) {
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

  /** Место вставки (номер зазора) или -1 */
  gap(): number {
    return this.caret;
  }

  /** Выделенные слайды по порядку; при месте вставки — ни одного (команды над слайдами ни к чему не относятся) */
  selected(): number[] {
    if (this.caret >= 0) return [];
    const cur = this.host.index();
    return this.picked.has(cur) ? [...this.picked].sort((a, b) => a - b) : [cur];
  }

  /** Выделить слайды (после дублирования и вставки — новые копии) */
  select(list: number[]): void {
    this.caret = -1;
    this.picked = new Set(list.filter((i) => i >= 0 && i < this.items.length));
    this.mark();
  }

  /** Оставить один текущий слайд: работа перешла на сам слайд */
  single(): void {
    if (this.picked.size > 1 || this.caret >= 0) this.select([this.host.index()]);
  }

  /** Место вставки в зазор g: текущий слайд остаётся, выделение — только у него */
  private place(g: number): void {
    this.caret = g;
    this.caretAt = this.host.index();
    this.picked = new Set([this.caretAt]);
    this.mark();
    // Клавиши — ленте: Esc убирает место вставки, Ctrl+V и Ctrl+M вставляют туда
    this.focus();
  }

  /**
   * Зазор под точкой y экрана: перед первой миниатюрой, чья середина ниже. По раскладке (offsetTop), не по экрану:
   * при перетаскивании миниатюры раздвинуты (transform), и по экранным местам зазор прыгал бы туда-обратно
   */
  private gapAt(y: number): number {
    const top = this.list.getBoundingClientRect().top;
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      const el = this.items[m];
      if (y < top + el.offsetTop + el.offsetHeight / 2) hi = m;
      else lo = m + 1;
    }
    return lo;
  }

  /**
   * Миниатюры расходятся у зазора g, куда встанет группа: выше — вверх, ниже — вниз, в зазоре — гнездо
   * (.st-drop-line). -1 — все на место. Стиль пишется только при смене зазора
   */
  private part(g: number): void {
    if (g === this.parted) return;
    this.parted = g;
    this.items.forEach((el, i) => {
      const t = g < 0 ? '' : `translateY(${i < g ? -PART : PART}px)`;
      if (el.style.transform !== t) el.style.transform = t;
    });
  }
  private parted = -1;
  private unpart = 0;

  /** Alt+↑/↓ и «Переместить выше/ниже»: группа — на шаг */
  shift(list: number[], dir: -1 | 1): void {
    const order = shiftOrder(this.items.length, list, dir);
    if (order) this.reorder(order, list);
  }

  private reorder(order: number[], group: number[]): void {
    this.host.reorder(order);
    this.select(group.map((i) => order.indexOf(i)));
  }

  /** Щелчок (и стрелки): один слайд, Ctrl — добавить или убрать, Shift — подряд от anchor */
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
    // Щелчок по миниатюре — выбор; между ними (или ниже последней) — место вставки, как в PowerPoint
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
      else if (e.key === 'Escape' && (this.picked.size > 1 || this.caret >= 0)) this.single();
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

    // Перетаскивание: копия миниатюры за курсором, линия в зазоре, куда встанет группа. С Shift и Ctrl — это
    // выделение, не перетаскивание; пальцем — прокрутка ленты
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
    // Расхождение миниатюр — плавное, только пока тянут и пока они возвращаются на место
    clearTimeout(this.unpart);
    this.list.classList.add('parting');
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
    // Гнездо появляется сразу на своём месте (а не выезжает из прошлого), дальше — скользит за курсором
    const appear = this.line.hidden && a.gap >= 0;
    if (appear) this.line.style.transition = 'none';
    this.line.hidden = a.gap < 0;
    if (a.gap >= 0) this.line.style.top = `${this.gapY(a.gap)}px`;
    if (appear) {
      void this.line.offsetTop;
      this.line.style.transition = '';
    }
    this.part(a.gap);
  }

  /**
   * Куда целится перетаскивание: зазор (-1 — порядок не изменится), скорость прокрутки у верхнего и нижнего края
   * (чем ближе к краю, тем быстрее) и «мимо ленты» — тогда отпускание ничего не меняет
   */
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

  /** Середина зазора g по высоте ленты — там рисуется линия */
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
    this.part(-1);
    this.unpart = window.setTimeout(() => this.list.classList.remove('parting'), 260);
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
