// Пульт с телефона: пересылка сообщений между окнами и правила входа в сеть в приложении
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { remoteRelay } from '../../plugins/remote-relay.mjs';
// @ts-expect-error — модуль приложения на JS, без типов
import { allowed } from '../../desktop/lan.mjs';

test.describe('пересылка сообщений пульта', () => {
  let server: http.Server;
  let base = '';
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (!remoteRelay(req, res, () => ({ port: 5180, localOnly: true }))) { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/__slideria/remote/`;
  });
  test.afterAll(() => { server.closeAllConnections(); server.close(); });

  test('сообщение доходит до всех, кто слушает комнату', async () => {
    const got: string[] = [];
    const ctrl = new AbortController();
    const res = await fetch(`${base}events?room=testroom123`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const listen = (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        got.push(dec.decode(value));
        if (got.join('').includes('"go"')) break;
      }
    })();
    await new Promise((r) => setTimeout(r, 100));
    const sent = await fetch(`${base}send?room=testroom123`, { method: 'POST', body: JSON.stringify({ t: 'go', i: 3 }) }).then((r) => r.json());
    expect(sent).toEqual({ ok: true, peers: 1 });
    await listen;
    ctrl.abort();
    expect(got.join('')).toContain('data: {"t":"go","i":3}');
  });

  test('неверный код комнаты и не-JSON отклоняются', async () => {
    expect((await fetch(`${base}send?room=../x`, { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await fetch(`${base}send?room=testroom123`, { method: 'POST', body: 'привет' })).status).toBe(400);
  });

  test('info: сервер только для этого компьютера — адресов для телефона нет', async () => {
    expect(await fetch(`${base}info`).then((r) => r.json())).toMatchObject({ urls: [], localOnly: true });
  });
});

test.describe('вход для телефона в приложении: видна только показываемая презентация', () => {
  const decks = 'C:/Users/Иван/Documents/Slideria';
  const req = (url: string, method = 'GET') => ({ url, method });
  const ok = (url: string, method?: string) => allowed(req(url, method), decks, 'demo');

  test('показ, движок и файлы нужной презентации — можно', () => {
    expect(ok('/?deck=demo&view=presenter')).toBe(true);
    expect(ok('/src/main.ts')).toBe(true);
    expect(ok(`/@fs/${decks}/demo/deck.yaml?import`)).toBe(true);
    expect(ok(`/@fs/${encodeURI(decks)}/demo/assets/photo.png`)).toBe(true);
    expect(ok('/__slideria/remote/send?room=abcdefgh', 'POST')).toBe(true);
  });

  test('другие презентации, правка и обходные пути — нельзя', () => {
    expect(ok(`/@fs/${decks}/secret/deck.yaml`)).toBe(false);
    expect(ok(`/@fs/${decks.toLowerCase()}/secret/deck.yaml`)).toBe(process.platform === 'win32' || process.platform === 'darwin' ? false : true);
    expect(ok(`/@fs/${decks}/demo/../secret/deck.yaml`)).toBe(false);
    expect(ok(`/@fs/${decks}/demo/%2e%2e/secret/deck.yaml`)).toBe(false);
    expect(ok('/__htmlpptx/save?deck=demo', 'POST')).toBe(false);
    expect(ok('/__htmlpptx/list', 'POST')).toBe(false);
    expect(ok('/__htmlpptx/list')).toBe(false);              // и чтение команд правки — тоже нет
    expect(ok('/presentations/lora/deck.yaml')).toBe(false);
    expect(ok('/src/main.ts', 'PUT')).toBe(false);
  });

  test('пока презентация не выбрана, её файлы закрыты', () => {
    expect(allowed(req(`/@fs/${decks}/demo/deck.yaml`), decks, '')).toBe(false);
  });
});
