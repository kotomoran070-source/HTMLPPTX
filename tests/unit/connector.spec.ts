// Соединители: стороны и изломы по взаимному положению объектов, середина для подписи, копии с линиями
import { expect, test } from '@playwright/test';
import { connect, midOf, pathD } from '../../src/components/connector/geom';
import { relink } from '../../src/components/connector/links';

const A = { x: 100, y: 100, w: 200, h: 100 };

test('уступ: справа налево, если объекты разнесены по горизонтали; снизу вверх — если по вертикали; поворот посередине', () => {
  const g = connect(A, { x: 600, y: 300, w: 200, h: 100 });
  expect(g.route).toBe('elbow');
  expect(g.pts).toEqual([[300, 150], [450, 150], [450, 350], [600, 350]]);
  const v = connect(A, { x: 150, y: 400, w: 200, h: 100 });
  expect(v.pts[0]).toEqual([200, 200]);
  expect(v.pts.at(-1)).toEqual([250, 400]);
  expect(v.pts[1][1]).toBe(300);
  // Второй объект слева и выше — линия идёт от левой стороны к правой
  const back = connect({ x: 600, y: 300, w: 200, h: 100 }, A);
  expect(back.pts[0]).toEqual([600, 350]);
  expect(back.pts.at(-1)).toEqual([300, 150]);
  // На одной высоте — без изломов
  expect(connect(A, { x: 500, y: 100, w: 100, h: 100 }).pts).toEqual([[300, 150], [500, 150]]);
});

test('прямая — от края к краю по линии центров, у овала — до контура; наложенные объекты — прямой', () => {
  const s = connect(A, { x: 500, y: 100, w: 200, h: 100 }, 'straight');
  expect(s.pts).toEqual([[300, 150], [500, 150]]);
  const o = connect(A, { x: 500, y: 400, w: 200, h: 200, oval: true }, 'straight');
  const [ex, ey] = o.pts[1];
  expect(Math.hypot(ex - 600, ey - 500)).toBeCloseTo(100, 5);
  expect(connect(A, { x: 150, y: 150, w: 200, h: 100 }).route).toBe('straight');
});

test('кривая — четыре точки Безье, середина при t = 0,5; рамка пути с запасом под наконечник', () => {
  const g = connect(A, { x: 600, y: 300, w: 200, h: 100 }, 'curve');
  expect(g.pts).toHaveLength(4);
  expect(g.pts[1][1]).toBe(150);
  expect(g.pts[2][1]).toBe(350);
  expect(g.mid).toEqual([450, 250]);
  expect(g.box.x).toBe(300 - 14);
  expect(pathD(g)).toMatch(/^M14 14C/);
  // Середина ломаной — по длине пути
  expect(midOf([[0, 0], [100, 0], [100, 100]], 'elbow')).toEqual([100, 0]);
  // Изломы скруглены
  expect(pathD(connect(A, { x: 600, y: 300, w: 200, h: 100 }))).toContain('Q');
});

test('стороны заданы: одна и та же — скобкой снаружи обоих; перпендикулярные — одним изломом; кривая — наружу из сторон', () => {
  const B = { x: 100, y: 400, w: 200, h: 100 };
  const c = connect(B, A, 'elbow', 14, { from: 'right', to: 'right' });
  expect(c.pts).toEqual([[300, 450], [328, 450], [328, 150], [300, 150]]);
  const l = connect(A, { x: 500, y: 400, w: 200, h: 100 }, 'elbow', 14, { from: 'right', to: 'top' });
  expect(l.pts).toEqual([[300, 150], [600, 150], [600, 400]]);
  const q = connect(B, A, 'curve', 14, { from: 'left', to: 'left' });
  expect(q.pts[1][0]).toBeLessThan(100);
  expect(q.pts[2][0]).toBeLessThan(100);
});

test('копии с соединителями: занятые имена — новые, линия — к копиям; линия без своих объектов не копируется', () => {
  const copies = relink([
    { type: 'connector', from: 'a', to: 'b' },
    { type: 'shape', id: 'a' },
    { type: 'shape', id: 'b' },
    { type: 'shape', id: 'c' },
    { type: 'connector', from: 'a', to: 'z' },
  ], new Set(['a', 'b', 'c', 'a-2']));
  expect(copies).toEqual([
    { type: 'connector', from: 'a-3', to: 'b-2' },
    { type: 'shape', id: 'a-3' },
    { type: 'shape', id: 'b-2' },
    { type: 'shape' },
  ]);
  // На другой слайд — имена свободны и остаются
  expect(relink([{ type: 'shape', id: 'a' }, { type: 'shape', id: 'b' }, { type: 'connector', from: 'a', to: 'b' }], new Set())).toHaveLength(3);
});
