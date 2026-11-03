// Лицензии библиотек: у всех, что программа везёт с собой, — из разрешённого списка
import { expect, test } from '@playwright/test';
import { checkLicenses, noticeText, pagePackages, prodPackages, spdxOk } from '../../plugins/licenses.mjs';

test('выражения SPDX: «или» — хватит одной подходящей, «и» — нужны все', () => {
  expect(spdxOk('MIT')).toBe(true);
  expect(spdxOk('(MIT OR GPL-3.0-or-later)')).toBe(true);
  expect(spdxOk('(MIT AND Zlib)')).toBe(true);
  expect(spdxOk('GPL-3.0-only')).toBe(false);
  expect(spdxOk('(MIT AND GPL-3.0-only)')).toBe(false);
  expect(spdxOk('нет лицензии')).toBe(false);
});

test('все библиотеки программы — со свободной лицензией (LGPL — только у работающих отдельными файлами), у каждой есть текст', () => {
  // Сервер (node_modules программы): LGPL можно — sharp и occt-import-js работают отдельными файлами
  const server = prodPackages(process.cwd());
  expect(server.map((p) => p.name)).toEqual(expect.arrayContaining(['yaml', 'sharp', 'jszip', 'node-html-parser', 'occt-import-js']));
  expect(checkLicenses(server).map((p) => `${p.name}: ${p.license}`)).toEqual([]);
  // Страницы (собраны внутрь студии и проигрывателя): только свободные, LGPL нельзя
  const page = pagePackages(process.cwd());
  expect(page.length).toBeGreaterThan(30);
  expect(page.map((p) => p.name)).toEqual(expect.arrayContaining(['codemirror', '@google/model-viewer', 'pptxgenjs', 'qrcode-generator', 'temml']));
  expect(page.map((p) => p.name)).not.toContain('vite');
  expect(checkLicenses(page, { html: true }).map((p) => `${p.name}: ${p.license}`)).toEqual([]);
  // Без текста лицензии упоминание авторов не передать
  expect([...server, ...page].filter((p) => !p.text).map((p) => p.name)).toEqual([]);
  // Одинаковые тексты — один раз
  const t = noticeText([{ dir: '', name: 'a', version: '1', license: 'MIT', text: 'X' }, { dir: '', name: 'b', version: '2', license: 'MIT', text: 'X' }]);
  expect(t.match(/^X$/gm)).toHaveLength(1);
  expect(t).toContain('== a 1 — MIT, b 2 — MIT ==');
});
