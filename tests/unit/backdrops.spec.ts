import { expect, test } from '@playwright/test';
import { slideBackdrop } from '../../src/engine/backdrops';
import type { Deck, SlideData } from '../../src/types';

const deck = (backdrop?: string): Deck => ({ title: 't', slides: [], ...(backdrop ? { theme: { backdrop } } : {}) });

test('фон слайда: свой важнее темы, none убирает фон темы, неизвестный — как не задан', () => {
  const s = (backdrop?: string): SlideData => (backdrop ? { backdrop } : {});
  expect(slideBackdrop(s(), deck('waves'))).toBe('waves');
  expect(slideBackdrop(s('stars'), deck('waves'))).toBe('stars');
  expect(slideBackdrop(s('none'), deck('waves'))).toBeNull();
  expect(slideBackdrop(s('???'), deck('waves'))).toBe('waves');
  expect(slideBackdrop(s(), deck())).toBeNull();
  expect(slideBackdrop(s(), deck('???'))).toBeNull();
});
