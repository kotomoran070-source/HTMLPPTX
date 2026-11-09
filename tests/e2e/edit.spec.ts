// Правка и сохранение: текст на месте → deck.yaml, картинки → assets/, новая презентация, корзина, импорт HTML
import fs from 'node:fs';
import http from 'node:http';
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
  await page.goto('/?deck=tpl&studio#7');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const before = readDeck('tpl');
  const title = page.locator('#st-canvas .slide h2[data-edit]').filter({ hasText: 'Цифры и' }).first();
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

test('удаление со страницы выбора: карточка уходит сразу, без перезагрузки; та же папка снова — видна и отслеживается', async ({ page }) => {
  const name = 'udalit-iz-testa';
  fs.cpSync(path.join(DECKS, 'design'), path.join(DECKS, name), { recursive: true });
  await page.goto('/?all');
  const card = page.locator(`.pk-card[data-name="${name}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  // Сколько всего — по заголовку библиотеки: на странице показана порция
  const count = async () => Number(await page.locator('#pk-count').textContent());
  const before = await count();
  // Метка в окне: перезагрузка страницы её сотрёт
  await page.evaluate(() => { (window as { zzStay?: number }).zzStay = 1; });
  // «Удалить…» — в меню «⋯» карточки
  await page.locator(`.pk-more[data-more="${name}"]`).click();
  await page.locator('.pk-menu [data-a="del"]').click();
  const t0 = Date.now();
  await page.locator('.pk-confirm [data-a="ok"]').click();
  await expect(card).toHaveCount(0, { timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect.poll(count).toBe(before - 1);
  await expect(page.locator('#pk-where')).toContainText(`${before - 1} `);
  expect(await page.evaluate(() => (window as { zzStay?: number }).zzStay)).toBe(1);
  expect(fs.existsSync(path.join(DECKS, name))).toBe(false);
  expect(fs.readdirSync(path.join(DECKS, '.trash')).some((d) => d.startsWith(`${name}-`))).toBe(true);
  // Та же папка снова: карточка появляется, правки её файла сервер замечает
  await page.waitForTimeout(3200);
  fs.cpSync(path.join(DECKS, 'design'), path.join(DECKS, name), { recursive: true });
  await expect(card).toBeVisible({ timeout: 15_000 });
  const file = path.join(DECKS, name, 'deck.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^title: .*$/m, 'title: Снова здесь'));
  // Карточки за краем экрана заполняются при прокрутке
  await expect(async () => {
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.pk-title')).toHaveText('Снова здесь', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  fs.rmSync(path.join(DECKS, name), { recursive: true, force: true });
});

test('запрос с чужого сайта не может править проект', async () => {
  const res = await fetch('http://localhost:5190/__htmlpptx/delete?deck=slideria', { method: 'POST', headers: { Origin: 'http://evil.example' } });
  expect(res.status).toBe(403);
  expect(fs.existsSync(deckFile('slideria'))).toBe(true);
});

/** Запрос к серверу тестов со своим заголовком Host (fetch его не меняет) */
function rawPost(pathname: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 5190, path: pathname, method: 'POST', headers: { Host: host, Origin: `http://${host}` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

test('подмена адреса (DNS rebinding): чужое имя, направленное на этот компьютер, не пускают', async () => {
  // Чужой сайт направил своё имя на 127.0.0.1: запрос идёт с этого компьютера, Origin совпадает с Host
  const name = 'zz-rebind';
  fs.cpSync(path.join(DECKS, 'design'), path.join(DECKS, name), { recursive: true });
  try {
    expect(await rawPost('/__htmlpptx/list', 'evil.example:5190')).toBe(403);
    expect(await rawPost(`/__htmlpptx/delete?deck=${name}`, 'evil.example:5190')).toBe(403);
    expect(await rawPost('/__slideria/remote/open?room=rebindroom1', 'evil.example:5190')).toBe(403);
    expect(fs.existsSync(path.join(DECKS, name, 'deck.yaml'))).toBe(true);
    // Свои адреса работают: localhost, 127.0.0.1 и IP-адрес (телефон в сети)
    expect(await rawPost('/__htmlpptx/list', 'localhost:5190')).toBe(200);
    expect(await rawPost('/__htmlpptx/list', '127.0.0.1:5190')).toBe(200);
    expect(await rawPost('/__htmlpptx/list', '[::1]:5190')).toBe(200);
  } finally {
    fs.rmSync(path.join(DECKS, name), { recursive: true, force: true });
  }
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

test('импорт HTML: «.slide .x» и класс секции оформляют свободные объекты, картинка заполняет рамку', async ({ page }) => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const html = `<!doctype html><html><head><style>
    .slide { display:grid; color:var(--tx) } .slide .title { font-size:48px } .dark .title { color:rgb(255, 0, 0) }
    .slide .photo { object-fit:cover; border-radius:16px }
  </style></head><body>
    <section class="slide dark" data-id="a" style="background:#0B1220">
      <h1 class="title" style="position:absolute; left:64px; top:60px; width:900px">Заголовок</h1>
      <img class="photo" src="${png}" style="position:absolute; left:64px; top:200px; width:194px; height:242px">
    </section></body></html>`;
  const name = 'zz-import-styles';
  try {
    const res = await fetch(`http://localhost:5190/__htmlpptx/import?deck=${name}&theme=0`, { method: 'POST', body: html });
    expect(res.status).toBe(200);
    await page.goto(`/?deck=${name}&show#1`);
    const slide = page.locator('.slide.on');
    await expect(slide).toHaveClass(/\bdark\b/);
    const title = slide.locator('h1.title');
    await expect(title).toHaveCSS('font-size', '48px');
    await expect(title).toHaveCSS('color', 'rgb(255, 0, 0)');
    const photo = slide.locator('img.photo');
    await expect(photo).toHaveCSS('object-fit', 'cover');
    // Размер картинки — её рамки (194×242 слайда), а не свой (1×1)
    const box = await photo.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]);
    expect(box).toEqual([194, 242]);
  } finally {
    fs.rmSync(path.join(DECKS, name), { recursive: true, force: true });
  }
});
