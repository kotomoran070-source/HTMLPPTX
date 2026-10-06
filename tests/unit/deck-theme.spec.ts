// Тема презентации: палитра из фона и текста, постоянный вид слайдов, текст на акценте
import { expect, test } from '@playwright/test';
import { fullPalette, hasThemeLook, themeCss, themeVars } from '../../src/engine/deck-theme';

test('палитра выводится из фона и текста, заданные цвета не трогаются', () => {
  const p = fullPalette({ bg: '#FFFFFF', tx: '#000000', mu: '#123456' }, 'light');
  expect(p.bg).toBe('#FFFFFF');
  expect(p.mu).toBe('#123456');
  // Линии — между фоном и текстом, ближе к фону; второстепенный текст — ближе к тексту
  expect(p.bd).toBe('#E6E6E6');
  expect(p.tx2).toBe('#333333');
  // Без фона или текста — стандартная палитра
  expect(fullPalette({ bg: '#FFFFFF' }, 'dark').bg).toBe('#0F172A');
  // Только акцент и шрифт — это ещё не тема: слайды как раньше
  expect(hasThemeLook({ accent: '#FF0000', font: 'Manrope' })).toBe(false);
  expect(hasThemeLook({ bg: 'grid' })).toBe(true);
});

test('постоянно тёмные слайды — один набор без условий; на светлом акценте текст тёмный', () => {
  const dark = themeCss({ mode: 'dark', accent: '#22D3EE', dark: { bg: '#070B18', tx: '#E8ECFA' } }, '.slide[data-th="k"]');
  expect(dark).not.toContain('@media');
  expect(dark).toContain('--bg:#070B18');
  expect(dark).toContain('color-scheme:dark');
  const auto = themeCss({ bg: 'plain' }, '.slide');
  expect(auto).toContain('@media (prefers-color-scheme: dark)');
  expect(auto).toContain(':root[data-theme="dark"] .slide');
  // Светлый бирюзовый акцент: белый текст на нём не читается — тёмный из палитры
  expect(themeVars({ accent: '#22D3EE', mode: 'dark', dark: { bg: '#070B18', tx: '#E8ECFA' } }, 'dark')['--on-ac']).toBe('#070B18');
  expect(themeVars({ accent: '#2563EB' }, 'light')['--on-ac']).toBe('#FFFFFF');
  // Незаданное — «как без темы», поправка размера заголовков — в разумных пределах
  const v = themeVars({ headScale: 3 }, 'light');
  expect(v['--font-head']).toBe('initial');
  expect(v['--h-scale']).toBe('1.3');
});
