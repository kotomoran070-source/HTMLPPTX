import { icon } from '../../components/icons';
import type { Deck, SlideData } from '../../types';
import { clone, getAt, setAt, type Path } from '../data';
import { H, W } from '../deck-view';
import { esc } from '../html';
import { placeOf, type Place } from '../render';

export interface BlockHost {
  deck(): Deck;
  stage(): HTMLElement;
  index(): number;
  commit(fn: (d: Deck) => void, opts?: { rebuild?: boolean; merge?: string }): boolean;
  toast(text: string, ms?: number, error?: boolean): void;
  /** Снять выделение текста и картинки (выделен блок) */
  clearOthers(): void;
  /** Выделение появилось, сменилось или снято */
  selected?(): void;
}

const NAMES: Record<string, string> = {
  text: 'Текст', note: 'Подпись', list: 'Список', image: 'Картинка', tile: 'Плитка', card: 'Карточка',
  grid: 'Сетка', stack: 'Столбик', panel: 'Панель', kv: 'Таблица', progress: 'Прогресс', sliders: 'Ползунки',
  chips: 'Чипы', network: 'Схема сети', hub: 'Схема итогов', system: 'Схема системы', pipeline: 'Пайплайн',
  'line-chart': 'График', uptime: 'Доступность', bars: 'Столбцы', spacer: 'Отступ',
  html: 'Элемент', embed: 'Живая вставка', stat: 'Число', quote: 'Цитата', timeline: 'Хронология', shape: 'Фигура',
};

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? '');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

interface Sel {
  /** Рамка выделения: обёртка свободного объекта или корень блока */
  el: HTMLElement;
  /** Атрибут, по которому элемент находится после перерисовки */
  attr: 'data-free' | 'data-block';
  key: string;
  block: Path;
  free: Path | null;
}

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const DIRS: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SNAP = 6;

/**
 * Блоки и свободные объекты в режиме правки.
 * Любой блок можно выделить, удалить или «сделать свободным» — тогда он лежит поверх
 * раскладки и его можно двигать и масштабировать мышью, с прилипанием и направляющими.
 */
export class BlockEditor {
  private sel: Sel | null = null;
  /** Другие свободные объекты, выделенные вместе с sel (Shift+клик, Ctrl+A) */
  private group: Sel[] = [];
  private hover: HTMLElement | null = null;
  readonly bar: HTMLElement;
  private frame: HTMLElement;
  private guides: HTMLElement;
  private dragging = false;

  constructor(private host: BlockHost) {
    document.body.insertAdjacentHTML('beforeend', `
<div class="edframe" id="ed-frame">${DIRS.map((d) => `<i class="h-${d}" data-dir="${d}"></i>`).join('')}</div>
<div class="edguides" id="ed-guides"></div>
<div class="edblock" id="ed-block" role="toolbar" aria-label="Блок">
  <span class="edblock-name"></span>
  <button type="button" data-b="parent" title="Выделить внешний блок">${icon('up')}<span>Выше</span></button>
  <button type="button" data-b="detach" title="Сделать свободным: двигать и масштабировать мышью">${icon('move')}<span>Свободно</span></button>
  <button type="button" data-b="dup" title="Дублировать (Ctrl+D)">${icon('copy')}</button>
  <button type="button" data-b="front" title="На передний план">${icon('front')}</button>
  <button type="button" data-b="back" title="На задний план">${icon('back')}</button>
  <button type="button" data-b="attach" title="Вернуть в раскладку слайда">${icon('grid')}<span>В раскладку</span></button>
  <i class="edsep"></i>
  <button type="button" data-b="delete" class="danger" title="Удалить (Delete)">${icon('trash')}</button>
</div>`);
    this.bar = document.getElementById('ed-block')!;
    this.frame = document.getElementById('ed-frame')!;
    this.guides = document.getElementById('ed-guides')!;
    this.bind();
  }

  get selected(): boolean {
    return this.sel !== null;
  }

  get isFree(): boolean {
    return !!this.sel?.free;
  }

