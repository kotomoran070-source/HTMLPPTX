/**
 * Строки «Версий» (file-panel.ts) по дням. Подряд идущие автоматические точки одного дня — «Когда открыли»,
 * «Когда закрыли», «Не сохранено при выходе» — сворачиваются в одну строку, как автосохранения в истории версий
 * Google Docs и Figma: иначе каждое открытие студии — отдельная строка, и за неделю работы список уходит в десятки
 * одинаковых миниатюр. Свои точки (Ctrl+S) и правки агентов и скриптов ряд разрывают: их ищут глазами
 */

export type Folded<T> = { kind: 'one'; item: T } | { kind: 'group'; items: T[] };

/**
 * items — строки одного дня, новые первыми. auto — строка автоматической точки (или убранная из истории такая
 * строка: «Отменить» остаётся внутри своей группы); counts — сама точка. Ряд из двух точек и больше — группа,
 * одиночная точка остаётся обычной строкой
 */
export function foldAuto<T>(items: T[], auto: (x: T) => boolean, counts: (x: T) => boolean): Folded<T>[] {
  const out: Folded<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.filter(counts).length >= 2) out.push({ kind: 'group', items: run });
    else for (const item of run) out.push({ kind: 'one', item });
    run = [];
  };
  for (const x of items) {
    if (auto(x)) {
      run.push(x);
      continue;
    }
    flush();
    out.push({ kind: 'one', item: x });
  }
  flush();
  return out;
}

/** «Когда открыли — 6, не сохранено при выходе — 6»: сколько точек каждого вида, в порядке names */
export function kindsText(kinds: string[], names: [string, string][]): string {
  const parts = names.map(([k, name]) => [name, kinds.filter((x) => x === k).length] as const).filter(([, n]) => n > 0);
  return parts.map(([name, n], i) => `${i ? name.toLowerCase() : name} — ${n}`).join(', ');
}

/** «17:28» — время строки: день уже в заголовке над ней */
export const hm = (t: number): string => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
