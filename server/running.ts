/**
 * Какой сервер студии сейчас работает с папкой презентаций: .slideria/server.json в самой папке.
 * По нему MCP (server/mcp.ts) отправляет правки через открытую студию: правка приходит в неё, как правка
 * другого окна, а не перезаписью файла со стороны (та перезагрузила бы страницу студии).
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const FILE = path.join('.slideria', 'server.json');

interface Running { url: string; pid: number }

/** Адрес сервера для этого компьютера: слушает все адреса — 127.0.0.1, IPv6 — в скобках */
function urlOf(a: AddressInfo): string {
  const host = a.address === '0.0.0.0' || a.address === '::' || !a.address ? '127.0.0.1' : a.family === 'IPv6' || a.address.includes(':') ? `[${a.address}]` : a.address;
  return `http://${host}:${a.port}`;
}

/** Сервер начал слушать: записать о себе. Ответ — убрать запись при остановке (если она ещё наша) */
export function announce(dir: string, a: AddressInfo): () => void {
  const file = path.join(dir, FILE);
  const me: Running = { url: urlOf(a), pid: process.pid };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(me));
  } catch { /* папка только для чтения — MCP будет писать в файлы сам */ }
  return () => {
    try {
      const now = JSON.parse(fs.readFileSync(file, 'utf8')) as Running;
      if (now.pid === me.pid && now.url === me.url) fs.rmSync(file, { force: true });
    } catch { /* уже нет */ }
  };
}

/** Адрес сервера студии, который работает с папкой (процесс жив); нет — null */
export function runningServer(dir: string): string | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')) as Running;
    if (typeof r.url !== 'string' || !Number.isInteger(r.pid)) return null;
    process.kill(r.pid, 0);
    return r.url;
  } catch {
    return null;
  }
}
