import { getAt, setAt, type Path } from '../data';
import type { TextStyle } from '../text-style';

/**
 * Оформление по пути data-ed-style-at (ячейка таблицы): недостающие списки создаются, пустое
 * оформление — null, а список, где не осталось ни одного значения, убирается целиком
 */
export function putStyle(root: unknown, at: Path, st: TextStyle): void {
  const empty = !Object.keys(st).length;
  if (empty && getAt(root, at) == null) return;
  setAt(root, at, empty ? null : st);
  // Пропуски в созданных списках — null (в файле — явные пустые места, а не дыры)
  for (let i = 1; i < at.length; i++) {
    const list = getAt(root, at.slice(0, i));
    if (Array.isArray(list)) for (let k = 0; k < list.length; k++) if (list[k] === undefined) list[k] = null;
  }
  for (let i = at.length - 1; i > 0; i--) {
    const list = getAt(root, at.slice(0, i));
    if (!Array.isArray(list) || list.some((v) => v != null && !(Array.isArray(v) && !v.some((x) => x != null)))) break;
    const parent = getAt(root, at.slice(0, i - 1)) as Record<string | number, unknown>;
    if (Array.isArray(parent)) parent[at[i - 1] as number] = null;
    else delete parent[at[i - 1]];
  }
}
