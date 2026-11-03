/// <reference types="vite/client" />

/** false — сборка «для показа»: без режима правки (yarn build --clean) */
declare const __EDITABLE__: boolean;
/** false — в собранной презентации нет 3D-моделей: библиотека не нужна */
declare const __HAS_MODEL__: boolean;
/** false — в собранной презентации нет формул: набор формул не нужен */
declare const __HAS_MATH__: boolean;
/**
 * Страница работает с сервером Slideria (yarn dev, программа, облако): презентации, студия, запись в deck.yaml.
 * false — собранный файл презентации (готовый проигрыватель): всё своё у него внутри
 */
declare const __SERVED__: boolean;

/** Полная сборка <model-viewer> вместе с three.js: подключается, только когда на слайде есть модель */
declare module '@google/model-viewer/dist/model-viewer.min.js';

/** gifenc (MIT): кодировщик GIF для «Цвет+» у анимированных GIF */
declare module 'gifenc' {
  type Palette = number[][];
  interface Encoder {
    writeFrame(index: Uint8Array, w: number, h: number, o?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, o?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
