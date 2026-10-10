/**
 * Анимированные фоны слайдов: названия и порядок (от спокойных к заметным). Сами сцены —
 * components/backdrop. Фон задаётся у слайда (backdrop) или у темы (theme.backdrop — для всех
 * слайдов); у слайда backdrop: none — без фона темы.
 */
import type { Deck, SlideData } from '../types';

export const BACKDROPS = [
  ['mesh', 'Переливы'], ['aurora', 'Сияние'], ['silk', 'Шёлк'], ['waves', 'Волны'], ['topo', 'Рельеф'],
  ['rays', 'Лучи'], ['bokeh', 'Боке'], ['particles', 'Частицы'], ['stars', 'Звёзды'], ['snow', 'Снегопад'], ['leaves', 'Листопад'], ['petals', 'Лепестки'], ['bubbles', 'Пузыри'], ['hearts', 'Сердечки'], ['confetti', 'Конфетти'], ['caustics', 'Блики'], ['plankton', 'Планктон'], ['pulse', 'Пульс'], ['dots', 'Точки'],
  ['network', 'Сеть'], ['hex', 'Соты'], ['orbits', 'Орбиты'], ['grid', 'Сетка'], ['retrosun', 'Ретро-закат'],
  ['globe', 'Глобус'], ['terrain', 'Ландшафт'], ['tunnel', 'Тоннель'], ['lava', 'Лава'],
] as const satisfies readonly (readonly [string, string])[];

export type BackdropKind = (typeof BACKDROPS)[number][0];
export const isBackdrop = (v: unknown): v is BackdropKind => BACKDROPS.some(([k]) => k === v);
export const backdropName = (v: unknown) => BACKDROPS.find(([k]) => k === v)?.[1] ?? '';

/** Фон, который у слайда на самом деле: свой, «без фона» или фон темы */
export function slideBackdrop(slide: SlideData, deck: Deck): BackdropKind | null {
  if (slide.backdrop === 'none') return null;
  if (isBackdrop(slide.backdrop)) return slide.backdrop;
  return isBackdrop(deck.theme?.backdrop) ? deck.theme.backdrop : null;
}

const clampNum = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);

/** Заметность и скорость анимированного фона: у слайда свои, иначе — темы, иначе 1 */
export function backdropLook(slide: SlideData, deck: Deck): { opacity: number; speed: number } {
  return {
    opacity: clampNum(slide.backdropOpacity, 0.1, 1) ?? clampNum(deck.theme?.backdropOpacity, 0.1, 1) ?? 1,
    speed: clampNum(slide.backdropSpeed, 0.25, 3) ?? clampNum(deck.theme?.backdropSpeed, 0.25, 3) ?? 1,
  };
}

/** Заметность фона слайда-холста (bg), 0,1–1 */
export const bgOpacity = (slide: SlideData) => clampNum(slide.bgOpacity, 0.1, 1) ?? 1;
