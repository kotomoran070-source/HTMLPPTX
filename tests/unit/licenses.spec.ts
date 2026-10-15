// Лицензии библиотек: у всех, что программа везёт с собой, — из разрешённого списка
import { expect, test } from '@playwright/test';
import { checkLicenses, noticeText, prodPackages, spdxOk } from '../../plugins/licenses.mjs';

test('выражения SPDX: «или» — хватит одной подходящей, «и» — нужны все', () => {
  expect(spdxOk('MIT')).toBe(true);
  expect(spdxOk('(MIT OR GPL-3.0-or-later)')).toBe(true);
  expect(spdxOk('(MIT AND Zlib)')).toBe(true);
  expect(spdxOk('GPL-3.0-only')).toBe(false);
  expect(spdxOk('(MIT AND GPL-3.0-only)')).toBe(false);
  expect(spdxOk('нет лицензии')).toBe(false);
});

test('все библиотеки программы — со свободной лицензией (LGPL — только у работающих отдельными файлами), у каждой есть текст', () => {
  const pkgs = prodPackages(process.cwd());
  expect(pkgs.length).toBeGreaterThan(50);
  expect(checkLicenses(pkgs).map((p) => `${p.name}: ${p.license}`)).toEqual([]);
  // Без текста лицензии упоминание авторов не передать
  expect(pkgs.filter((p) => !p.text).map((p) => p.name)).toEqual([]);
  // Одинаковые тексты — один раз
  const t = noticeText([{ dir: '', name: 'a', version: '1', license: 'MIT', text: 'X' }, { dir: '', name: 'b', version: '2', license: 'MIT', text: 'X' }]);
  expect(t.match(/^X$/gm)).toHaveLength(1);
  expect(t).toContain('== a 1 — MIT, b 2 — MIT ==');
});
