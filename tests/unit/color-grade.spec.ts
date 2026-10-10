// Панель «Цвет»: кривая без перехлёстов, разбор LUT .cube, пустая коррекция не трогает картинку
import { expect, test } from '@playwright/test';
import { parseCube } from '../../src/engine/color/cube';
import { autoGrade, compact, curveTable, isNeutral, scaleGrade } from '../../src/engine/color/grade';

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

/** Картинка из пикселей: функция цвета по номеру пикселя */
const img = (n: number, f: (i: number) => [number, number, number]) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const [r, g, b] = f(i); a.set([r, g, b, 255], i * 4); }
  return a;
};

test('«Авто»: чистый скриншот не трогает, тёмное фото вытягивает, цветной сдвиг убирает', () => {
  // Белый фон с тёмно-серым текстом и цветной линией: фон белым и остаётся, не темнеет, текст — чётче
  const shot = autoGrade(img(4000, (i) => (i % 10 === 0 ? [20, 20, 30] : i % 13 === 0 ? [140, 120, 230] : [255, 255, 255])));
  expect(shot.exposure ?? 0).toBe(0);
  expect(shot.curves?.all?.at(-1) ?? [1, 1]).toEqual([1, 1]);
  expect(shot.temp ?? 0).toBe(0);
  // Тёмное фото: светлее, края гистограммы растянуты
  const dark = autoGrade(img(4000, (i) => { const v = 10 + (i % 90); return [v, v, v]; }));
  expect(dark.exposure ?? 0).toBeGreaterThan(0.2);
  expect(dark.curves?.all?.[1][0]).toBeLessThan(1);
  // Синий сдвиг на серых местах — теплее
  const blue = autoGrade(img(4000, (i) => { const v = 70 + (i % 120); return [v * 0.82, v * 0.95, v]; }));
  expect(blue.temp ?? 0).toBeGreaterThan(5);
});

test('сила образа: половина — половина каждой настройки, кривая — к прямой', () => {
  const g = scaleGrade({ contrast: 40, gain: [0.2, 0.4, 0.1], curves: { all: [[0, 0.1], [1, 0.9]] }, duo: ['#000000', '#808080', '#FFFFFF'], duoMix: 1 }, 0.5);
  expect(g.contrast).toBe(20);
  expect(g.gain).toEqual([0.1, 0.2, 0.05]);
  expect(g.curves?.all).toEqual([[0, 0.05], [1, 0.95]]);
  expect(g.duoMix).toBe(0.5);
  expect(isNeutral(scaleGrade({ contrast: 40, vignette: 30 }, 0))).toBe(true);
});
