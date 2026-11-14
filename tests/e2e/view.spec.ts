// «Вид» → «Интерфейс»: тема программы и вид слайдов в редакторе — отдельно; шаг сетки; размер слайда (4:3, 21:9)
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { DECKS, exportAs, readDeck, watchErrors } from './helpers';

// Своя презентация для размера слайда: общие тестовые не меняются. Слайд 1 тесный (картинка и подписи на всю ширину)
const SIZES = path.join(DECKS, 'sizes');
test.beforeAll(() => {
  fs.mkdirSync(SIZES, { recursive: true });
  fs.writeFileSync(path.join(SIZES, 'deck.yaml'), `title: Размеры
slides:
  - template: canvas
    free:
      - {type: shape, id: photo, kind: rect, fill: accent, place: {x: 80, y: 120, w: 700, h: 400}}
      - {type: text, id: notes, text: Подписи справа, place: {x: 860, y: 120, w: 380}}
  - template: canvas
    free:
      - {type: text, id: title, text: Заголовок на всю ширину, place: {x: 80, y: 60, w: 1120}}
  - template: canvas
    free:
      - {type: shape, id: left, kind: rect, place: {x: 80, y: 200, w: 520, h: 200}}
      - {type: shape, id: right, kind: rect, place: {x: 680, y: 200, w: 520, h: 200}}
`);
});
test.afterAll(() => fs.rmSync(SIZES, { recursive: true, force: true }));

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
  // Больше допустимого — ближайшее (100)
  await step.click();
  await field.fill('9000');
  await field.press('Enter');
  await expect.poll(gs).toBeCloseTo(100, 0);
  // Запоминается
  await page.reload();
  await page.locator('#st-canvas .slide.on').waitFor();
  await page.locator('.st-tabs [data-tab="view"]').click();
  await step.click();
  await expect(field).toHaveValue('100');
  await page.locator('.st-menu button', { hasText: '20 px' }).click();
  await expect.poll(gs).toBeCloseTo(20, 0);
  expect(errors).toEqual([]);
});

test('«Размер слайда»: 4:3 — «Уместить», обратно в 16:9 — «Увеличить» (как было); Ctrl+Z; 21:9 — «Расставить по ширине»; PPTX своего размера', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('/?deck=sizes&studio#1');
  const stage = page.locator('#st-canvas .stage');
  await page.locator('#st-canvas .slide.on').waitFor();
  const ratio = async () => { const b = (await stage.boundingBox())!; return b.width / b.height; };
  expect(await ratio()).toBeCloseTo(16 / 9, 1);
  await page.locator('.st-tabs [data-tab="view"]').click();
  const size = page.locator('.st-ribbon [data-cmd="view.size"]');
  const pick = async (label: string) => { await size.click(); await page.locator('.st-menu button', { hasText: label }).click(); };
  await size.click();
  await expect(page.locator('.st-menu [aria-checked="true"]')).toContainText('Широкий 16:9');
  await page.locator('.st-menu button', { hasText: 'Стандартный 4:3' }).click();
  // Слайды 1 и 3 тесные — вопрос с двумя превью; для каждого слайда: слайд 3 — «Как есть», «Применить»
  const ask = page.locator('.sz');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('На 2 слайдах (1 и 3) содержимое шире нового слайда (960 px)');
  await expect(ask.locator('.sz-opt .thumb')).toHaveCount(2);
  await ask.locator('.sz-more').click();
  await expect(ask.locator('.sz-item')).toHaveCount(2);
  await expect(ask.locator('.sz-item .thumb')).toHaveCount(2);
  await ask.locator('.sz-item[data-n="3"] [data-v="keep"]').click();
  await expect(ask.locator('.sz-item[data-n="3"] [data-v="keep"]')).toHaveAttribute('aria-pressed', 'true');
  await ask.locator('.sz-apply').click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator('#ed-toast')).toContainText('Размер слайда — Стандартный 4:3 · уменьшено слайдов: 1');
  // Слайд 3 — как есть: правый прямоугольник у правого края своего размера
  await expect.poll(() => readDeck('sizes')).toContain('place: {x: 360, y: 200, w: 520, h: 200}');
  await expect.poll(() => readDeck('sizes')).toMatch(/size: ["']?4:3/);
  await expect.poll(ratio).toBeCloseTo(4 / 3, 1);
  // Композиция слайда 1 уменьшена целиком, заголовок слайда 2 — сузился вместе со слайдом
  expect(readDeck('sizes')).toContain('place: {x: 60, y: 180, w: 525, h: 300}');
  expect(readDeck('sizes')).toContain('w: 800');
  // Обратно в 16:9 — Enter, «Увеличить» для всех: композиция слайда 1 — как была
  await pick('Широкий 16:9');
  await expect(ask).toContainText('Как разместить содержимое в 16:9?');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ed-toast')).toContainText('Размер слайда — Широкий 16:9 · увеличено слайдов: 2');
  await expect.poll(() => readDeck('sizes')).not.toMatch(/size:/);
  expect(readDeck('sizes')).toContain('place: {x: 80, y: 120, w: 700, h: 400}');
  expect(readDeck('sizes')).toContain('w: 1120');
  await expect.poll(ratio).toBeCloseTo(16 / 9, 1);
  // Ctrl+Z — снова 4:3, на том же слайде
  await page.locator('#st-canvas').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ed-toast')).toContainText('Отменено: размер слайда');
  await expect.poll(() => readDeck('sizes')).toMatch(/size: ["']?4:3/);
  await expect.poll(ratio).toBeCloseTo(4 / 3, 1);
  await expect(page).toHaveURL(/#1$/);
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('sizes')).not.toMatch(/size:/);
  // 21:9 — «Расставить по ширине»: заголовок тянется до 1520, картинка остаётся у края
  await pick('Сверхширокий 21:9');
  await expect(ask).toContainText('Как разместить содержимое в 21:9?');
  await ask.locator('.sz-opt[data-a="keep"]').click();
  await expect.poll(() => readDeck('sizes')).toMatch(/size: ["']?21:9/);
  await expect.poll(ratio).toBeCloseTo(21 / 9, 1);
  expect(readDeck('sizes')).toContain('w: 1520');
  expect(readDeck('sizes')).toContain('place: {x: 80, y: 120, w: 700, h: 400}');
  // PowerPoint — слайд 17,5 × 7,5 дюйма
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 100_000 }), exportAs(page, 'pptx')]);
  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  expect(await zip.file('ppt/presentation.xml')!.async('string')).toMatch(/<p:sldSz cx="16002000" cy="6858000"/);
  expect(errors).toEqual([]);
});
