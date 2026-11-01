/**
 * Копии объектов вместе с линиями (дублирование, вставка). Имя объекта на слайде одно: занятое имя
 * копия теряет, а если к ней прицеплена скопированная линия — получает новое, и линия идёт к нему.
 * Линия копируется, если каждый её конец свободен или прицеплен к скопированному объекту (иначе
 * она легла бы поверх старой); свободные концы сдвигаются вместе с копиями на shift
 */
interface Item { type?: unknown; id?: unknown; from?: unknown; to?: unknown; start?: unknown; end?: unknown }

export function relink<T extends Item>(copies: T[], used: Set<unknown>, shift: [number, number] = [0, 0]): T[] {
  const ids = new Set(copies.filter((c) => c.type !== 'connector' && typeof c.id === 'string').map((c) => c.id));
  const ok = (id: unknown, pt: unknown) => (typeof id === 'string' && id ? ids.has(id) : Array.isArray(pt));
  const keep = copies.filter((c) => c.type === 'connector' && ok(c.from, c.start) && ok(c.to, c.end));
  const needed = new Set(keep.flatMap((c) => [c.from, c.to]).filter((x) => typeof x === 'string'));
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
  const move = (pt: unknown) => (Array.isArray(pt) ? [Number(pt[0]) + shift[0], Number(pt[1]) + shift[1]] : pt);
  for (const c of keep) {
    if (c.from !== undefined) c.from = renamed.get(c.from) ?? c.from;
    if (c.to !== undefined) c.to = renamed.get(c.to) ?? c.to;
    if (c.start !== undefined) c.start = move(c.start);
    if (c.end !== undefined) c.end = move(c.end);
  }
  return copies.filter((c) => c.type !== 'connector' || keep.includes(c));
}
