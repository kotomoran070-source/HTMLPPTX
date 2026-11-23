// 3D-модель: начальная камера из ракурса и масштаба в рамке («Свойства» → «Масштаб»)
import { expect, test } from '@playwright/test';
import { modelCamera } from '../../src/components/media/model-orbit';

test('без ракурса и масштаба — камера, подобранная библиотекой', () => {
  expect(modelCamera(undefined, undefined)).toEqual({ orbit: 'auto auto auto', dist: 100 });
  expect(modelCamera('-12deg 80deg', 1)).toEqual({ orbit: '-12deg 80deg auto', dist: 100 });
});

test('масштаб меньше 1 отодвигает камеру: 0,8 — на четверть дальше, 0,5 — вдвое', () => {
  expect(modelCamera('-12deg 80deg', 0.8)).toEqual({ orbit: '-12deg 80deg 125%', dist: 125 });
  expect(modelCamera(undefined, 0.5)).toEqual({ orbit: 'auto auto 200%', dist: 200 });
  // Больше 1 — ближе
  expect(modelCamera('0deg 75deg', 2).dist).toBe(50);
});

test('масштаб умножается на расстояние из ракурса', () => {
  expect(modelCamera('10deg 70deg 150%', 0.6)).toEqual({ orbit: '10deg 70deg 250%', dist: 250 });
});

test('непонятный ракурс и масштаб вне 0,3–3 не применяются', () => {
  expect(modelCamera('0deg 70deg; script', 0.8)).toEqual({ orbit: 'auto auto 125%', dist: 125 });
  expect(modelCamera('-12deg 80deg', 0.1).dist).toBe(100);
  expect(modelCamera('-12deg 80deg', 'abc').dist).toBe(100);
  expect(modelCamera('-12deg 80deg', 9).dist).toBe(100);
});
