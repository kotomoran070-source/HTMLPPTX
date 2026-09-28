import { icon } from '../components/icons';
import type { Editor } from '../engine/editor/editor';
import { blockName } from '../engine/editor/block-edit';
import { esc } from '../engine/html';
import type { Block, Deck } from '../types';
import { snippet } from './code-tree';

/**
 * Область выделения (как в PowerPoint): свободные объекты слайда списком, сверху — передний план.
 * Щелчок выделяет объект (и закреплённый), глаз прячет его на время правки,
 * замок закрепляет, перетаскивание строки меняет порядок слоёв.
 * Скрытие живёт только в этой сессии редактора: в показе и файлах объект всегда виден.
 */
export interface LayersHost {
  deck(): Deck;
  index(): number;
  editor(): Editor;
  stage(): HTMLElement;
  /** Закрепить или открепить объекты слайда (номера в slide.free) */
  lock(indexes: number[], on: boolean): void;
  close(): void;
}

/** Объект запоминается по содержимому: номер меняется при удалении и перестановке соседей */
const print = (b: unknown) => JSON.stringify(b);

export class LayersPane {
  private list: HTMLElement;
  private showAll: HTMLButtonElement;
  /** Слайд (его id или номер) → отпечатки скрытых объектов */
  private hidden = new Map<string, Set<string>>();
  private drag = -1;

  constructor(private root: HTMLElement, private host: LayersHost) {
    root.innerHTML = `<header class="st-lyr-head">
  <b>Область выделения</b>
  <button type="button" class="st-lyr-x" aria-label="Закрыть область выделения" title="Закрыть (Alt+F10)">${icon('close')}</button>
</header>
<p class="st-lyr-hint">Сверху — передний план. Перетащите строку, чтобы поменять порядок.</p>
<button type="button" class="st-lyr-all" hidden>Показать скрытые</button>
<div class="st-lyr-list" role="list" aria-label="Объекты слайда"></div>`;
    this.list = root.querySelector('.st-lyr-list')!;
    this.showAll = root.querySelector('.st-lyr-all')!;
    root.querySelector('.st-lyr-x')!.addEventListener('click', () => host.close());
    this.showAll.addEventListener('click', () => {
      this.hidden.delete(this.slideKey(this.host.index()));
      this.apply();
      this.update();
    });
    this.list.addEventListener('click', (e) => this.onClick(e as MouseEvent));
    this.list.addEventListener('dragstart', (e) => {
      const row = (e.target as Element).closest<HTMLElement>('.st-lyr');
      if (!row) return;
      this.drag = Number(row.dataset.k);
      row.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', '');
    });
    this.list.addEventListener('dragover', (e) => {
      if (this.drag < 0) return;
      e.preventDefault();
      const at = this.dropAt(e.clientY);
      this.list.querySelectorAll('.st-lyr').forEach((r, j) => {
        r.classList.toggle('drop-before', j === at.row && !at.after);
        r.classList.toggle('drop-after', j === at.row && at.after);
      });
    });
    this.list.addEventListener('drop', (e) => {
      if (this.drag < 0) return;
      e.preventDefault();
      this.reorder(this.drag, this.dropAt(e.clientY));
    });
    this.list.addEventListener('dragend', () => {
      this.drag = -1;
      this.list.querySelectorAll('.st-lyr').forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
    });
  }

  private slideKey(i: number): string {
    const s = this.host.deck().slides[i];
    return typeof s?.id === 'string' && s.id ? `id:${s.id}` : `n:${i}`;
  }

  private items(i = this.host.index()): Block[] {
    const s = this.host.deck().slides[i];
    return Array.isArray(s?.free) ? (s.free as Block[]) : [];
  }

  isHidden(slide: number, k: number): boolean {
    const set = this.hidden.get(this.slideKey(slide));
    const b = this.items(slide)[k];
    return !!set && !!b && set.has(print(b));
  }

  /** Скрытые объекты на сцене: вызывается после каждой перерисовки слайдов */
  apply(): void {
    this.host.stage().querySelectorAll<HTMLElement>('.slide > [data-free]').forEach((el) => {
      let hide = false;
      try {
        const p = JSON.parse(el.getAttribute('data-free') ?? '') as unknown[];
        hide = this.isHidden(Number(p[1]), Number(p[3]));
      } catch { /* не свободный объект */ }
      el.classList.toggle('st-hidden', hide);
    });
  }