  owns(node: Node | null): boolean {
    return !!node && (this.bar.contains(node) || this.frame.contains(node));
  }

  /** Что выделено: для панели свойств студии. */
  get info(): { block: Path; free: Path | null; type: string; hasParent: boolean; group: Path[] } | null {
    const s = this.sel;
    if (!s) return null;
    const obj = getAt(this.host.deck(), s.block) as { type?: string } | undefined;
    return {
      block: s.block, free: s.free, type: obj?.type ?? '', hasParent: !s.free && !!s.el.parentElement?.closest('[data-block]'),
      group: this.members.filter((m) => m.free).map((m) => m.free!),
    };
  }

  /** Все выделенные: главный и группа. */
  private get members(): Sel[] {
    return this.sel ? [this.sel, ...this.group] : [];
  }

  get isMulti(): boolean {
    return this.group.length > 0;
  }

  /** Свободный объект по элементу-обёртке. */
  private freeSel(el: HTMLElement): Sel | null {
    const blockEl = el.querySelector<HTMLElement>('[data-block]');
    const block = blockEl ? readPath(blockEl, 'data-block') : null;
    const free = readPath(el, 'data-free');
    return block && free ? { el, attr: 'data-free', key: el.getAttribute('data-free')!, block, free } : null;
  }

  /** Shift+клик: добавить свободный объект к выделению или убрать из него. */
  toggleGroup(el: HTMLElement): void {
    if (!this.sel?.free) return this.select(el);
    const key = el.getAttribute('data-free');
    const all = this.members;
    const hit = all.findIndex((m) => m.key === key);
    if (hit < 0) {
      const add = this.freeSel(el);
      if (!add || add.free![1] !== this.sel.free[1]) return;
      el.classList.add('ed-block-sel');
      this.group.push(add);
    } else {
      if (all.length === 1) return this.clear();
      all[hit].el.classList.remove('ed-block-sel');
      all.splice(hit, 1);
      [this.sel, ...this.group] = all;
      this.group = all.slice(1);
    }
    this.render();
    this.host.selected?.();
  }

  /** Выделить несколько свободных объектов слайда по номерам. */
  selectMany(slide: number, indexes: number[]): void {
    const els = indexes.map((i) => this.findFree(slide, i)).filter((x): x is HTMLElement => !!x);
    if (!els.length) return this.clear();
    this.host.clearOthers();
    this.select(els[0]);
    for (const el of els.slice(1)) {
      const add = this.freeSel(el);
      if (!add) continue;
      el.classList.add('ed-block-sel');
      this.group.push(add);
    }
    this.render();
    this.host.selected?.();
  }

  private findFree(slide: number, index: number): HTMLElement | null {
    const key = JSON.stringify(['slides', slide, 'free', index]);
    return [...this.host.stage().querySelectorAll<HTMLElement>('.slide.on [data-free]')].find((x) => x.getAttribute('data-free') === key) ?? null;
  }

  /** Выделить внешний блок. */
  selectParent(): void {
    const p = this.sel?.el.parentElement?.closest<HTMLElement>('[data-block]');
    if (p) this.select(p);
  }

  isSelected(el: Element): boolean {
    return this.sel?.el === el;
  }

  // ---------------- выделение ----------------

  select(el: HTMLElement): void {
    const free = el.hasAttribute('data-free');
    const blockEl = free ? el.querySelector<HTMLElement>('[data-block]') : el;
    const block = blockEl ? readPath(blockEl, 'data-block') : null;
    if (!block) return;
    this.clear();
    const attr = free ? 'data-free' : 'data-block';
    this.sel = { el, attr, key: el.getAttribute(attr)!, block, free: free ? readPath(el, 'data-free') : null };
    el.classList.add('ed-block-sel');
    this.render();
    this.host.selected?.();
  }

  clear(): void {
    const had = !!this.sel;
    this.members.forEach((m) => m.el.classList.remove('ed-block-sel'));
    this.sel = null;
    this.group = [];
    this.bar.classList.remove('on');
    this.frame.classList.remove('on', 'free', 'multi');
    this.guides.innerHTML = '';
    if (had) this.host.selected?.();
  }

