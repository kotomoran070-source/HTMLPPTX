import type { Deck } from '../types';
import { saveToProject, uploadAsset } from './editor/persist';

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
  /** Собрать один HTML-файл: clean — «для показа», без режима правки */
  exportHtml(deckKey: string, clean: boolean): Promise<Blob>;
}

/** Файлы проекта через API сервера разработки (plugins/decks.ts). */
export const projectStorage: DeckStorage = {
  save: saveToProject,
  uploadAsset,
  async exportHtml(deckKey, clean) {
    const r = await fetch(`/__htmlpptx/export?deck=${encodeURIComponent(deckKey)}&mode=${clean ? 'clean' : 'edit'}`, { method: 'POST' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(e.error || `Сборка не удалась (${r.status})`);
    }
    return r.blob();
  },
};
