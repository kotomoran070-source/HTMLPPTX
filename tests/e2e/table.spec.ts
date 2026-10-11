// Таблица, как в PowerPoint: выделение ячеек, клавиши, буфер, вставка из Excel; порядок объектов на шаг
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import JSZip from 'jszip';
import { parse } from 'yaml';
import { readDeck, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

const cell = (page: Page, t: string) => page.locator('#st-canvas .slide.on :is(td, th)').filter({ hasText: new RegExp(`^${t}$`) }).first();
const center = async (page: Page, t: string) => {
  const b = (await cell(page, t).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** Протянуть мышью от ячейки до ячейки */
const drag = async (page: Page, from: string, to: string) => {
  const a = await center(page, from);
  const b = await center(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
};
const clip = (page: Page, type: 'copy' | 'paste', text = '') => page.evaluate(([type, text]) => {
  const dt = new DataTransfer();
  if (text) dt.setData('text/plain', text);
  (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
  return dt.getData('text/plain');
}, [type, text] as const);
/** Таблица слайда (с единицы) из файла */
const table = (slide: number) => (parse(readDeck('table')) as { slides: { free: Record<string, unknown>[] }[] }).slides[slide - 1].free[0] as { rows: string[][]; header: string[]; fills?: unknown[][] };
const rows = (slide = 1) => table(slide).rows;

test('ячейки: протянуть — диапазон; Delete, Ctrl+Z, копирование, вставка из Excel, строки и заливка на весь диапазон', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=table&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  // Первый щелчок — выделить таблицу; протянуть по ячейкам — диапазон, а не перемещение
  await cell(page, 'Выручка').click();
  await drag(page, 'Выручка', '70');
  const sel = page.locator('#st-canvas .tbl-csel');
  await expect(sel).toHaveCount(6);
  expect(readDeck('table')).toContain('place: {x: 80, y: 80, w: 700}');
  // Копирование — табуляциями, как в Excel
  expect(await clip(page, 'copy')).toBe('Выручка\t100\t120\nРасходы\t80\t70');
  // Строки целиком: Delete удаляет их; Ctrl+Z — вернуть
  await page.keyboard.press('Delete');
  await expect.poll(() => rows().map((r) => r[0])).toEqual(['Прибыль']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => rows()[0][0]).toBe('Выручка');
  // Backspace очищает ячейки
  await cell(page, 'Выручка').click();
  await page.keyboard.press('Escape');
  await drag(page, 'Выручка', '80');
  await expect(sel).toHaveCount(4);
  await page.keyboard.press('Backspace');
  await expect.poll(() => rows()[0]).toEqual(['', '', '120']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => rows()[0][0]).toBe('Выручка');
  // Столбец целиком (с шапкой): Delete удаляет его вместе с содержимым
  await cell(page, 'План').click();
  await page.keyboard.press('Escape');
  await drag(page, 'План', '20');
  await page.keyboard.press('Delete');
  await expect.poll(() => table(1).header).toEqual(['Показатель', 'Факт']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => table(1).header).toEqual(['Показатель', 'План', 'Факт']);
  // Shift+стрелка — ещё на строку; Esc — снять
  await cell(page, 'Выручка').click();
  await page.keyboard.press('Escape');
  await drag(page, 'Выручка', '80');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(sel).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(sel).toHaveCount(0);
  // Вставка из Excel с левой верхней ячейки: таблица растёт на строку
  await cell(page, 'Прибыль').click();
  await page.keyboard.press('Escape');
  await drag(page, 'Прибыль', '20');
  await clip(page, 'paste', 'Налоги\t5\t6\nИтог\t15\t44\n');
  await expect.poll(() => rows()[3]).toEqual(['Итог', '15', '44']);
  await expect(sel).toHaveCount(6);
  // Вставить снизу при двух выделенных строках — две новые строки
  await page.locator('.st-tabs [data-tab="table"]').click();
  await page.locator('[data-cmd="table.row.below"]').click();
  await expect.poll(() => rows().length).toBe(6);
  // Заливка выделенных ячеек
  await drag(page, 'Выручка', '100');
  await page.locator('[data-cmd="table.fill"]').click();
  await page.locator('.st-pgrid [data-v="#16A34A"]').click();
  await expect.poll(() => table(1).fills?.[0]).toEqual(['#16A34A', '#16A34A']);
  await expect(cell(page, 'Выручка')).toHaveCSS('background-color', 'rgb(22, 163, 74)');
  // «Выделить → столбец»: столбцы выделенных ячеек, с шапкой
  await page.locator('[data-cmd="table.select"]').click();
  await page.locator('.st-menu').getByText('Выделить столбец').click();
  await expect(sel).toHaveCount(14);
  // Курсор в одной ячейке — её столбец
  await page.keyboard.press('Escape');
  await cell(page, '80').click();
  await page.locator('[data-cmd="table.select"]').click();
  await page.locator('.st-menu').getByText('Выделить столбец').click();
  await expect(sel).toHaveCount(7);
  expect(errors).toEqual([]);
});

test('правка ячейки: Tab в последней — новая строка, стрелка вниз — ячейка ниже; таблица из Excel на пустом слайде', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=table&studio#2');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await cell(page, '50').click();
  await cell(page, '50').click();
  await expect(cell(page, '50')).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('Tab');
  await expect.poll(() => rows(2).length).toBe(4);
  await page.keyboard.type('Новая');
  await page.keyboard.press('Escape');
  await expect.poll(() => rows(2)[3][0]).toBe('Новая');
  // Стрелка вниз с последней строки ячейки — в ячейку ниже
  await cell(page, 'План').click();
  await expect(cell(page, 'План')).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#st-canvas .slide.on [contenteditable="true"]')).toHaveText(/^\d+$/);
  await page.keyboard.press('Escape');
  // Пустой слайд: данные из Excel — новая таблица, первая строка — шапка
  await page.goto('/?deck=table&studio#3');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await clip(page, 'paste', 'Город\tЛюди\nМосква\t13\nКазань\t1,3\n');
  await expect(page.locator('#st-canvas .slide.on [data-type="table"] th')).toHaveCount(2);
  await expect.poll(() => table(3)?.header).toEqual(['Город', 'Люди']);
  expect(errors).toEqual([]);
});

test('числовые поля: свои стрелки у поля под мышью, щелчок — шаг', async ({ page }) => {
  await page.goto('/?deck=table&studio#4');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.locator('#st-canvas .slide.on [data-obj="mid"]').click({ position: { x: 10, y: 10 } });
  const w = page.locator('.st-props input[data-f="w"]');
  await expect(w).toHaveValue('200');
  await w.hover();
  const up = page.locator('.st-numstep [data-d="1"]');
  await expect(up).toBeVisible();
  // Стрелки — у правого края поля
  const [a, b] = [(await w.boundingBox())!, (await up.boundingBox())!];
  expect(Math.abs(a.x + a.width - (b.x + b.width))).toBeLessThan(6);
  await up.click();
  await expect(w).toHaveValue('201');
  await expect.poll(() => readDeck('table')).toContain('id: mid, kind: rect, fill: "#CA8A04", place: {x: 80, y: 80, w: 201');
});

test('порядок: «Вперёд» — над ближайшим перекрывающим объектом, Ctrl+[ — на шаг назад, стрелка — меню до конца', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=table&studio#4');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const order = () => page.locator('#st-canvas .slide.on > .free').evaluateAll((els) => els.map((e) => e.getAttribute('data-obj')));
  await page.locator('#st-canvas .slide.on [data-obj="back"]').click({ position: { x: 10, y: 10 } });
  // Синий под красным: шаг вперёд проходит мимо неперекрывающих (жёлтый, зелёный) и встаёт над красным.
  // Кнопки — на вкладке «Фигура», как «Упорядочение» в PowerPoint
  await page.locator('[data-cmd="obj.forward"]').filter({ visible: true }).click();
  await expect.poll(order).toEqual(['mid', 'far', 'top', 'back']);
  await page.keyboard.press('Control+BracketLeft');
  await expect.poll(order).toEqual(['mid', 'far', 'back', 'top']);
  await page.locator('[data-cmd="obj.backward-menu"]').filter({ visible: true }).click();
  await page.locator('.st-menu').getByText('На задний план').click();
  await expect.poll(order).toEqual(['back', 'mid', 'far', 'top']);
  await page.keyboard.press('Control+Shift+BracketRight');
  await expect.poll(order).toEqual(['mid', 'far', 'top', 'back']);
  expect(errors).toEqual([]);
});

test('объединение ячеек; очищенная строка не сжимается; таблица растягивается по высоте', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=table&studio#5');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const tr = page.locator('#st-canvas .slide.on tbody tr');
  const h0 = (await tr.nth(0).boundingBox())!.height;
  // Объединить: текст второй ячейки — в первую, новой строкой
  await cell(page, 'Выручка').click();
  await drag(page, 'Выручка', '100');
  await page.locator('.st-tabs [data-tab="table"]').click();
  await page.locator('[data-cmd="table.merge"]').click();
  await expect(page.locator('#st-canvas .slide.on td[colspan="2"]')).toHaveCount(1);
  await expect.poll(() => (table(5) as { merges?: number[][] }).merges).toEqual([[0, 0, 1, 2]]);
  expect(rows(5)[0]).toEqual(['Выручка\n100', '', '120']);
  // Столбец слева — объединение сдвигается вместе с ячейками
  await page.locator('[data-cmd="table.col.left"]').click();
  await expect.poll(() => (table(5) as { merges?: number[][] }).merges).toEqual([[0, 1, 1, 2]]);
  // В PowerPoint — объединённой ячейкой (gridSpan), и обратно — объединением
  await page.locator('[data-cmd="file.export"]').click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 150_000 }), page.locator('[data-x="pptx"]').click()]);
  const pptx = new Uint8Array(fs.readFileSync(await download.path()));
  const zip = await JSZip.loadAsync(pptx);
  expect(await zip.file('ppt/slides/slide5.xml')!.async('string')).toMatch(/<a:tc gridSpan="2"[^>]*>/);
  const back = await fetch('http://localhost:5190/__htmlpptx/import-pptx?file=t.pptx&deck=table-back', { method: 'POST', body: pptx });
  expect(back.status).toBe(200);
  const imported = (parse(readDeck('table-back')) as { slides: { free: { type: string; merges?: number[][] }[] }[] }).slides[4].free.find((o) => o.type === 'table');
  // Строка: шапка без заливки читается обычной строкой — номера строк сдвигаются, объединение то же
  expect(imported?.merges?.map((m) => m.slice(1))).toEqual([[1, 1, 2]]);
  await page.keyboard.press('Escape');
  // Разделить: курсор в объединённой ячейке
  await page.locator('#st-canvas .slide.on td[colspan="2"]').click();
  await page.locator('.st-tabs [data-tab="table"]').click();
  await page.locator('[data-cmd="table.split"]').click();
  await expect(page.locator('#st-canvas .slide.on td[colspan]')).toHaveCount(0);
  await expect.poll(() => (table(5) as { merges?: unknown }).merges).toBeUndefined();
  // Очищенная строка — той же высоты. Таблица выделена: щелчок выделяет её, а если уже выделена — правка, из неё Esc
  await page.keyboard.press('Escape');
  await cell(page, 'Расходы').click();
  if (await page.locator('#st-canvas [contenteditable="true"]').count()) await page.keyboard.press('Escape');
  await drag(page, 'Расходы', '70');
  await expect(page.locator('#st-canvas .tbl-csel')).toHaveCount(3);
  await page.keyboard.press('Backspace');
  await expect.poll(() => rows(5)[1].join('')).toBe('');
  expect(Math.abs((await tr.nth(1).boundingBox())!.height - h0)).toBeLessThan(2);
  // Высота рамки — строки растягиваются
  await page.keyboard.press('Escape');
  const box = page.locator('#st-canvas .slide.on [data-type="table"] table');
  const before = (await box.boundingBox())!.height;
  const hField = page.locator('.st-props input[data-f="h"]');
  await hField.fill('500');
  await hField.press('Enter');
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(before * 1.5);
  // Тянем нижний край выше текста — рамка останавливается на таблице и совпадает с ней
  const handle = page.locator('#ed-frame .h-s');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 600, { steps: 8 });
  await page.mouse.up();
  const free = page.locator('#st-canvas .slide.on > .free').first();
  await expect.poll(async () => Math.abs((await free.boundingBox())!.height - (await box.boundingBox())!.height)).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await page.locator('#ed-frame').boundingBox())!.height - (await free.boundingBox())!.height)).toBeLessThan(4);
  const saved = () => (table(5) as { place: { h?: number } }).place.h ?? 0;
  // Записанная высота — та, что видна (таблица на слайде в масштабе), меньше прежних 500
  const scale = (await page.locator('#st-canvas .slide.on').boundingBox())!.width / 1280;
  const shown = (await free.boundingBox())!.height;
  await expect.poll(() => Math.abs(saved() * scale - shown)).toBeLessThan(4);
  expect(saved()).toBeLessThan(500);
  expect(errors).toEqual([]);
});
