// Тема презентации: палитра из фона и текста, постоянный вид слайдов, текст на акценте
import { expect, test } from '@playwright/test';
import { fullPalette, hasThemeLook, lookFor, ownBg, themeCss, themeVars } from '../../src/engine/deck-theme';

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

test('своё у тёмных слайдов: узор фона, карточки, анимированный фон — только у тёмных, чего нет — как у всех', () => {
  const t = { bg: 'glow', cards: 'flat', backdrop: 'waves', darkLook: { bg: 'grid', backdrop: 'none', backdropSpeed: 2 } };
  const light = themeVars(t, 'light');
  const dark = themeVars(t, 'dark');
  expect(light['--slide-bg']).toBe(themeVars({ bg: 'glow' }, 'light')['--slide-bg']);
  expect(dark['--slide-bg']).toBe(themeVars({ bg: 'grid' }, 'dark')['--slide-bg']);
  // Карточки у тёмных своими не заданы — как у всех
  expect(dark['--card-bg']).toBe(themeVars({ cards: 'flat' }, 'dark')['--card-bg']);
  // Из двух слоёв анимированного фона виден слой своего вида
  expect([light['--bd-light'], light['--bd-dark'], dark['--bd-light'], dark['--bd-dark']]).toEqual(['block', 'none', 'none', 'block']);
  expect(lookFor(t, 'light')).toBe(t);
  // none — у тёмных без анимации
  expect(lookFor(t, 'dark')).toMatchObject({ bg: 'grid', cards: 'flat', backdrop: undefined, backdropSpeed: 2 });
  expect(hasThemeLook({ darkLook: { bg: 'grid' } })).toBe(true);
  // Слайды всегда тёмные — оформление одно, общее (переключателя «Для тёмных» тогда нет)
  expect(themeVars({ ...t, mode: 'dark' }, 'dark')['--slide-bg']).toBe(themeVars({ bg: 'glow', mode: 'dark' }, 'dark')['--slide-bg']);
});

test('свой фон темы: цвет или картинка на весь слайд, заметность картинки — пеленой цвета фона', () => {
  expect(ownBg('grid')).toBeNull();
  expect(ownBg('#112233')).toBe('color');
  expect(ownBg('./assets/sky.jpg')).toBe('image');
  expect(ownBg('javascript:alert(1)')).toBeNull();
  expect(themeVars({ bg: '#112233' }, 'light')['--slide-bg']).toBe('#112233');
  const img = themeVars({ bg: '/presentations/x/assets/a"b.png' }, 'light')['--slide-bg'];
  expect(img).toBe('url("/presentations/x/assets/ab.png") center / cover no-repeat, var(--bg)');
  expect(themeVars({ bg: './assets/a.png', bgOpacity: 0.6 }, 'light')['--slide-bg']).toMatch(/^linear-gradient\(color-mix\(in srgb, var\(--bg\) 40%, transparent\)/);
  // У тёмных — своя картинка и своя заметность
  expect(themeVars({ bg: 'dots', darkLook: { bg: './assets/n.png', bgOpacity: 0.3 } }, 'dark')['--slide-bg']).toContain('url("./assets/n.png")');
});
