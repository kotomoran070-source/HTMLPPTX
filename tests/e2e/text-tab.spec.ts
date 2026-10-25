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
  await page.locator('#st-ribbon [data-cmd="text.shadow"]').click();
  await page.locator('.st-lkpop [title="Ретро"]').click();
  expect(await waitFile(() => styles().every((s) => s.shadow === 'retro'))).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await waitFile(() => styles().every((s) => !s.shadow && s.glow === 'accent'))).toBe(true);
  // Выбранный эффект — в «Свойствах» со своими ручками: размер свечения — у обеих, «×» убирает
  await expect(page.locator('#st-props .st-fx-card[data-fxk="glow"]')).toHaveCount(1);
  await page.locator('#st-props [data-fx="glowSize"]').fill('30');
  expect(await waitFile(() => styles().every((s) => typeof s.glowSize === 'number' && (s.glowSize as number) > 0.34))).toBe(true);
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
