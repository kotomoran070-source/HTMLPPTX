/**
 * Новый порядок слайдов при переносе группы (лента слайдов, slides-panel.ts). Порядок — список прежних номеров
 * в новом порядке; null — порядок не меняется (команда недоступна, линию вставки не показывать)
 */

/**
 * «Переместить выше/ниже» (Alt+↑/↓) для группы: каждый выделенный слайд меняется местами с соседним
 * невыделенным. Подряд идущие едут блоком, разрозненные — каждый на шаг; упёршиеся в край стоят
 */
export function shiftOrder(n: number, list: number[], dir: -1 | 1): number[] | null {
  const order = Array.from({ length: n }, (_, i) => i);
  const sel = new Set(list);
  const on = order.map((i) => sel.has(i));
  // Проход навстречу движению: блок у края не перескакивает через соседний выделенный
  for (let k = dir < 0 ? 1 : n - 2; dir < 0 ? k < n : k >= 0; k -= dir) {
    const j = k + dir;
    if (on[k] && !on[j]) {
      [order[k], order[j]] = [order[j], order[k]];
      [on[k], on[j]] = [on[j], on[k]];
    }
  }
  return order.some((v, k) => v !== k) ? order : null;
}

/**
 * Перетаскивание: группа встаёт в зазор gap (0 — перед первым слайдом, n — после последнего) одним блоком,
 * в своём порядке, как в PowerPoint; остальные слайды сохраняют порядок
 */
export function dropOrder(n: number, group: number[], gap: number): number[] | null {
  const set = new Set(group);
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !set.has(i));
  const at = rest.filter((i) => i < gap).length;
  const order = [...rest.slice(0, at), ...[...group].sort((a, b) => a - b), ...rest.slice(at)];
  return order.some((v, k) => v !== k) ? order : null;
}
