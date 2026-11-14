// Панель быстрого доступа (studio/qat.ts): свои кнопки любых команд — рядом с «Файлом» или под лентой
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './helpers';

const cmds = (page: Page) => page.locator('.st-qat [data-cmd], .st-qat [data-qat]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.cmd ?? (b as HTMLElement).dataset.qat));
const menu = (page: Page, text: string) => page.locator('.st-menu').getByText(text, { exact: true }).click();

test('панель быстрого доступа: правый щелчок по кнопке ленты, «▾», под лентой, запоминается', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  // С самого начала: отменить, повторить, показ с текущего слайда, формат по образцу — перед «Файлом»
  expect(await cmds(page)).toEqual(['undo', 'redo', 'show.current', 'format.painter']);
  await expect(page.locator('.st-top .st-qat')).toBeVisible();
  // Правый щелчок по «Найти» на ленте — на панель; кнопка панели выполняет команду
  await page.locator('.st-ribbon [data-cmd="edit.find"]').filter({ visible: true }).click({ button: 'right' });
  await menu(page, 'Добавить на панель быстрого доступа');
  expect(await cmds(page)).toEqual(['undo', 'redo', 'show.current', 'format.painter', 'edit.find']);
  await page.locator('.st-qat [data-cmd="edit.find"]').click();
  await expect(page.locator('.st-find')).toBeVisible();
  await page.keyboard.press('Escape');
  // На той же кнопке ленты пункт — уже «Удалить…»; правый щелчок по кнопке панели — тоже
  // «Повторить» сейчас недоступна — и такую кнопку можно убрать (мышью: недоступную Playwright не щёлкает)
  const redo = (await page.locator('.st-qat [data-cmd="redo"]').boundingBox())!;
  await page.mouse.click(redo.x + redo.width / 2, redo.y + redo.height / 2, { button: 'right' });
  await menu(page, 'Удалить с панели быстрого доступа');
  expect(await cmds(page)).toEqual(['undo', 'show.current', 'format.painter', 'edit.find']);
  // «▾»: частые команды галочками
  await page.locator('.st-qat-more').click();
  await expect(page.locator('.st-menu [aria-checked="true"]')).toHaveCount(4);
  await menu(page, 'Показ с начала');
  expect(await cmds(page)).toContain('show.start');
  // Под лентой — своя строка
  await page.locator('.st-qat-more').click();
  await menu(page, 'Показывать под лентой');
  await expect(page.locator('#st-qat-down .st-qat')).toBeVisible();
  await expect(page.locator('.st-top .st-qat')).toHaveCount(0);
  // Запоминается
  await page.reload();
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  await expect(page.locator('#st-qat-down .st-qat')).toBeVisible();
  expect(await cmds(page)).toEqual(['undo', 'show.current', 'format.painter', 'edit.find', 'show.start']);
  expect(errors).toEqual([]);
});

test('панель быстрого доступа: «Другие команды…» — поиск, порядок, место, сброс; меню команды — у кнопки панели', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  await page.locator('.st-qat-more').click();
  await menu(page, 'Другие команды…');
  // Настройка — в «Файл → Параметры», поиск команд — в фокусе
  const q = page.locator('.fp-qat [data-qe="q"]');
  await expect(q).toBeFocused();
  await q.fill('блоки');
  await page.locator('.fp-qat [data-qe="add:insert.blocks"]').click();
  await expect(page.locator('.fp-qat .qe-mrow')).toHaveCount(5);
  // Порядок: «Блоки» — на одну выше
  await page.locator('.fp-qat [data-qe="up:insert.blocks"]').click();
  expect(await cmds(page)).toEqual(['undo', 'redo', 'show.current', 'insert.blocks', 'format.painter']);
  // Перетаскиванием за ручку — в начало
  const grip = page.locator('.fp-qat .qe-mrow[data-id="insert.blocks"] [data-grip]');
  const first = await page.locator('.fp-qat .qe-mrow').first().boundingBox();
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, first!.y + 4, { steps: 8 });
  await page.mouse.up();
  expect(await cmds(page)).toEqual(['insert.blocks', 'undo', 'redo', 'show.current', 'format.painter']);
  await page.keyboard.press('Escape');
  // «Блоки» с панели, когда открыта другая вкладка ленты: библиотека — у кнопки панели
  await page.locator('.st-tabs [data-tab="view"]').click();
  const b = (await page.locator('.st-qat [data-cmd="insert.blocks"]').boundingBox())!;
  await page.locator('.st-qat [data-cmd="insert.blocks"]').click();
  const lib = (await page.locator('.st-lib').boundingBox())!;
  expect(Math.abs(lib.x - b.x)).toBeLessThan(12);
  expect(lib.y).toBeGreaterThan(b.y);
  expect(lib.y - (b.y + b.height)).toBeLessThan(20);
  await page.keyboard.press('Escape');
  // Место и «Сбросить» — в настройке
  await page.locator('#st-file').click();
  await page.locator('.fp [data-fs="prefs"]').click();
  await page.locator('.fp-qat [data-qe="place:below"]').click();
  await expect(page.locator('#st-qat-down')).toBeVisible();
  await page.locator('.fp-qat [data-qe="reset"]').click();
  await expect(page.locator('#st-qat-down')).toBeHidden();
  expect(await cmds(page)).toEqual(['undo', 'redo', 'show.current', 'format.painter']);
  expect(errors).toEqual([]);
});
