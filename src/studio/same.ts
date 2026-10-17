/**
 * Свои библиотеки (темы, шаблоны, эффекты, образы) без двойников: одинаковое содержимое узнаётся
 * при любом порядке полей, а одинаковое имя у разного содержимого получает номер.
 */
import type { MyTheme } from './my-themes';

/** JSON с ключами по алфавиту, без пустых полей: одинаковое содержимое — одинаковая строка */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Имя, которого ещё нет в списке: «Тема», «Тема (2)», «Тема (3)»… */
export function freeName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  const base = name.replace(/\s\(\d+\)$/, '');
  let n = 2;
  while (set.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/** Содержимое своей темы для сравнения: оформление и файлы шрифтов — без имени, id, даты и отметки галереи */
export function themeKey(t: Pick<MyTheme, 'theme' | 'fonts'>): string {
  const { preset: _p, ...theme } = t.theme;
  // Файл шрифта — по содержимому: тип в начале data: URL зависит от того, откуда файл взяли
  return stableJson({ theme, fonts: (t.fonts ?? []).map((f) => [f.name, f.weight ?? 400, f.style ?? '', f.data.slice(f.data.indexOf(',') + 1)]).sort() });
}
