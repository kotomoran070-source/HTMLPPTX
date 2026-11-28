// Плагины (docs/PLUGINS.md): «Файл → Интеграции → Плагины» — список, включение с вопросом о разрешениях, удаление;
// кнопка в группе «Плагины» на «Инструментах» и Ctrl+K; панель рядом со слайдом — правка операциями (одна отмена,
// журнал), события, настройки; изоляция панели: команды студии, её страница, хранилища и сеть закрыты
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DECKS, readDeck, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

const DECK = 'plugdeck';
const ID = 'user:e2e-plugin';
const DIR = path.join(DECKS, 'plugins', 'e2e-plugin');
const STATE = path.join(DECKS, '.slideria', 'plugins.json');

const post = async (cmd: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`http://localhost:5190/__htmlpptx/${cmd}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};

function writePlugin(manifest: Record<string, unknown>, files: Record<string, string>): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'plugin.json'), JSON.stringify({ name: 'E2E плагин', description: 'Проверка плагинов', version: '1.0', author: 'Тесты', api: 1, icon: 'sparkle', panel: { file: 'panel.html', width: 300 }, ...manifest }));
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(DIR, f), text);
}

test.beforeEach(() => {
  fs.mkdirSync(path.join(DECKS, DECK), { recursive: true });
  fs.writeFileSync(path.join(DECKS, DECK, 'deck.yaml'), 'title: Плагины\nslides:\n  - template: canvas\n    free:\n      - {type: text, text: Первый объект, place: {x: 100, y: 100, w: 400}}\n');
});
test.afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.rmSync(path.join(DECKS, DECK), { recursive: true, force: true });
  fs.rmSync(path.join(DECKS, '.slideria', 'plugin-data'), { recursive: true, force: true });
  try {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8')) as Record<string, unknown>;
    delete st[ID];
    fs.writeFileSync(STATE, JSON.stringify(st));
  } catch { /* состояния ещё нет */ }
});

async function openPlugins(page: Page): Promise<void> {
  await page.locator('#st-file').click();
  await page.locator('.fp [data-fs="int"]').click();
  await page.locator('[data-sub="plugins"]').click();
}

test('плагин: включение — после вопроса о разрешениях; кнопка и Ctrl+K; правка из панели — одна отмена и журнал; события и настройки', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  writePlugin({ edit: true, button: { label: 'E2E', title: 'Панель E2E' } }, {
    'panel.html': '<p id="n"></p><p id="sel"></p><p id="chg">0</p><button class="primary" id="add">Добавить</button><script src="panel.js"></script>',
    'panel.js': `const $ = (id) => document.getElementById(id);
slideria.outline().then((o) => { $('n').textContent = 'слайдов ' + o.slides.length; });
slideria.on('selection', (s) => { $('sel').textContent = s.slide + ':' + s.objects.join(','); });
let c = 0; slideria.on('change', () => { $('chg').textContent = String(++c); });
$('add').onclick = () => slideria.apply({ op: 'object.add', slide: 1, object: { type: 'text', text: 'Из плагина', place: { x: 100, y: 300, w: 400 } } }, { label: 'надпись' })
  .then((r) => { document.body.dataset.done = String(r.changes.length); });
slideria.storage.set('k', { a: 1 }).then(() => slideria.storage.get('k')).then((v) => { document.body.dataset.store = JSON.stringify(v); });`,
  });
  await page.goto(`/?deck=${DECK}&studio#1`);
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Первый объект');
  // Выключенного плагина на ленте нет — и пустой группы «Плагины» тоже
  await page.locator('[data-tab="tools"]').click();
  await expect(page.locator('.st-rpanel[data-panel="tools"]')).toBeVisible();
  await expect(page.locator('#st-plug-group')).toBeHidden();
  await openPlugins(page);
  const card = page.locator(`[data-plugin-pick="${ID}"]`);
  await expect(card).toContainText('E2E плагин');
  await expect(card.locator('.ig-tag')).toHaveText('выключен');
  await expect(page.locator('.ig-perms')).toContainText('Править презентацию');
  await expect(page.locator('.ig-perms')).toContainText('Показывать панель рядом со слайдом');
  // Включить — сначала вопрос: «Отмена» оставляет выключенным
  const sw = page.locator(`[data-plugin-on="${ID}"]`);
  await sw.click();
  const dlg = page.locator('.ig-dlg');
  await expect(dlg).toContainText('Включить «E2E плагин»?');
  await expect(dlg.locator('.ig-dlg-item')).toHaveCount(2);
  await dlg.locator('[data-k="cancel"]').click();
  await expect(dlg).toHaveCount(0);
  await expect(sw).not.toBeChecked();
  expect((await post('plugins')).data.find((p: { id: string }) => p.id === ID).enabled).toBe(false);
  await sw.click();
  await page.locator('.ig-dlg [data-k="ok"]').click();
  await expect(card.locator('.ig-tag')).toHaveText('включён');
  const info = (await post('plugins')).data.find((p: { id: string }) => p.id === ID);
  expect([info.enabled, info.granted, info.needs]).toEqual([true, ['edit', 'panel'], []]);

  // «Открыть панель» — «Файл» закрывается, панель рядом со слайдом; кнопка на «Инструментах» горит
  await page.locator(`[data-plugin-open="${ID}"]`).click();
  await expect(page.locator('.fp')).toBeHidden();
  await expect(page.locator('#st-ppane')).toBeVisible();
  const frame = page.frameLocator('#st-ppane .st-pp-frame');
  await expect(frame.locator('#n')).toHaveText('слайдов 1');
  await expect(frame.locator('body')).toHaveAttribute('data-store', '{"a":1}');
  await page.locator('[data-tab="tools"]').click();
  await expect(page.locator(`#st-plugs [data-plugin="${ID}"]`)).toHaveAttribute('aria-pressed', 'true');

  // Правка из панели — на слайде, в файле, одним шагом отмены, в журнале от имени плагина; панель знает о правке
  await frame.locator('#add').click();
  await expect(frame.locator('body')).toHaveAttribute('data-done', '1');
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Из плагина');
  await expect(frame.locator('#chg')).not.toHaveText('0');
  await expect.poll(() => readDeck(DECK)).toContain('Из плагина');
  await expect.poll(async () => (await post(`journal?deck=${DECK}&limit=5`)).data[0]?.by).toEqual({ kind: 'plugin', name: 'E2E плагин', id: ID });
  await page.locator('#st-canvas').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('#st-canvas .slide.on')).not.toContainText('Из плагина');
  // Выделение на слайде — событием в панель
  await page.locator('#st-canvas .slide.on .free').first().click();
  await expect(frame.locator('#sel')).toHaveText('1:1');

  // Ctrl+K находит плагин
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('E2E плагин');
  await expect(page.locator('.st-pal-o').first()).toContainText('Плагин: E2E плагин');
  await page.keyboard.press('Escape');

  // Одна колонка на двоих: область анимации закрывает панель плагина, кнопка плагина — область анимации
  await page.locator('[data-tab="anim"]').click();
  await page.locator('[data-cmd="anim.order"]').click();
  await expect(page.locator('#st-apane')).toBeVisible();
  await expect(page.locator('#st-ppane')).toBeHidden();
  await page.locator('[data-tab="tools"]').click();
  await page.locator(`#st-plugs [data-plugin="${ID}"]`).click();
  await expect(page.locator('#st-ppane')).toBeVisible();
  await expect(page.locator('#st-apane')).toBeHidden();

  // Выключили — панель закрылась, кнопки нет
  await openPlugins(page);
  await page.locator(`[data-plugin-on="${ID}"]`).click();
  await expect(card.locator('.ig-tag')).toHaveText('выключен');
  await page.keyboard.press('Escape');
  await expect(page.locator('#st-ppane')).toBeHidden();
  await expect(page.locator('#st-plug-group')).toBeHidden();
  expect(errors).toEqual([]);
});

