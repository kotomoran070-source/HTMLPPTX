// Жёлтые ручки фигур PowerPoint: где стоят, какие регулировки двигают и как перетаскивание их меняет
import { expect, test } from '@playwright/test';
import { adjParse, adjText, presetAdjust, presetGeometry, presetHandles } from '../../src/components/shape/kinds';

test('ручки — как в PowerPoint: у звезды одна (глубина лучей), у стрелки две (толщина и остриё), у ромба нет', () => {
  expect(presetHandles('diamond', 200, 200)).toEqual([]);
  const star = presetHandles('star', 200, 200);
  expect(star).toHaveLength(1);
  expect(star[0].refs.map((r) => r.name)).toEqual(['adj']);
  // По умолчанию ручка — на внутренней вершине по центру сверху, ниже вершины звезды
  expect(star[0].x).toBeCloseTo(100, 0);
  expect(star[0].y).toBeGreaterThan(30);
  const arrow = presetHandles('block-arrow', 260, 130);
  expect(arrow.map((a) => a.refs.map((r) => r.name).join())).toEqual(['adj1', 'adj2']);
});

test('ручку тянут — регулировка такая, что ручка встаёт под мышь; контур меняется', () => {
  const star = presetHandles('star', 200, 200)[0];
  const adj = presetAdjust('star', 200, 200, {}, 0, star.x, star.y + 30);
  const moved = presetHandles('star', 200, 200, adj)[0];
  expect(Math.abs(moved.y - (star.y + 30))).toBeLessThan(1.5);
  expect(presetGeometry('star', 200, 200, adj)[0].d).not.toBe(presetGeometry('star', 200, 200)[0].d);
  // Остриё стрелки длиннее: ручка по ширине влево
  const head = presetHandles('block-arrow', 260, 130)[1];
  const a2 = presetAdjust('block-arrow', 260, 130, {}, 1, head.x - 60, head.y);
  expect(Math.abs(presetHandles('block-arrow', 260, 130, a2)[1].x - (head.x - 60))).toBeLessThan(1.5);
  // В пределах регулировки: за край фигуры ручка не уходит
  const far = presetAdjust('star', 200, 200, {}, 0, 100, 5000);
  expect(presetHandles('star', 200, 200, far)[0].y).toBeLessThanOrEqual(200);
});

test('регулировки строкой — туда и обратно; посторонние поля не попадают', () => {
  expect(adjText({ adj1: 30000, adj2: 50000, x: 1 })).toBe('adj1=30000,adj2=50000');
  expect(adjParse('adj1=30000,adj2=50000')).toEqual({ adj1: 30000, adj2: 50000 });
});
