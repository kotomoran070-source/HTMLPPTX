// Оформление текста ячеек таблицы идёт вместе с ячейками: вставка, удаление, сортировка, шапка
import { expect, test } from '@playwright/test';
import { cellLists, dropCols, dropRows, pruneCellData, rowLists, sortRows, type TableData } from '../../src/studio/table-cells';
import { putStyle } from '../../src/engine/editor/text-edit';

const table = (): TableData => ({
  header: ['Город', 'Люди'],
  rows: [['Москва', '13'], ['Казань', '1,3'], ['Омск', '1,1']],
  cellStyles: [[{ weight: 700 }, null], null as unknown as unknown[], [null, { color: 'accent' }]],
  headStyles: [null, { size: 20 }],
  fills: [[null, 'soft']],
});

test('удалили строку — оформление строк ниже поднимается; удалили шапку — оформление первой строки становится её', () => {
  const t = table();
  dropRows(t, 1, 1);
  expect(t.cellStyles).toEqual([[{ weight: 700 }, null], [null, { color: 'accent' }]]);
  dropRows(t, -1, -1);
  expect(t.header).toEqual(['Москва', '13']);
  expect(t.headStyles).toEqual([{ weight: 700 }, null]);
  expect(t.headFills).toEqual([null, 'soft']);
  expect(t.cellStyles).toEqual([[null, { color: 'accent' }]]);
});

test('удалили столбец — его оформление уходит и в шапке, и в строках; сортировка переставляет оформление со строками', () => {
  const t = table();
  dropCols(t, 0, 0);
  expect(t.headStyles).toEqual([{ size: 20 }]);
  expect(t.cellStyles).toEqual([[null], null, [{ color: 'accent' }]]);
  const s = table();
  sortRows(s, 0, false);
  expect(s.rows.map((r) => r[0])).toEqual(['Казань', 'Москва', 'Омск']);
  expect(s.cellStyles).toEqual([null, [{ weight: 700 }, null], [null, { color: 'accent' }]]);
  expect(rowLists(s)).toHaveLength(2);
  expect(cellLists(s).length).toBeGreaterThan(2);
});

test('пустое оформление не хранится: сняли последнее — списка нет', () => {
  const d = { t: { rows: [['a', 'b']], cellStyles: [[null, { size: 20 }]] as unknown[][] } };
  putStyle(d, ['t', 'cellStyles', 0, 1], {});
  expect('cellStyles' in d.t).toBe(false);
  putStyle(d, ['t', 'cellStyles', 1, 0], { color: 'accent' });
  expect(d.t.cellStyles).toStrictEqual([null, [{ color: 'accent' }]]);
  const t = { rows: [], fills: [[null]], headStyles: [null] } as unknown as TableData;
  pruneCellData(t);
  expect(t).toEqual({ rows: [] });
});
