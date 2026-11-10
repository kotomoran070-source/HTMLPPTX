// Вкладка «Надпись»: оформление всего текста выделенных надписей — стили, эффекты, начертание
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { parse } from 'yaml';
import { DECKS, deckFile, waitFile, watchErrors } from './helpers';

const DIR = path.join(DECKS, 'txtab');
test.beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'deck.yaml'), `title: Надписи
slides:
  - template: canvas
    free:
      - {type: text, text: "Итоги квартала", styles: {text: {size: 56}}, place: {x: 80, y: 60, w: 700}}
      - {type: text, text: "Рост выручки", place: {x: 80, y: 300, w: 600}}
`);
});
test.afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

const styles = () => ((parse(fs.readFileSync(deckFile('txtab'), 'utf8')) as { slides: { free: { styles?: { text?: Record<string, unknown> } }[] }[] }).slides[0].free.map((b) => b.styles?.text ?? {}));

test('«Надпись»: две надписи — стиль с примеркой, курсив и тень сразу у обеих; ручки эффекта в «Свойствах»; правка текста — на «Главной»', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=txtab&studio#1');
  const t = (k: number) => page.locator('#st-canvas .slide.on [data-free]').nth(k);
  await t(0).click();
  await expect(page.locator('.st-tabs [data-tab="text"]')).toHaveAttribute('aria-selected', 'true');
  await t(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('#st-canvas .slide.on .ed-block-sel')).toHaveCount(2);
  const p1 = page.locator('#st-canvas .slide.on [data-block] >> nth=1');
  // Наведение на плитку — примерка на слайде без записи, уход — как было
  await page.locator('#st-ribbon [data-cmd="text.style.neon"]').hover();
  await expect.poll(() => p1.evaluate((el) => getComputedStyle(el).textShadow)).not.toBe('none');
  await page.mouse.move(700, 800);
  await expect.poll(() => p1.evaluate((el) => getComputedStyle(el).textShadow)).toBe('none');
  await page.locator('#st-ribbon [data-cmd="text.style.neon"]').click();
  await page.locator('#st-ribbon [data-cmd="text.italic"]').click();
  expect(await waitFile(() => styles().every((s) => s.glow === 'accent' && s.italic === true))).toBe(true);
  // Своё у каждой остаётся: размер первой
  expect(styles()[0].size).toBe(56);
  // Тень из меню — у обеих; Ctrl+Z — одним шагом назад
  await page.locator('.st-rpanel[data-panel="text"] [data-cmd="text.shadow"]').click();
  await page.locator('.st-lkpop [title="Ретро"]').click();
  expect(await waitFile(() => styles().every((s) => s.shadow === 'retro'))).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await waitFile(() => styles().every((s) => !s.shadow && s.glow === 'accent'))).toBe(true);
  // Выбранный эффект — в «Свойствах» со своими ручками: размер свечения — у обеих, «×» убирает
  await expect(page.locator('#st-props .st-fx-card[data-fxk="glow"]')).toHaveCount(1);
  await page.locator('#st-props [data-fx="glowSize"]').fill('30');
  expect(await waitFile(() => styles().every((s) => typeof s.glowSize === 'number' && (s.glowSize as number) > 0.26))).toBe(true);
  await page.locator('#st-props [data-fxoff="glow"]').click();
  expect(await waitFile(() => styles().every((s) => !s.glow && !s.glowSize))).toBe(true);
  await expect(page.locator('#st-props .st-fx')).toHaveCount(0);
  // Щелчок в текст выделенной надписи — правка: панель «Текст» на «Главной»
  await page.keyboard.press('Escape');
  await t(1).click({ position: { x: 20, y: 12 } });
  await t(1).click({ position: { x: 20, y: 12 } });
  await expect(page.locator('.st-tabs [data-tab="home"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ed-text')).not.toHaveClass(/idle/);
  expect(errors).toEqual([]);
});