test('панель плагина изолирована: команды и страница студии, хранилища и сеть закрыты; без разрешения — не правит; ушла со своей страницы — закрыта', async ({ page }) => {
  writePlugin({}, {
    'panel.html': '<button id="go">Уйти</button><script src="panel.js"></script>',
    'panel.js': `const out = {};
const tryIt = async (k, f) => { try { await f(); out[k] = 'открыто'; } catch { out[k] = 'закрыто'; } };
(async () => {
  await tryIt('api', () => fetch('/__htmlpptx/plugins', { method: 'POST' }).then((r) => { if (!r.ok) throw new Error(); }));
  await tryIt('net', () => fetch('https://example.org/'));
  await tryIt('page', () => parent.document.title);
  await tryIt('storage', () => localStorage.getItem('x'));
  await tryIt('edit', () => slideria.apply({ op: 'slide.set', slide: 1, set: { title: 'x' } }));
  await tryIt('files', () => slideria.files.list());
  document.body.dataset.out = JSON.stringify(out);
})();
document.getElementById('go').onclick = () => { location.href = 'about:blank'; };`,
  });
  await post(`plugin-set?id=${encodeURIComponent(ID)}`, { enabled: true, granted: ['panel'] });
  await page.goto(`/?deck=${DECK}&studio#1`);
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Первый объект');
  await page.locator('[data-tab="tools"]').click();
  await page.locator(`#st-plugs [data-plugin="${ID}"]`).click();
  const frame = page.frameLocator('#st-ppane .st-pp-frame');
  await expect(frame.locator('body')).toHaveAttribute('data-out', JSON.stringify({ api: 'закрыто', net: 'закрыто', page: 'закрыто', storage: 'закрыто', edit: 'закрыто', files: 'закрыто' }));
  expect(readDeck(DECK)).not.toContain("title: x");
  // Сервер сам отказывает странице без адреса (рамке)
  expect((await post('plugins', undefined, { Origin: 'null' })).status).toBe(403);
  // Панель ушла со своей страницы — закрыта, данные ей больше не отдаются
  await frame.locator('#go').click();
  await expect(page.locator('#st-ppane')).toBeHidden();
  await expect(page.locator('#ed-toast')).toContainText('закрыта: переход на другую страницу');
});

