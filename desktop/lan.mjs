// Вход для телефона-пульта. Сервер приложения слушает только этот компьютер (127.0.0.1):
// так при запуске не нужен брандмауэр, а правка остаётся только с этого компьютера.
// Когда в показе нажимают R, здесь открывается второй вход — в локальной сети. Он пересылает
// запросы серверу приложения, но только на просмотр: страницы, файлы, живое обновление и
// сообщения пульта. Команды правки (/__htmlpptx/…) отсюда не проходят, а из папки с
// презентациями видна только та, что сейчас в показе: остальные с телефона не открыть.
import http from 'node:http';
import net from 'node:net';
import { ensureFirewall, firewallMessage } from '../plugins/firewall.mjs';

// Порты, которые брандмауэр разрешает пульту (plugins/firewall.mjs): 5173–5199
const FIRST = 5180;
const LAST = 5199;
const RELAY = '/__slideria/remote/';

const fold = process.platform === 'win32' || process.platform === 'darwin' ? (s) => s.toLowerCase() : (s) => s;

/**
 * Что можно с телефона: читать (GET/HEAD) и отправлять сообщения пульта.
 * decks — папка с презентациями (адреса /@fs/…), deck — презентация в показе.
 */
function allowed(req, decks, deck) {
  let p = (req.url ?? '/').split('?')[0];
  try { p = decodeURIComponent(p); } catch { return false; }
  if (p.includes('\\') || /\/\.\.?(\/|$)/.test(p)) return false;
  if (p.startsWith('/__htmlpptx/')) return false;
  // Примеры, которые лежат в папке программы, телефону не нужны
  if (/^\/(@fs\/.*\/)?(presentations|templates)\//i.test(p) && !fold(p).startsWith(fold('/@fs/' + decks + '/'))) return false;
  // Файлы презентаций: только той, что показывают (deck.yaml, картинки, вставки)
  const base = fold('/@fs/' + decks + '/');
  if (fold(p).startsWith(base)) {
    const name = p.slice(base.length).split('/')[0];
    if (!deck || fold(name) !== fold(deck)) return false;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return req.method === 'POST' && p === RELAY + 'send';
}

function listen(srv, port) {
  return new Promise((resolve) => {
    const fail = () => resolve(false);
    srv.once('error', fail);
    srv.listen(port, '0.0.0.0', () => {
      srv.off('error', fail);
      resolve(true);
    });
  });
}

/**
 * Вход для телефона: open(имя) при первом вызове настраивает брандмауэр (Windows, один раз
 * с подтверждением администратора) и начинает слушать сеть; дальше — тот же порт, а видна
 * только последняя открытая презентация. target() — порт сервера приложения;
 * decksDir — папка с презентациями; log — журнал.
 */
export function lanGateway(target, decksDir, log) {
  /** @type {Promise<number | null> | null} */
  let opening = null;
  let deck = '';
  const decks = decksDir.split('\\').join('/').replace(/^\/+/, '').replace(/\/+$/, '');
  /** @type {http.Server | null} */
  let srv = null;

  async function open() {
    const fw = await ensureFirewall({ log });
    const msg = firewallMessage(fw);
    if (msg) log(msg.trim());
    srv = http.createServer((req, res) => {
      if (!allowed(req, decks, deck)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'С телефона презентацию только показывают — правка с этого компьютера' }));
        return;
      }
      const up = http.request({ host: '127.0.0.1', port: target(), method: req.method, path: req.url, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      // Поток событий пульта живёт долго: закрылся телефон — закрываем и запрос к серверу
      res.on('close', () => up.destroy());
      req.pipe(up);
    });
    srv.requestTimeout = 0;
    // Живое обновление Vite (WebSocket): соединение пересылается как есть
    srv.on('upgrade', (req, socket, head) => {
      if (!allowed(req, decks, deck)) return socket.destroy();
      const up = net.connect(target(), '127.0.0.1', () => {
        const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        up.write(lines.join('\r\n') + '\r\n\r\n');
        if (head?.length) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      });
      const end = () => { up.destroy(); socket.destroy(); };
      up.on('error', end);
      socket.on('error', end);
    });
    for (let p = FIRST; p <= LAST; p++) {
      if (await listen(srv, p)) {
        log('Пульт: вход в сети на порту', p);
        return p;
      }
    }
    log('Пульт: все порты', `${FIRST}–${LAST}`, 'заняты');
    srv = null;
    return null;
  }

  return {
    /** Порт входа в сети или null, если открыть не удалось; name — презентация в показе */
    open(name) {
      if (typeof name === 'string' && name && !/[\\/]|\.\./.test(name)) {
        if (name !== deck) log('Пульт: телефону открыта презентация', name);
        deck = name;
      }
      opening ??= open().then((p) => {
        if (p === null) opening = null;
        return p;
      });
      return opening;
    },
    close() {
      srv?.close();
      srv?.closeAllConnections?.();
    },
  };
}