test('часть текста в фигуре: цвет, размер и шрифт — только выделенным словам; цвет не сбрасывает их размер', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=spanfmt&studio#1');
  const t = page.locator('#st-canvas .slide.on .shape-t').first();
  // Первый щелчок выделяет фигуру, второй — правка текста
  await t.click();
  await t.click();
  await expect(t).toHaveAttribute('contenteditable', /true|plaintext-only/);
  // Оформление текста — на «Главной» (у фигуры открывается её вкладка)
  await page.locator('.st-tabs [data-tab="home"]').click();
  // Выделить «19 дней»
  const pick = () => t.evaluate((el) => {
    const b = el.querySelector('b')!;
    const r = document.createRange();
    r.selectNodeContents(b);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  const look = () => t.evaluate((el) => {
    const cs = (n: Node) => getComputedStyle(n.parentElement!);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out: Record<string, { size: number; color: string; font: string }> = {};
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const k = n.textContent!.trim().slice(0, 7);
      if (k) out[k] = { size: parseFloat(cs(n).fontSize), color: cs(n).color, font: cs(n).fontFamily };
    }
    return out;
  });
  const before = await look();
  expect(before['19 дней'].size).toBe(34);
  const rest = before['Восьмог'];
  await pick();
  // Цвет: размер «19 дней» остаётся
  await page.locator('#ed-text [data-t="color"]').click();
  await page.locator('#ed-colors [data-c="#DC2626"]').click();
  let now = await look();
  expect(now['19 дней']).toMatchObject({ size: 34, color: 'rgb(220, 38, 38)' });
  expect(now['Восьмог']).toEqual(rest);
  // Размер из поля: только выделенным словам; в поле — их размер
  await expect(page.locator('#ed-text [data-t="size"]')).toHaveValue('34');
  await page.locator('#ed-text [data-t="size"]').fill('40');
  await page.locator('#ed-text [data-t="size"]').press('Enter');
  now = await look();
  expect(Math.round(now['19 дней'].size)).toBe(40);
  expect(now['19 дней'].color).toBe('rgb(220, 38, 38)');
  expect(now['Восьмог']).toEqual(rest);
  // Кнопка «больше» — тоже только им
  await page.locator('#ed-text [data-t="size+"]').click();
  now = await look();
  expect(Math.round(now['19 дней'].size)).toBe(42);
  expect(now['Восьмог'].size).toBe(rest.size);
  // Шрифт: только выделенным словам
  await page.locator('#ed-text [data-t="font"]').click();
  await page.locator('.fontpick-o', { hasText: 'С засечками' }).click();
  now = await look();
  expect(now['19 дней'].font).toContain('Georgia');
  expect(now['19 дней']).toMatchObject({ color: 'rgb(220, 38, 38)' });
  expect(Math.round(now['19 дней'].size)).toBe(42);
  expect(now['Восьмог']).toEqual(rest);
  // В данных — один кусок со всем оформлением, остальной текст без своего
  await page.keyboard.press('Escape');
  const text = () => (parse(fs.readFileSync(deckFile('spanfmt'), 'utf8')) as { slides: { free: { text: string }[] }[] }).slides[0].free[0].text;
  // 42 px из 17 — 247 %; жирный снаружи или внутри куска — одно и то же
  expect(await waitFile(() => /^(\*\*\{#DC2626 s:247 f:serif\|19 дней\}\*\*|\{#DC2626 s:247 f:serif\|\*\*19 дней\*\*\})\n/.test(text()))).toBe(true);
  expect(text()).toContain('\n\nВосьмого ноября Рентген открыл лучи');
  // После сохранения — так же
  now = await look();
  expect(Math.round(now['19 дней'].size)).toBe(42);
  expect(now['19 дней'].font).toContain('Georgia');
  expect(now['Восьмог']).toEqual(rest);
  expect(errors).toEqual([]);
});

test('Ctrl+A на слайде — «Главная» → «Шрифт» оформляет весь текст выделенных объектов; «Заменить шрифт» — только на этом слайде', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'manytext');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: Много текста
slides:
  - template: canvas
    free:
      - {type: text, text: "Заголовок", styles: {text: {size: 40, font: mono}}, place: {x: 80, y: 40, w: 700}}
      - {type: shape, kind: round, text: "{#B7791F s:200|Цифра}\\n\\nПодпись", styles: {text: {size: 16}}, place: {x: 80, y: 200, w: 400, h: 200}}
      - {type: text, text: "Сноска", place: {x: 600, y: 300, w: 400}}
  - template: canvas
    free:
      - {type: text, text: "Другой слайд", styles: {text: {font: mono}}, place: {x: 80, y: 80, w: 600}}
`);
  try {
    type Free = { text: string; styles?: { text?: Record<string, unknown> } };
    const deck = () => parse(fs.readFileSync(deckFile('manytext'), 'utf8')) as { slides: { free: Free[] }[] };
    await page.goto('/?deck=manytext&studio#1');
    const s = (await page.locator('#st-canvas .slide.on').boundingBox())!;
    await page.mouse.click(s.x + s.width - 20, s.y + s.height - 20);
    await page.keyboard.press('Control+a');
    await page.locator('.st-tabs [data-tab="home"]').click();
    // Панель «Шрифт» работает с выделенным (а не ждёт правки текста)
    await expect(page.locator('#ed-text')).toHaveClass(/st-target/);
    await page.locator('#ed-text [data-t="font"]').click();
    await page.locator('.fontpick-o', { hasText: 'С засечками' }).click();
    expect(await waitFile(() => deck().slides[0].free.every((b) => b.styles?.text?.font === 'serif'))).toBe(true);
    // Цвет — всему тексту, и части со своим цветом тоже; её размер остаётся
    await page.locator('#ed-text [data-t="color"]').click();
    await page.locator('#ed-colors [data-c="#7C3AED"]').click();
    expect(await waitFile(() => deck().slides[0].free.every((b) => b.styles?.text?.color === '#7C3AED'))).toBe(true);
    expect(deck().slides[0].free[1].text).toMatch(/^\{s:200\|Цифра\}/);
    // «Больше» — пропорционально, размер числом — всему тексту поровну
    await page.locator('#ed-text [data-t="size+"]').click();
    expect(await waitFile(() => deck().slides[0].free[1].styles?.text?.size === 18 && deck().slides[0].free[0].styles?.text?.size === 42)).toBe(true);
    expect(deck().slides[0].free[1].text).toMatch(/^\{s:200\|Цифра\}/);
    await page.locator('#ed-text [data-t="size"]').fill('20');
    await page.locator('#ed-text [data-t="size"]').press('Enter');
    expect(await waitFile(() => deck().slides[0].free.every((b) => b.styles?.text?.size === 20))).toBe(true);
    expect(deck().slides[0].free[1].text).toMatch(/^Цифра\n/);
    // Второй слайд не тронут
    expect(deck().slides[1].free[0].styles?.text?.font).toBe('mono');
    // Ctrl+Z — одним шагом назад
    await page.keyboard.press('Control+z');
    expect(await waitFile(() => deck().slides[0].free[1].text.startsWith('{s:200|Цифра}'))).toBe(true);

    // «Заменить шрифт» на втором слайде: первый слайд не меняется
    await page.goto('/?deck=manytext&studio#1');
    await page.keyboard.press('Control+z');
    await page.goto('/?deck=manytext&studio#2');
    await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
    await page.locator('.st-tabs [data-tab="tools"]').click();
    await page.locator('[data-cmd="tools.font"]').first().click();
    await page.locator('.st-frpop [data-fr="where"]').selectOption('slide');
    await page.locator('.st-frpop [data-fr="from"]').selectOption('mono');
    await page.locator('.st-frpop [data-fr="to"]').click();
    await page.locator('.fontpick-o', { hasText: 'Округлый' }).click();
    await expect(page.locator('.st-frpop [data-fr="hint"]')).toContainText('на слайде 2');
    await page.locator('.st-frpop [data-fr="go"]').click();
    expect(await waitFile(() => deck().slides[1].free[0].styles?.text?.font === 'rounded')).toBe(true);
    expect(deck().slides[0].free.some((b) => b.styles?.text?.font === 'rounded')).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('стили и эффекты текста у фигуры — на вкладке «Фигура»; надпись с фигурой — на «Надписи», обоим сразу', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'shapefx');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: Текст фигуры
slides:
  - template: canvas
    free:
      - {type: text, text: "Заголовок", place: {x: 80, y: 40, w: 700}}
      - {type: shape, kind: round, text: "Карточка", place: {x: 80, y: 220, w: 400, h: 200}}
`);
  try {
    type Free = { styles?: { text?: Record<string, unknown> }; glow?: unknown };
    const free = () => (parse(fs.readFileSync(deckFile('shapefx'), 'utf8')) as { slides: { free: Free[] }[] }).slides[0].free;
    await page.goto('/?deck=shapefx&studio#1');
    const shapeText = page.locator('#st-canvas .slide.on .shape-t').first();
    await shapeText.click();
    await expect(page.locator('.st-tabs [data-tab="shape"]')).toHaveAttribute('aria-selected', 'true');
    const panel = page.locator('.st-rpanel[data-panel="shape"]');
    // Свечение букв: примерка наведением — на тексте фигуры, щелчок — запись в styles.text (рамка фигуры — своя)
    await panel.locator('[data-cmd="text.glow"]').click();
    const accent = page.locator('.st-txpop button', { hasText: 'Акцент' }).first();
    await accent.hover();
    await expect.poll(() => shapeText.evaluate((e) => getComputedStyle(e).textShadow)).not.toBe('none');
    await accent.click();
    expect(await waitFile(() => free()[1].styles?.text?.glow === 'accent')).toBe(true);
    expect(free()[1].glow).toBeUndefined();
    await expect.poll(() => shapeText.evaluate((e) => getComputedStyle(e).textShadow)).not.toBe('none');
    // Готовый стиль текста — с той же вкладки
    await shapeText.click();
    await panel.locator('[data-cmd="text.style.accent"]').click();
    expect(await waitFile(() => free()[1].styles?.text?.color === 'accent' && free()[1].styles?.text?.weight === 700)).toBe(true);
    // Надпись и фигура вместе — вкладка «Надпись»: тень обоим; поворот — только у надписей
    const s = (await page.locator('#st-canvas .slide.on').boundingBox())!;
    await page.mouse.click(s.x + s.width - 20, s.y + s.height - 20);
    await page.keyboard.press('Control+a');
    await expect(page.locator('.st-tabs [data-tab="text"]')).toHaveAttribute('aria-selected', 'true');
    const tp = page.locator('.st-rpanel[data-panel="text"]');
    await expect(tp.locator('[data-cmd="text.rotate"]')).toBeDisabled();
    await tp.locator('[data-cmd="text.shadow"]').click();
    await page.locator('.st-txpop button', { hasText: 'Мягкая' }).first().click();
    expect(await waitFile(() => free().every((b) => b.styles?.text?.shadow === 'soft'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
