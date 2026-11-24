// «Версии» (src/studio/versions-rows.ts): автоматические точки подряд — одной группой, свои точки и правки агентов
// ряд разрывают, одиночная точка — обычной строкой; подписи групп и время строки
import { expect, test } from '@playwright/test';
import { foldAuto, hm, kindsText } from '../../src/studio/versions-rows';

type X = { k: 'open' | 'close' | 'drop' | 'mine' | 'agent' | 'gone'; id: string };
const auto = (x: X) => x.k === 'open' || x.k === 'close' || x.k === 'drop' || x.k === 'gone';
const point = (x: X) => x.k !== 'agent' && x.k !== 'gone';
const shape = (rows: ReturnType<typeof foldAuto<X>>) => rows.map((r) => (r.kind === 'one' ? r.item.id : `[${r.items.map((x) => x.id).join(' ')}]`)).join(' ');

test('автоматические точки подряд — группа; своя точка и агент разрывают; одна точка — строкой', () => {
  const day: X[] = [
    { k: 'open', id: 'o5' }, { k: 'drop', id: 'd4' }, { k: 'open', id: 'o4' },
    { k: 'mine', id: 'm1' },
    { k: 'agent', id: 'a1' },
    { k: 'open', id: 'o3' },
    { k: 'mine', id: 'm0' },
    { k: 'close', id: 'c2' }, { k: 'open', id: 'o2' },
  ];
  expect(shape(foldAuto(day, auto, point))).toBe('[o5 d4 o4] m1 a1 o3 m0 [c2 o2]');
  // Убранная из истории строка остаётся в своей группе, но точкой не считается: с одной точкой группы нет
  expect(shape(foldAuto([{ k: 'open', id: 'o2' }, { k: 'gone', id: 'g' }, { k: 'open', id: 'o1' }], auto, point))).toBe('[o2 g o1]');
  expect(shape(foldAuto([{ k: 'open', id: 'o1' }, { k: 'gone', id: 'g' }], auto, point))).toBe('o1 g');
  expect(foldAuto([], auto, point)).toEqual([]);
});

test('подпись группы — сколько точек каждого вида; время строки — без даты', () => {
  const names: [string, string][] = [['open', 'Когда открыли'], ['close', 'Когда закрыли'], ['drop', 'Не сохранено при выходе']];
  expect(kindsText(['open', 'drop', 'open', 'drop', 'open'], names)).toBe('Когда открыли — 3, не сохранено при выходе — 2');
  expect(kindsText(['drop', 'close'], names)).toBe('Когда закрыли — 1, не сохранено при выходе — 1');
  expect(hm(new Date(2026, 10, 23, 9, 5).getTime())).toBe('09:05');
});
