/**
 * Анимированные фоны слайдов: названия и порядок (от спокойных к заметным). Сами сцены —
 * components/backdrop. Фон задаётся у слайда (backdrop) или у темы (theme.backdrop — для всех
 * слайдов); у слайда backdrop: none — без фона темы.
 */
import type { Deck, SlideData } from '../types';

export const BACKDROPS = [
  ['mesh', 'Переливы'], ['aurora', 'Сияние'], ['silk', 'Шёлк'], ['waves', 'Волны'], ['topo', 'Рельеф'], ['field', 'Поле'],
  ['rays', 'Лучи'], ['bokeh', 'Боке'], ['particles', 'Частицы'], ['stars', 'Звёзды'], ['snow', 'Снегопад'], ['leaves', 'Листопад'], ['petals', 'Лепестки'], ['bubbles', 'Пузыри'], ['hearts', 'Сердечки'], ['confetti', 'Конфетти'], ['caustics', 'Блики'], ['ripples', 'Капли'], ['plankton', 'Планктон'], ['pulse', 'Пульс'], ['dots', 'Точки'],
  ['halftone', 'Поп-арт'], ['origami', 'Оригами'], ['dither', '8 бит'],
  ['network', 'Сеть'], ['hex', 'Соты'], ['orbits', 'Орбиты'], ['radar', 'Радар'], ['cymatics', 'Резонанс'], ['dna', 'ДНК'],
  ['growth', 'Рост'], ['candles', 'Биржа'], ['spectrum', 'Эквалайзер'], ['grid', 'Сетка'], ['retrosun', 'Ретро-закат'],
  ['globe', 'Глобус'], ['terrain', 'Ландшафт'], ['tunnel', 'Тоннель'], ['lava', 'Лава'],
] as const satisfies readonly (readonly [string, string])[];

export type BackdropKind = (typeof BACKDROPS)[number][0];
export const isBackdrop = (v: unknown): v is BackdropKind => BACKDROPS.some(([k]) => k === v);
export const backdropName = (v: unknown) => BACKDROPS.find(([k]) => k === v)?.[1] ?? '';
/** Фоны, которые отвечают на мышь и щелчок (это можно выключить — backdropTouch: false) */
export const TOUCH_BACKDROPS: ReadonlySet<BackdropKind> = new Set(['network']);

/** Фон, который у слайда на самом деле: свой, «без фона» или фон темы */
export function slideBackdrop(slide: SlideData, deck: Deck): BackdropKind | null {
  if (slide.backdrop === 'none') return null;
  if (isBackdrop(slide.backdrop)) return slide.backdrop;
  return isBackdrop(deck.theme?.backdrop) ? deck.theme.backdrop : null;
}

const clampNum = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);

const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

/** Заметность, скорость и ответ на мышь анимированного фона: у слайда свои, иначе — темы, иначе 1 и «да» */
export function backdropLook(slide: SlideData, deck: Deck): { opacity: number; speed: number; touch: boolean } {
  return {
    opacity: clampNum(slide.backdropOpacity, 0.1, 1) ?? clampNum(deck.theme?.backdropOpacity, 0.1, 1) ?? 1,
    speed: clampNum(slide.backdropSpeed, 0.25, 3) ?? clampNum(deck.theme?.backdropSpeed, 0.25, 3) ?? 1,
    touch: bool(slide.backdropTouch) ?? bool(deck.theme?.backdropTouch) ?? true,
  };
}

/** Заметность фона слайда-холста (bg), 0,1–1 */
export const bgOpacity = (slide: SlideData) => clampNum(slide.bgOpacity, 0.1, 1) ?? 1;
