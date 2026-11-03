// MCP (server/mcp.ts, scripts/mcp.mjs) глазами настоящего клиента — официальной библиотеки MCP: рукопожатие,
// инструменты, правка с ревизиями, ошибки агенту, экспорт; открытая студия (server/running.ts) — правки через её
// сервер, событие окнам; студия закрылась — правки в файлы
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createDecksCore } from '../../server/core';
import { createHandler } from '../../server/http';
import { announce, runningServer } from '../../server/running';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DECK = `title: Доклад
slides:
  - id: cover
    template: canvas
    free:
      - {type: text, text: Старый заголовок, place: {x: 80, y: 80, w: 600}}
  - id: end
    title: Спасибо
`;

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let tmp = '';
let dir = '';
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args }) as { content: { type: string; text: string }[]; isError?: boolean };
  const text = r.content[0]?.text ?? '';
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* текст */ }
  return { error: !!r.isError, text, data: data as Record<string, unknown> & unknown[] };
};

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-mcp-'));
  dir = path.join(tmp, 'decks');
  fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), DECK);
  client = new Client({ name: 'slideria-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'scripts', 'mcp.mjs'), `--decks=${dir}`], cwd: tmp, stderr: 'pipe' }));
});

test.afterAll(async () => {
  await client?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('рукопожатие и инструменты: описание правки — из каталога операций', async () => {
  expect(client.getServerVersion()).toMatchObject({ name: 'slideria' });
  expect(client.getInstructions()).toContain('read_presentation');
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(['list_presentations', 'read_presentation', 'edit_presentation', 'create_presentation', 'export_html', 'format_guide']);
  const edit = tools.find((t) => t.name === 'edit_presentation')!;
  for (const op of ['deck.set', 'slide.add', 'object.set', 'text.replace']) expect(edit.description).toContain(op);
  expect(tools.find((t) => t.name === 'read_presentation')!.annotations?.readOnlyHint).toBe(true);
});

test('читать и править: ревизия, все или ни одной, ошибка — агенту текстом', async () => {
  const list = await call('list_presentations');
  expect(list.data).toEqual([expect.objectContaining({ name: 'talk', title: 'Доклад', slides: 2 })]);
  const ol = await call('read_presentation', { presentation: 'talk' });
  const rev = (ol.data.slides as { rev: string }[])[0].rev;
  const r = await call('edit_presentation', {
    presentation: 'talk',
    ops: [{ op: 'object.set', slide: 'cover', object: 1, set: { text: 'Новый заголовок' } }, { op: 'slide.set', slide: 2, set: { notes: 'Вопросы' } }],
    expect: [{ slide: 1, rev }],
  });
  expect(r.error).toBe(false);
  expect(r.data.changes).toEqual(['Правка объекта · слайд 1', 'Правка слайда 2']);
  expect((r.data.slides as { rev: string }[])[0].rev).not.toBe(rev);
  expect(r.data.studio).toBeUndefined();
  expect(fs.readFileSync(path.join(dir, 'talk', 'deck.yaml'), 'utf8')).toContain('Новый заголовок');
  // Старая ревизия — отказ, текстом для агента
  const stale = await call('edit_presentation', { presentation: 'talk', ops: [{ op: 'object.remove', slide: 1, object: 1 }], expect: [{ slide: 1, rev }] });
  expect(stale.error).toBe(true);
  expect(stale.text).toContain('Слайд 1 изменился');
  expect((await call('edit_presentation', { presentation: 'nope', ops: [] })).text).toBe('Нет презентации «nope». Есть: talk');
  expect((await call('read_presentation', { presentation: 'talk', slide: 'end' })).data).toMatchObject({ n: 2, id: 'end', data: { title: 'Спасибо', notes: 'Вопросы' } });
  await expect(client.callTool({ name: 'zoom', arguments: {} })).rejects.toThrow(/zoom/);
});

test('новая презентация, справка по формату, экспорт в HTML', async () => {
  const c = await call('create_presentation', { title: 'План работ' });
  expect(c.error).toBe(false);
  expect(fs.existsSync(path.join(dir, String(c.data.name), 'deck.yaml'))).toBe(true);
  expect((await call('format_guide')).text).toContain('template: canvas');
  const out = path.join(tmp, 'out', 'talk.html');
  const x = await call('export_html', { presentation: 'talk', path: out });
  expect(x.error, x.text).toBe(false);
  expect(x.data).toEqual({ path: out, size: fs.statSync(out).size });
  expect(fs.readFileSync(out, 'utf8')).toContain('<meta name="slideria-deck" content="talk">');
  expect((await call('export_html', { presentation: 'talk', path: 'talk.html' })).text).toBe('path — полный путь к файлу .html');
});

test('открыта студия — правка через её сервер, окна получают событие; студия закрылась — снова в файлы', async () => {
  const studio = createDecksCore({ dir, root: ROOT });
  const events: string[] = [];
  studio.on('saved', (e) => events.push(`${e.name}:${e.from}`));
  const handle = createHandler(studio);
  const server = http.createServer((req, res) => handle(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const leave = announce(dir, server.address() as AddressInfo);
  expect(runningServer(dir)).toBe(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

  const r = await call('edit_presentation', { presentation: 'talk', ops: [{ op: 'slide.set', slide: 2, set: { title: 'Через студию' } }] });
  expect(r.error, r.text).toBe(false);
  expect(r.data.studio).toBeTruthy();
  expect(events).toEqual(['talk:mcp']);

  // Студия закрылась (запись осталась от упавшего процесса — адрес не отвечает): правка — в файлы
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  const r2 = await call('edit_presentation', { presentation: 'talk', ops: [{ op: 'slide.set', slide: 2, set: { title: 'Без студии' } }] });
  expect(r2.error, r2.text).toBe(false);
  expect(r2.data.studio).toBeUndefined();
  expect(fs.readFileSync(path.join(dir, 'talk', 'deck.yaml'), 'utf8')).toContain('Без студии');
  leave();
  expect(fs.existsSync(path.join(dir, '.slideria-server.json'))).toBe(false);
});
