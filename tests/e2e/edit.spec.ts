// Правка и сохранение: текст на месте → deck.yaml, картинки → assets/, новая презентация, корзина, импорт HTML
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DECKS, PNG, api, deckFile, readDeck, waitFile, watchErrors } from './helpers';

test('правка текста на слайде сохраняется в deck.yaml, комментарии файла на месте', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl#2');
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  await page.keyboard.press('e');
  const title = page.locator('.slide.on h2[data-edit]');
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Заголовок из автотеста');
  await page.keyboard.press('Escape');
  expect(await waitFile(() => readDeck('tpl').includes('title: Заголовок из автотеста'))).toBe(true);
  const text = readDeck('tpl');
  expect(text).toContain('# Новая презентация');            // комментарии в начале файла
  expect(text).toContain('logo: ./assets/logo.svg');         // пути к файлам — относительные
  expect(text).not.toMatch(/\/@fs\/|\/\.tmp\//);             // адреса сервера в файл не попадают
  // После перезагрузки — то же самое
  await page.reload();
  await expect(page.locator('.slide.on h2')).toHaveText('Заголовок из автотеста');
  expect(errors).toEqual([]);
});

test('Ctrl+Z отменяет правку и в файле', async ({ page }) => {
  await page.goto('/?deck=tpl&studio#5');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const before = readDeck('tpl');
  const title = page.locator('#st-canvas .slide h2[data-edit]').filter({ hasText: 'Коротко о' }).first();
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Временно');
  await page.keyboard.press('Escape');
  expect(await waitFile(() => readDeck('tpl').includes('title: Временно'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Z');
  expect(await waitFile(() => readDeck('tpl') === before)).toBe(true);
});

test('загрузка картинки: файл в assets/, адрес отдаётся сервером', async ({ page }) => {
  await page.goto('/?deck=tpl');
  const r = await api(page, 'asset?deck=tpl&name=' + encodeURIComponent('фото теста.png'), PNG);
  expect(r.status).toBe(200);
  expect(r.json.path).toMatch(/^\.\/assets\/.+\.png$/);
  expect(fs.existsSync(path.join(DECKS, 'tpl', r.json.path))).toBe(true);
  expect((await fetch(`http://localhost:5190${r.json.url}`)).status).toBe(200);
  // Тот же файл второй раз — без дубля
  const again = await api(page, 'asset?deck=tpl&name=' + encodeURIComponent('фото теста.png'), PNG);
  expect(again.json.path).toBe(r.json.path);
});

test('новая презентация и удаление в корзину', async ({ page }) => {
  await page.goto('/?all');
  const empty = await api(page, 'create?title=' + encodeURIComponent('Пустая из теста'));
  expect(empty.json.name).toBe('pustaya-iz-testa');
  expect(readDeck('pustaya-iz-testa').match(/^ {2}- id: /gm)).toHaveLength(1);       // только титул
  expect(fs.readdirSync(path.join(DECKS, 'pustaya-iz-testa', 'assets'))).toEqual(['logo.svg']);
  const full = await api(page, 'create?sample=1&title=' + encodeURIComponent('С примерами'));
  expect((readDeck(full.json.name).match(/^ {2}- id: /gm) ?? []).length).toBeGreaterThan(15);

  // Новая папка сама перезагружает страницу выбора — дожидаемся, а не перезагружаем вручную
  await expect(page.locator('.pk-card[data-name="pustaya-iz-testa"]')).toBeVisible({ timeout: 15_000 });
  const del = await api(page, 'delete?deck=pustaya-iz-testa');
  expect(del.status).toBe(200);
  expect(fs.existsSync(path.join(DECKS, 'pustaya-iz-testa'))).toBe(false);
  expect(fs.readdirSync(path.join(DECKS, '.trash')).some((d) => d.startsWith('pustaya-iz-testa-'))).toBe(true);
  await expect(page.locator('.pk-card[data-name="pustaya-iz-testa"]')).toHaveCount(0, { timeout: 15_000 });
});

test('запрос с чужого сайта не может править проект', async () => {
  const res = await fetch('http://localhost:5190/__htmlpptx/delete?deck=slideria', { method: 'POST', headers: { Origin: 'http://evil.example' } });
  expect(res.status).toBe(403);
  expect(fs.existsSync(deckFile('slideria'))).toBe(true);
});

test('импорт HTML по правилам: пробный прогон находит слайды и ничего не пишет', async ({ page }) => {
  await page.goto('/?all');
  const html = fs.readFileSync('docs/examples/example.html', 'utf8');
  const before = fs.readdirSync(DECKS).sort();
  const res = await fetch('http://localhost:5190/__htmlpptx/import?dry=1&file=example.html', { method: 'POST', body: html });
  const r = { status: res.status, json: await res.json() };
  expect(r.status).toBe(200);
  expect(r.json.dryRun).toBe(true);
  expect(r.json.slides).toBeGreaterThan(2);
  expect(fs.readdirSync(DECKS).sort()).toEqual(before);
});
