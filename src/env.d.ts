/// <reference types="vite/client" />

/** false — сборка «для показа»: без режима правки (yarn build --clean) */
declare const __EDITABLE__: boolean;
/** false — в собранной презентации нет 3D-моделей: библиотека не нужна */
declare const __HAS_MODEL__: boolean;
/** Папка с презентациями для подсказок: presentations/ или «Документы/Slideria» в приложении */
declare const __DECKS_DIR__: string;

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
