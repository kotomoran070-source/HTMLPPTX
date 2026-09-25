/** Путь к значению внутри данных презентации: ['slides', 3, 'body', 'items', 0, 'title'] */
export type Path = (string | number)[];

/** Служебный сегмент пути: следующий сегмент — имя ключа словаря, которое правят как текст. */
export const KEY = '@key';

export function getAt(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (seg === KEY) return path[i + 1];
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/**
 * Записывает значение по пути, создавая недостающие объекты.
 * Путь вида [...словарь, '@key', 'старый'] переименовывает ключ с сохранением порядка.
 */
export function setAt(root: unknown, path: Path, value: unknown): void {
  const k = path.indexOf(KEY);
  if (k >= 0) {
    renameKey(getAt(root, path.slice(0, k)), String(path[k + 1]), String(value));
    return;
  }
  if (!path.length) throw new Error('Пустой путь');
  let cur = root as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    let next = cur[seg];
    if (next == null || typeof next !== 'object') {
      next = typeof path[i + 1] === 'number' ? [] : {};
      cur[seg] = next;
    }
    cur = next as Record<string | number, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined) {
    if (Array.isArray(cur) && typeof last === 'number') cur.splice(last, 1);
    else delete cur[last];
  } else {
    cur[last] = value;
  }
}

function renameKey(obj: unknown, from: string, to: string): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Ключ можно переименовать только в словаре');
  const map = obj as Record<string, unknown>;
  const name = to.trim();
  if (!name) throw new Error('Название не может быть пустым');
  if (name === from) return;
  if (name in map) throw new Error(`«${name}» уже есть в этом списке`);
  const entries = Object.entries(map).map(([k, v]) => [k === from ? name : k, v] as const);
  for (const key of Object.keys(map)) delete map[key];
  for (const [key, v] of entries) map[key] = v;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Заменяет содержимое объекта, сохраняя ссылку на него. */
export function replaceContents(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}
