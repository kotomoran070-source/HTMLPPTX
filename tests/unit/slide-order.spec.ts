// Лента слайдов (src/studio/slide-order.ts): новый порядок при переносе группы перетаскиванием и Alt+↑/↓
import { expect, test } from '@playwright/test';
import { dropOrder, shiftOrder } from '../../src/studio/slide-order';

const apply = (order: number[] | null, names = 'ABCDEFGH') => (order ? order.map((i) => names[i]).join('') : null);

test('перетаскивание: группа встаёт в зазор одним блоком, в своём порядке; на своё же место — порядок не меняется', () => {
  // B и D — в зазор после F (6): остальные сдвигаются, группа подряд
  expect(apply(dropOrder(8, [1, 3], 6))).toBe('ACEFBDGH');
  // В начало и в конец; группа, отмеченная не по порядку, — всё равно в своём порядке
  expect(apply(dropOrder(8, [5, 2], 0))).toBe('CFABDEGH');
  expect(apply(dropOrder(8, [0, 1], 8))).toBe('CDEFGHAB');
  // Подряд идущие — в зазор внутри себя или рядом: ничего не меняется (линию не показывать)
  expect(dropOrder(8, [2, 3], 2)).toBeNull();
  expect(dropOrder(8, [2, 3], 3)).toBeNull();
  expect(dropOrder(8, [2, 3], 4)).toBeNull();
  // Разрозненные в зазор между ними — собираются вместе
  expect(apply(dropOrder(8, [1, 4], 3))).toBe('ACBEDFGH');
});

test('Alt+↑/↓: каждый выделенный — на шаг, блок — целиком, у края стоит', () => {
  expect(apply(shiftOrder(6, [2, 3], -1), 'ABCDEF')).toBe('ACDBEF');
  expect(apply(shiftOrder(6, [2, 3], 1), 'ABCDEF')).toBe('ABECDF');
  // Разрозненные — каждый на шаг
  expect(apply(shiftOrder(6, [1, 4], 1), 'ABCDEF')).toBe('ACBDFE');
  // Первый уже наверху — стоит, второй подтягивается к нему
  expect(apply(shiftOrder(6, [0, 2], -1), 'ABCDEF')).toBe('ACBDEF');
  expect(shiftOrder(6, [0, 1], -1)).toBeNull();
  expect(shiftOrder(6, [5], 1)).toBeNull();
});
