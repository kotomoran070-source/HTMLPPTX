/**
 * Выбор анимированного фона: лента плиток листается вбок (колесом, перетаскиванием, стрелками
 * по краям), наведение примеряет фон живьём на открытом слайде. Одна лента — у слайда (панель
 * свойств) и у темы («Дизайн» → «Фон анимации»).
 */
import { icon } from '../components/icons';
import { previewBackdrop } from '../components/backdrop/backdrop';
import { BACKDROPS, backdropName, isBackdrop, type BackdropKind } from '../engine/backdrops';
import { esc } from '../engine/html';

/**
 * Плитки: cur — выбранное значение ('' — по умолчанию). theme — фон темы для слайда:
 * тогда первая плитка «Как в теме», вторая — «Без фона» (none)
 */
export function backdropStrip(cur: string, theme?: string | null): string {
  const t = isBackdrop(theme) ? theme : null;
  const opts: [value: string, name: string, look: string][] = [
    ...(t ? [['', `Как в теме · ${backdropName(t)}`, t] as [string, string, string], ['none', 'Без фона', ''] as [string, string, string]] : [['', 'Без фона', ''] as [string, string, string]]),
    ...BACKDROPS.map(([k, n]) => [k, n, k] as [string, string, string]),
  ];
  const [prev, next] = railNav();
  return `<div class="st-bdpick">${prev}`
    + `<div class="st-bdstrip" role="radiogroup" aria-label="Анимация фона">${opts.map(([v, n, look]) =>
      `<button type="button" role="radio" aria-checked="${v === cur}" data-backdrop="${v}" title="${esc(n)}"><i class="${look ? `backdrop bd-${look}` : ''}"></i><span>${esc(n)}</span></button>`).join('')}</div>`
    + `${next}</div>`;
}

/** Стрелки листания по краям ленты */
export const railNav = () => ['-1', '1'].map((d) =>
  `<button type="button" class="st-bdnav" data-nav="${d}" aria-label="${d === '-1' ? 'Листать влево' : 'Листать вправо'}" tabindex="-1">${icon(d === '-1' ? 'prev' : 'next')}</button>`);

/**
 * Лента, что листается вбок: колесом, перетаскиванием, стрелками по краям (они гаснут у концов).
 * root — обёртка со стрелками [data-nav], strip — сама прокручиваемая лента
 */
export function bindRail(root: HTMLElement, strip: HTMLElement): void {
  if (strip.dataset.bound) return;
  strip.dataset.bound = '1';
  const ends = () => {
    root.querySelector(':scope > [data-nav="-1"]')?.classList.toggle('off', strip.scrollLeft < 4);
    root.querySelector(':scope > [data-nav="1"]')?.classList.toggle('off', strip.scrollLeft > strip.scrollWidth - strip.clientWidth - 4);
  };
  strip.addEventListener('scroll', ends, { passive: true });
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  root.querySelectorAll<HTMLElement>(':scope > [data-nav]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    strip.scrollBy({ left: Number(b.dataset.nav) * strip.clientWidth * 0.8, behavior: 'smooth' });
  }));
  // Выбранная плитка — на виду
  const cur = strip.querySelector<HTMLElement>('[aria-checked="true"], .on');
  if (cur) strip.scrollLeft = Math.max(0, cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2 - strip.offsetLeft);
  ends();
  requestAnimationFrame(ends);
}

/** Лента в контейнере: прокрутка вбок и живая примерка на слайде */
export function bindBackdropStrip(root: HTMLElement, stage: () => HTMLElement, theme?: string | null): void {
  const strip = root.querySelector<HTMLElement>('.st-bdstrip');
  if (!strip || strip.dataset.bound) return;
  bindRail(strip.parentElement!, strip);
  strip.addEventListener('pointerover', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-backdrop]');
    if (!b) return;
    const v = b.dataset.backdrop!;
    const kind: BackdropKind | 'none' = isBackdrop(v) ? v : v === 'none' || !isBackdrop(theme) ? 'none' : theme;
    previewBackdrop(stage(), kind);
  });
  strip.addEventListener('pointerleave', () => previewBackdrop(stage(), null));
  strip.addEventListener('click', () => previewBackdrop(stage(), null));
}
