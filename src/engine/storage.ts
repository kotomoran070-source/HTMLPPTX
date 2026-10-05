import type { Deck } from '../types';
import { listLibraryFonts, saveLibraryFont, saveToProject, uploadAsset, useLibraryFont } from './editor/persist';

/**
 * Где хранятся презентации. Редактор и студия работают только через этот интерфейс:
 * сейчас это файлы проекта (yarn dev пишет deck.yaml и assets/), при переезде
 * в облако меняется только реализация здесь.
 */
export interface DeckStorage {
  /** Записать данные презентации. keepalive — запрос переживёт закрытие вкладки */
  save(deckKey: string, deck: Deck, keepalive?: boolean): Promise<unknown>;
  /** Сохранить картинку рядом с презентацией; url — адрес для данных слайда */
  uploadAsset(deckKey: string, file: Blob, name: string): Promise<{ url: string }>;
  /** Собрать один HTML-файл: clean — «для показа», без режима правки; compact — картинки сжаты */
  exportHtml(deckKey: string, clean: boolean, compact?: boolean): Promise<Blob>;
  /** Общая библиотека шрифтов (на все презентации): список, добавить, взять копией в презентацию */
  listFonts?(): Promise<{ file: string; url: string }[]>;
  saveFont?(file: Blob, name: string): Promise<{ file: string }>;
  useFont?(deckKey: string, file: string): Promise<{ url: string }>;
}

/** Файлы проекта через API сервера разработки (plugins/decks.ts). */
export const projectStorage: DeckStorage = {
  save: saveToProject,
  uploadAsset,
  listFonts: listLibraryFonts,
  saveFont: saveLibraryFont,
  useFont: useLibraryFont,
  async exportHtml(deckKey, clean, compact = false) {
    const r = await fetch(`/__htmlpptx/export?deck=${encodeURIComponent(deckKey)}&mode=${clean ? 'clean' : 'edit'}${compact ? '&quality=compact' : ''}`, { method: 'POST' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(e.error || `Сборка не удалась (${r.status})`);
    }
    return r.blob();
  },
};
