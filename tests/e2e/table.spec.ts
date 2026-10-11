// Таблица, как в PowerPoint: выделение ячеек, клавиши, буфер, вставка из Excel; порядок объектов на шаг
import { expect, test, type Page } from '@playwright/test';
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
  // Delete — очистить, Ctrl+Z — вернуть
  await page.keyboard.press('Delete');
  await expect.poll(() => rows()[0]).toEqual(['', '', '']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => rows()[0][0]).toBe('Выручка');
  // Shift+щелчок — от начальной ячейки до этой; Shift+стрелка — ещё на строку; Esc — снять
  await cell(page, '80').click({ modifiers: ['Shift'] });
  await expect(sel).toHaveCount(4);
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
