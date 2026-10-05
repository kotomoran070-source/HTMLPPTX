// «Привести в порядок»: правит только почти одинаковое между слайдами, задуманное не трогает
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { parse } from 'yaml';
import { findFixes } from '../../src/studio/tidy';
import type { Deck } from '../../src/types';

const head = (size: number, x: number, y: number, extra: object = {}) => ({ type: 'text', text: 'Заголовок', styles: { text: { size } }, place: { x, y, w: 900 }, ...extra });
const body = (size: number) => ({ type: 'text', text: 'Текст', styles: { text: { size } }, place: { x: 48, y: 300, w: 600 } });
const shape = (fill: string) => ({ type: 'shape', kind: 'rect', fill, place: { x: 700, y: 400, w: 100, h: 100 } });

function messy(): Deck {
  return {
    title: 'т',
    slides: [
      { template: 'canvas', free: [head(72, 120, 200)] }, // обложка — своя вёрстка
      { template: 'canvas', free: [head(40, 48, 40), body(16), body(15), shape('#1F2937')] },
      { template: 'canvas', free: [head(40, 48, 40), shape('#1F2937')] },
      { template: 'canvas', free: [head(38, 50, 44), shape('#1F2938')] }, // случайно чуть иначе
      { template: 'canvas', free: [head(28, 48, 40), shape('#2563EB')] }, // 28 — нарочно меньше
      { template: 'canvas', free: [head(40, 48, 40, { locked: true })] },
      { template: 'canvas', free: [head(56, 200, 300)] }, // финал
    ],
  } as unknown as Deck;
}

test('находит только почти одинаковое и только на разных слайдах', () => {
  const fixes = findFixes(messy());
  const list = fixes.map((f) => `${f.what}: ${f.from} → ${f.to} @${f.slides.map((i) => i + 1)}`).sort();
  expect(list).toEqual([
    'Заголовки: отступ сверху: 44 px → 40 px @4',
    'Заголовки: отступ слева: 50 px → 48 px @4',
    'Размер заголовков: 38 px → 40 px @4',
    'Цвет: #1F2938 → #1F2937 @4',
  ]);
});

test('исправления меняют ровно эти значения', () => {
  const d = messy();
  for (const f of findFixes(d)) f.apply(d);
  const h = (d.slides[3].free as Record<string, any>[])[0];
  expect(h.styles.text.size).toBe(40);
  expect(h.place).toMatchObject({ x: 48, y: 40 });
  expect((d.slides[3].free as Record<string, any>[])[1].fill).toBe('#1F2937');
  // Остальное как было: 28 px, текст 15/16 на одном слайде, обложка, закреплённый
  expect((d.slides[4].free as Record<string, any>[])[0].styles.text.size).toBe(28);
  expect((d.slides[1].free as Record<string, any>[])[2].styles.text.size).toBe(15);
  expect((d.slides[0].free as Record<string, any>[])[0].place.x).toBe(120);
  expect(findFixes(d)).toEqual([]);
});

test('на готовых презентациях — без ложных срабатываний', () => {
  for (const n of ['lora', 'microclimate']) expect(findFixes(parse(fs.readFileSync(`presentations/${n}/deck.yaml`, 'utf8')))).toEqual([]);
});
