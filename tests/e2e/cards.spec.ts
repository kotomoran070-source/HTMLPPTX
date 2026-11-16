// Карточки: своя заливка и прозрачность, раскрытие по щелчку (как «Вопрос — ответ»); шаги в ряд, столбцом
// и стрелками; переливающиеся карточки набора — свои цвета и скорость; поля в «Свойствах»
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { exportAs, readDeck, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

test('карточки: заливка из темы и своя, прозрачность — только фона, раскрытие по щелчку', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=cards#1');
  const card = (n: number) => page.locator('.slide.on > .free .card').nth(n);
  await expect(card(0)).toBeVisible();
  const look = (n: number) => card(n).evaluate((el) => {
    const cs = getComputedStyle(el);
    const ac = getComputedStyle(el.closest('.slide')!).getPropertyValue('--ac').trim();
    return { bg: cs.backgroundColor, color: getComputedStyle(el.querySelector('p')!).color, ac };
  });
  // Акцент: фон — цвет акцента, текст — светлый на нём
  const accent = await look(1);
  expect(accent.bg).not.toBe((await look(0)).bg);
  // Подпись — второстепенный текст: белый с небольшой прозрачностью, как --tx2 у темы
  expect(accent.color).toMatch(/^rgb\(255, 255, 255\)$|^color\(srgb 1 1 1( \/ 0\.8\d*)?\)$/);
  // Прозрачность 50 %: полупрозрачный фон, текст при этом сплошной
  const half = await look(2);
  expect(half.bg).toMatch(/\/ 0\.5\)|, 0\.5\)/);
  expect(half.color).not.toMatch(/\/ 0\.|, 0\.\d+\)/);
  // Своя тёмная заливка: текст светлый
  expect((await look(3)).color).toMatch(/^rgb\(255, 255, 255\)$|^color\(srgb 1 1 1( \/ 0\.8\d*)?\)$/);

  // Раскрытие: при показе видно только заголовок с «+», щелчок по заголовку раскрывает текст
  const rev = card(4);
  const textH = () => rev.locator('.cr-a').evaluate((el) => el.getBoundingClientRect().height);
  expect(await textH()).toBeLessThan(2);
  await rev.locator('.cr-q').click();
  await expect(rev).toHaveClass(/open/);
  await expect.poll(textH).toBeGreaterThan(20);
  await expect(rev.locator('.cr-q')).toHaveAttribute('aria-expanded', 'true');
  // Ещё щелчок — свернулась; с клавиатуры — Enter
  await rev.locator('.cr-q').click();
  await expect(rev).not.toHaveClass(/open/);
  await rev.locator('.cr-q').press('Enter');
  await expect(rev).toHaveClass(/open/);

  // В студии раскрыта всегда: её текст правят
  await page.goto('/?deck=cards&studio#1');
  const inStudio = page.locator('#st-canvas .slide.on .card-reveal .cr-a');
  await expect.poll(() => inStudio.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('карточка в «Свойствах»: заливка, ползунок прозрачности и «Раскрывать по щелчку» пишутся в презентацию', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=cards&studio#1');
  const free = page.locator('#st-canvas .slide.on > .free').first();
  await free.click({ position: { x: 40, y: 20 } });
  const props = page.locator('.st-props');
  await expect(props.getByText('Прозрачность заливки')).toBeVisible();
  const first = () => readDeck('cards').split('\n').find((l) => l.includes('title: Обычная')) ?? '';
  // Ползунок — прозрачность в процентах, в данных — плотность: 30 % → 0.7; число рядом — пока тянут
  const slider = props.locator('input[data-t="clear"]');
  await slider.evaluate((el: HTMLInputElement) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(props.locator('.st-f-clear output')).toHaveText('30 %');
  await slider.evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('change', { bubbles: true })));
  await expect.poll(first).toContain('fillOpacity: 0.7');
  await props.locator('[data-act="setcolor"][data-v="text"]').click();
  await expect.poll(first).toContain('fill: text');
  await props.getByText('Раскрывать по щелчку').click();
  await expect.poll(first).toContain('reveal: true');
  // 0 % — поле убирается
  await slider.evaluate((el: HTMLInputElement) => { el.value = '0'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(first).not.toContain('fillOpacity');
  expect(errors).toEqual([]);
});

test('шаги: в ряд, столбцом и стрелками — вид в «Свойствах», подсвечиваются по очереди', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=cards#2');
  const pipe = (n: number) => page.locator('.slide.on .pipe').nth(n);
  await expect(pipe(0)).toBeVisible();
  const boxes = (n: number) => pipe(n).locator('.st').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  // В ряд — слева направо на одной высоте
  const row = await boxes(0);
  expect(new Set(row.map((b) => Math.round(b.y))).size).toBe(1);
  expect(row[1].x).toBeGreaterThan(row[0].x);
  // Стрелками — тоже в ряд, у шагов форма стрелки и своя подсветка целиком
  await expect(pipe(1)).toHaveClass(/pipe-arrows/);
  const arrow = await pipe(1).locator('.st').nth(1).evaluate((el) => ({ clip: getComputedStyle(el).clipPath, anim: getComputedStyle(el).animationName }));
  expect(arrow.clip).toContain('polygon');
  expect(arrow.anim).toBe('act-arrow');
  // Столбцом — сверху вниз на одной линии, номер слева от подписи
  const col = await boxes(2);
  expect(new Set(col.map((b) => Math.round(b.x))).size).toBe(1);
  expect(col[1].y).toBeGreaterThan(col[0].y);
  const n = await pipe(2).locator('.st').first().evaluate((el) => [el.querySelector('i')!.getBoundingClientRect().right, el.querySelector('b')!.getBoundingClientRect().left]);
  expect(n[0]).toBeLessThan(n[1]);

  // В студии вид меняется в «Свойствах»
  await page.goto('/?deck=cards&studio#2');
  await page.locator('#st-canvas .slide.on > .free').first().click();
  const sel = page.locator('.st-props select[data-t="select"]').first();
  await expect(sel.locator('option')).toHaveText(['В ряд', 'Столбцом', 'Стрелками']);
  await sel.selectOption('column');
  await expect.poll(() => readDeck('cards')).toMatch(/type: pipeline, steps: \[[^\n]*layout: column|layout: column[^\n]*steps: \[\{title: Заявка, sub: онлайн\}/);
  expect(errors).toEqual([]);
});

test('переливающиеся карточки: свои цвета и скорость; поля — только у них', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=cards#3');
  const block = (n: number) => page.locator('.slide.on > .free .html-block').nth(n);
  await expect(block(1)).toBeVisible();
  // Цвета темы — без своих переменных; «Закат» ×2 — цвета градиента и вдвое быстрее
  expect(await block(0).evaluate((el) => el.style.getPropertyValue('--kt-a'))).toBe('');
  const own = await block(1).evaluate((el) => {
    const glow = el.querySelector('.kt-glow')!;
    return { a: el.style.getPropertyValue('--kt-a'), dur: getComputedStyle(glow, '::before').animationDuration, bg: getComputedStyle(glow, '::before').backgroundImage };
  });
  expect(own.a).toBe('#F97316');
  expect(own.dur).toBe('2.5s');
  expect(own.bg).toContain('rgb(249, 115, 22)');
  // Стекло «Океан»: пятна — цветами градиента
  expect(await block(2).locator('.kt-blob.a').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('rgb(6, 182, 212)');

  // «Свойства»: у переливающейся карточки — цвета и скорость, у простой вёрстки — нет
  await page.goto('/?deck=cards&studio#3');
  const free = (n: number) => page.locator('#st-canvas .slide.on > .free').nth(n);
  await free(0).click({ position: { x: 20, y: 20 } });
  const props = page.locator('.st-props');
  await expect(props.getByText('Цвета переливания')).toBeVisible();
  await props.locator('select[data-t="select"]').last().selectOption('forest');
  await expect.poll(() => readDeck('cards')).toMatch(/flow: forest/);
  await free(3).click({ position: { x: 20, y: 20 } });
  await expect(props.getByText('Масштаб вёрстки')).toBeVisible();
  await expect(props.getByText('Цвета переливания')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PowerPoint: прозрачная заливка карточки — родной прозрачностью, шаги стрелками — картинкой, в ряд — фигурами', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?deck=cards&studio');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 100_000 }), exportAs(page, 'pptx')]);
  const file = path.resolve('.tmp', 'test-export', 'cards.pptx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const slide = (n: number) => zip.file(`ppt/slides/slide${n}.xml`)!.async('string');
  // Карточка с прозрачностью 50 %: заливка с alpha 50 %, текст — текстом
  const one = await slide(1);
  expect(one).toMatch(/<a:solidFill><a:srgbClr val="[0-9A-F]{6}"><a:alpha val="50000"\/><\/a:srgbClr><\/a:solidFill>/);
  expect(one).toContain('Полупрозрачная');
  // Шаги: в ряд и столбцом — надписями, стрелками — одна картинка на месте блока
  const two = await slide(2);
  expect(two).toContain('Согласование');
  expect((two.match(/<p:pic>/g) ?? []).length).toBe(1);
});
