// Живой ряд: промежутки держатся сами, порядок — по положению, весь ряд двигается целиком
import { expect, test } from '@playwright/test';
import { layoutRows, rowAnchors } from '../../src/engine/editor/rows';
import type { Deck } from '../../src/types';

const card = (id: string, x: number, y: number, w: number, h: number, row = { id: 'r', gap: 20 }) => ({ type: 'shape', id, place: { x, y, w, h }, row });
const deck = (...free: object[]) => ({ title: 't', slides: [{ template: 'canvas', free }] }) as unknown as Deck;
const at = (d: Deck) => (d.slides[0].free as { id: string; place: { x: number; y: number } }[]).map((o) => `${o.id}:${o.place.x},${o.place.y}`).join(' ');
const fromData = () => null;

test('ряд: стал шире — соседи сдвигаются; перетащили один — порядок; весь — едет целиком', () => {
  const d = deck(card('a', 100, 50, 100, 80), card('b', 220, 50, 100, 80), card('c', 340, 50, 100, 80));
  let before = rowAnchors(d);
  (d.slides[0].free as any[])[1].place.w = 200; // b шире
  layoutRows(d, before, fromData);
  expect(at(d)).toBe('a:100,50 b:220,50 c:440,50');

  before = rowAnchors(d);
  (d.slides[0].free as any[])[0].place.x = 900; // a перетащили в конец
  layoutRows(d, before, fromData);
  expect(at(d)).toBe('a:440,50 b:100,50 c:320,50');

  before = rowAnchors(d);
  for (const o of d.slides[0].free as any[]) { o.place.x += 30; o.place.y += 10; } // весь ряд
  layoutRows(d, before, fromData);
  expect(at(d)).toBe('a:470,60 b:130,60 c:350,60');

  before = rowAnchors(d);
  (d.slides[0].free as any[])[2].place.y = 300; // один вниз — вернётся на линию ряда
  layoutRows(d, before, fromData);
  expect(at(d)).toBe('a:470,60 b:130,60 c:350,60');
});

test('по центру — по самому высокому; столбец; один объект — уже не ряд', () => {
  const d = deck(card('a', 0, 0, 100, 40, { id: 'r', gap: 10, align: 'center' } as any), card('b', 200, 0, 100, 100, { id: 'r', gap: 10, align: 'center' } as any));
  layoutRows(d, rowAnchors(d), fromData);
  expect(at(d)).toBe('a:0,30 b:110,0');

  const c = deck(card('a', 50, 0, 100, 40, { id: 'k', gap: 16, dir: 'col' } as any), card('b', 60, 300, 100, 60, { id: 'k', gap: 16, dir: 'col' } as any));
  layoutRows(c, rowAnchors(c), (_s, k) => (k === 0 ? { w: 100, h: 70 } : null)); // a на слайде выше, чем в данных
  expect(at(c)).toBe('a:50,0 b:50,86');

  const one = deck(card('a', 0, 0, 100, 40));
  layoutRows(one, rowAnchors(one), fromData);
  expect((one.slides[0].free as any[])[0].row).toBeUndefined();
});
