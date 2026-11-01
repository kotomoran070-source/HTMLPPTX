// Тренды графиков: регрессия с R², скользящее среднее, прогноз, «круглые» оси, уравнение по-русски
import { expect, test } from '@playwright/test';
import { axisBounds, delta, equation, linearFit, movingAverage, niceAxis, ruNum, trendCaption, trendKind, trendOf } from '../../src/components/charts/trend';

test('линейная регрессия: точная прямая — R² = 1, шум — меньше; одинаковые x — нет прямой', () => {
  const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7])!;
  expect([f.a, f.b, f.r2]).toEqual([1, 2, 1]);
  const g = linearFit([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])!;
  expect(g.b).toBeCloseTo(0.6, 6);
  expect(g.r2).toBeCloseTo(0.6, 6);
  expect(linearFit([2, 2], [1, 5])).toBeNull();
  expect(linearFit([1], [1])).toBeNull();
});

test('скользящее среднее как в Excel: первые n − 1 точек пустые; тренд графика — linear или число 2–12', () => {
  expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  expect([trendKind('linear'), trendKind(true), trendKind('3'), trendKind(5), trendKind(1), trendKind(''), trendKind('nope')]).toEqual(['linear', 'linear', 3, 5, null, null, null]);
});

test('прогноз продолжает линейный тренд на заданные шаги и без явного тренда', () => {
  const t = trendOf([10, 12, 14, 16], undefined, 2);
  expect(t.ahead).toBe(2);
  expect(t.line).toEqual([10, 12, 14, 16, 18, 20]);
  // Скользящее среднее прогноза не даёт
  expect(trendOf([1, 2, 3, 4], 2, 0)).toEqual({ line: [null, 1.5, 2.5, 3.5], ahead: 0 });
});

test('оси — круглыми делениями, уравнение и числа — по-русски с типографским минусом', () => {
  expect(niceAxis(-12, 21, 5)).toEqual({ min: -20, max: 30, step: 10 });
  expect(niceAxis(232, 412, 5)).toEqual({ min: 200, max: 450, step: 50 });
  expect(niceAxis(3, 3).max).toBeGreaterThan(3);
  expect(equation({ a: -15.2, b: 2.1, r2: 1 })).toBe('y = 2,1x − 15,2');
  expect(equation({ a: 343.4, b: -5.734, r2: 1 })).toBe('y = −5,73x + 343');
  expect(ruNum(12345.6).replace(/\s/g, ' ')).toBe('12 346');
});

test('свои границы оси — только верные; подпись тренда и изменение к предыдущему значению', () => {
  expect(axisBounds(0, 10, -20, 30)).toEqual([0, 10]);
  expect(axisBounds(150, 100, 94, 255)).toEqual([94, 255]); // «от» больше «до» — по данным
  expect(axisBounds('', 300, 94, 255)).toEqual([94, 300]);
  expect(axisBounds(400, undefined, 94, 255)).toEqual([94, 255]); // нижняя выше верхней по данным
  expect(trendCaption([10, 12, 14, 16], 'linear', 0)).toBe('тренд: +2 за шаг · R² = 1');
  expect(trendCaption([1, 2, 3], 3, 0)).toBe('пунктир — среднее за 3 точки');
  expect(trendCaption([1, 2, 3], '', 0)).toBe('');
  expect(delta(15, 11)).toBe('+4 (+36,4 %)');
  expect(delta(9, 12)).toBe('−3 (−25 %)');
});
