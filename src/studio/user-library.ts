/**
 * Свои библиотеки студии — темы, шаблоны, эффекты появления, образы «Цвет+» — на диске: library/ проекта
 * (в приложении — рядом с библиотекой шрифтов), по файлу на запись. Хранилище браузера (около 5 МБ) кончалось
 * на паре шаблонов с картинками и терялось при очистке браузера. Записи из браузера переезжают сами
 * при первом запуске. Без сервера студии (или в тестах без него) — по-прежнему в браузере.
 *
 * Читать — сразу из памяти (загружено до открытия студии), писать — в память и на диск в фоне.
 */
export type LibKind = 'themes' | 'templates' | 'effects' | 'looks';
interface Item { id: string; created?: number }

const KINDS: LibKind[] = ['themes', 'templates', 'effects', 'looks'];
/** Прежнее место в браузере */
const LEGACY: Record<LibKind, string> = { themes: 'slideria-themes', templates: 'htmlpptx-templates', effects: 'htmlpptx-effects', looks: 'slideria-looks' };
const API = '/__htmlpptx/';

const cache = new Map<LibKind, Item[]>();
let disk = false;
/** Записи, ещё не дошедшие до диска: обновление из других окон их не теряет */
let writing = 0;
let onError: (msg: string) => void = (m) => console.error(m);

async function post<T>(cmd: string, body = ''): Promise<T> {
  const r = await fetch(API + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? `ошибка ${r.status}`);
  return d as T;
}
const putFile = (kind: LibKind, item: Item) => post(`library-put?kind=${kind}&id=${encodeURIComponent(item.id)}`, JSON.stringify(item));
const deleteFile = (kind: LibKind, id: string) => post(`library-delete?kind=${kind}&id=${encodeURIComponent(id)}`);

function legacy(kind: LibKind): Item[] {
  try {
    const v = JSON.parse(localStorage.getItem(LEGACY[kind]) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : [];
  } catch {
    return [];
  }
}
/** Новые — первыми */
const newest = (list: Item[]) => [...list].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));

async function fetchAll(): Promise<Record<string, Item[]>> {
  return post<Record<string, Item[]>>('library');
}

/** Загрузить библиотеки до открытия студии; записи из браузера — на диск */
export async function loadUserLibrary(): Promise<void> {
  let all: Record<string, Item[]>;
  try {
    all = await fetchAll();
  } catch {
    disk = false;
    return;
  }
  disk = true;
  for (const kind of KINDS) {
    const list = Array.isArray(all[kind]) ? all[kind] : [];
    const old = legacy(kind);
    let moved = true;
    // Порядок в браузере — новые первыми; у записей без даты она ставится по этому порядку
    const now = Date.now();
    for (const [i, x] of old.entries()) {
      if (list.some((y) => y.id === x.id)) continue;
      const item = { ...x, created: x.created ?? now - i };
      try {
        await putFile(kind, item);
        list.push(item);
      } catch {
        moved = false;
      }
    }
    if (old.length && moved) try { localStorage.removeItem(LEGACY[kind]); } catch { /* нет доступа */ }
    cache.set(kind, newest(list));
  }
  // Другое окно студии могло добавить запись: при возвращении в окно — свежий список
  window.addEventListener('focus', () => {
    if (writing) return;
    void fetchAll().then((fresh) => {
      if (writing) return;
      for (const kind of KINDS) if (Array.isArray(fresh[kind])) cache.set(kind, newest(fresh[kind]));
    }).catch(() => { /* сервер недоступен — остаётся то, что есть */ });
  });
}

/** Куда сообщать, что запись на диск не удалась (студия показывает подсказку) */
export function onLibraryError(fn: (msg: string) => void): void {
  onError = fn;
}

export function libList<T>(kind: LibKind): T[] {
  return (disk ? [...(cache.get(kind) ?? [])] : legacy(kind)) as T[];
}

function background(job: () => Promise<unknown>): void {
  writing++;
  void job().catch((e) => onError(`Не удалось записать в свою библиотеку: ${(e as Error).message}`)).finally(() => { writing--; });
}

/**
 * Запись в библиотеку — первой; drop — записи, которые она заменяет (то же имя под другим id).
 * false — некуда записать (в браузере кончилось место)
 */
export function libPut(kind: LibKind, item: Item, drop: string[] = []): boolean {
  const rest = (list: Item[]) => list.filter((x) => x.id !== item.id && !drop.includes(x.id));
  if (!disk) {
    try {
      localStorage.setItem(LEGACY[kind], JSON.stringify([item, ...rest(legacy(kind))]));
      return true;
    } catch {
      return false;
    }
  }
  cache.set(kind, [item, ...rest(cache.get(kind) ?? [])]);
  background(async () => {
    await putFile(kind, item);
    for (const id of drop) if (id !== item.id) await deleteFile(kind, id);
  });
  return true;
}

export function libRemove(kind: LibKind, id: string): void {
  if (!disk) {
    try { localStorage.setItem(LEGACY[kind], JSON.stringify(legacy(kind).filter((x) => x.id !== id))); } catch { /* нет доступа */ }
    return;
  }
  cache.set(kind, (cache.get(kind) ?? []).filter((x) => x.id !== id));
  background(() => deleteFile(kind, id));
}
