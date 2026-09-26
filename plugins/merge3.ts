/**
 * Трёхстороннее слияние данных презентации.
 *   base   — версия проекта, из которой собирали HTML-файл;
 *   ours   — deck.yaml сейчас;
 *   theirs — данные из присланного HTML-файла.
 * Изменения с обеих сторон сохраняются. Если одно и то же поле изменено по-разному,
 * побеждает файл (theirs), а место записывается в конфликты.
 * Списки объектов с id (слайды) сливаются по id: слайд, добавленный в проекте,
 * не пропадёт из-за правок текста в файле.
 */

type J = unknown;

export interface Conflict {
  /** Путь в данных: slides › intro › title */
  path: string;
  kind: 'both-changed' | 'deleted-in-file' | 'deleted-in-project';
}

const isObj = (v: J): v is Record<string, J> => !!v && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a: J, b: J): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as J[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  return ak.length === bk.length && ak.every((k) => deepEqual((a as Record<string, J>)[k], (b as Record<string, J>)[k]));
}

function idOf(v: J): string | undefined {
  if (!isObj(v)) return undefined;
  return typeof v.id === 'string' || typeof v.id === 'number' ? String(v.id) : undefined;
}

/** Все элементы — объекты с уникальными id. */
function keyed(list: J): list is J[] {
  if (!Array.isArray(list) || !list.length) return false;
  const ids = list.map(idOf);
  return ids.every((x) => x !== undefined) && new Set(ids).size === ids.length;
}

function label(path: string[]): string {
  return path.join(' › ');
}

export function merge3(base: J, ours: J, theirs: J, conflicts: Conflict[] = [], path: string[] = []): J {
  if (deepEqual(ours, theirs)) return ours;
  if (deepEqual(base, ours)) return theirs;
  if (deepEqual(base, theirs)) return ours;

  // Изменены обе стороны
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const keys = [...Object.keys(theirs), ...Object.keys(ours).filter((k) => !(k in theirs))];
    const out: Record<string, J> = {};
    for (const k of keys) {
      const v = merge3(b[k], ours[k], theirs[k], conflicts, [...path, k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  if (keyed(ours) && keyed(theirs) && (base === undefined || keyed(base) || (Array.isArray(base) && !base.length))) {
    return mergeById((Array.isArray(base) ? base : []) as J[], ours, theirs, conflicts, path);
  }

  if (ours === undefined) {
    conflicts.push({ path: label(path), kind: 'deleted-in-project' });
    return theirs;
  }
  if (theirs === undefined) {
    conflicts.push({ path: label(path), kind: 'deleted-in-file' });
    return ours;
  }
  conflicts.push({ path: label(path), kind: 'both-changed' });
  return theirs;
}

function mergeById(base: J[], ours: J[], theirs: J[], conflicts: Conflict[], path: string[]): J[] {
  const B = new Map(base.map((x) => [idOf(x)!, x] as const));
  const O = new Map(ours.map((x) => [idOf(x)!, x] as const));
  const T = new Map(theirs.map((x) => [idOf(x)!, x] as const));
  const out: J[] = [];
  const placed = new Set<string>();

  // Порядок — как в файле
  for (const t of theirs) {
    const id = idOf(t)!;
    const name = labelFor(t, id);
    if (O.has(id)) {
      out.push(merge3(B.get(id), O.get(id), t, conflicts, [...path, name]));
      placed.add(id);
    } else if (B.has(id)) {
      // В проекте удалён. Если в файле не менялся — удаляем; менялся — оставляем и сообщаем
      if (!deepEqual(B.get(id), t)) {
        conflicts.push({ path: label([...path, name]), kind: 'deleted-in-project' });
        out.push(t);
        placed.add(id);
      }
    } else {
      out.push(t);
      placed.add(id);
    }
  }

  // Что есть только в проекте: добавленное там или удалённое в файле
  ours.forEach((o, i) => {
    const id = idOf(o)!;
    if (placed.has(id) || T.has(id)) return;
    if (B.has(id)) {
      if (deepEqual(B.get(id), o)) return; // удалён в файле, в проекте не менялся
      conflicts.push({ path: label([...path, labelFor(o, id)]), kind: 'deleted-in-file' });
    }
    // Ставим после ближайшего предшественника из проекта
    let at = 0;
    for (let k = i - 1; k >= 0; k--) {
      const prev = out.findIndex((x) => idOf(x) === idOf(ours[k]));
      if (prev >= 0) { at = prev + 1; break; }
    }
    out.splice(at, 0, o);
    placed.add(id);
  });
  return out;
}

function labelFor(v: J, id: string): string {
  if (isObj(v)) {
    const l = v.label ?? v.title;
    if (typeof l === 'string' && l.trim()) return `«${l.trim().slice(0, 40)}»`;
  }
  return id;
}
