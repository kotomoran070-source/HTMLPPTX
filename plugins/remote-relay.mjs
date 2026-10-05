// Пульт с телефона: пересылка сообщений показа внутри «комнаты».
// Без зависимостей и без WebSocket: телефон и окно показа слушают поток событий (SSE)
// и отправляют сообщения обычным POST. Работает в yarn dev, yarn present и в приложении.
//
// Подключение телефона. QR ведёт на одноразовую ссылку …/pair?t=билет: билет действует
// несколько минут и только один раз. По нему телефон получает пропуск — cookie со случайным
// ключом, — и дальше из сети без пропуска не отдаётся ничего: ни страница, ни заметки, ни команды.
// Отключить телефон (или все) — в окне с QR на компьютере; закрыли показ — пропуска гаснут сами.
import crypto from 'node:crypto';
import os from 'node:os';

const PREFIX = '/__slideria/remote/';
const ROOM = /^[a-z0-9]{8,40}$/;
// Сообщения идут пачками (см. Sync.pump в src/engine/sync.ts)
const MAX_BODY = 256 * 1024;

const COOKIE = 'slideria_rc';
/** Билет из QR живёт 5 минут */
const TICKET_MS = 5 * 60_000;
/** Окно показа закрыто дольше минуты — сеанс окончен, пропуска телефонов гаснут */
const HOST_GONE_MS = 60_000;
/** Шлюз приложения (desktop/lan.mjs) помечает запросы из сети: до сервера они идут с 127.0.0.1 */
export const LAN_HEADER = 'x-slideria-lan';

/**
 * Состояние пульта — общее на процесс: модуль может загрузиться дважды (конфиг Vite и шлюз
 * приложения), а пропуск, выданный одним, должен проверять другой.
 * @type {{
 *   rooms: Map<string, Set<import('node:http').ServerResponse>>,
 *   tickets: Map<string, { room: string, next: string, exp: number }>,
 *   devices: Map<string, { id: string, room: string, name: string, ip: string, since: number, conns: Set<import('node:http').ServerResponse> }>,
 *   hosts: Map<string, { conns: number, timer?: ReturnType<typeof setTimeout> }>,
 * }}
 */
const state = (globalThis.__slideriaRemote ??= { rooms: new Map(), tickets: new Map(), devices: new Map(), hosts: new Map() });
const { rooms, tickets, devices, hosts } = state;

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
  return (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') && !req.headers?.[LAN_HEADER];
}

function cookieKey(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{16,64})`).exec(req.headers?.cookie ?? '');
  return m ? m[1] : null;
}

/** Телефон с действующим пропуском (или null) */
export function deviceOf(req) {
  const key = cookieKey(req);
  return key ? devices.get(key) ?? null : null;
}

/**
 * Можно ли этому запросу из сети что-то получить. Без пропуска — только сама одноразовая
 * ссылка и вопрос «действует ли мой пропуск» (телефон после отключения объясняет, что случилось).
 */
export function lanPass(req) {
  if (isLocal(req)) return true;
  const p = (req.url ?? '/').split('?')[0];
  if (p === PREFIX + 'pair' || p === PREFIX + 'whoami' || p === PREFIX + 'ended') return true;
  return !!deviceOf(req);
}

/** Страница для телефона без пропуска: что сделать, чтобы подключиться */
export function denyPage(res, why = 'Отсканируйте QR на компьютере, чтобы подключиться к показу.', code = 403) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пульт Slideria</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F3F4F6;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#111827">
<main style="max-width:340px;margin:24px;padding:24px;border-radius:18px;background:#fff;box-shadow:0 6px 24px rgba(15,23,42,.08)">
<h1 style="margin:0 0 8px;font-size:21px">Пульт показа</h1><p style="margin:0;color:#4B5563">${why}</p>
<p style="margin:14px 0 0;font-size:14px;color:#6B7280">Подключиться снова: на компьютере окно докладчика → кнопка с телефоном (или клавиша R), затем отсканируйте новый QR.</p></main></body></html>`);
}

/** Имя телефона по браузеру: точную модель браузер по http не сообщает */
function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
  const br = /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg/.test(ua) ? 'Edge' : /OPR|Opera/.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'браузер';
  return `${os} · ${br}`;
}

function clientIp(req) {
  const fwd = req.headers?.[LAN_HEADER];
  const a = (typeof fwd === 'string' && fwd !== '1' ? fwd : req.socket?.remoteAddress) ?? '';
  return a.replace(/^::ffff:/, '');
}

/** Отключить телефон: поток событий получает «revoked» и закрывается, пропуск больше не действует */
function revoke(key) {
  const d = devices.get(key);
  if (!d) return;
  devices.delete(key);
  for (const r of d.conns) {
    try { r.end('event: revoked\ndata: {}\n\n'); } catch { /* уже закрыт */ }
    rooms.get(d.room)?.delete(r);
  }
}

/** Окно показа (хозяин комнаты) подключилось или ушло; ушло надолго — сеанс окончен */
function hostSeen(room, delta) {
  let h = hosts.get(room);
  if (!h) hosts.set(room, (h = { conns: 0 }));
  h.conns += delta;
  clearTimeout(h.timer);
  if (h.conns <= 0) {
    h.timer = setTimeout(() => {
      hosts.delete(room);
      for (const [k, d] of devices) if (d.room === room) revoke(k);
      for (const [t, v] of tickets) if (v.room === room) tickets.delete(t);
    }, HOST_GONE_MS);
    h.timer.unref?.();
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) req.destroy();
      else body += c;
    });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { resolve(undefined); } });
    req.on('error', () => resolve(undefined));
  });
}

