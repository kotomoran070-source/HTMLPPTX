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

test('эффекты фигуры: бегущий свет и матовое стекло — на слайде, в «Свойствах» и на ленте; у фигур PowerPoint их нет', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=cards#3');
  const shape = (n: number) => page.locator('.slide.on > .free .shape').nth(n);
  await expect(shape(1)).toBeVisible();
  // Свет: под заливкой поворачивается конический градиент; цвета темы и «Закат» вдвое быстрее с краем 5 px
  const light = (n: number) => shape(n).evaluate((el) => {
    const before = getComputedStyle(el, '::before');
    const after = getComputedStyle(el, '::after');
    return { cls: el.className, bg: before.backgroundImage, anim: before.animationName, dur: before.animationDuration, inset: after.top };
  });
  const theme = await light(0);
  expect(theme.cls).toContain('shape-flow');
  expect(theme.anim).toBe('shape-flow');
  expect(theme.dur).toBe('5s');
  const sunset = await light(1);
  expect(sunset.bg).toContain('rgb(249, 115, 22)');
  expect(sunset.dur).toBe('2.5s');
  expect(sunset.inset).toBe('5px');
  // Стекло: полупрозрачная заливка, под ней размыто
  const glass = await shape(3).evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
  expect(glass.bg).toMatch(/\/ 0\.6\)|, 0\.6\)/);
  expect(glass.blur).toContain('blur(30px)');

  // «Свойства»: карточка «Бегущий свет» с цветами и ручками; ползунок скорости пишет flowSpeed, «×» убирает эффект
  await page.goto('/?deck=cards&studio#3');
  const free = (n: number) => page.locator('#st-canvas .slide.on > .free').nth(n);
  const shapeLine = (t: string) => readDeck('cards').split('\n').find((l) => l.includes(`text: ${t}`)) ?? '';
  await free(0).click({ position: { x: 30, y: 30 } });
  const card = page.locator('.st-fx-card[data-fxk="flow"]');
  await expect(card).toBeVisible();
  await card.locator('[data-fxc="flow"][data-v="forest"]').click();
  await expect.poll(() => shapeLine('Цвета темы')).toContain('flow: forest');
  await card.locator('input[data-fx="flowSpeed"]').evaluate((el: HTMLInputElement) => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(() => shapeLine('Цвета темы')).toContain('flowSpeed: 1.5');
  await card.locator('[data-fxoff="flow"]').click();
  await expect.poll(() => shapeLine('Цвета темы')).not.toContain('flow');
  // Стекло — своя карточка с размытием и плотностью
  await free(3).click();
  await expect(page.locator('.st-fx-card[data-fxk="glass"] input[data-fx="glassBlur"]')).toBeVisible();
  // Лента «Фигура»: «Стекло» включает эффект у выделенной фигуры
  await free(1).click({ position: { x: 30, y: 30 } });
  await page.locator('[data-cmd="shape.glass"]').first().click();
  await page.locator('.st-flt-pop .st-flt[title="Матовое стекло"]').click();
  await expect.poll(() => shapeLine('Закат')).toContain('glass: true');
  // У звезды (фигура PowerPoint) света и стекла нет
  await free(4).click();
  await expect(page.locator('[data-cmd="shape.flow"]').first()).toBeDisabled();
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
  // Эффекты фигуры: стекло — заливкой с прозрачностью 40 %, у света — мягкая тень; обе — фигурами с текстом
  const three = await slide(3);
  expect(three).toMatch(/<a:alpha val="60000"\/>/);
  expect(three).toContain('<a:outerShdw');
  expect(three).toContain('Закат');
  expect(three).toContain('Стекло');
});