  refresh(): void {
    if (!this.sel) return;
    const keys = this.members.map((m) => [m.attr, m.key] as const);
    const find = ([attr, key]: readonly [string, string]) =>
      [...this.host.stage().querySelectorAll<HTMLElement>(`.slide.on [${attr}]`)].find((x) => x.getAttribute(attr) === key);
    const els = keys.map(find).filter((x): x is HTMLElement => !!x);
    if (!els.length) return this.clear();
    this.select(els[0]);
    for (const el of els.slice(1)) {
      const add = this.freeSel(el);
      if (!add) continue;
      el.classList.add('ed-block-sel');
      this.group.push(add);
    }
    if (this.group.length) {
      this.render();
      this.host.selected?.();
    }
  }

  /** Подсветка блока под мышью (самого внутреннего). */
  onOver(target: Element): void {
    const el = (target.closest('[data-free]') ?? target.closest('[data-block]')) as HTMLElement | null;
    if (el === this.hover) return;
    this.hover?.classList.remove('ed-block-hover');
    this.hover = el;
    el?.classList.add('ed-block-hover');
  }

  private slideIndex(): number {
    return Number(this.sel?.block[1] ?? this.host.index());
  }

  private slide(d: Deck = this.host.deck()): SlideData {
    return d.slides[this.slideIndex()];
  }

  private render(): void {
    const s = this.sel;
    if (!s) return;
    const obj = getAt(this.host.deck(), s.block) as { type?: string } | undefined;
    const type = obj?.type ?? '';
    const name = NAMES[type] ?? type;
    this.bar.querySelector('.edblock-name')!.textContent = s.free ? `${name} · свободно` : name;
    const parent = s.el.parentElement?.closest('[data-block]');
    const content = (this.slide().template ?? 'content') === 'content';
    const show = (k: string, v: boolean) => { (this.bar.querySelector(`[data-b="${k}"]`) as HTMLElement).hidden = !v; };
    show('parent', !s.free && !!parent);
    show('detach', !s.free);
    show('dup', !!s.free);
    show('front', !!s.free);
    show('back', !!s.free);
    show('attach', !!s.free && content);
    this.bar.classList.add('on');
    this.frame.classList.add('on');
    this.frame.classList.toggle('free', !!s.free);
    // Несколько объектов: общая рамка без ручек размера
    this.frame.classList.toggle('multi', this.isMulti);
    this.position();
  }