/**
 * Обрабатывает запросы /__slideria/remote/…; true — запрос обработан.
 * net() — адрес сервера: порт и слушает ли он только этот компьютер (тогда телефон не подключится).
 * Может вернуть обещание: приложение открывает вход для телефона по первому запросу (desktop/lan.mjs).
 *
 * Окно показа (с этого компьютера): info, open — новый билет, devices, revoke, events, send.
 * Телефон: pair — билет → пропуск; дальше events и send своей комнаты; whoami — действует ли пропуск.
 */
export function remoteRelay(req, res, net) {
  if (!req.url?.startsWith(PREFIX)) return false;
  const url = new URL(req.url, 'http://local');
  const what = url.pathname.slice(PREFIX.length);
  const host = isLocal(req);

  if (what === 'pair' && req.method === 'GET') {
    const t = url.searchParams.get('t') ?? '';
    const ticket = tickets.get(t);
    if (!ticket || ticket.exp < Date.now()) {
      if (ticket) tickets.delete(t);
      denyPage(res, 'Этот QR уже использован или устарел: каждый код подключает один телефон. Покажите новый код на компьютере.');
      return true;
    }
    tickets.delete(t);
    const key = crypto.randomBytes(24).toString('base64url');
    devices.set(key, { id: crypto.randomBytes(6).toString('hex'), room: ticket.room, name: deviceName(req.headers['user-agent']), ip: clientIp(req), since: Date.now(), conns: new Set() });
    // Lax, а не Strict: страница открывается из камеры — с чужого сайта, и пропуск должен дойти
    res.writeHead(302, {
      'Set-Cookie': `${COOKIE}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      Location: ticket.next,
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }
  // Телефон отключили: страница-объяснение вместо пульта (ни заметок, ни слайдов)
  if (what === 'ended') {
    denyPage(res, '<b>Пульт отключён.</b> Сеанс завершили на компьютере или закрыли показ — заметки и слайды с этого телефона больше не видны.', 200);
    return true;
  }
  if (what === 'info') {
    if (!host) { json(res, 403, { error: 'Только с этого компьютера' }); return true; }
    Promise.resolve(net()).then(
      ({ port, localOnly, app, firewall }) => json(res, 200, { urls: localOnly ? [] : lanUrls(port), localOnly, app: !!app, firewall: !!firewall }),
      () => json(res, 200, { urls: [], localOnly: true }),
    );
    return true;
  }
  const room = url.searchParams.get('room') ?? '';
  if (!ROOM.test(room)) {
    json(res, 400, { error: 'Неверный код комнаты' });
    return true;
  }
  const dev = host ? null : deviceOf(req);
  if (what === 'whoami') {
    json(res, 200, { ok: host || dev?.room === room });
    return true;
  }
  // Остальное — окну показа или телефону с пропуском в эту комнату
  if (!host && dev?.room !== room) {
    json(res, 403, { error: 'Нет доступа: отсканируйте QR на компьютере', revoked: true });
    return true;
  }
  // Новый код, список телефонов и отключение — только окну показа на этом компьютере
  if ((what === 'open' || what === 'devices' || what === 'revoke') && !host) {
    json(res, 403, { error: 'Только с этого компьютера' });
    return true;
  }
  if (what === 'open' && req.method === 'POST') {
    void readJson(req).then((b) => {
      const next = typeof b?.next === 'string' && /^\/(?!\/)/.test(b.next) ? b.next : '/';
      // Новый код — прежний неиспользованный больше не действует
      for (const [t, v] of tickets) if (v.room === room) tickets.delete(t);
      const t = crypto.randomBytes(12).toString('base64url');
      tickets.set(t, { room, next, exp: Date.now() + TICKET_MS });
      json(res, 200, { ticket: t, expires: TICKET_MS });
    });
    return true;
  }
  if (what === 'devices') {
    const list = [...devices.values()].filter((d) => d.room === room)
      .map((d) => ({ id: d.id, name: d.name, ip: d.ip, since: d.since, online: d.conns.size > 0 }));
    json(res, 200, { devices: list });
    return true;
  }
  if (what === 'revoke' && req.method === 'POST') {
    const id = url.searchParams.get('id');
    let n = 0;
    for (const [k, d] of devices) if (d.room === room && (!id || d.id === id)) { revoke(k); n++; }
    json(res, 200, { revoked: n });
    return true;
  }
  if (what === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': ok\n\n');
    let set = rooms.get(room);
    if (!set) rooms.set(room, (set = new Set()));
    set.add(res);
    dev?.conns.add(res);
    if (host) hostSeen(room, 1);
    // Без трафика соединение закрывают прокси и спящие телефоны
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(res);
      dev?.conns.delete(res);
      if (!set.size) rooms.delete(room);
      if (host) hostSeen(room, -1);
    });
    return true;
  }
  if (what === 'send' && req.method === 'POST') {
    void readJson(req).then((b) => {
      if (b === undefined) return json(res, 400, { error: 'Не JSON' });
      const line = `data: ${JSON.stringify(b)}\n\n`;
      const set = rooms.get(room);
      for (const r of set ?? []) r.write(line);
      json(res, 200, { ok: true, peers: set?.size ?? 0 });
    });
    return true;
  }
  json(res, 404, { error: 'Неизвестный запрос' });
  return true;
}
