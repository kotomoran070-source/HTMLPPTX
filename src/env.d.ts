/// <reference types="vite/client" />

/** false — сборка «для показа»: без режима правки (yarn build --clean) */
declare const __EDITABLE__: boolean;
/** false — в собранной презентации нет 3D-моделей: библиотека не нужна */
declare const __HAS_MODEL__: boolean;
/** false — в собранной презентации нет формул: набор формул не нужен */
declare const __HAS_MATH__: boolean;
/** Папка с презентациями для подсказок: presentations/ или «Документы/Slideria» в приложении */
declare const __DECKS_DIR__: string;
/** Страница открыта в приложении Slideria (desktop/), а не через yarn dev */
declare const __APP__: boolean;
/** Вид слайдов, в котором файл открывается (yarn build --look=dark, «Как на этом компьютере»); '' — как у системы зрителя */
declare const __LOOK__: '' | 'light' | 'dark';

declare module 'virtual:decks' {
  import type { Deck } from './types';
  /** Загрузчики презентаций по имени папки в presentations/ */
  export const decks: Record<string, () => Promise<Deck>>;
  /** Имя презентации, если сборка сделана для одной (yarn build имя) */
  export const fixed: string | null;
}

declare module '*.yaml' {
  const data: unknown;
  export default data;
}

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