test('файлы презентации: список, чтение, новый файл — сразу на слайде; пути — как в deck.yaml; код и чужие папки — нет; медиа — в самой панели', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  // Картинка 1×1 — уже лежит в презентации
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  fs.mkdirSync(path.join(DECKS, DECK, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DECKS, DECK, 'assets', 'old.png'), png);
  writePlugin({ edit: true, files: true }, {
    'panel.html': '<script src="panel.js"></script>',
    'panel.js': `(async () => {
  const out = {};
  out.list = (await slideria.files.list()).map((f) => f.path + ':' + f.size);
  const old = await slideria.files.read('./assets/old.png');
  out.read = [old instanceof Blob, old.size, old.type];
  const c = new OffscreenCanvas(40, 20);
  const g = c.getContext('2d'); g.fillStyle = '#e33'; g.fillRect(0, 0, 40, 20);
  out.path = (await slideria.files.add('из плагина.png', await c.convertToBlob({ type: 'image/png' }))).path;
  await slideria.apply({ op: 'object.add', slide: 1, object: { type: 'image', src: out.path, place: { x: 600, y: 100, w: 200 } } });
  out.deck = JSON.stringify(await slideria.deck()).match(/"src":"([^"]+)"/)?.[1];
  const no = async (f) => { try { await f(); return 'можно'; } catch { return 'нельзя'; } };
  out.code = await no(() => slideria.files.add('x.html', '<script>1</script>'));
  out.out = await no(() => slideria.files.read('./assets/../deck.yaml'));
  out.other = await no(() => slideria.files.read('../other/assets/a.png'));
  out.codecs = typeof VideoEncoder === 'function' && typeof AudioDecoder === 'function';
  const w = new Worker(URL.createObjectURL(new Blob(['onmessage = (e) => postMessage(e.data * 2)'], { type: 'text/javascript' })));
  out.worker = await new Promise((ok) => { w.onmessage = (e) => ok(e.data); w.onerror = () => ok('ошибка'); w.postMessage(21); });
  out.wasm = await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => 'да', () => 'нет');
  document.body.dataset.out = JSON.stringify(out);
})().catch((e) => { document.body.dataset.out = 'ошибка: ' + e.message; });`,
  });
  await post(`plugin-set?id=${encodeURIComponent(ID)}`, { enabled: true, granted: ['edit', 'files', 'panel'] });
  await page.goto(`/?deck=${DECK}&studio#1`);
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Первый объект');
  await page.locator('[data-tab="tools"]').click();
  await page.locator(`#st-plugs [data-plugin="${ID}"]`).click();
  const body = page.frameLocator('#st-ppane .st-pp-frame').locator('body');
  await expect(body).toHaveAttribute('data-out', /\{/);
  const out = JSON.parse(await body.getAttribute('data-out') ?? '{}');
  expect(out).toEqual({
    list: [`./assets/old.png:${png.length}`], read: [true, png.length, 'image/png'],
    path: './assets/из-плагина.png', deck: './assets/из-плагина.png',
    code: 'нельзя', out: 'нельзя', other: 'нельзя', codecs: true, worker: 42, wasm: 'да',
  });
  // Новый файл — в папке презентации и сразу на слайде; в deck.yaml — путем
  expect(fs.existsSync(path.join(DECKS, DECK, 'assets', 'из-плагина.png'))).toBe(true);
  const img = page.locator('#st-canvas .slide.on img').first();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(40);
  await expect.poll(() => readDeck(DECK)).toContain('./assets/из-плагина.png');
  // В разрешениях — и файлы
  await openPlugins(page);
  await expect(page.locator('.ig-perms')).toContainText('Читать и добавлять файлы презентации');
  expect(errors).toEqual([]);
});

