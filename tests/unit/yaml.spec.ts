// Запись правок в deck.yaml: меняются только отредактированные значения, комментарии и порядок остаются
import { expect, test } from '@playwright/test';
import { parse } from 'yaml';
import { mergeYaml } from '../../plugins/yaml-merge';
import { slug } from '../../plugins/import';

const SOURCE = `# Комментарий в начале файла
title: Старое название
theme:
  accent: "#4F46E5" # акцент

slides:
  # первый слайд
  - id: one
    title: Привет
    notes: |
      Первая строка
      Вторая строка
  - id: two
    title: Второй
`;

test('правка заголовка не трогает комментарии и остальные поля', () => {
  const data = parse(SOURCE);
  data.title = 'Новое название';
  data.slides[1].title = 'Изменён';
  const out = mergeYaml(SOURCE, data);
  expect(out).toContain('# Комментарий в начале файла');
  expect(out).toContain('# акцент');
  expect(out).toContain('# первый слайд');
  expect(out).toContain('title: Новое название');
  expect(out).toContain('title: Изменён');
  expect(out).toContain('notes: |\n      Первая строка\n      Вторая строка');
  expect(parse(out)).toEqual(data);
});

test('без изменений файл остаётся тем же', () => {
  expect(mergeYaml(SOURCE, parse(SOURCE))).toBe(SOURCE);
});

test('новый слайд добавляется, удалённый — исчезает', () => {
  const data = parse(SOURCE);
  data.slides = [data.slides[0], { id: 'three', title: 'Третий' }];
  const out = parse(mergeYaml(SOURCE, data));
  expect(out.slides.map((s: { id: string }) => s.id)).toEqual(['one', 'three']);
});

test('многострочный текст становится блоком', () => {
  const data = parse(SOURCE);
  data.slides[1].title = 'Строка 1\nСтрока 2';
  const out = mergeYaml(SOURCE, data);
  expect(parse(out).slides[1].title).toBe('Строка 1\nСтрока 2');
});

test('ошибка в файле — сохранение отменяется, а не портит файл', () => {
  expect(() => mergeYaml('title: [незакрытая', { title: 'x' })).toThrow(/ошибку/);
});

test('имя папки из названия — латиницей', () => {
  expect(slug('Итоги квартала 2026')).toBe('itogi-kvartala-2026');
  expect(slug('  Щука & Ёжик!  ')).toBe('schuka-ezhik');
  expect(slug('Hello World')).toBe('hello-world');
  expect(slug('!!!')).toBe('');
});
