/**
 * Анимированные фоны слайдов: названия и порядок (от спокойных к заметным). Сами сцены —
 * components/backdrop. Фон задаётся у слайда (backdrop) или у темы (theme.backdrop — для всех
 * слайдов); у слайда backdrop: none — без фона темы.
 */
import type { Deck, SlideData } from '../types';

export const BACKDROPS = [
  ['mesh', 'Переливы'], ['aurora', 'Сияние'], ['silk', 'Шёлк'], ['waves', 'Волны'], ['topo', 'Рельеф'],
  ['rays', 'Лучи'], ['bokeh', 'Боке'], ['particles', 'Частицы'], ['stars', 'Звёзды'], ['snow', 'Снегопад'], ['leaves', 'Листопад'], ['dots', 'Точки'],
  ['network', 'Сеть'], ['hex', 'Соты'], ['orbits', 'Орбиты'], ['grid', 'Сетка'],
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