test('новое разрешение в обновлении — плагин не работает, пока его не разрешат; удалить — папка в корзину проекта', async ({ page }) => {
  writePlugin({ edit: true }, { 'panel.html': '<p>Панель</p>' });
  await post(`plugin-set?id=${encodeURIComponent(ID)}`, { enabled: true, granted: ['edit', 'panel'] });
  // Обновление попросило сеть — кнопки нет, в «Плагинах» — просьба
  writePlugin({ edit: true, network: ['api.example.org'] }, { 'panel.html': '<p>Панель</p>' });
  expect((await post('plugins')).data.find((p: { id: string }) => p.id === ID).needs).toEqual(['net:api.example.org']);
  await page.goto(`/?deck=${DECK}&studio#1`);
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Первый объект');
  await openPlugins(page);
  await expect(page.locator(`[data-plugin-pick="${ID}"] .ig-tag`)).toHaveText('нужно разрешение');
  await expect(page.locator('#st-plug-group')).toBeHidden();
  // «Разрешить…» — вопрос и с новым адресом
  await page.locator(`[data-plugin-allow="${ID}"]`).click();
  await expect(page.locator('.ig-dlg h2')).toHaveText('Разрешения для «E2E плагин»');
  await expect(page.locator('.ig-dlg')).toContainText('api.example.org');
  await page.locator('.ig-dlg [data-k="ok"]').click();
  await expect(page.locator('#ed-toast')).toContainText('Разрешения плагина «E2E плагин» обновлены');
  await expect(page.locator(`[data-plugin-pick="${ID}"] .ig-tag`)).toHaveText('включён');
  await expect(page.locator('#st-plug-group')).toBeAttached();
  expect((await post('plugins')).data.find((p: { id: string }) => p.id === ID).needs).toEqual([]);

  // Удалить — после вопроса; папка — в .trash; список пуст — подсказка, куда класть плагины
  await page.locator('.ig-side [data-a="del-plugin"]').click();
  await expect(page.locator('.ig-dlg')).toContainText('Удалить плагин?');
  await page.locator('.ig-dlg [data-k="ok"]').click();
  await expect(page.locator('.ig-hero')).toContainText('Нет установленных плагинов');
  expect(fs.existsSync(DIR)).toBe(false);
  const trash = fs.readdirSync(path.join(DECKS, '.trash')).filter((d) => d.startsWith('plugins-'));
  expect(trash.some((d) => fs.existsSync(path.join(DECKS, '.trash', d, 'e2e-plugin', 'plugin.json')))).toBe(true);
  for (const d of trash) fs.rmSync(path.join(DECKS, '.trash', d), { recursive: true, force: true });
});
