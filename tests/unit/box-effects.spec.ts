import { expect, test } from '@playwright/test';
import { boxFxCss, boxShadowOf, dropFxCss } from '../../src/engine/box-fx';

test('тень фигуры и рисунка: готовая — как прежде, подкрутка поверх неё', () => {
  expect(boxFxCss({ shadow: 'md' })).toBe('0px 10px 28px rgba(15, 23, 42, 0.2)');
  // true и неизвестное имя — заметная, как было у фигур
  expect(boxFxCss({ shadow: true })).toBe(boxFxCss({ shadow: 'md' }));
  // Направление 0° — вправо; цвет темы — через color-mix
  expect(boxFxCss({ shadow: 'sm', shadowAngle: 0, shadowDist: 12, shadowBlur: 0, shadowOpacity: 0.5, shadowColor: 'accent' }))
    .toBe('12px 0px 0px color-mix(in srgb, var(--ac) 50%, transparent)');
  // Мусор в подкрутке — значения готовой тени
  expect(boxShadowOf({ shadow: 'lg', shadowBlur: 'x' as never, shadowColor: 'red;x' })).toMatchObject({ blur: 50, color: '#0F172A' });
  expect(boxFxCss({})).toBe('');
});

test('свечение: у box-shadow — с разливом и поверх тени, у фигуры по контуру — двумя слоями без сдвига', () => {
  expect(boxFxCss({ glow: 'accent', shadow: 'sm' })).toBe('0px 0px 18px 5.4px color-mix(in srgb, var(--ac) 70%, transparent), 0px 2px 8px rgba(15, 23, 42, 0.14)');
  expect(boxFxCss({ glow: '#FDE047', glowSize: 10, glowOpacity: 1 })).toBe('0px 0px 10px 3px rgba(253, 224, 71, 1)');
  expect(dropFxCss({ glow: '#FFFFFF', glowSize: 20, glowOpacity: 1 })).toBe('drop-shadow(0px 0px 7px rgba(255, 255, 255, 1)) drop-shadow(0px 0px 16px rgba(255, 255, 255, 0.85))');
  // Неизвестный цвет — без свечения
  expect(boxFxCss({ glow: 'url(x)' })).toBe('');
});
