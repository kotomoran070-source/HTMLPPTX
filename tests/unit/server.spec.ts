// Сервер Slideria без Vite: ядро (server/core.ts) и HTTP-обработчик (server/http.ts) на голом node:http —
// команды проекта, слияние правок двух окон, контрольные точки, файлы, корзина, библиотека, защита.
// И сторож: в server/ нет Vite — тем же сервером пользуются программа, команды для MCP и облако
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createDecksCore, type DecksCore } from '../../server/core';
import { createHandler } from '../../server/http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const DECK = `title: Проверка
lang: ru
slides:
  - id: one
    title: Первый
    notes: Старые заметки
  - id: two
    title: Второй
    image: ./assets/dot.png
`;

let tmp = '';
let core: DecksCore;
let server: http.Server;
let base = '';
const events: string[] = [];

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-server-'));
  const deck = path.join(tmp, 'decks', 'check');
  fs.mkdirSync(path.join(deck, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(deck, 'deck.yaml'), DECK);
  fs.writeFileSync(path.join(deck, 'assets', 'dot.png'), PNG);
  core = createDecksCore({ dir: path.join(tmp, 'decks'), root: ROOT, fonts: path.join(tmp, 'fonts'), library: path.join(tmp, 'library') });
  core.on('saved', (e) => events.push(`saved:${e.name}:${e.from}`));
  core.on('removed', (e) => events.push(`removed:${e.name}`));
  const handle = createHandler(core);
  server = http.createServer((req, res) => handle(req, res, () => { res.statusCode = 404; res.end('чужой адрес'); }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = async (cmd: string, body?: unknown, headers: Record<string, string> = {}) => {
  const raw = body instanceof Buffer || typeof body === 'string';
  const r = await fetch(`${base}/__htmlpptx/${cmd}`, { method: 'POST', headers, body: body === undefined ? undefined : raw ? body as BodyInit : JSON.stringify(body) });
  const text = await r.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* не JSON */ }
  return { status: r.status, data: data as Record<string, unknown> & unknown[] };
};

test('в server/ нет Vite: ни импорта, ни типов', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'server'))) {
    const src = fs.readFileSync(path.join(ROOT, 'server', f), 'utf8');
    expect(src, f).not.toMatch(/from\s+['"]vite['"]|import\(['"]vite['"]\)|require\(['"]vite['"]\)/);
  }
});

test('список, данные с адресами файлов, новая презентация из шаблона', async () => {
  const list = await call('list');
  expect(list.status).toBe(200);
  expect(list.data.map((d: { name: string }) => d.name)).toEqual(['check']);
  const read = await call('read?deck=check');
  const slides = (read.data as unknown as { slides: { image?: string }[] }).slides;
  // Путь из deck.yaml — адресом, по которому страница возьмёт файл
  expect(slides[1].image).toMatch(/^\/@fs\/.+\/check\/assets\/dot\.png$/);
  // Без адресов — как в файле
  expect((core.read('check') as { slides: { image?: string }[] }).slides[1].image).toBe('./assets/dot.png');
  const made = await call(`create?title=${encodeURIComponent('Отчёт за "квартал"')}&sample=0`);
  expect(made.data).toEqual({ name: 'otchet-za-kvartal' });
  const yaml = fs.readFileSync(path.join(core.dir, 'otchet-za-kvartal', 'deck.yaml'), 'utf8');
  expect(yaml).toContain('Отчёт за \\"квартал\\"');
  // Пустая презентация — один титульный слайд и логотип
  expect([...yaml.matchAll(/\n {2}- id: /g)]).toHaveLength(1);
  expect(fs.readdirSync(path.join(core.dir, 'otchet-za-kvartal', 'assets'))).toEqual(['logo.svg']);
  // То же имя — с номером
  expect((await call(`create?title=${encodeURIComponent('Отчёт за "квартал"')}`)).data).toEqual({ name: 'otchet-za-kvartal-2' });
});

test('запись: правки двух окон сливаются, окну возвращается итог с чужими, остальным — событие', async () => {
  const start = core.read('check', { urls: true }) as { title: string; slides: { title: string; notes?: string; image?: string }[] };
  // Окно докладчика поменяло заметки и записало
  const a = structuredClone(start);
  a.slides[0].notes = 'Заметки с показа';
  const first = await call('save?deck=check&from=presenter', { deck: a, base: start });
  expect(first.data).toMatchObject({ ok: true, changed: true });
  // Студия начинала с той же версии и поменяла заголовок второго слайда
  const b = structuredClone(start);
  b.slides[1].title = 'Второй — новый';
  const second = await call('save?deck=check&from=studio', { deck: b, base: start });
  expect(second.data).toMatchObject({ ok: true, changed: true });
  // Студии вернулись чужие правки — заметки из окна докладчика
  expect((second.data.deck as typeof start).slides[0].notes).toBe('Заметки с показа');
  const yaml = fs.readFileSync(core.deckFile('check'), 'utf8');
  expect(yaml).toContain('Заметки с показа');
  expect(yaml).toContain('Второй — новый');
  // Адрес картинки снова записан путём рядом с презентацией
  expect(yaml).toContain('image: ./assets/dot.png');
  expect(events).toEqual(['saved:check:presenter', 'saved:check:studio']);
  // Запись — своя: наблюдение за файлами страницу не перезагружает
  expect(core.wrote(core.deckFile('check'))).toBe(true);
  expect(core.ownWrite(core.deckFile('check'), yaml)).toBe(true);
  // То же самое ещё раз — файл не трогается
  const again = await call('save?deck=check&from=studio', { deck: core.read('check', { urls: true }) });
  expect(again.data).toMatchObject({ changed: false });
});

test('контрольные точки: та же, что последняя, не повторяется; данные точки читаются', async () => {
  const cp = await call('checkpoint?deck=check');
  expect(cp.data).toMatchObject({ same: false });
  expect((await call('checkpoint?deck=check')).data).toMatchObject({ id: cp.data.id, same: true });
  const list = await call('checkpoints?deck=check');
  expect(list.data.map((x: { id: string }) => x.id)).toEqual([cp.data.id]);
  const back = await call(`checkpoint-read?deck=check&id=${cp.data.id}`);
  expect((back.data.deck as { title: string }).title).toBe('Проверка');
  expect((await call('checkpoint-read?deck=check&id=../../etc')).status).toBe(400);
});

test('файлы: тот же файл не повторяется, чужое расширение — отказ, неиспользуемые — в корзину', async () => {
  const up = await call('asset?deck=check&name=Моя картинка.png', PNG, { 'Content-Type': 'application/octet-stream' });
  // Такой файл уже есть под другим именем — используется он
  expect(up.data).toMatchObject({ path: './assets/dot.png' });
  const other = Buffer.concat([PNG, Buffer.from([0])]);
  const second = await call('asset?deck=check&name=Моя картинка.png', other);
  expect(second.data).toMatchObject({ path: './assets/Моя-картинка.png' });
  expect((await call('asset?deck=check&name=evil.exe', PNG)).data).toMatchObject({ error: expect.stringContaining('Поддерживаются') });
  const files = await call('assets-list?deck=check');
  expect(files.data.map((f: { path: string }) => f.path).sort()).toEqual(['assets/dot.png', 'assets/Моя-картинка.png'].sort());
  // Только свои файлы: выход из папки assets/ не срабатывает
  const moved = await call('assets-trash?deck=check', ['assets/Моя-картинка.png', 'assets/../deck.yaml', '../other']);
  expect(moved.data).toEqual({ moved: 1 });
  expect(fs.existsSync(core.deckFile('check'))).toBe(true);
});

test('своя библиотека: запись, список, удаление; id — только простой', async () => {
  expect((await call('library-put?kind=themes&id=night', { id: 'night', name: 'Ночь' })).data).toEqual({ ok: true });
  expect((await call('library')).data).toMatchObject({ themes: [{ id: 'night', name: 'Ночь' }], templates: [] });
  expect((await call('library-put?kind=themes&id=../x', { id: '../x' })).status).toBe(400);
  expect((await call('library-put?kind=themes&id=day', { id: 'other' })).data).toMatchObject({ error: 'Запись не совпадает с id' });
  await call('library-delete?kind=themes&id=night');
  expect((await call('library')).data).toMatchObject({ themes: [] });
});

test('защита: только POST, только свои страницы, только своё имя сервера; ошибки — понятные', async () => {
  expect((await fetch(`${base}/__htmlpptx/list`)).status).toBe(405);
  expect((await call('list', undefined, { Origin: 'http://evil.example' })).status).toBe(403);
  // Чужое имя, направленное на этот компьютер (DNS rebinding), не доходит ни до одной команды
  const rebinding = await new Promise<number>((done) => {
    const req = http.request(`${base}/__htmlpptx/list`, { method: 'POST', headers: { Host: 'evil.example' } }, (res) => { res.resume(); done(res.statusCode ?? 0); });
    req.end();
  });
  expect(rebinding).toBe(403);
  expect((await call('save?deck=nope', { deck: {} })).data).toEqual({ error: 'Презентация «nope» не найдена' });
  expect((await call('nonsense?deck=check')).status).toBe(404);
  // Что не команда проекта — дальше по цепочке (здесь — 404 тестового сервера)
  expect(await (await fetch(`${base}/some/page`)).text()).toBe('чужой адрес');
});

test('удаление: папка уходит в корзину, а не стирается; страницам — событие', async () => {
  const r = await call('delete?deck=otchet-za-kvartal-2');
  expect(r.data.trashed).toMatch(/^decks\/\.trash\/otchet-za-kvartal-2-\d{8}-\d{6}$/);
  expect(fs.existsSync(path.join(tmp, r.data.trashed as string, 'deck.yaml'))).toBe(true);
  expect(core.names()).not.toContain('otchet-za-kvartal-2');
  expect(events).toContain('removed:otchet-za-kvartal-2');
});
