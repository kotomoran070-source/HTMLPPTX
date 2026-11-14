// Окно «Код вставки»: редактор кода, как у «Кода слайда», — подсветка, поиск и замена (Ctrl+F, Ctrl+H)
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DECKS, readDeck, watchErrors } from './helpers';

const DIR = path.join(DECKS, 'embedfind');
test.beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'deck.yaml'), `title: Код вставки
slides:
  - template: canvas
    free:
      - type: embed
        code: |
          <style>p { color: tomato }</style>
          <p class="hello">Привет</p>
          <p class="hello">Привет ещё раз</p>
        place: {x: 200, y: 100, w: 600, h: 400}
`);
});
test.afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('код вставки: редактор с подсветкой, Ctrl+F находит, Ctrl+H заменяет все, Esc — сначала поиск, Ctrl+Enter — применить', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=embedfind&studio#1');
  await page.locator('#st-canvas .slide.on [data-type="embed"]').dblclick();
  const cm = page.locator('.st-cd .cm-content');
  await expect(cm).toBeVisible();
  await expect(cm).toContainText('Привет ещё раз');
  // Подсветка HTML — как в «Коде слайда»
  await expect(page.locator('.st-cd .cm-line span').first()).toBeVisible();
  // Ctrl+F — поиск по коду (не по презентации), «1 из 2»
  await cm.click();
  await page.keyboard.press('ControlOrMeta+f');
  const q = page.locator('.st-cd .st-cs-q');
  await expect(q).toBeFocused();
  await q.fill('Привет');
  await expect(page.locator('.st-cd .st-cs-n')).toHaveText(/из 2/);
  await expect(page.locator('.st-find')).toBeHidden();
  // Ctrl+H — замена, «Все»
  await page.keyboard.press('ControlOrMeta+h');
  await page.locator('.st-cd .st-cs-r').fill('Здравствуйте');
  await page.locator('.st-cd [data-a="all"]').click();
  await expect(cm).toContainText('Здравствуйте ещё раз');
  // Esc в поиске закрывает поиск, окно остаётся
  await q.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.st-cd .st-cs')).toHaveCount(0);
  await expect(page.locator('.st-cd')).toBeVisible();
  // Ctrl+Enter — применить
  await cm.click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.st-cd')).toHaveCount(0);
  await expect.poll(() => readDeck('embedfind')).toContain('Здравствуйте ещё раз');
  expect(errors).toEqual([]);
});
