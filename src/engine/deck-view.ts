import type { Deck } from '../types';
import { Renderer } from './render';

export const W = 1280;
export const H = 720;

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Все слайды колоды на одной сцене 1280×720; показывается слайд с классом .on */
export class DeckView {
  readonly stage: HTMLElement;
  slides: HTMLElement[] = [];
  private current = -1;
  /** Очистка mount() каждого слайда: слайд можно перерисовать отдельно */
  private cleanups: ((() => void) | null)[] = [];
  /** Данные, по которым нарисован каждый слайд, и общие поля презентации */
  private sigs: string[] = [];
  private deckSig = '';

  constructor(deck: Deck, container: HTMLElement) {
    this.stage = document.createElement('div');
    this.stage.className = 'stage canvas';
    container.appendChild(this.stage);
    this.build(deck);
  }

  private base() {
    return { stage: this.stage, reducedMotion: reducedMotion() };
  }

  /** Порядок появления блоков: каждому .r на слайде — свой индекс задержки. */
  private static order(slide: HTMLElement): void {
    slide.querySelectorAll<HTMLElement>('.r').forEach((e, k) => e.style.setProperty('--i', String(k)));
  }

  /** Перерисовывает все слайды из данных, оставаясь на текущем слайде. */
  build(deck: Deck): void {
    this.cleanups.forEach((c) => c?.());
    const r = new Renderer(deck, deck.brand?.logo);
    // Слой указки и другие вложения сцены не относятся к слайдам: сохраняем их
    const extras = [...this.stage.children].filter((el) => !el.classList.contains('slide'));
    this.stage.innerHTML = deck.slides.map((s, i) => r.slide(s, i)).join('');
    extras.forEach((el) => this.stage.appendChild(el));
    this.slides = [...this.stage.querySelectorAll<HTMLElement>(':scope > .slide')];
    this.slides.forEach(DeckView.order);
    this.cleanups = this.slides.map((el) => r.activate(el, this.base()));
    this.sigs = deck.slides.map((s) => JSON.stringify(s));
    this.deckSig = deckSignature(deck);
    const cur = this.current;
    this.current = -1;
    if (cur >= 0 && this.slides.length) this.show(Math.min(cur, this.slides.length - 1));
  }

  /**
   * Перерисовывает только изменившиеся слайды: остальные остаются как есть —
   * без мигания, перезапуска живой графики и перезагрузки вставок.
   * Если поменялось общее (тема, стили, логотип) или число слайдов — всё заново.
   */
  update(deck: Deck): void {
    if (deckSignature(deck) !== this.deckSig || deck.slides.length !== this.slides.length) return this.build(deck);
    let r: Renderer | null = null;
    deck.slides.forEach((s, i) => {
      const sig = JSON.stringify(s);
      if (sig === this.sigs[i]) return;
      r ??= new Renderer(deck, deck.brand?.logo);
      this.cleanups[i]?.();
      const tmp = document.createElement('div');
      tmp.innerHTML = r.slide(s, i);
      const el = tmp.firstElementChild as HTMLElement;
      DeckView.order(el);
      if (i === this.current) el.classList.add('on');
      this.slides[i].replaceWith(el);
      this.slides[i] = el;
      this.cleanups[i] = r.activate(el, this.base());
      this.sigs[i] = sig;
    });
  }

  get index(): number {
    return this.current;
  }

  show(i: number): void {
    if (i === this.current) return;
    this.current = i;
    this.slides.forEach((s, k) => s.classList.toggle('on', k === i));
  }

  /** Вписывает сцену в прямоугольник с сохранением пропорций. */
  fit(width: number, height: number, offsetY = 0): number {
    const s = Math.max(0.05, Math.min(width / W, height / H));
    this.stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    this.stage.style.top = `calc(50% + ${offsetY}px)`;
    return s;
  }
}

/** Всё, что влияет на вид любого слайда, кроме самих слайдов. */
function deckSignature(deck: Deck): string {
  const { slides: _s, title: _t, ...rest } = deck;
  return JSON.stringify(rest);
}

const thumbObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => entries.forEach((e) => {
    const inner = e.target.firstElementChild as HTMLElement | null;
    if (inner) inner.style.transform = `scale(${(e.target as HTMLElement).clientWidth / W})`;
  }))
  : null;

/**
 * Статичная копия слайда (для миниатюр и превью). Без width миниатюра тянется
 * по ширине контейнера и сама подгоняет масштаб.
 */
export function staticSlide(deck: Deck, index: number, width?: number): HTMLElement {
  const box = document.createElement('div');
  box.className = 'thumb';
  box.style.aspectRatio = `${W} / ${H}`;
  if (width) box.style.width = `${width}px`;
  const inner = document.createElement('div');
  inner.className = 'thumb-stage canvas static';
  inner.style.transform = `scale(${(width ?? 220) / W})`;
  const slide = deck.slides[index];
  if (slide) inner.innerHTML = new Renderer(deck, deck.brand?.logo).slide(slide, index, 'on static');
  // SMIL-анимации CSS не останавливает: убираем их из статичной копии
  inner.querySelectorAll('animateMotion').forEach((a) => a.parentElement?.remove());
  inner.querySelectorAll('animate').forEach((a) => a.remove());
  // Миниатюра — картинка, а не место для правки
  inner.querySelectorAll('[data-edit],[data-edit-img],[data-edit-url]').forEach((e) => {
    // Пометка «здесь текст»: по ней экспорт подгоняет текст импортированной вёрстки
    if (e.hasAttribute('data-edit')) e.setAttribute('data-text', '');
    e.removeAttribute('data-edit');
    e.removeAttribute('data-edit-img');
    e.removeAttribute('data-edit-url');
  });
  box.appendChild(inner);
  thumbObserver?.observe(box);
  return box;
}
