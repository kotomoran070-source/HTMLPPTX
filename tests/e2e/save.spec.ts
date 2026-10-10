// Сохранение: контрольные точки (Ctrl+S) и два окна одной презентации
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DECKS, readDeck, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

test('контрольная точка: Ctrl+S — копия на диске; зажатый Ctrl+Z на точке стоит, ещё нажатие — дальше; вернуть из списка', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=save&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const title = page.locator('#st-title');
  const toast = page.locator('#ed-toast');
  const rename = async (t: string) => {
    await title.fill(t);
    await title.press('Enter');
    await expect.poll(() => readDeck('save')).toContain(`title: ${t}`);
  };
  await rename('Т1');
  await page.keyboard.press('Control+s');
  await expect(toast).toContainText('контрольная точка');
  const dir = path.join(DECKS, '.checkpoints', 'save');
  expect(fs.readdirSync(dir).length).toBe(1);
  expect(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8')).toContain('title: Т1');
  await rename('Т2');
  await rename('Т3');
  // Зажатый Ctrl+Z: Т3 → Т2 → Т1 и стоп на точке
  await page.keyboard.down('Control');
  for (let k = 0; k < 6; k++) await page.keyboard.down('z');
  await page.keyboard.up('z');
  await page.keyboard.up('Control');
  await expect(title).toHaveValue('Т1');
  await expect(toast).toContainText('Контрольная точка');
  // Отдельное нажатие — дальше
  await page.keyboard.press('Control+z');
  await expect(title).toHaveValue('Сохранение');
  await expect.poll(() => readDeck('save')).toContain('title: Сохранение');
  // Вернуть к точке из списка у «Сохранено»
  await page.locator('#st-status').click();
  await page.locator('.st-menu').getByText(/^Вернуть:/).first().click();
  await expect(title).toHaveValue('Т1');
  await expect.poll(() => readDeck('save')).toContain('title: Т1');
  expect(errors).toEqual([]);
});

test('два окна: заметки из одного не стираются, когда в другом меняют название; второе окно их видит', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=save&studio#2');
  const other = await context.newPage();
  await other.goto('/?deck=save&studio#2');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await expect(other.locator('#st-canvas .slide.on')).toHaveCount(1);
  // Во втором окне долго пишут заметки
  await other.locator('#st-notes-text').fill('Долго писал эти заметки');
  await expect.poll(() => readDeck('save')).toContain('notes: Долго писал эти заметки');
  // Первое окно подтягивает их само
  await expect(page.locator('#st-notes-text')).toHaveValue('Долго писал эти заметки');
  // Название в первом окне — заметки на месте
  await page.locator('#st-title').fill('Новое название');
  await page.locator('#st-title').press('Enter');
  await expect.poll(() => readDeck('save')).toContain('title: Новое название');
  expect(readDeck('save')).toContain('notes: Долго писал эти заметки');
  // Ctrl+Z в первом окне откатывает только название, не чужие заметки
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('save')).not.toContain('Новое название');
  expect(readDeck('save')).toContain('notes: Долго писал эти заметки');
  expect(errors).toEqual([]);
});