  position(): void {
    const s = this.sel;
    if (!s) return;
    const rects = this.members.map((m) => m.el.getBoundingClientRect());
    const x0 = Math.min(...rects.map((x) => x.left));
    const y0 = Math.min(...rects.map((x) => x.top));
    const y1 = Math.max(...rects.map((x) => x.bottom));
    const r = { left: x0, top: y0, width: Math.max(...rects.map((x) => x.right)) - x0, height: y1 - y0, bottom: y1 };
    Object.assign(this.frame.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const w = this.bar.offsetWidth;
    const h = this.bar.offsetHeight;
    const below = r.bottom + 12;
    const top = below + h < innerHeight - 64 ? below : Math.max(60, r.top - h - 12);
    this.bar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    this.bar.style.top = `${top}px`;
  }

  // ---------------- команды ----------------

  private bind(): void {
    this.bar.addEventListener('mousedown', (e) => e.preventDefault());
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-b]');
      if (!b || !this.sel) return;
      switch (b.dataset.b) {
        case 'parent': this.selectParent(); break;
        case 'detach': this.detach(); break;
        case 'attach': this.attach(); break;
        case 'dup': this.duplicate(); break;
        case 'front': this.reorder(1); break;
        case 'back': this.reorder(-1); break;
        case 'delete': this.remove(); break;
      }
    });
    this.frame.addEventListener('pointerdown', (e) => {
      const dir = (e.target as HTMLElement).dataset.dir as Dir | undefined;
      if (dir && this.sel?.free) this.resize(e, dir);
    });
  }

  remove(): void {
    const s = this.sel;
    if (!s) return;
    if (this.isMulti) {
      const paths = this.members.map((m) => m.free!).sort((a, b) => Number(b[3]) - Number(a[3]));
      const i = Number(paths[0][1]);
      this.clear();
      if (this.host.commit((d) => {
        const list = d.slides[i].free!;
        paths.forEach((p) => list.splice(Number(p[3]), 1));
        if (!list.length) delete d.slides[i].free;
      }, { rebuild: true })) this.host.toast(`Удалено объектов: ${paths.length}. Вернуть: Ctrl+Z`, 2500);
      return;
    }
    const target = s.free ?? s.block;
    const last = target[target.length - 1];
    this.clear();
    if (this.host.commit((d) => {
      const parent = getAt(d, target.slice(0, -1));
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else setAt(d, target, undefined);
      const sl = d.slides[Number(target[1])];
      if (Array.isArray(sl?.free) && !sl.free.length) delete sl.free;
    }, { rebuild: true })) this.host.toast('Удалено. Вернуть: Ctrl+Z', 2500);
  }

  /** Блок из раскладки → свободный объект на том же месте и того же размера. */
  detach(): void {
    const s = this.sel;
    if (!s) return;
    const place = this.measure(s.el);
    const blockPath = s.block;
    const i = Number(blockPath[1]);
    const value = clone(getAt(this.host.deck(), blockPath)) as Record<string, unknown>;
    const last = blockPath[blockPath.length - 1];
    let newIndex = 0;
    this.clear();
    const ok = this.host.commit((d) => {
      const parent = getAt(d, blockPath.slice(0, -1));
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else setAt(d, blockPath, undefined);
      // Элемент сетки со span больше не занимает ячейки
      delete value.cols;
      delete value.rows;
      const sl = d.slides[i];
      sl.free = Array.isArray(sl.free) ? sl.free : [];
      sl.free.push({ ...(value as { type: string }), place });
      newIndex = sl.free.length - 1;
    }, { rebuild: true });
    if (ok) {
      this.selectFree(i, newIndex);
      this.host.toast('Блок стал свободным: тяните, чтобы переместить, за углы — чтобы изменить размер', 4000);
    }
  }

  /** Свободный объект → в конец раскладки слайда. */
  attach(): void {
    const s = this.sel;
    if (!s?.free) return;
    const free = s.free;
    const i = Number(free[1]);
    this.clear();
    this.host.commit((d) => {
      const sl = d.slides[i];
      const list = sl.free!;
      const [b] = list.splice(Number(free[3]), 1);
      delete (b as { place?: unknown }).place;
      if (sl.body === undefined) sl.body = b;
      else if (Array.isArray(sl.body)) sl.body.push(b);
      else sl.body = [sl.body, b];
      if (!list.length) delete sl.free;
    }, { rebuild: true });
  }

  duplicate(): void {
    const s = this.sel;
    if (!s?.free) return;
    if (this.isMulti) {
      const paths = this.members.map((m) => m.free!);
      const i = Number(s.free[1]);
      const copies = paths.map((p) => {
        const c = clone(getAt(this.host.deck(), p)) as { place?: Place };
        const pl = placeOf(c);
        c.place = { ...pl, x: pl.x + 24, y: pl.y + 24 };
        return c;
      });
      let from = 0;
      if (this.host.commit((d) => {
        const list = d.slides[i].free!;
        from = list.length;
        list.push(...(copies as never[]));
      }, { rebuild: true })) this.selectMany(i, copies.map((_c, k) => from + k));
      return;
    }
    const i = Number(s.free[1]);
    const copy = clone(getAt(this.host.deck(), s.free)) as { place?: Place };
    const pl = placeOf(copy);
    copy.place = { ...pl, x: pl.x + 24, y: pl.y + 24 };
    let at = 0;
    if (this.host.commit((d) => {
      d.slides[i].free!.push(copy as never);
      at = d.slides[i].free!.length - 1;
    }, { rebuild: true })) this.selectFree(i, at);
  }

  reorder(dir: 1 | -1): void {
    const s = this.sel;
    if (!s?.free) return;
    const i = Number(s.free[1]);
    const from = Number(s.free[3]);
    const n = this.slide().free?.length ?? 0;
    const to = dir > 0 ? n - 1 : 0;
    if (from === to) return this.host.toast(dir > 0 ? 'Объект уже на переднем плане' : 'Объект уже на заднем плане', 1800);
    if (this.host.commit((d) => {
      const list = d.slides[i].free!;
      const [b] = list.splice(from, 1);
      list.splice(to, 0, b);
    }, { rebuild: true })) this.selectFree(i, to);
  }

  selectFree(slide: number, index: number): void {
    const key = JSON.stringify(['slides', slide, 'free', index]);
    const el = [...this.host.stage().querySelectorAll<HTMLElement>('.slide.on [data-free]')].find((x) => x.getAttribute('data-free') === key);
    if (el) {
      this.host.clearOthers();
      this.select(el);
    }
  }

  /** Стрелки: сдвиг на 1 px, с Shift — на 10 px. */
  nudge(dx: number, dy: number): void {
    const s = this.sel;
    if (!s?.free) return;
    if (this.isMulti) {
      const paths = this.members.map((m) => m.free!);
      this.host.commit((d) => paths.forEach((p) => {
        const pl = placeOf(getAt(d, p));
        setAt(d, [...p, 'place'], { ...pl, x: pl.x + dx, y: pl.y + dy, ...(pl.h ? {} : { h: undefined }) });
      }), { rebuild: true, merge: `nudge:${paths.map((p) => p.join('.')).join('|')}` });
      return;
    }
    const pl = placeOf(getAt(this.host.deck(), s.free));
    const path = s.free;
    this.host.commit((d) => setAt(d, [...path, 'place'], { ...pl, x: pl.x + dx, y: pl.y + dy, ...(pl.h ? {} : { h: undefined }) }),
      { rebuild: true, merge: `nudge:${path.join('.')}` });
  }

  // ---------------- мышь ----------------

  private scale(): number {
    return this.host.stage().getBoundingClientRect().width / W;
  }

  /** Координаты элемента в пикселях слайда. */
  private measure(el: HTMLElement): Place {
    const sr = this.host.stage().getBoundingClientRect();
    const k = sr.width / W;
    const r = el.getBoundingClientRect();
    return { x: Math.round((r.left - sr.left) / k), y: Math.round((r.top - sr.top) / k), w: Math.round(r.width / k), h: Math.round(r.height / k) };
  }

  /**
   * Нажатие на выделенный свободный объект: если мышь сдвинулась — перемещение.
   * Возвращает true, если событие обработано. Клик без сдвига проходит дальше (правка текста).
   */
  pointerDown(e: PointerEvent, allowImagePan: boolean): boolean {
    const s = this.sel;
    // Shift — это добавление к выделению, а не перетаскивание
    if (e.shiftKey) return false;
    if (this.isMulti && e.button === 0 && this.members.some((m) => m.el.contains(e.target as Node))) return this.groupDrag(e);
    if (!s?.free || !s.el.contains(e.target as Node) || e.button !== 0) return false;
    if ((e.target as Element).closest('[contenteditable="true"]')) return false;
    if (allowImagePan && e.altKey) return false;
    e.preventDefault();
    const start = placeOf(getAt(this.host.deck(), s.free));
    const startH = start.h ?? this.measure(s.el).h!;
    const k = this.scale();
    let moved = false;
    let cur = start;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - e.clientX) / k;
      const dy = (ev.clientY - e.clientY) / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / k) return;
      moved = true;
      this.dragging = true;
      const snapped = this.snapMove({ x: start.x + dx, y: start.y + dy, w: start.w, h: startH }, ev.altKey);
      cur = { ...start, x: Math.round(snapped.x), y: Math.round(snapped.y) };
      s.el.style.left = `${cur.x}px`;
      s.el.style.top = `${cur.y}px`;
      this.position();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      this.guides.innerHTML = '';
      if (!moved) return;
      // Клик после перетаскивания не должен начинать правку текста
      setTimeout(() => { this.dragging = false; }, 0);
      const path = s.free!;
      this.host.commit((d) => setAt(d, [...path, 'place'], cur.h ? cur : { x: cur.x, y: cur.y, w: cur.w }), { rebuild: true });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    return true;
  }

  /** Перетаскивание нескольких объектов: общая рамка прилипает как один объект. */
  private groupDrag(e: PointerEvent): boolean {
    e.preventDefault();
    const deck = this.host.deck();
    const items = this.members.map((m) => {
      const pl = placeOf(getAt(deck, m.free!));
      return { m, pl, h: pl.h ?? this.measure(m.el).h! };
    });
    const bx = Math.min(...items.map((it) => it.pl.x));
    const by = Math.min(...items.map((it) => it.pl.y));
    const bw = Math.max(...items.map((it) => it.pl.x + it.pl.w)) - bx;
    const bh = Math.max(...items.map((it) => it.pl.y + it.h)) - by;
    const k = this.scale();
    let moved = false;
    let ddx = 0;
    let ddy = 0;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - e.clientX) / k;
      const dy = (ev.clientY - e.clientY) / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / k) return;
      moved = true;
      this.dragging = true;
      const snapped = this.snapMove({ x: bx + dx, y: by + dy, w: bw, h: bh }, ev.altKey);
      ddx = Math.round(snapped.x - bx);
      ddy = Math.round(snapped.y - by);
      items.forEach((it) => {
        it.m.el.style.left = `${it.pl.x + ddx}px`;
        it.m.el.style.top = `${it.pl.y + ddy}px`;
      });
      this.position();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      this.guides.innerHTML = '';
      if (!moved) return;
      setTimeout(() => { this.dragging = false; }, 0);
      this.host.commit((d) => items.forEach((it) => {
        const { h, ...rest } = { ...it.pl, x: it.pl.x + ddx, y: it.pl.y + ddy };
        setAt(d, [...it.m.free!, 'place'], h ? { ...rest, h } : rest);
      }), { rebuild: true });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    return true;
  }

  /** Сразу после перетаскивания клик игнорируется. */
  get justDragged(): boolean {
    return this.dragging;
  }

  private resize(e: PointerEvent, dir: Dir): void {
    const s = this.sel!;
    e.preventDefault();
    e.stopPropagation();
    const start = placeOf(getAt(this.host.deck(), s.free!));
    const measured = this.measure(s.el);
    const r0 = { x: start.x, y: start.y, w: start.w, h: start.h ?? measured.h! };
    const k = this.scale();
    const type = (getAt(this.host.deck(), s.block) as { type?: string })?.type;
    // Картинки за угол масштабируются с сохранением пропорций; Shift — наоборот
    const keepRatioDefault = type === 'image' && dir.length === 2;
    const ratio = r0.w / r0.h;
    let cur = r0;
    let changedH = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - e.clientX) / k;
      const dy = (ev.clientY - e.clientY) / k;
      let { x, y, w, h } = r0;
      if (dir.includes('e')) w = r0.w + dx;
      if (dir.includes('w')) { w = r0.w - dx; x = r0.x + dx; }
      if (dir.includes('s')) { h = r0.h + dy; changedH = true; }
      if (dir.includes('n')) { h = r0.h - dy; y = r0.y + dy; changedH = true; }
      const snapped = this.snapResize({ x, y, w, h }, dir, ev.altKey);
      ({ x, y, w, h } = snapped);
      if (keepRatioDefault !== ev.shiftKey && dir.length === 2) {
        // Пропорционально: берём большее изменение
        if (Math.abs(w - r0.w) / r0.w > Math.abs(h - r0.h) / r0.h) h = w / ratio;
        else w = h * ratio;
        if (dir.includes('w')) x = r0.x + r0.w - w;
        if (dir.includes('n')) y = r0.y + r0.h - h;
        changedH = true;
      }
      w = Math.max(20, w);
      h = Math.max(20, h);
      cur = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      Object.assign(s.el.style, { left: `${cur.x}px`, top: `${cur.y}px`, width: `${cur.w}px`, ...(changedH || start.h ? { height: `${cur.h}px` } : {}) });
      this.position();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      this.guides.innerHTML = '';
      const path = s.free!;
      const keepH = changedH || !!start.h;
      this.host.commit((d) => setAt(d, [...path, 'place'], keepH ? cur : { x: cur.x, y: cur.y, w: cur.w }), { rebuild: true });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // ---------------- прилипание ----------------

  /** Линии, к которым прилипают края: края и центр слайда, поля, другие свободные объекты. */
  private lines(): { v: number[]; h: number[] } {
    const v = [0, 64, W / 2, W - 64, W];
    const h = [0, 48, H / 2, H - 48, H];
    const s = this.sel;
    const list = this.slide().free ?? [];
    const own = new Set(this.members.filter((m) => m.free).map((m) => Number(m.free![3])));
    list.forEach((b, i) => {
      if (s?.free && own.has(i)) return;
      const p = placeOf(b);
      const el = this.host.stage().querySelector(`.slide.on [data-free='${JSON.stringify(['slides', this.slideIndex(), 'free', i])}']`) as HTMLElement | null;
      const ph = p.h ?? (el ? this.measure(el).h! : 0);
      v.push(p.x, p.x + p.w / 2, p.x + p.w);
      h.push(p.y, p.y + ph / 2, p.y + ph);
    });
    return { v, h };
  }

  private best(values: number[], targets: number[]): { d: number; at: number } | null {
    let res: { d: number; at: number } | null = null;
    for (const val of values) {
      for (const t of targets) {
        const d = t - val;
        if (Math.abs(d) <= SNAP && (!res || Math.abs(d) < Math.abs(res.d))) res = { d, at: t };
      }
    }
    return res;
  }

  private snapMove(r: Place & { h: number }, off: boolean): Place & { h: number } {
    if (off) {
      this.guides.innerHTML = '';
      return r;
    }
    const L = this.lines();
    const sx = this.best([r.x, r.x + r.w / 2, r.x + r.w], L.v);
    const sy = this.best([r.y, r.y + r.h / 2, r.y + r.h], L.h);
    const out = { ...r, x: r.x + (sx?.d ?? 0), y: r.y + (sy?.d ?? 0) };
    this.drawGuides(sx ? [sx.at] : [], sy ? [sy.at] : []);
    return out;
  }

  private snapResize(r: Place & { h: number }, dir: Dir, off: boolean): Place & { h: number } {
    if (off) {
      this.guides.innerHTML = '';
      return r;
    }
    const L = this.lines();
    const out = { ...r };
    const gv: number[] = [];
    const gh: number[] = [];
    if (dir.includes('e')) {
      const b = this.best([r.x + r.w], L.v);
      if (b) { out.w += b.d; gv.push(b.at); }
    }
    if (dir.includes('w')) {
      const b = this.best([r.x], L.v);
      if (b) { out.x += b.d; out.w -= b.d; gv.push(b.at); }
    }
    if (dir.includes('s')) {
      const b = this.best([r.y + r.h], L.h);
      if (b) { out.h += b.d; gh.push(b.at); }
    }
    if (dir.includes('n')) {
      const b = this.best([r.y], L.h);
      if (b) { out.y += b.d; out.h -= b.d; gh.push(b.at); }
    }
    this.drawGuides(gv, gh);
    return out;
  }

  private drawGuides(v: number[], h: number[]): void {
    const sr = this.host.stage().getBoundingClientRect();
    const k = sr.width / W;
    this.guides.innerHTML = v.map((x) => `<i class="gv" style="left:${sr.left + x * k}px;top:${sr.top}px;height:${sr.height}px"></i>`).join('')
      + h.map((y) => `<i class="gh" style="top:${sr.top + y * k}px;left:${sr.left}px;width:${sr.width}px"></i>`).join('');
  }
}

export function blockName(type: string): string {
  return esc(NAMES[type] ?? type);
}
