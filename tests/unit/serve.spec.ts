// Сервер программы без Vite (server/serve.ts): страница и код собранной студии, данные для страниц, файлы
// презентаций (кусками и с проверкой «не изменился ли»), защита от выхода из папок, уведомления по WebSocket
// (server/events.ts) и слежение за папкой презентаций (server/watch.ts)
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startServer, type Served } from '../../server/serve';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const DECK = 'title: Проверка\nslides:\n  - id: one\n    title: Первый\n    image: ./assets/dot.png\n';

let tmp = '';
let decks = '';
let served: Served;

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-serve-'));
  decks = path.join(tmp, 'decks');
  const deck = path.join(decks, 'check');
  fs.mkdirSync(path.join(deck, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(deck, 'deck.yaml'), DECK);
  fs.writeFileSync(path.join(deck, 'assets', 'dot.png'), PNG);
  fs.writeFileSync(path.join(deck, 'assets', 'big.bin'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  // Собранная студия — маленькая подделка: index.html и файлы с отпечатком в имени
  const studio = path.join(tmp, 'code', 'studio');
  fs.mkdirSync(path.join(studio, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(studio, 'index.html'), '<!DOCTYPE html>\n<html lang="ru">\n<head>\n<title>Презентация</title>\n</head>\n<body></body>\n</html>\n');
  fs.writeFileSync(path.join(studio, 'assets', 'index-Ab12_c.js'), 'console.log(1)');
  fs.writeFileSync(path.join(studio, 'assets', 'script-worker-q-5w8WLP.js'), 'self.onmessage = () => {}');
  fs.writeFileSync(path.join(tmp, 'code', 'licenses.json'), JSON.stringify({ packages: [{ name: 'some-lib', version: '1.2.3', license: 'MIT', text: 'Текст some-lib' }] }));
  served = await startServer({
    dir: decks, root: ROOT, studio, fonts: path.join(tmp, 'fonts'), library: path.join(tmp, 'library'),
    port: 0, env: { app: true, decks: 'Документы/Slideria/' }, log: () => {},
  });
});

test.afterAll(async () => {
  await served.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = (p: string, headers: Record<string, string> = {}) => fetch(served.url + p, { headers });

test('страница студии: настройки страниц и адрес для слайдов со звуком вписаны; код — в кэш навсегда, песочница скриптов закрыта', async () => {
  const r = await get('/?deck=check&studio');
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-cache');
  const html = await r.text();
  const env = /<meta name="slideria-env" content="([^"]+)">/.exec(html)?.[1].replace(/&quot;/g, '"');
  expect(JSON.parse(env!)).toEqual({ app: true, decks: 'Документы/Slideria/' });
  expect(html).toMatch(/<meta name="slideria-frame-host" content="http:\/\/127\.0\.0\.1:\d+\/">/);
  const js = await get('/assets/index-Ab12_c.js');
  expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
  expect(js.headers.get('cache-control')).toContain('immutable');
  expect(js.headers.get('content-security-policy')).toBeNull();
  const worker = await get('/assets/script-worker-q-5w8WLP.js');
  expect(worker.headers.get('content-security-policy')).toBe("default-src 'none'; script-src 'self' blob:; connect-src 'none'");
  expect((await get('/assets/нет.js')).status).toBe(404);
  // Лицензии: данные страницы — библиотеки сервера и те, что внутри собранной студии, с текстами; старый адрес
  // страницы ведёт на новую
  const lic = await (await get('/__slideria/licenses/data')).json() as { items: { name: string; license: string; text: string; where?: string[] }[] };
  expect(lic.items[0]).toMatchObject({ name: 'Slideria', license: 'MIT' });
  expect(lic.items).toContainEqual(expect.objectContaining({ name: 'some-lib', license: 'MIT', text: 'Текст some-lib', where: ['pg'] }));
  expect(lic.items.find((p) => p.name === 'yaml')?.where).toContain('srv');
  const old = await fetch(served.url + '/__slideria/licenses', { redirect: 'manual' });
  expect(old.status).toBe(302);
  expect(old.headers.get('location')).toBe('/?licenses');
});

test('данные для страниц: список, презентация с адресами файлов, файл по этому адресу; ошибка в YAML — текстом', async () => {
  expect(await (await get('/__slideria/decks')).json()).toEqual([expect.objectContaining({ name: 'check' })]);
  const deck = await (await get('/__slideria/deck/check')).json() as { slides: { image: string }[] };
  const url = deck.slides[0].image;
  expect(url).toMatch(/^\/@fs\/.+\/check\/assets\/dot\.png$/);
  const img = await get(url);
  expect(img.status).toBe(200);
  expect(img.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
  // Не изменился — 304 без тела
  expect((await get(url, { 'if-none-match': img.headers.get('etag')! })).status).toBe(304);
  expect((await get('/__slideria/deck/nope')).status).toBe(404);
  expect((await fetch(served.url + '/__slideria/deck/check', { method: 'POST' })).status).toBe(405);
  fs.mkdirSync(path.join(decks, 'broken'));
  fs.writeFileSync(path.join(decks, 'broken', 'deck.yaml'), 'title: [не закрыто\n');
  const bad = await get('/__slideria/deck/broken');
  expect(bad.status).toBe(422);
  expect((await bad.json() as { error: string }).error).toMatch(/deck\.yaml/);
  fs.rmSync(path.join(decks, 'broken'), { recursive: true });
});

test('файлы кусками (перемотка видео): Range → 206 с нужными байтами, вне файла — 416', async () => {
  const deck = await (await get('/__slideria/deck/check')).json() as { slides: { image: string }[] };
  const url = deck.slides[0].image.replace('dot.png', 'big.bin');
  const r = await get(url, { range: 'bytes=10-19' });
  expect(r.status).toBe(206);
  expect(r.headers.get('content-range')).toBe('bytes 10-19/1000');
  expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const tail = await get(url, { range: 'bytes=-3' });
  expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([229, 230, 231]);
  expect((await get(url, { range: 'bytes=5000-' })).status).toBe(416);
});

test('только папки презентаций и шрифтов: чужие файлы, служебные папки и выход наверх — нет', async () => {
  const fsUrl = (p: string) => '/@fs/' + p.split(path.sep).join('/').replace(/^\/+/, '');
  fs.mkdirSync(path.join(decks, '.slideria'), { recursive: true });
  fs.writeFileSync(path.join(decks, '.slideria', 'secret.json'), '{}');
  fs.writeFileSync(path.join(tmp, 'outside.txt'), 'секрет');
  for (const p of [
    fsUrl(path.join(tmp, 'outside.txt')),
    fsUrl(path.join(decks, '.slideria', 'secret.json')),
    fsUrl(path.join(decks, 'check')) + '/../../outside.txt',
    fsUrl(path.join(decks, 'check')) + '/%2e%2e/%2e%2e/outside.txt',
    '/server/serve.ts',
    '/package.json',
    '/assets/../index.html/../../licenses.json',
  ]) {
    const r = await get(p);
    expect(r.status, p).toBe(404);
  }
  // Чужое имя сервера (подмена адреса) — отказ до всех обработчиков
  const r = await new Promise<number>((done) => {
    http.get(served.url + '/', { headers: { host: 'evil.example' } }, (res) => { res.resume(); done(res.statusCode ?? 0); });
  });
  expect(r).toBe(403);
});

/** Подключиться к уведомлениям; ответ — полученные события и закрыть */
async function listen(): Promise<{ got: { type: string; data: unknown }[]; wait: (type: string, ms?: number) => Promise<unknown>; close: () => void }> {
  const ws = new WebSocket(served.url.replace(/^http/, 'ws') + '/__slideria/events');
  const got: { type: string; data: unknown }[] = [];
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('нет соединения')); });
  const wait = async (type: string, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = got.find((g) => g.type === type);
      if (hit) return hit.data;
      if (Date.now() > end) throw new Error(`Нет события ${type}: ${JSON.stringify(got)}`);
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  return { got, wait, close: () => ws.close() };
}

test('уведомления: запись окна, правка файла со стороны, новая и удалённая презентация; свои записи — не «со стороны»', async () => {
  const ev = await listen();
  try {
    // Запись окна студии: событие записи, но не «поменяли со стороны» (запись — своя)
    const deck = await (await get('/__slideria/deck/check')).json() as { title: string };
    const save = await fetch(`${served.url}/__htmlpptx/save?deck=check&from=w1`, { method: 'POST', body: JSON.stringify({ deck: { ...deck, title: 'Новое' }, base: deck }) });
    expect(save.status).toBe(200);
    expect(await ev.wait('deck-saved')).toEqual({ name: 'check', from: 'w1' });
    await new Promise((r) => setTimeout(r, 400));
    expect(ev.got.filter((g) => g.type === 'deck-changed')).toEqual([]);
    // Правка deck.yaml текстовым редактором
    fs.writeFileSync(path.join(decks, 'check', 'deck.yaml'), fs.readFileSync(path.join(decks, 'check', 'deck.yaml'), 'utf8').replace('Новое', 'Руками'));
    const changed = await ev.wait('deck-changed') as { name: string; rev: string };
    expect(changed.name).toBe('check');
    // Версия в уведомлении — та же, что у данных, которые страница возьмёт теперь: открытая после правки
    // страница по ней поймёт, что перезагружаться не нужно
    expect((await get('/__slideria/deck/check')).headers.get('x-slideria-rev')).toBe(changed.rev);
    // Положили папку новой презентации
    fs.mkdirSync(path.join(decks, 'fresh'));
    fs.writeFileSync(path.join(decks, 'fresh', 'deck.yaml'), 'title: Свежая\nslides:\n  - title: Один\n');
    expect(await ev.wait('decks')).toEqual({ added: ['fresh'], removed: [] });
    // Удаление из студии: событие удаления; «список поменялся» об этом не приходит — страницы убрали карточку сами
    ev.got.length = 0;
    expect((await fetch(`${served.url}/__htmlpptx/delete?deck=fresh`, { method: 'POST' })).status).toBe(200);
    expect(await ev.wait('deck-removed')).toEqual({ name: 'fresh' });
    await new Promise((r) => setTimeout(r, 600));
    expect(ev.got.filter((g) => g.type === 'decks')).toEqual([]);
  } finally {
    ev.close();
  }
});

/** Запрос на переход к WebSocket с такими заголовками: код ответа сервера */
const upgrade = (headers: Record<string, string>) => new Promise<number>((done) => {
  const req = http.request(served.url + '/__slideria/events', {
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
  });
  req.on('upgrade', (_res, socket) => { socket.destroy(); done(101); });
  req.on('response', (res) => { res.resume(); done(res.statusCode ?? 0); });
  req.end();
});

test('уведомления — только своим страницам этого компьютера: чужой источник, телефон и чужое имя сервера — отказ', async () => {
  expect(await upgrade({})).toBe(101);
  expect(await upgrade({ Origin: served.url })).toBe(101);
  expect(await upgrade({ Origin: 'http://evil.example' })).toBe(403);
  expect(await upgrade({ 'x-slideria-lan': '192.168.1.5' })).toBe(403);
  expect(await upgrade({ Host: 'evil.example' })).toBe(403);
});

test('запись о себе для MCP: есть, пока сервер работает', async () => {
  const file = path.join(decks, '.slideria', 'server.json');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).url).toBe(served.url);
});
