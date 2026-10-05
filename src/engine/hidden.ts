import type { Deck } from '../types';

/**
 * Скрытые слайды (slide.hidden: true): остаются в презентации, но при показе, в окне
 * докладчика и в PDF пропускаются; в PowerPoint — скрытый слайд. В правке видны все.
 */
export const isHidden = (deck: Deck, i: number) => deck.slides[i]?.hidden === true;

/**
 * Куда перейти, пропуская скрытые: ближайший видимый в сторону движения (от from к target);
 * дальше видимых нет — ближайший видимый с другой стороны. Все скрыты — как просили.
 */
export function landOn(deck: Deck, target: number, from: number): number {
  const n = deck.slides.length;
  const t = Math.max(0, Math.min(n - 1, target));
  if (!isHidden(deck, t)) return t;
  const dir = t >= from ? 1 : -1;
  for (let j = t; j >= 0 && j < n; j += dir) if (!isHidden(deck, j)) return j;
  for (let j = t; j >= 0 && j < n; j -= dir) if (!isHidden(deck, j)) return j;
  return t;
}

/** Следующий (dir 1) или предыдущий (−1) видимый слайд; −1 — такого нет */
export function stepVisible(deck: Deck, i: number, dir: 1 | -1): number {
  for (let j = i + dir; j >= 0 && j < deck.slides.length; j += dir) if (!isHidden(deck, j)) return j;
  return -1;
}

/** Номер среди видимых и сколько их: «5 из 12» без скрытых (сам скрытый — по общему счёту) */
export function visiblePos(deck: Deck, i: number): { pos: number; total: number } {
  if (isHidden(deck, i)) return { pos: i + 1, total: deck.slides.length };
  let pos = 0;
  let total = 0;
  deck.slides.forEach((_, k) => {
    if (isHidden(deck, k)) return;
    total++;
    if (k <= i) pos++;
  });
  return { pos, total };
}
