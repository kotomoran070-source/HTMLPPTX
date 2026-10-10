/**
 * Слияние трёх версий данных презентации: base — с какой окно начинало (последнее, что оно видело
 * в файле), mine — что оно сохраняет, theirs — что сейчас в файле (могло записать другое окно:
 * заметки из окна докладчика, вторая вкладка студии). Окно меняет только то, что меняло само, —
 * чужие правки остаются. Слайды сверяются по полям: правка заголовка в одном окне и заметки
 * в другом не мешают друг другу. Если одно и то же поле поменяли оба — побеждает mine.
 */

type Rec = Record<string, unknown>;

/** Сравнение без учёта порядка полей */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Rec).filter((k) => (v as Rec)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Rec)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}

export const same = (a: unknown, b: unknown): boolean => a === b || canon(a) === canon(b);

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Поля объекта: поменяла mine — её значение, иначе — из файла */
function fields(base: Rec, mine: Rec, theirs: Rec): Rec {
  const out: Rec = {};
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
    const v = same(mine[k], base[k]) ? theirs[k] : mine[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Слайды: свои перестановки, добавления и удаления остаются, чужие правки в нетронутых слайдах — тоже */
function slides(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] {
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  // Список слайдов поменяли оба (добавили, удалили) — свой; иначе слайды по одному
  const stable = theirs.length === base.length;
  const used = new Set<number>();
  return mine.map((m, i) => {
    if (!stable) return m;
    // Слайд не тронут (на своём месте или переставлен) — версия из файла
    let j = i < base.length && same(m, base[i]) && !used.has(i) ? i : -1;
    if (j < 0) j = base.findIndex((b, k) => !used.has(k) && same(m, b));
    if (j >= 0) {
      used.add(j);
      return theirs[j];
    }
    // Правлен на месте (число слайдов не менялось) — по полям
    if (mine.length === base.length && isRec(m) && isRec(base[i]) && isRec(theirs[i])) return fields(base[i] as Rec, m, theirs[i] as Rec);
    return m;
  });
}

/** Итог слияния; changed — в нём есть чужие правки (окну нужно взять итог себе) */
export function merge3(base: unknown, mine: unknown, theirs: unknown): { result: unknown; changed: boolean } {
  if (!isRec(base) || !isRec(mine) || !isRec(theirs)) return { result: mine, changed: false };
  const out = fields({ ...base, slides: 0 }, { ...mine, slides: 0 }, { ...theirs, slides: 0 });
  out.slides = slides(
    Array.isArray(base.slides) ? base.slides : [],
    Array.isArray(mine.slides) ? mine.slides : [],
    Array.isArray(theirs.slides) ? theirs.slides : [],
  );
  // Порядок полей — как у mine (так меньше лишних перестановок в файле)
  const result: Rec = {};
  for (const k of Object.keys(mine)) if (k in out) result[k] = out[k];
  for (const k of Object.keys(out)) if (!(k in result)) result[k] = out[k];
  return { result, changed: !same(result, mine) };
}
