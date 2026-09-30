// Пульт с телефона: пересылка сообщений показа внутри «комнаты» (её код — в QR на экране).
// Без зависимостей и без WebSocket: телефон и окно показа слушают поток событий (SSE)
// и отправляют сообщения обычным POST. Работает в yarn dev и в yarn present (scripts/present.mjs).
import os from 'node:os';

const PREFIX = '/__slideria/remote/';
const ROOM = /^[a-z0-9]{8,40}$/;
const MAX_BODY = 64 * 1024;

/** @type {Map<string, Set<import('node:http').ServerResponse>>} */
const rooms = new Map();

/** Адреса этого компьютера в локальной сети (для QR на экране) */
export function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
    }
  }
  return out;
}

/** Запрос с этого же компьютера (правка проекта разрешена только так) */
export function isLocal(req) {
  const a = req.socket?.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Обрабатывает запросы /__slideria/remote/…; true — запрос обработан.
 * net() — адрес сервера: порт и слушает ли он только этот компьютер (тогда телефон не подключится).
 */
export function remoteRelay(req, res, net) {
  if (!req.url?.startsWith(PREFIX)) return false;
  const url = new URL(req.url, 'http://local');
  const what = url.pathname.slice(PREFIX.length);
  if (what === 'info') {
    const { port, localOnly } = net();
    json(res, 200, { urls: localOnly ? [] : lanUrls(port), localOnly });
    return true;
  }
  const room = url.searchParams.get('room') ?? '';
  if (!ROOM.test(room)) {
    json(res, 400, { error: 'Неверный код комнаты' });
    return true;
  }
  if (what === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': ok\n\n');
    let set = rooms.get(room);
    if (!set) rooms.set(room, (set = new Set()));
    set.add(res);
    // Без трафика соединение закрывают прокси и спящие телефоны
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(res);
      if (!set.size) rooms.delete(room);
    });
    return true;
  }
  if (what === 'send' && req.method === 'POST') {
    let body = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else body += c;
    });
    req.on('end', () => {
      try { JSON.parse(body); } catch { return json(res, 400, { error: 'Не JSON' }); }
      const line = `data: ${body.replace(/[\r\n]+/g, ' ')}\n\n`;
      const set = rooms.get(room);
      for (const r of set ?? []) r.write(line);
      json(res, 200, { ok: true, peers: set?.size ?? 0 });
    });
    return true;
  }
  json(res, 404, { error: 'Неизвестный запрос' });
  return true;
}
