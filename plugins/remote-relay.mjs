// Пульт с телефона: пересылка сообщений показа внутри «комнаты» (её код — в QR на экране).
// Без зависимостей и без WebSocket: телефон и окно показа слушают поток событий (SSE)
// и отправляют сообщения обычным POST. Работает в yarn dev и в yarn present (scripts/present.mjs).
import os from 'node:os';

const PREFIX = '/__slideria/remote/';
const ROOM = /^[a-z0-9]{8,40}$/;
// Сообщения идут пачками (см. Sync.pump в src/engine/sync.ts)
const MAX_BODY = 256 * 1024;

/** @type {Map<string, Set<import('node:http').ServerResponse>>} */
const rooms = new Map();

// Виртуальные адаптеры (WSL, Hyper-V, VirtualBox, Docker, VPN): телефон до них не достучится
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|vboxnet|docker|veth|br-|virbr|utun|tun|tap|tailscale|zerotier|wireguard|wg\d|vpn|hamachi|radmin|loopback|npcap/i;
const WIRELESS = /wi-?fi|wlan|wireless|беспровод|en0|wlp/i;

/** Насколько адрес похож на домашнюю или офисную Wi-Fi: больше — лучше */
function score(name, ip) {
  let s = 0;
  if (WIRELESS.test(name)) s += 40;
  if (/^(eth|en|ethernet|Ethernet)/i.test(name)) s += 15;
  if (VIRTUAL.test(name)) s -= 100;
  if (ip.startsWith('192.168.')) s += 30;
  else if (ip.startsWith('10.')) s += 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) s += 10;
  if (ip.startsWith('169.254.')) s -= 200;
  return s;
}

/** Адреса этого компьютера в локальной сети: самый вероятный для телефона — первым */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, ip: a.address, score: score(name, a.address) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function lanUrls(port) {
  return lanAddresses().filter((a) => a.score > -100).map((a) => `http://${a.ip}:${port}`);
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
