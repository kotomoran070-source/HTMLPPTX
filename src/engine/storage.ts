import type { Deck } from '../types';
import { discardToPoint, listCheckpoints, listDeckAssets, listLibraryFonts, makeCheckpoint, readCheckpoint, saveLibraryFont, saveToProject, trashDeckAssets, uploadAsset, useLibraryFont, type PointKind } from './editor/persist';

/**
 * Где хранятся презентации. Редактор и студия работают только через этот интерфейс:
 * сейчас это файлы проекта (yarn dev пишет deck.yaml и assets/), при переезде
 * в облако меняется только реализация здесь.
 */
export interface DeckStorage {
  /**
   * Записать данные презентации. keepalive — запрос переживёт закрытие вкладки; base — версия, с которой
   * окно начинало: правки других окон в файле не затираются, итог с ними — в ответе (deck)
   */
  save(deckKey: string, deck: Deck, keepalive?: boolean, base?: Deck): Promise<{ deck?: Deck; base?: Deck } | unknown>;
  /** Сохранить картинку рядом с презентацией; url — адрес для данных слайда */
  uploadAsset(deckKey: string, file: Blob, name: string): Promise<{ url: string }>;
  /** Собрать один HTML-файл: clean — «для показа», без режима правки; compact — картинки сжаты */
  /** look и motion — «Как на этом компьютере»: файл открывается в этом виде слайдов и с анимациями у любого зрителя */
  exportHtml(deckKey: string, clean: boolean, compact?: boolean, same?: { look?: 'light' | 'dark'; motion?: boolean }): Promise<Blob>;
  /** Общая библиотека шрифтов (на все презентации): список, добавить, взять копией в презентацию */
  listFonts?(): Promise<{ file: string; url: string }[]>;
  saveFont?(file: Blob, name: string): Promise<{ file: string }>;
  useFont?(deckKey: string, file: string): Promise<{ url: string }>;
  /** Файлы презентации с размерами (сводка) и перенос неиспользуемых в корзину */
  listAssets?(deckKey: string): Promise<{ path: string; size: number }[]>;
  trashAssets?(deckKey: string, paths: string[]): Promise<{ moved: number }>;
  /**
   * Контрольные точки: копия сохранённого файла (своя — Ctrl+S; auto — до и после скрипта; open — когда студию
   * открыли; close — «Сохранить» при выходе), список (новые первыми), данные точки
   */
  checkpoint?(deckKey: string, kind?: Exclude<PointKind, 'mine' | 'drop'>): Promise<{ id: string; time: number; same: boolean }>;
  checkpoints?(deckKey: string): Promise<{ id: string; time: number; kind: PointKind }[]>;
  readCheckpoint?(deckKey: string, id: string): Promise<{ deck: unknown }>;
  /** «Не сохранять» при выходе: файл — как в точке to, отброшенное — точкой «Не сохранено при выходе» (drop) */
  discard?(deckKey: string, to: string): Promise<{ changed: boolean; dropped?: string }>;
}

/** Файлы проекта через API сервера Slideria (server/http.ts). */
export const projectStorage: DeckStorage = {
  save: saveToProject,
  uploadAsset,
  listFonts: listLibraryFonts,
  saveFont: saveLibraryFont,
  useFont: useLibraryFont,
  listAssets: listDeckAssets,
  trashAssets: trashDeckAssets,
  checkpoint: makeCheckpoint,
  checkpoints: listCheckpoints,
  readCheckpoint,
  discard: discardToPoint,
  async exportHtml(deckKey, clean, compact = false, same = {}) {
    const q = `${compact ? '&quality=compact' : ''}${same.look ? `&look=${same.look}` : ''}${same.motion ? '&motion=1' : ''}`;
    const r = await fetch(`/__htmlpptx/export?deck=${encodeURIComponent(deckKey)}&mode=${clean ? 'clean' : 'edit'}${q}`, { method: 'POST' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(e.error || `Сборка не удалась (${r.status})`);
    }
    return r.blob();
  },
};