  /** Список текущего слайда; выделенные строки — как на слайде */
  update(): void {
    if (this.root.hidden) return;
    const i = this.host.index();
    const items = this.items(i);
    const sel = this.host.editor().selection;
    const picked = new Set((sel?.group.length ? sel.group : sel?.free ? [sel.free] : []).filter((p) => Number(p[1]) === i).map((p) => Number(p[3])));
    const set = this.hidden.get(this.slideKey(i));
    // Отпечатки, которых на слайде больше нет (объект изменили или удалили), забываются
    if (set) {
      const alive = new Set(items.map(print));
      [...set].forEach((f) => { if (!alive.has(f)) set.delete(f); });
      if (!set.size) this.hidden.delete(this.slideKey(i));
    }
    this.showAll.hidden = !this.hidden.get(this.slideKey(i))?.size;
    if (!items.length) {
      this.list.innerHTML = '<p class="st-lyr-empty">На слайде нет свободных объектов. Здесь появятся надписи, фигуры и картинки, которые лежат поверх раскладки.</p>';
      return;
    }
    const focused = (document.activeElement as HTMLElement | null)?.closest?.('.st-lyr')?.getAttribute('data-k');
    this.list.innerHTML = items.map((b, k) => ({ b, k })).reverse().map(({ b, k }) => {
      const locked = b.locked === true;
      const hid = this.isHidden(i, k);
      const label = snippet(b as Record<string, unknown>) || (Array.isArray(b.items) ? `объектов: ${b.items.length}` : '');
      return `<div class="st-lyr${picked.has(k) ? ' on' : ''}${hid ? ' hid' : ''}${locked ? ' locked' : ''}" role="listitem" data-k="${k}" draggable="true">`
        + `<button type="button" class="st-lyr-name" aria-pressed="${picked.has(k)}" title="Выделить (Ctrl — добавить к выделению)"><b>${blockName(b.type)}</b>${label ? `<span>${esc(label)}</span>` : ''}</button>`
        + `<button type="button" class="st-lyr-eye" data-a="eye" aria-pressed="${hid}" title="${hid ? 'Показать' : 'Скрыть на время правки'}" aria-label="${hid ? 'Показать' : 'Скрыть'}">${icon(hid ? 'eye-off' : 'eye')}</button>`
        + `<button type="button" class="st-lyr-lock" data-a="lock" aria-pressed="${locked}" title="${locked ? 'Открепить' : 'Закрепить: не выделяется и не двигается мышью'}" aria-label="${locked ? 'Открепить' : 'Закрепить'}">${icon(locked ? 'lock' : 'unlock')}</button>`
        + '</div>';
    }).join('');
    if (focused) this.list.querySelector<HTMLElement>(`.st-lyr[data-k="${focused}"] .st-lyr-name`)?.focus();
  }

  private onClick(e: MouseEvent): void {
    const row = (e.target as Element).closest<HTMLElement>('.st-lyr');
    if (!row) return;
    const k = Number(row.dataset.k);
    const i = this.host.index();
    const ed = this.host.editor();
    const a = (e.target as Element).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'eye') {
      const key = this.slideKey(i);
      const set = this.hidden.get(key) ?? new Set<string>();
      const f = print(this.items(i)[k]);
      if (set.has(f)) set.delete(f);
      else set.add(f);
      if (set.size) this.hidden.set(key, set);
      else this.hidden.delete(key);
      this.apply();
      this.update();
      return;
    }
    if (a === 'lock') {
      this.host.lock([k], this.items(i)[k]?.locked !== true);
      return;
    }
    // Ctrl или Shift — добавить к выделению или убрать из него
    const sel = ed.selection;
    const cur = (sel?.group.length ? sel.group : sel?.free ? [sel.free] : []).filter((p) => Number(p[1]) === i).map((p) => Number(p[3]));
    if ((e.ctrlKey || e.metaKey || e.shiftKey) && cur.length) {
      const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
      if (next.length) ed.selectMany(i, next.sort((x, y) => x - y));
      else ed.clearSelection();
    } else {
      ed.selectFree(i, k);
    }
  }

  /** Куда бросают строку: номер строки в списке и до/после неё */
  private dropAt(y: number): { row: number; after: boolean } {
    const rows = [...this.list.querySelectorAll<HTMLElement>('.st-lyr')];
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j].getBoundingClientRect();
      if (y < r.top + r.height / 2) return { row: j, after: false };
    }
    return { row: rows.length - 1, after: true };
  }

  /** Строки идут сверху вниз от переднего плана: номер в списке объектов обратный */
  private reorder(from: number, at: { row: number; after: boolean }): void {
    const n = this.items().length;
    const target = n - 1 - at.row;
    // Выше строки — ближе к переднему плану
    let to = at.after ? target : target + 1;
    if (from < to) to -= 1;
    to = Math.max(0, Math.min(n - 1, to));
    if (to === from) return;
    const i = this.host.index();
    const ed = this.host.editor();
    if (ed.commit((d) => {
      const list = d.slides[i].free!;
      const [b] = list.splice(from, 1);
      list.splice(to, 0, b);
    }, { rebuild: true })) ed.selectFree(i, to);
  }
}
