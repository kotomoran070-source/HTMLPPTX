// Панель быстрого доступа (studio/qat.ts): свои кнопки любых команд — рядом с «Файлом» или под лентой
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DECKS, readDeck, watchErrors } from './helpers';

// Своя презентация для пипетки: общие тестовые не меняются
const PICK = path.join(DECKS, 'qatpick');
test.beforeAll(() => {
  fs.mkdirSync(PICK, { recursive: true });
  fs.writeFileSync(path.join(PICK, 'deck.yaml'), `title: Пипетка
slides:
  - template: canvas
    free:
      - {type: shape, kind: round, fill: surface, place: {x: 120, y: 120, w: 420, h: 260}}
`);
});
test.afterAll(() => fs.rmSync(PICK, { recursive: true, force: true }));

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
  // Свой крестик: появляется с текстом, очищает поиск (Esc — тоже)
  const clear = page.locator('.fp-qat .qe-clear');
  await expect(clear).toBeHidden();
  await q.fill('блоки');
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(page.locator('.fp-qat [data-qe="q"]')).toHaveValue('');
  await expect(page.locator('.fp-qat [data-qe="q"]')).toBeFocused();
  await page.locator('.fp-qat [data-qe="q"]').fill('блоки');
  await page.keyboard.press('Escape');
  await expect(page.locator('.fp-qat [data-qe="q"]')).toHaveValue('');
  await expect(page.locator('.fp')).toBeVisible();
  await page.locator('.fp-qat [data-qe="q"]').fill('блоки');
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

test('пипетка: в «▾» панели — значком; без выделения цвет копируется, у фигуры — заливка', async ({ page }) => {
  const errors = watchErrors(page);
  // Пипетка системы — подставная: «взяла» #12AB34
  await page.addInitScript(() => {
    (window as unknown as { EyeDropper: unknown }).EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#12ab34' }); } };
  });
  await page.goto('/?deck=qatpick&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.locator('.st-qat-more').click();
  await menu(page, 'Пипетка');
  const pick = page.locator('.st-qat [data-cmd="color.pick"]');
  await expect(pick).toBeVisible();
  // Ничего не выделено — цвет копируется
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await pick.click();
  await expect(page.locator('#ed-toast')).toContainText('#12AB34');
  // Фигура — заливка
  await page.locator('#st-canvas .slide.on [data-type="shape"]').first().click({ position: { x: 10, y: 10 } });
  await pick.click();
  await expect.poll(() => readDeck('qatpick')).toContain('#12AB34');
  // Ctrl+Z — заливка как была
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('qatpick')).not.toContain('#12AB34');
  expect(errors).toEqual([]);
});
