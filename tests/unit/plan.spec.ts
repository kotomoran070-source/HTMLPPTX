// Прогресс показа: вид полосы у зрителей и план доклада у докладчика
import { expect, test } from '@playwright/test';
import { clock, planState, progressMode } from '../../src/engine/plan';

test('вид прогресса: без поля — линия, false — нет, сегментов слишком много — линия', () => {
  expect(progressMode(undefined, 10)).toBe('line');
  expect(progressMode(true, 10)).toBe('line');
  expect(progressMode(false, 10)).toBe('none');
  expect(progressMode('segments', 10)).toBe('segments');
  expect(progressMode('segments', 61)).toBe('line');
  expect(progressMode('number', 10)).toBe('number');
});

test('план доклада: метка по времени, сколько осталось, запас и отставание по слайду', () => {
  const min = 60_000;
  // 20 минут на 10 слайдов — по 2 минуты; на 3-м слайде с 4-й по 6-ю минуту — по плану
  expect(planState(3, 10, 5 * min, 20 * min)).toEqual({ at: 0.25, left: 15 * min, delta: 0 });
  // Пришли на 3-й слайд за 3 минуты — запас минута
  expect(planState(3, 10, 3 * min, 20 * min).delta).toBe(min);
  // На 3-м слайде уже 7 минут — отстаём на минуту
  expect(planState(3, 10, 7 * min, 20 * min).delta).toBe(-min);
  // Перерасход: метка в конце, осталось меньше нуля
  expect(planState(10, 10, 22 * min, 20 * min)).toMatchObject({ at: 1, left: -2 * min, delta: -2 * min });
  expect(clock(15.5 * min)).toBe('15:30');
  expect(clock(-130_000)).toBe('2:10');
  expect(clock(62 * min + 5000)).toBe('1:02:05');
});
