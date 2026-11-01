// Проектные схемы: сроки Ганта, уровень риска, итоги матрицы решений; смена вида сохраняет свои поля пунктов
import { expect, test } from '@playwright/test';
import { decisionTotals, ganttRows, riskLevel } from '../../src/components/schemes/project-calc';
import { toView } from '../../src/studio/block-views';

test('Ганта: «с 1 по 2» — два периода, «с 1,5 по 2,5» — с середины до середины; без сроков — за предыдущей; отставшие — late', () => {
  const { rows, n } = ganttRows([
    { title: 'Этап', section: true },
    { title: 'А', from: 1, to: 2, done: 100 },
    { title: 'Б' },
    { title: 'В', from: '1,5', to: 2.5, done: 30 },
    { title: 'Веха', from: 6, milestone: true },
  ], null, 4);
  expect(n).toBe(6); // по самой поздней — вехе посередине шестого
  expect(rows.map((r) => r.kind)).toEqual(['section', 'task', 'task', 'task', 'milestone']);
  expect(rows[1]).toMatchObject({ s: 0, e: 2, done: 100, late: false });
  // «Б» без сроков — сразу за концом «А» на один период
  expect(rows[2]).toMatchObject({ s: 2, e: 3 });
  expect(rows[3]).toMatchObject({ s: 0.5, e: 1.5 });
  expect(rows[4]).toMatchObject({ s: 5.5, e: 5.5 });
  // «Сегодня» — начало четвёртого: «Б» кончилась ровно тогда и не готова — отстаёт, как и «В»
  expect([rows[2].late, rows[3].late]).toEqual([true, true]);
  expect(ganttRows([{ title: 'А', from: 1, to: 2 }], ['Янв', 'Фев', 'Мар']).n).toBe(3);
});

test('риск: уровень по доле произведения от наибольшего — 5 × 5 и 3 × 3', () => {
  expect([riskLevel(1, 4, 5), riskLevel(1, 5, 5), riskLevel(3, 3, 5), riskLevel(2, 5, 5), riskLevel(4, 4, 5), riskLevel(4, 5, 5)]).toEqual([0, 1, 1, 2, 2, 3]);
  expect([riskLevel(1, 1, 3), riskLevel(1, 2, 3), riskLevel(2, 2, 3), riskLevel(3, 3, 3)]).toEqual([0, 1, 2, 3]);
});

test('матрица решений: итог — средняя оценка с весами-долями, лучшие — с наибольшим (ничья — несколько)', () => {
  const r = decisionTotals([
    { title: 'Цена', weight: 3, scores: [5, 1] },
    { title: 'Качество', weight: 1, scores: ['1', 5] },
  ], 2);
  expect(r.shares).toEqual([0.75, 0.25]);
  expect(r.totals).toEqual([4, 2]);
  expect(r.best).toEqual([0]);
  // Без весов — поровну; одинаковый итог — оба лучшие
  expect(decisionTotals([{ scores: [4, 2] }, { scores: [2, 4] }], 2).best).toEqual([0, 1]);
  // Нет оценок — нет лучшего
  expect(decisionTotals([{ title: 'Цена', weight: 1 }], 2).best).toEqual([]);
});

test('смена вида: Ганта → дорожная карта → Ганта — сроки и готовность остаются; риски → матрица 2×2 → риски', () => {
  const gantt = { type: 'gantt', place: { x: 64, y: 120, w: 1100 }, items: [{ title: 'Прототип', text: 'Команда', from: 1, to: 3, done: 60 }] };
  const road = toView(gantt, 'roadmap') as any;
  expect(road.items[0]).toMatchObject({ title: 'Прототип', text: 'Команда', from: 1, to: 3, done: 60 });
  expect((toView(road, 'gantt') as any).items[0]).toMatchObject({ from: 1, to: 3, done: 60 });
  const risks = { type: 'risks', items: [{ title: 'Поставки', text: 'Резерв', p: 4, i: 5 }] };
  const back = toView(toView(risks, 'matrix') as any, 'risks') as any;
  expect(back).toMatchObject({ type: 'risks', items: [{ title: 'Поставки', text: 'Резерв', p: 4, i: 5 }] });
  expect((toView({ type: 'fishbone', items: [{ title: 'Люди', text: 'А\nБ' }] }, 'pillars') as any).items[0]).toMatchObject({ title: 'Люди', text: 'А\nБ' });
});
