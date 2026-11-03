/**
 * Слежение за папкой презентаций без Vite: deck.yaml поменяли со стороны (текстовый редактор, git, другая
 * программа) и презентации появились или пропали (положили папку, удалили руками). Свои записи сервера
 * правкой со стороны не считаются: ядро помнит, что записало (core.wrote / core.ownWrite).
 *
 * Следим не за всем деревом, а за самой папкой и за каждой папкой презентации (без вложенных): картинки,
 * корзина (.trash) и контрольные точки (.checkpoints) бывают большими, а нужны нам только deck.yaml.
 * Windows не даёт переименовать папку, за которой следят: перед переносом в корзину ядро просит отпустить
 * её (крючок release) — слежение за ней снимается и потом возвращается.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DecksCore } from './core';

export interface WatchHandlers {
  /** deck.yaml презентации поменяли со стороны */
  changed(name: string): void;
  /** Презентации появились или пропали; removed — какие пропали */
  list(e: { added: string[]; removed: string[] }): void;
  /** Слежение не удалось (папку нельзя читать) — сервер работает и без него */
  error?(message: string): void;
}

export type Watch = ReturnType<typeof watchDecks>;

/** Подождать, пока события одного изменения кончатся (запись файла приходит несколькими событиями) */
const SETTLE_MS = 90;

export function watchDecks(core: Pick<DecksCore, 'dir' | 'names' | 'deckFile' | 'wrote' | 'ownWrite' | 'isTrashing'>, on: WatchHandlers) {
  const dir = core.dir;
  let names = new Set(core.names());
  const folders = new Map<string, fs.FSWatcher>();
  /** Папки, которые сейчас уходят в корзину: за ними не следим */
  const released = new Set<string>();
  const timers = new Map<string, NodeJS.Timeout>();
  let root: fs.FSWatcher | null = null;
  let closed = false;

  const later = (key: string, fn: () => void, ms = SETTLE_MS) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); if (!closed) fn(); }, ms));
  };
  const fail = (e: unknown) => on.error?.((e as Error)?.message ?? String(e));

  function checkList(): void {
    syncFolders();
    const now = new Set(core.names());
    const added = [...now].filter((n) => !names.has(n));
    // Удалённое из студии страницы уже убрали сами (событие removed ядра)
    const removed = [...names].filter((n) => !now.has(n) && !core.isTrashing(n));
    names = now;
    if (added.length || removed.length) on.list({ added, removed });
  }

  function checkDeck(name: string): void {
    if (!names.has(name)) return checkList();
    const file = core.deckFile(name);
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return checkList(); }
    if (core.wrote(file) && core.ownWrite(file, text)) return;
    on.changed(name);
  }

  /** Папка презентации: появление и правка deck.yaml */
  function watchFolder(name: string): void {
    if (folders.has(name) || released.has(name)) return;
    try {
      const w = fs.watch(path.join(dir, name), (_type, file) => {
        if (file && String(file) !== 'deck.yaml') return;
        later(`deck:${name}`, () => checkDeck(name));
      });
      w.on('error', () => { w.close(); folders.delete(name); later('list', checkList); });
      folders.set(name, w);
    } catch { /* папку уже убрали */ }
  }

  /** Следить за всеми папками, кроме служебных (.trash, .slideria, _черновики), и бросить исчезнувшие */
  function syncFolders(): void {
    let now: string[] = [];
    try {
      now = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_')).map((d) => d.name);
    } catch { /* папки нет */ }
    for (const [n, w] of folders) if (!now.includes(n)) { w.close(); folders.delete(n); }
    for (const n of now) watchFolder(n);
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    root = fs.watch(dir, (_type, file) => {
      if (file && String(file).startsWith('.')) return;
      later('list', checkList, SETTLE_MS * 2);
    });
    root.on('error', fail);
    syncFolders();
  } catch (e) {
    fail(e);
  }

  return {
    /**
     * Отпустить папки на время переноса в корзину (крючок release ядра). Ответ — вернуть слежение
     * (за тем, что осталось на месте)
     */
    release(paths: string[]): () => void {
      const names = new Set(paths.map((p) => path.relative(dir, p).split(path.sep)[0]).filter((n) => n && !n.startsWith('..')));
      for (const n of names) {
        released.add(n);
        folders.get(n)?.close();
        folders.delete(n);
      }
      return () => {
        for (const n of names) released.delete(n);
        later('list', checkList);
      };
    },
    close(): void {
      closed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      root?.close();
      for (const w of folders.values()) w.close();
      folders.clear();
    },
  };
}
