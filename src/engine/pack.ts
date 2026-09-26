/**
 * Данные презентации внутри собранного HTML. Одинаковые встроенные файлы (фон на всех
 * слайдах, логотип) хранятся один раз: в данных вместо них ссылка на общий список.
 *   { "$pack": 1, "assets": ["data:image/png;base64,…"], "deck": { … "\u0001asset:0" … } }
 * Без зависимостей: используется и в браузере, и в плагинах сборки.
 */
const REF = '\u0001asset:';

export interface Packed {
  $pack: 1;
  assets: string[];
  deck: unknown;
}

export function packDeck(deck: unknown): Packed {
  const assets: string[] = [];
  const index = new Map<string, number>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!v.startsWith('data:') || v.length < 256) return v;
      let i = index.get(v);
      if (i === undefined) {
        i = assets.push(v) - 1;
        index.set(v, i);
      }
      return REF + i;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { $pack: 1, assets, deck: walk(deck) };
}

/** Данные из HTML → презентация. Файлы старых сборок (без упаковки) возвращаются как есть. */
export function unpackDeck(v: unknown): unknown {
  if (!v || typeof v !== 'object' || (v as Packed).$pack !== 1) return v;
  const { assets, deck } = v as Packed;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return x.startsWith(REF) ? assets[Number(x.slice(REF.length))] ?? '' : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(deck);
}
