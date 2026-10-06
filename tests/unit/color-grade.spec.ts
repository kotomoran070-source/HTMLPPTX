// Панель «Цвет»: кривая без перехлёстов, разбор LUT .cube, пустая коррекция не трогает картинку
import { expect, test } from '@playwright/test';
import { parseCube } from '../../src/engine/color/cube';
import { compact, curveTable, isNeutral } from '../../src/engine/color/grade';

test('кривая проходит через точки и не выходит за соседей (монотонный сплайн)', () => {
  const t = curveTable([[0, 0], [0.25, 0.1], [0.5, 0.5], [1, 1]]);
  expect(t[0]).toBe(0);
  expect(t[255]).toBe(1);
  expect(Math.abs(t[Math.round(0.25 * 255)] - 0.1)).toBeLessThan(0.01);
  for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
  // Без точек — прямая
  expect(curveTable(undefined)[128]).toBeCloseTo(128 / 255, 5);
});

test('LUT .cube: размер, красный меняется быстрее всего, ошибки понятны', () => {
  const rows = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r} ${g} ${b}`);
  const lut = parseCube(`TITLE "Тест"\n# комментарий\nLUT_3D_SIZE 2\n${rows.join('\n')}`);
  expect(lut.size).toBe(2);
  expect(lut.title).toBe('Тест');
  expect([...lut.data.slice(4, 8)]).toEqual([1, 0, 0, 1]);
  expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/строк/);
  expect(() => parseCube('LUT_1D_SIZE 16')).toThrow(/3D/);
});

test('коррекция без изменений — исходная картинка; в данные — только заданное', () => {
  expect(isNeutral({ temp: 0, lift: [0, 0, 0], curves: { all: [[0, 0], [1, 1]] }, duo: ['#000000', '#808080', '#FFFFFF'], duoMix: 0 })).toBe(true);
  expect(isNeutral({ hsl: { red: [0, 0.2, 0] } })).toBe(false);
  expect(compact({ temp: 12.3456, contrast: 0, gain: [0, 0, 0], lutMix: 1 })).toEqual({ temp: 12.35 });
});
