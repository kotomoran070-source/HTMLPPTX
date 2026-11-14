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

test('«Шаг сетки»: готовые значения и свой — вписать и Enter; вне границ — ближайшее; запоминается', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#2');
  await page.locator('#st-canvas .slide.on').waitFor();
  await page.locator('.st-tabs [data-tab="view"]').click();
  const step = page.locator('.st-ribbon [data-cmd="view.grid-step"]');
  const gs = () => page.locator('.st-grid').evaluate((g) => Number.parseFloat((g as HTMLElement).style.getPropertyValue('--gs')) / g.getBoundingClientRect().width * 1280);
  await step.click();
  const field = page.locator('.st-menu .st-menu-field input');
  await expect(field).toHaveValue('40');
  // Своё число: Enter — сетка включается с ним, меню закрывается
  await field.fill('25');
  await field.press('Enter');
  await expect(page.locator('.st-menu')).toHaveCount(0);
  await expect(page.locator('.st-grid')).toBeVisible();
  await expect.poll(gs).toBeCloseTo(25, 0);
  // Готовых значений с ним нет — ни одно не отмечено; стрелка ↓ в поле — шаг, а не следующий пункт
  await step.click();
  await expect(page.locator('.st-menu [aria-checked="true"]')).toHaveCount(0);
  await expect(field).toHaveValue('25');
  await field.focus();
  await field.press('ArrowUp');
  await expect(field).toHaveValue('26');
  await expect(field).toBeFocused();
  await field.press('Enter');
  await expect.poll(gs).toBeCloseTo(26, 0);
  // Больше допустимого — ближайшее (360)
  await step.click();
  await field.fill('9000');
  await field.press('Enter');
  await expect.poll(gs).toBeCloseTo(360, 0);
  // Запоминается
  await page.reload();
  await page.locator('#st-canvas .slide.on').waitFor();
  await page.locator('.st-tabs [data-tab="view"]').click();
  await step.click();
  await expect(field).toHaveValue('360');
  await page.locator('.st-menu button', { hasText: '20 px' }).click();
  await expect.poll(gs).toBeCloseTo(20, 0);
  expect(errors).toEqual([]);
});
