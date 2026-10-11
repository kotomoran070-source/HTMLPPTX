// Цвета импортированного файла по теме (engine/recolor.ts): перекраска, «Как в файле», разметка
import { expect, test } from '@playwright/test';
import { colorFamilies, recolorHtml, recolorVars, sameColors } from '../../src/engine/recolor';
import type { DeckOrigin } from '../../src/types';

const origin: DeckOrigin = {
  bg: '#F0EBE4', tx: '#1C343C', accents: ['#E0B4A4', '#4C6A78'],
  colors: ['#F0EBE4', '#1C343C', '#E0B4A4', '#4C6A78', '#A7B3B2', '#FFFFFF'],
};
const winter = { bg: '#F3F8FF', tx: '#0C1B33', surf: '#FFFFFF', accents: ['#1D6FD6', '#7DD3FC'] };
const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114; };

test('перекраска: фон и текст файла — фон и текст темы, светлота по оси «фон — текст» сохраняется', () => {
  const v = recolorVars(origin, winter);
  expect(v['--k-F0EBE4']).toBe('#F3F8FF');
  expect(v['--k-1C343C']).toBe('#0C1B33');
  // Белое на бежевом фоне — карточка темы
  expect(v['--k-FFFFFF']).toBe('#FFFFFF');
  // Розовый акцент файла → синий оттенок темы той же светлоты: светлое остаётся светлым
  const pink = v['--k-E0B4A4'];
  const [r, , b] = [1, 3, 5].map((i) => parseInt(pink.slice(i, i + 2), 16));
  expect(b).toBeGreaterThan(r);
  expect(Math.abs(lum(pink) - lum('#E0B4A4'))).toBeLessThan(30);
  // Серый между фоном и текстом — между фоном и текстом темы
  const gray = lum(v['--k-A7B3B2']);
  expect(gray).toBeLessThan(lum('#F3F8FF'));
  expect(gray).toBeGreaterThan(lum('#0C1B33'));
});

test('перекраска в тёмный вид: всё переворачивается вместе с фоном', () => {
  const v = recolorVars(origin, { bg: '#081426', tx: '#E8F1FF', surf: '#0F2038', accents: ['#3A82E0', '#8AD8FC'] });
  expect(v['--k-F0EBE4']).toBe('#081426');
  expect(v['--k-1C343C']).toBe('#E8F1FF');
  // Светлый розовый акцент на светлом фоне → тёмный оттенок на тёмном
  expect(lum(v['--k-E0B4A4'])).toBeLessThan(110);
});

test('семейства акцентов — по частоте и оттенку; серые не в счёт', () => {
  const counts = new Map([['#3C388D', 40], ['#5A57A8', 30], ['#888888', 90], ['#F97316', 10], ['#FFFFFF', 100]]);
  expect(colorFamilies(counts)).toEqual(['#3C388D', '#F97316']);
});

test('«Как в файле» — без перекраски; разметка: цвета в атрибутах, текст не трогается', () => {
  expect(sameColors({ accent: '#E0B4A4', mode: 'light', light: { bg: '#F0EBE4', tx: '#1C343C' }, font: 'Arimo' }, { accent: '#E0B4A4', mode: 'light', light: { bg: '#F0EBE4', tx: '#1C343C' } })).toBe(true);
  expect(sameColors({ accent: '#1D6FD6' }, { accent: '#E0B4A4' })).toBe(false);
  const html = '<div style="color:#e0b4a4;background:#123456"><svg><path fill="#4C6A78"/></svg>Цвет #E0B4A4</div>';
  expect(recolorHtml(html, new Set(['#E0B4A4', '#4C6A78']))).toBe(
    '<div style="color:var(--k-E0B4A4, #E0B4A4);background:#123456"><svg><path fill="var(--k-4C6A78, #4C6A78)"/></svg>Цвет #E0B4A4</div>',
  );
});
