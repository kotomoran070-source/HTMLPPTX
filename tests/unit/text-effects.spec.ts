import { expect, test } from '@playwright/test';
import { textShadowOf, textStyleCss } from '../../src/engine/text-style';

test('эффекты текста: тень и свечение — text-shadow в em, контур — под заливкой', () => {
  const css = textStyleCss({ shadow: 'soft', glow: 'accent', outline: 2, outlineColor: 'accent' });
  expect(css).toContain('text-shadow:0em 0.04em 0.14em color-mix(in srgb, #0F172A 35%, transparent), 0 0 0.03em var(--ac)');
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
  expect(css).toContain('filter:drop-shadow(0.05em 0.06em 0em color-mix(in srgb, #0F172A 50%, transparent))');
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

test('ручки эффектов: своя тень поверх готовой, свечение и плашка — числами в em', () => {
  // Направление 0° — тень вправо; цвет темы с непрозрачностью — color-mix
  const css = textStyleCss({ shadow: 'soft', shadowAngle: 0, shadowDist: 0.1, shadowBlur: 0, shadowColor: 'accent', shadowOpacity: 0.5 });
  expect(css).toContain('text-shadow:0.1em 0em 0em color-mix(in srgb, var(--ac) 50%, transparent)');
  // Без поправок — готовая; мусор в поправках не ломает тень
  expect(textShadowOf({ shadow: 'retro', shadowBlur: Number.NaN, shadowColor: 'red;x' })).toMatchObject({ blur: 0, color: 'accent', dist: 0.085 });
  expect(textShadowOf({ shadowBlur: 1 })).toBeNull();
  expect(textStyleCss({ glow: 'accent', glowSize: 0.68, glowOpacity: 0.5 })).toContain('0 0 0.68em color-mix(in srgb, var(--ac) 25%, transparent)');
  const plate = textStyleCss({ plate: 'accent', plateRadius: 0, platePad: 1 });
  expect(plate).toContain('padding:0.28em 1em 0.36em');
  expect(plate).toContain('border-radius:0em');
});
