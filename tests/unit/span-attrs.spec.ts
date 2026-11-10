import { expect, test } from '@playwright/test';
import { formatSpanAttrs, mergeSpanAttrs, parseSpanAttrs, spanCss } from '../../src/engine/span-attrs';
import { t } from '../../src/engine/html';
import { escapeText, wrapColor } from '../../src/engine/editor/serialize';

test('оформление части текста: цвет, размер и шрифт в одном токене; старые записи — частные случаи', () => {
  expect(parseSpanAttrs('#B7791F s:200')).toEqual({ paint: '#B7791F', size: 200 });
  expect(parseSpanAttrs('s:80')).toEqual({ size: 80 });
  expect(parseSpanAttrs('accent')).toEqual({ paint: 'accent' });
  expect(parseSpanAttrs('g:ocean')).toEqual({ paint: 'g:ocean' });
  // Шрифт — последним, в имени пробелы
  expect(parseSpanAttrs('#DC2626 s:120 f:Segoe UI')).toEqual({ paint: '#DC2626', size: 120, font: 'Segoe UI' });
  expect(parseSpanAttrs('f:serif')).toEqual({ font: 'serif' });
  // Не оформление: маркер, слово, кавычки в имени шрифта
  for (const bad of ['mark', 'привет', 'f:Bad"Font', 's:5000', '#zzz', '']) expect(parseSpanAttrs(bad)).toBeNull();
  // Метки правки — только в правке
  expect(parseSpanAttrs('-c s:120')).toBeNull();
  expect(parseSpanAttrs('-c s:120', true)).toEqual({ noPaint: true, size: 120 });
  expect(formatSpanAttrs({ paint: 'accent', size: 150, font: 'PT Sans' })).toBe('accent s:150 f:PT Sans');
  expect(formatSpanAttrs({ size: 100 })).toBe('');
  expect(formatSpanAttrs({ noPaint: true, size: 90 })).toBe('s:90');
  expect(formatSpanAttrs({ noPaint: true, size: 90 }, true)).toBe('-c s:90');
});

test('кусок внутри куска: свой цвет и шрифт главнее, размеры перемножаются, -c снимает цвет снаружи', () => {
  expect(mergeSpanAttrs({ paint: '#B7791F', size: 200 }, { paint: '#DC2626' })).toEqual({ paint: '#DC2626', size: 200 });
  expect(mergeSpanAttrs({ size: 200 }, { size: 150 })).toEqual({ size: 300 });
  expect(mergeSpanAttrs({ paint: 'accent', font: 'serif' }, { noPaint: true, size: 80 })).toEqual({ noPaint: true, size: 80, font: 'serif' });
  expect(mergeSpanAttrs({ font: 'serif' }, { font: 'mono' })).toEqual({ font: 'mono' });
});

test('разметка → HTML: один span со всем оформлением', () => {
  const html = t('{#DC2626 s:200 f:serif|**19 дней**} и дальше');
  expect(html).toContain('class="md-c"');
  expect(html).toContain('data-c="#DC2626 s:200 f:serif"');
  expect(html).toMatch(/style="color:#DC2626;font-size:2em;font-family:Georgia/);
  expect(t('{g:ocean s:150|волна}')).toContain('class="md-c md-g"');
  // Не оформление — как есть
  expect(t('{не цвет|текст}')).toBe('{не цвет|текст}');
  expect(spanCss({ paint: 'accent' })).toBe('color:var(--ac)');
});

test('правка → разметка: цвет поверх куска с размером сохраняет размер; в обычном тексте похожее экранируется', () => {
  // Внутри {#B7791F s:200|…} слова перекрасили: размер остаётся, цвет — новый
  expect(wrapColor('#B7791F s:200', '**{#DC2626|19 дней}**')).toBe('**{#DC2626 s:200|19 дней}**');
  // Внутри куска с размером — свой размер: перемножается
  expect(wrapColor('s:200', 'А {s:50|б} в')).toBe('{s:200|А} б {s:200|в}');
  // Цвет «как у всего текста» внутри цветного куска
  expect(wrapColor('#B7791F s:200', '{-c|слово}')).toBe('{-c s:200|слово}');
  expect(escapeText('{f:serif|x} и {#123456|y} и {mark|z} и {просто|текст}')).toBe('\\{f:serif|x} и \\{#123456|y} и \\{mark|z} и {просто|текст}');
});
