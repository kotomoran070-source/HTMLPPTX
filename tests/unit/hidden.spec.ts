// Скрытые слайды: куда ведут стрелки, Home/End и прямой переход, как считается «N из M»
import { expect, test } from '@playwright/test';
import { landOn, stepVisible, visiblePos } from '../../src/engine/hidden';
import type { Deck } from '../../src/types';

const deck = (hidden: number[]) => ({ title: 't', slides: Array.from({ length: 6 }, (_, i) => ({ hidden: hidden.includes(i) || undefined })) }) as unknown as Deck;

test('стрелки перескакивают скрытые, на краю — остаются на месте', () => {
  const d = deck([0, 2, 3, 5]);
  expect(landOn(d, 2, 1)).toBe(4);   // → со 2-го: 3 и 4 скрыты
  expect(landOn(d, 3, 4)).toBe(1);   // ← с 5-го
  expect(landOn(d, 5, 4)).toBe(4);   // → с последнего видимого: дальше только скрытый
  expect(landOn(d, 0, 4)).toBe(1);   // Home: первый скрыт — первый видимый
  expect(landOn(d, 0, -1)).toBe(1);  // открыли показ на скрытом первом
  expect(landOn(d, 4, 1)).toBe(4);   // видимый — как есть
});

test('следующий и предыдущий видимые, счёт без скрытых', () => {
  const d = deck([0, 2, 3, 5]);
  expect(stepVisible(d, 1, 1)).toBe(4);
  expect(stepVisible(d, 4, 1)).toBe(-1);
  expect(stepVisible(d, 1, -1)).toBe(-1);
  expect(visiblePos(d, 4)).toEqual({ pos: 2, total: 2 });
  // Все скрыты — переход не теряется
  expect(landOn(deck([0, 1, 2, 3, 4, 5]), 3, 0)).toBe(3);
});
