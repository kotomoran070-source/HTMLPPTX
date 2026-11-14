/**
 * Размер слайда: высота всегда 720, ширина — по пропорции презентации (deck.size). Так шрифты, поля и вертикальная
 * вёрстка одинаковы при любом размере, а раскладки перестраиваются по ширине. Без страницы — годится и серверу
 * (снимки слайдов для агента, server/shot.ts)
 */
export const SLIDE_SIZES = { '16:9': 1280, '4:3': 960, '21:9': 1680 } as const;
export type SlideSize = keyof typeof SLIDE_SIZES;
export const SLIDE_H = 720;
/** Ширина слайда презентации */
export const widthOf = (deck?: { size?: unknown } | null): number => SLIDE_SIZES[deck?.size as SlideSize] ?? SLIDE_SIZES['16:9'];
