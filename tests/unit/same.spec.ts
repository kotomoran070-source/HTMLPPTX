// Свои библиотеки без двойников: шаблоны, эффекты появления, образы «Цвет+», темы
import { expect, test } from '@playwright/test';
import { freeName, stableJson, themeKey } from '../../src/studio/same';
import { addEffect, addTemplate, listEffects, listTemplates, type Template } from '../../src/studio/templates';
import { addMyLook, listMyLooks } from '../../src/studio/color/my-looks';
import type { MyTheme } from '../../src/studio/my-themes';

// Хранилище браузера — в памяти
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
test.beforeEach(() => mem.clear());

test('одинаковое содержимое — одинаковая строка при любом порядке полей; занятое имя — с номером', () => {
  expect(stableJson({ b: 1, a: [1, { y: 2, x: 1 }], u: undefined })).toBe(stableJson({ a: [1, { x: 1, y: 2 }], b: 1 }));
  expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
  expect(freeName('Тема', ['Другая'])).toBe('Тема');
  expect(freeName('Тема', ['Тема', 'Тема (2)'])).toBe('Тема (3)');
  expect(freeName('Тема (2)', ['Тема', 'Тема (2)'])).toBe('Тема (3)');
});

test('шаблон: тот же второй раз не добавляется, то же имя — заменяется', () => {
  const t = (id: string, name: string, x = 0): Template => ({ id, name, created: Date.now(), w: 100, h: 50, items: [{ type: 'text', text: 'Привет', place: { x, y: 0, w: 100 } }], preview: `data:${id}` });
  expect(addTemplate(t('a', 'Карточка'))?.status).toBe('added');
  // То же содержимое под другим именем и с другой картинкой галереи
  const same = addTemplate(t('b', 'Копия'));
  expect(same?.status).toBe('same');
  expect(same?.template.name).toBe('Карточка');
  expect(addTemplate(t('c', 'Карточка', 20))?.status).toBe('updated');
  expect(listTemplates().map((x) => x.id)).toEqual(['c']);
  expect(addTemplate(t('d', 'Другая', 40))?.status).toBe('added');
  expect(listTemplates()).toHaveLength(2);
});

test('эффект: то же движение — не второй раз (имя @keyframes не в счёт), то же имя — замена под прежним id', () => {
  const fx = (id: string, name: string, to = 1) => ({ id, name, css: `@keyframes ${id} { from { opacity: 0; } to { opacity: ${to}; } }`, ms: 400, ease: 'ease', created: 1 });
  expect(addEffect(fx('ufx-a', 'Проявление'))?.status).toBe('added');
  expect(addEffect(fx('ufx-b', 'Ещё'))?.status).toBe('same');
  const up = addEffect(fx('ufx-c', 'Проявление', 0.8));
  expect(up?.status).toBe('updated');
  expect(up?.effect.id).toBe('ufx-a');
  expect(up?.effect.css).toContain('@keyframes ufx-a');
  expect(listEffects()).toHaveLength(1);
});

test('образ «Цвет+»: та же коррекция — не второй раз, то же имя — замена', () => {
  expect(addMyLook('Тёплый', { temp: 20, contrast: 10 })?.status).toBe('added');
  const same = addMyLook('Другой', { contrast: 10, temp: 20 });
  expect(same?.status).toBe('same');
  expect(same?.look.name).toBe('Тёплый');
  expect(addMyLook('Тёплый', { temp: 30 })?.status).toBe('updated');
  expect(listMyLooks()).toHaveLength(1);
});

test('тема: то же оформление и шрифты — та же, даже если тип файла шрифта в data: URL другой', () => {
  const a: MyTheme = { id: 'a', name: 'A', created: 1, theme: { accent: '#E11D48', bg: 'glow' }, fonts: [{ name: 'X', file: 'x.woff2', data: 'data:font/woff2;base64,AAAA' }] };
  const b: MyTheme = { id: 'b', name: 'B', created: 2, theme: { bg: 'glow', accent: '#E11D48', preset: 'my:a' }, fonts: [{ name: 'X', file: 'y.woff2', data: 'data:application/octet-stream;base64,AAAA' }] };
  expect(themeKey(a)).toBe(themeKey(b));
  expect(themeKey({ theme: { accent: '#000000' } })).not.toBe(themeKey(a));
  expect(themeKey({ ...a, fonts: [{ ...a.fonts![0], data: 'data:font/woff2;base64,BBBB' }] })).not.toBe(themeKey(a));
});
