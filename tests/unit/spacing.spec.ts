// Равные промежутки при перетаскивании (src/engine/editor/spacing.ts): куда прилипнуть и где стрелки
import { expect, test } from '@playwright/test';
import { equalGaps, spacingSnap, type Box } from '../../src/engine/editor/spacing';

const box = (x: number, y: number, w = 100, h = 80): Box => ({ x, y, w, h });

test('ряд из трёх: промежуток как у соседей — прилипает, стрелки в обоих промежутках', () => {
  const a = box(100, 200);
  const b = box(260, 200); // промежуток a–b: 60
  // Тянем третий правее b: промежуток 64 — в пределах 6 px от 60
  const r = box(424, 210);
  expect(spacingSnap(r, [a, b], 'x', 6)).toEqual({ d: -4 });
  const at = box(420, 210);
  const gaps = equalGaps(at, [a, b], 'x');
  expect(gaps.map((g) => [g.from, g.to])).toEqual(expect.arrayContaining([[200, 260], [360, 420]]));
  expect(gaps).toHaveLength(2);
  // Стрелка — по середине общей части соседей по высоте (210…280)
  expect(gaps.find((g) => g.from === 360)!.at).toBe(245);
  // Далеко от равного промежутка — не прилипает и стрелок нет
  expect(spacingSnap(box(450, 210), [a, b], 'x', 6)).toBeNull();
  expect(equalGaps(box(450, 210), [a, b], 'x')).toEqual([]);
});

test('ровно посередине между двумя; слева от пары — тоже', () => {
  const a = box(100, 200);
  const c = box(500, 200);
  // Посередине: (200 + 500 − 100) / 2 = 300
  expect(spacingSnap(box(303, 190), [a, c], 'x', 6)).toEqual({ d: -3 });
  expect(equalGaps(box(300, 190), [a, c], 'x')).toHaveLength(2);
  // Слева от a с тем же промежутком, что a–b
  const b = box(260, 200);
  expect(spacingSnap(box(-58, 200), [a, b], 'x', 6)).toEqual({ d: -2 });
});

test('другой ряд и объект между соседями не в счёт; по вертикали — так же', () => {
  const a = box(100, 100);
  const b = box(260, 100);
  // Тот же промежуток по горизонтали, но ниже ряда (по высоте не перекрывается) — не прилипает
  expect(spacingSnap(box(424, 400), [a, b], 'x', 6)).toBeNull();
  // Столбец: промежуток 40 по вертикали
  const t = box(100, 100, 200, 60);
  const m = box(100, 200, 200, 60);
  expect(spacingSnap(box(110, 302, 200, 60), [t, m], 'y', 6)).toEqual({ d: -2 });
  expect(equalGaps(box(110, 300, 200, 60), [t, m], 'y').map((g) => [g.from, g.to])).toEqual(expect.arrayContaining([[160, 200], [260, 300]]));
  // Между соседями что-то стоит — это не соседи, их промежуток не образец
  const between = box(205, 100, 20, 80);
  expect(spacingSnap(box(424, 100), [a, between, b], 'x', 6)).toBeNull();
});
