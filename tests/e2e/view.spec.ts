// «Вид» → «Интерфейс»: тема программы и вид слайдов в редакторе — отдельно
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test('«Вид слайдов» отдельно от темы интерфейса: светлые слайды в тёмной программе, T меняет только программу', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#2');
  const slide = page.locator('#st-canvas .slide.on');
  await slide.waitFor();
  await page.locator('.st-tabs [data-tab="view"]').click();
  await page.locator('.st-ribbon [data-cmd="view.ui-theme"]').click();
  await page.locator('.st-menu button', { hasText: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(slide).not.toHaveAttribute('data-mode');
  await page.locator('.st-ribbon [data-cmd="view.slides-look"]').click();
  await page.locator('.st-menu button', { hasText: 'Светлые' }).click();
  await expect(page.locator('#st-canvas .slide.on')).toHaveAttribute('data-mode', 'light');
  // Слайд светлый своим фоном, миниатюры — тоже
  const bg = () => page.locator('#st-canvas .slide.on').evaluate((e) => getComputedStyle(e).getPropertyValue('--bg').trim());
  await expect.poll(bg).toBe('#F8FAFC');
  await expect(page.locator('.st-thumb.cur .slide')).toHaveAttribute('data-mode', 'light');
  // Тема программы меняется — слайды нет; выбор запоминается
  await page.locator('#st-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#st-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).toBe('#F8FAFC');
  await page.reload();
  await expect(page.locator('#st-canvas .slide.on')).toHaveAttribute('data-mode', 'light');
  // «Как интерфейс» — снова за темой программы
  await page.locator('.st-tabs [data-tab="view"]').click();
  await page.locator('.st-ribbon [data-cmd="view.slides-look"]').click();
  await page.locator('.st-menu button', { hasText: 'Как интерфейс' }).click();
  await expect(page.locator('#st-canvas .slide.on')).not.toHaveAttribute('data-mode');
  await expect.poll(bg).toBe('#0F172A');
  await page.evaluate(() => localStorage.removeItem('htmlpptx-theme'));
  expect(errors).toEqual([]);
});
