/// <reference types="vite/client" />

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
