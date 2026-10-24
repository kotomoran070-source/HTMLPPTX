// Автопоказ: таймлайн слайда — шаги по 1,5 с, потом время слайда; чёрточки и отрезки — доли полосы
import { expect, test } from '@playwright/test';
import { plan } from '../../src/engine/autoplay';

test('таймлайн слайда: чёрточки шагов, отрезок после k шагов, без шагов — одна полоса', () => {
  const p = plan(2, 8000);
  expect(p.total).toBe(11000);
  expect(p.ticks).toEqual([1500 / 11000, 3000 / 11000]);
  expect(p.seg(0)).toEqual({ from: 0, to: 1500 / 11000, ms: 1500 });
  expect(p.seg(1)).toEqual({ from: 1500 / 11000, to: 3000 / 11000, ms: 1500 });
  expect(p.seg(2)).toEqual({ from: 3000 / 11000, to: 1, ms: 8000 });
  expect(plan(0, 5000)).toMatchObject({ total: 5000, ticks: [] });
  expect(plan(0, 5000).seg(0)).toEqual({ from: 0, to: 1, ms: 5000 });
});
