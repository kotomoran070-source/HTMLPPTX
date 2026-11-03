/**
 * Уведомления страницам: записали презентацию, удалили, поменяли файл снаружи, агенты на связи, правка
 * агента в журнале. Свой WebSocket без библиотек и без Vite: его подключают и сервер разработки
 * (plugins/decks.ts), и сервер программы (server/serve.ts). Страница — src/engine/events.ts.
 *
 * Почему WebSocket, а не поток событий (text/event-stream): браузер держит к одному серверу не больше шести
 * обычных соединений на все вкладки, а поток событий занимает одно навсегда — студия, показ, докладчик и
 * пара вкладок исчерпали бы их, и запросы встали бы. На WebSocket это ограничение не распространяется.
 *
 * Только сервер → страница. Только этому компьютеру и только страницам этого же сервера: в событиях есть
 * имена презентаций и тексты правок, телефону в сети они не нужны.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { hostAllowed } from './host-guard';
import { isLocal } from '../plugins/remote-relay.mjs';

/** Адрес канала уведомлений */
export const EVENTS = '/__slideria/events';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Страница сообщений не шлёт: больше — это уже не наша страница */
const MAX_IN = 64 * 1024;
/** Проверка, что соединение живо (браузер отвечает сам) */
const PING_MS = 25_000;

export interface EventsOptions {
  /** Свои имена сервера, кроме localhost и IP-адресов (как у HTTP-обработчика) */
  allowedHosts?: () => readonly string[] | true | undefined;
}

export type Events = ReturnType<typeof createEvents>;

/** Кадр WebSocket от сервера (без маски): opcode 1 — текст, 8 — закрыть, 9 — проверка, 10 — ответ на неё */
function frame(opcode: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const n = data.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
      : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, data]);
}

export function createEvents(o: EventsOptions = {}) {
  const clients = new Set<Duplex>();
  const timer = setInterval(() => { for (const s of clients) s.write(frame(9)); }, PING_MS);
  timer.unref?.();

  /** Разобрать кадры страницы: отвечаем только на «закрыть» и «проверку» */
  function reader(socket: Duplex) {
    let buf: Buffer = Buffer.alloc(0);
    return (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let at = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          at = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          const big = buf.readBigUInt64BE(2);
          if (big > BigInt(MAX_IN)) { socket.destroy(); return; }
          len = Number(big);
          at = 10;
        }
        if (len > MAX_IN) { socket.destroy(); return; }
        const mask = masked ? buf.subarray(at, at + 4) : null;
        if (masked) at += 4;
        if (buf.length < at + len) return;
        const data = Buffer.from(buf.subarray(at, at + len));
        if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
        buf = buf.subarray(at + len);
        if (opcode === 8) {
          socket.end(frame(8, data.subarray(0, 2)));
          return;
        }
        if (opcode === 9) socket.write(frame(10, data));
      }
    };
  }

  /**
   * Запрос на переход к WebSocket (событие upgrade сервера). Ответ — наш ли это адрес: чужие (WebSocket Vite)
   * остаются другим обработчикам
   */
  function upgrade(req: IncomingMessage, socket: Duplex, head?: Buffer): boolean {
    if ((req.url ?? '').split('?')[0] !== EVENTS) return false;
    const key = req.headers['sec-websocket-key'];
    const origin = req.headers.origin;
    let sameOrigin = true;
    try { sameOrigin = !origin || new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
    if (!hostAllowed(req.headers.host, o.allowedHosts?.() ?? []) || !isLocal(req) || !sameOrigin
      || typeof key !== 'string' || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return true;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    (socket as Duplex & { setNoDelay?: (v: boolean) => void }).setNoDelay?.(true);
    clients.add(socket);
    const read = reader(socket);
    socket.on('data', read);
    const drop = () => clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', () => { drop(); socket.destroy(); });
    if (head?.length) read(Buffer.from(head));
    return true;
  }

  /** Событие всем открытым страницам */
  function send(type: string, data: unknown): void {
    if (!clients.size) return;
    const f = frame(1, Buffer.from(JSON.stringify({ type, data })));
    for (const s of clients) if (!s.destroyed) s.write(f);
  }

  function close(): void {
    clearInterval(timer);
    for (const s of clients) s.end(frame(8, Buffer.from([0x03, 0xe9])));
    clients.clear();
  }

  return { upgrade, send, close, get size() { return clients.size; } };
}
