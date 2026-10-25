import { expect, test } from '@playwright/test';
import { textStyleCss } from '../../src/engine/text-style';

test('эффекты текста: тень и свечение — text-shadow в em, контур — под заливкой', () => {
  const css = textStyleCss({ shadow: 'soft', glow: 'accent', outline: 2, outlineColor: 'accent' });
  expect(css).toMatch(/text-shadow:0 \.04em \.14em rgb\(15 23 42 \/ \.35\), 0 0 \.03em var\(--ac\)/);
  // Видимая толщина контура — 2 px: половина его — под буквой (paint-order)
  expect(css).toContain('-webkit-text-stroke:4px var(--ac)');
  expect(css).toContain('paint-order:stroke fill');
  // Неизвестная тень и мусор в цвете — пропускаются
  expect(textStyleCss({ shadow: 'x', glow: 'red;x' })).toBe('');
});

test('только контур: буквы без заливки, тень — фильтром (сквозь пустые буквы не просвечивает)', () => {
  const css = textStyleCss({ hollow: true, color: 'accent', shadow: 'hard' });
  expect(css).toContain('-webkit-text-stroke:2px var(--ac)');
  expect(css).toContain('-webkit-text-fill-color:transparent');
  expect(css).toMatch(/filter:drop-shadow\(\.05em \.06em 0 rgb\(15 23 42 \/ \.5\)\)/);
  expect(css).not.toContain('text-shadow');
});

test('градиент всего текста и плашка: рамка по самому тексту, на месте строки', () => {
  const g = textStyleCss({ color: 'g:sunset', align: 'center' });
  expect(g).toContain('-webkit-background-clip:text');
  expect(g).toContain('width:fit-content');
  expect(g).toContain('margin-left:auto;margin-right:auto');
  const p = textStyleCss({ plate: 'soft', align: 'right', color: 'accent2' });
  expect(p).toContain('background:var(--acs)');
  expect(p).toContain('margin-left:auto');
  expect(p).not.toContain('margin-right:auto');
  // У градиентного текста плашки нет: фон занят градиентом
  expect(textStyleCss({ color: 'g:sunset', plate: 'accent' })).not.toContain('border-radius');
});

test('курсив, подчёркивание и прозрачность всего текста', () => {
  const css = textStyleCss({ italic: true, underline: true, opacity: 0.6 });
  expect(css).toContain('font-style:italic');
  expect(css).toContain('text-decoration:underline');
  expect(css).toContain('opacity:0.6');
  expect(textStyleCss({ opacity: 1 })).toBe('');
});
