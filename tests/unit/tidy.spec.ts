// «Привести в порядок»: правит только почти одинаковое между слайдами, задуманное не трогает
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { parse } from 'yaml';
import { applyFixes, findFixes } from '../../src/studio/tidy';
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

test('точно ошибки: копия поверх такой же, ссылки в никуда, скрытое без кнопки — и только они', () => {
  const card = { type: 'shape', kind: 'round', text: 'Важное', place: { x: 100, y: 100, w: 200, h: 80 } };
  const d = {
    title: 'т',
    slides: [
      { id: 'a', template: 'canvas', free: [
        card,
        { ...card, place: { x: 101, y: 100, w: 200, h: 80 } }, // вставили дважды — на 1 px в сторону
        { ...card, place: { x: 140, y: 120, w: 200, h: 80 } }, // нарочно рядом — не копия
        { ...card, text: 'Другое' }, // поверх, но другое
        { type: 'text', text: 'Дальше', action: 'slide:gone' }, // слайда нет
        { type: 'text', text: 'Назад', action: 'slide:b', place: { x: 0, y: 500, w: 100 } },
        { type: 'text', text: 'Открыть', action: 'show:tip,lost;hide:old', place: { x: 0, y: 600, w: 100 } },
        { type: 'text', id: 'tip', text: 'Подсказка', hidden: true, place: { x: 0, y: 650, w: 100 } }, // кнопка есть
        { type: 'text', id: 'orphan', text: 'Сюрприз', hidden: true, place: { x: 0, y: 700, w: 100 } }, // кнопки нет
      ] },
      { id: 'b', template: 'canvas', free: [{ ...card, locked: true }, { ...card, locked: true }] }, // закреплённое не трогаем
    ],
  } as unknown as Deck;
  const fixes = findFixes(d);
  expect(fixes.map((f) => `${f.what}: ${f.from}`).sort()).toEqual([
    'Кнопка управляет удалённым объектом: «Открыть»: объектов lost, old нет',
    'Копия поверх такого же объекта: «Важное»',
    'Скрыт до щелчка, но кнопки нет: «Сюрприз»',
    'Ссылка на удалённый слайд: «Дальше»: слайда «gone» нет',
  ]);
  applyFixes(d, fixes);
  const free = d.slides[0].free as Record<string, any>[];
  expect(free).toHaveLength(8);
  expect(free.map((o) => o.text)).toEqual(['Важное', 'Важное', 'Другое', 'Дальше', 'Назад', 'Открыть', 'Подсказка', 'Сюрприз']);
  expect(free[1].place.x).toBe(140);
  expect(free[3].action).toBeUndefined();
  expect(free[4].action).toBe('slide:b');
  expect(free[5].action).toBe('show:tip');
  expect(free[6].hidden).toBe(true);
  expect(free[7].hidden).toBeUndefined();
  expect(d.slides[1].free).toHaveLength(2);
  expect(findFixes(d)).toEqual([]);
});

test('кнопка, у которой не осталось ни одного объекта, — без действия', () => {
  const d = { title: 'т', slides: [{ template: 'canvas', free: [{ type: 'text', text: 'Кнопка', action: 'toggle:x;play:y' }] }] } as unknown as Deck;
  applyFixes(d, findFixes(d));
  expect((d.slides[0].free as Record<string, any>[])[0].action).toBeUndefined();
});
