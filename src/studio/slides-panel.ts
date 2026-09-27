import { icon } from '../components/icons';
import { staticSlide } from '../engine/deck-view';
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
  menu(i: number, at: { x: number; y: number }): void;
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
  private items: HTMLElement[] = [];
  private sigs: string[] = [];
  private deckSig = '';
  private dragFrom = -1;

  constructor(root: HTMLElement, private host: SlidesHost) {
    root.innerHTML = `<div class="st-slides-list" role="listbox" aria-label="Слайды" aria-orientation="vertical"></div>
<button type="button" class="st-slides-add" title="Новый слайд (Ctrl+M)">${icon('plus')}<span>Новый слайд</span></button>`;
    this.list = root.querySelector('.st-slides-list')!;
    root.querySelector<HTMLElement>('.st-slides-add')!.onclick = (e) => host.add(host.index(), e.currentTarget as HTMLElement);
    this.bind();
  }

  /** Сверить миниатюры с данными: перерисовать изменившиеся, добавить и убрать лишние. */
  update(): void {
    const deck = this.host.deck();
    const all = deckSignature(deck);
    const full = all !== this.deckSig;
    this.deckSig = all;
    const n = deck.slides.length;
    for (let i = 0; i < n; i++) {
      const sig = JSON.stringify(deck.slides[i]);
      let item = this.items[i];
      if (!item) {
        item = document.createElement('div');
        item.className = 'st-thumb';
        item.setAttribute('role', 'option');
        item.dataset.i = String(i);
        item.draggable = true;
        item.innerHTML = `<span class="st-num">${i + 1}</span><div class="st-tbox"></div>`;
        this.list.appendChild(item);
        this.items[i] = item;
        this.sigs[i] = '';
      }
      if (full || this.sigs[i] !== sig) {
        const box = item.querySelector('.st-tbox')!;
        box.replaceChildren(staticSlide(deck, i));
        this.sigs[i] = sig;
      }
      item.setAttribute('aria-label', `Слайд ${i + 1}: ${slideLabel(deck.slides[i], i)}`);
      item.title = slideLabel(deck.slides[i], i);
      item.classList.toggle('has-notes', typeof deck.slides[i].notes === 'string' && !!deck.slides[i].notes);
    }
    this.items.splice(n).forEach((el) => el.remove());
    this.sigs.length = n;
    this.mark();
  }

  /** Отметить текущий слайд и прокрутить к нему. */
  mark(): void {
    const cur = this.host.index();
    this.items.forEach((el, i) => {
      const on = i === cur;
      el.classList.toggle('cur', on);
      el.setAttribute('aria-selected', String(on));
      el.tabIndex = on ? 0 : -1;
    });
    this.items[cur]?.scrollIntoView({ block: 'nearest' });
  }

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
      const i = this.at(e);
      if (i >= 0) h.go(i);
    });
    this.list.addEventListener('contextmenu', (e) => {
      const i = this.at(e);
      if (i < 0) return;
      e.preventDefault();
      h.go(i);
      h.menu(i, { x: e.clientX, y: e.clientY });
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
    const clearMarks = () => this.items.forEach((c) => c.classList.remove('dragging', 'drop-before', 'drop-after'));
    this.list.addEventListener('dragstart', (e) => {
      const i = this.at(e);
      if (i < 0) return;
      this.dragFrom = i;
      this.items[i].classList.add('dragging');
      e.dataTransfer?.setData('text/plain', String(i));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    this.list.addEventListener('dragend', () => {
      this.dragFrom = -1;
      clearMarks();
    });
    this.list.addEventListener('dragover', (e) => {
      const i = this.at(e);
      if (this.dragFrom < 0 || i < 0) return;
      e.preventDefault();
      const r = this.items[i].getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      this.items.forEach((c) => c.classList.remove('drop-before', 'drop-after'));
      this.items[i].classList.add(after ? 'drop-after' : 'drop-before');
    });
    this.list.addEventListener('drop', (e) => {
      const i = this.at(e);
      if (this.dragFrom < 0 || i < 0) return;
      e.preventDefault();
      const r = this.items[i].getBoundingClientRect();
      let to = i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
      if (this.dragFrom < to) to -= 1;
      const from = this.dragFrom;
      this.dragFrom = -1;
      clearMarks();
      h.move(from, to);
    });
  }
}
