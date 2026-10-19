import { expect, test } from '@playwright/test';
import { backdropLook, slideBackdrop } from '../../src/engine/backdrops';
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

test('ответ фона на мышь: по умолчанию есть, тема выключает для всех, слайд — своё', () => {
  const d = (backdropTouch?: boolean): Deck => ({ title: 't', slides: [], theme: { backdrop: 'network', ...(backdropTouch === undefined ? {} : { backdropTouch }) } });
  expect(backdropLook({}, d()).touch).toBe(true);
  expect(backdropLook({}, d(false)).touch).toBe(false);
  expect(backdropLook({ backdropTouch: true }, d(false)).touch).toBe(true);
  expect(backdropLook({ backdropTouch: false }, d()).touch).toBe(false);
  // Не да/нет — как не задано
  expect(backdropLook({ backdropTouch: 'нет' }, d()).touch).toBe(true);
});
