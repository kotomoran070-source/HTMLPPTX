/**
 * Картинка с кадрами: несколько снимков в одной рамке, листаются на слайде (стрелки, точки, свайп) или по «Далее»
 * (flip: click — кадры встают в очередь щелчков слайда). Первый кадр — сама картинка (src, подпись, кадр),
 * остальные — images: [{src, caption, position, zoom}]. Оформление (рамка, тень, скругление, цвет) у кадров общее.
 * В студии, на миниатюрах, при печати, в PDF и PowerPoint — первый кадр (в студии — тот, что открыли для правки).
 */
import { icon } from '../icons';
import { defineStepper } from '../../engine/steps';
import { pathOf } from '../../engine/marks';
import type { ImageFrame } from '../../engine/marks';

export interface Frame extends ImageFrame {
  src: string;
  srcDark?: string;
  alt?: string;
  caption?: string;
}

/**
 * Кадры картинки: первый — она сама; кадры без адреса пропускаются. owner — объект кадра для правки
 * (у строки — нет), n — место в images
 */
export interface FrameOf { f: Frame; owner: object | null; n: number }
export function framesOf(p: Frame & { images?: unknown }): FrameOf[] {
  const more = (Array.isArray(p.images) ? p.images as unknown[] : []).flatMap((x, n): FrameOf[] => {
    if (typeof x === 'string' && x.trim()) return [{ f: { src: x.trim() }, owner: null, n }];
    if (x && typeof x === 'object' && typeof (x as Frame).src === 'string' && (x as Frame).src.trim()) return [{ f: x as Frame, owner: x as object, n }];
    return [];
  });
  return [{ f: p, owner: p as object, n: -1 }, ...more];
}

/** Студия: какой кадр открыли для правки — после перерисовки он же (ключ — путь картинки) */
const shownAt = new Map<string, number>();
const editing = () => typeof document !== 'undefined' && document.body.classList.contains('editing');

/** Кадр, с которого картинка рисуется: при показе — первый, в студии — открытый для правки */
export function startFrame(p: object, n: number): number {
  return editing() ? shownFrame(pathOf(p) ?? [], n) : 0;
}

/** Студия: открытый для правки кадр картинки по её адресу (из n кадров) */
export function shownFrame(block: (string | number)[], n: number): number {
  return Math.min(n - 1, Math.max(0, shownAt.get(JSON.stringify(block)) ?? 0));
}

/** Студия: открыть кадр k после перерисовки (добавили, переставили) */
export function showFrame(block: (string | number)[], k: number): void {
  shownAt.set(JSON.stringify(block), k);
}

/** Стрелки и точки поверх снимка; data-ed-pass — студия пропускает щелчки по ним (листать, чтобы править кадр) */
export function frameControls(n: number, at: number): string {
  const dots = Array.from({ length: n }, (_v, k) => `<button type="button" class="gal-dot${k === at ? ' on' : ''}" data-k="${k}" aria-label="Кадр ${k + 1}"${k === at ? ' aria-current="true"' : ''}></button>`).join('');
  return `<div class="gal-ctl" data-ed-pass aria-hidden="false">`
    + `<button type="button" class="gal-nav" data-d="-1" aria-label="Предыдущий кадр">${icon('prev')}</button>`
    + `<button type="button" class="gal-nav" data-d="1" aria-label="Следующий кадр">${icon('next')}</button>`
    + `<div class="gal-dots">${dots}</div></div>`;
}

/** Показать кадр k (по кругу); animate — со сменой (сдвиг и растворение), иначе сразу */
export function setFrame(fig: HTMLElement, k: number, animate = true): number {
  const boxes = [...fig.querySelectorAll<HTMLElement>(':scope > .imgfit > .gal-f')];
  const n = boxes.length;
  if (!n) return 0;
  const at = ((k % n) + n) % n;
  fig.dataset.at = String(at);
  if (!animate) fig.classList.add('gal-now');
  boxes.forEach((b, i) => { b.classList.toggle('on', i === at); b.classList.toggle('past', i < at); });
  fig.querySelectorAll<HTMLElement>(':scope > .gal-cap').forEach((c) => c.classList.toggle('on', Number(c.dataset.k) === at));
  fig.querySelectorAll<HTMLElement>('.gal-dot').forEach((d) => {
    const on = Number(d.dataset.k) === at;
    d.classList.toggle('on', on);
    if (on) d.setAttribute('aria-current', 'true');
    else d.removeAttribute('aria-current');
  });
  if (!animate) {
    void fig.offsetWidth;
    fig.classList.remove('gal-now');
  }
  return at;
}

/** Окно докладчика или зрителей перелистнуло кадр (GAL) — другое окно повторяет (GAL_SET, от show.ts / presenter.ts) */
export const GAL = 'slideria:frame';
export const GAL_SET = 'slideria:frame-set';
export interface FrameState { key: string; at: number }

/** Листание кадров на слайде: стрелки, точки, свайп; в студии — чтобы править нужный кадр */
export function mountFrames(fig: HTMLElement, slide: HTMLElement): () => void {
  const n = fig.querySelectorAll(':scope > .imgfit > .gal-f').length;
  if (n < 2) return () => {};
  const path = fig.closest('[data-block]')?.getAttribute('data-block') ?? '';
  const key = `${slide.dataset.index ?? ''}:${path}`;
  const byClick = fig.dataset.flip === 'click';
  const go = (k: number) => {
    const at = setFrame(fig, k);
    if (editing()) {
      shownAt.set(path, at);
      // Выделенная картинка — теперь открытый кадр (правка, замена, кадрирование — его)
      fig.dispatchEvent(new CustomEvent('slideria:frame-shown', { bubbles: true }));
      return;
    }
    // По «Далее» кадры листает очередь щелчков (и она же — у зрителей): стрелок нет
    if (!byClick) window.dispatchEvent(new CustomEvent<FrameState>(GAL, { detail: { key, at } }));
  };
  const at = () => Number(fig.dataset.at) || 0;
  const click = (e: MouseEvent) => {
    const b = (e.target as Element).closest<HTMLElement>('.gal-nav, .gal-dot');
    if (!b || !fig.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    if (byClick && !editing()) return;
    go(b.dataset.k !== undefined ? Number(b.dataset.k) : at() + Number(b.dataset.d));
  };
  // Свайп по снимку листает кадры, а не слайды
  let tx = 0;
  let ty = 0;
  const down = (e: TouchEvent) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; };
  const up = (e: TouchEvent) => {
    if (byClick && !editing()) return;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    e.stopPropagation();
    go(at() + (dx < 0 ? 1 : -1));
  };
  const follow = (e: Event) => {
    const m = (e as CustomEvent<FrameState>).detail;
    if (m?.key === key && m.at !== at()) setFrame(fig, m.at);
  };
  fig.addEventListener('click', click);
  fig.addEventListener('touchstart', down, { passive: true });
  fig.addEventListener('touchend', up);
  window.addEventListener(GAL_SET, follow);
  return () => {
    fig.removeEventListener('click', click);
    fig.removeEventListener('touchstart', down);
    fig.removeEventListener('touchend', up);
    window.removeEventListener(GAL_SET, follow);
  };
}

/** flip: click — каждый щелчок «Далее» открывает следующий кадр, после последнего — дальше по слайду */
defineStepper({
  sel: '.image.gal[data-flip="click"]',
  count: (el) => el.querySelectorAll(':scope > .imgfit > .gal-f').length,
  set: (el, k, animate) => { setFrame(el, k, animate); },
});
