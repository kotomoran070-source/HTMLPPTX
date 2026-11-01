/**
 * Копии объектов вместе с соединителями (дублирование, вставка). Имя объекта на слайде одно: занятое имя
 * копия теряет, а если её соединяет скопированная линия — получает новое, и линия идёт к нему.
 * Линия, у которой среди копий нет обоих концов, не копируется: она легла бы поверх старой
 */
interface Item { type?: unknown; id?: unknown; from?: unknown; to?: unknown }

export function relink<T extends Item>(copies: T[], used: Set<unknown>): T[] {
  const ids = new Set(copies.filter((c) => c.type !== 'connector' && typeof c.id === 'string').map((c) => c.id));
  const keep = copies.filter((c) => c.type === 'connector' && ids.has(c.from) && ids.has(c.to));
  const needed = new Set(keep.flatMap((c) => [c.from, c.to]));
  const renamed = new Map<unknown, string>();
  for (const c of copies) {
    if (c.type === 'connector' || typeof c.id !== 'string') continue;
    if (!used.has(c.id)) { used.add(c.id); continue; }
    if (!needed.has(c.id)) { delete c.id; continue; }
    let id = '';
    for (let n = 2; used.has(id = `${c.id}-${n}`); n++);
    used.add(id);
    renamed.set(c.id, id);
    c.id = id;
  }
  for (const c of keep) {
    c.from = renamed.get(c.from) ?? c.from;
    c.to = renamed.get(c.to) ?? c.to;
  }
  return copies.filter((c) => c.type !== 'connector' || keep.includes(c));
}
