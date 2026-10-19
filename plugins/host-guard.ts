import net from 'node:net';
import type { Connect } from 'vite';

/**
 * Защита от подмены адреса (DNS rebinding). Чужой сайт может направить своё имя на 127.0.0.1, и браузер
 * пойдёт к этому серверу как к «своему»: запрос — с этого компьютера, Origin совпадает с Host. Отличает
 * его только заголовок Host — в нём имя чужого сайта. Свои страницы приходят по localhost или по
 * IP-адресу (127.0.0.1, адрес в сети — телефон-пульт); allowed — свои имена из server.allowedHosts.
 * Так же проверяет и сам Vite, но его проверка стоит после обработчиков плагинов — поэтому здесь своя
 */
export function hostAllowed(host: string | undefined, allowed: readonly string[] | true = []): boolean {
  if (allowed === true) return true;
  if (!host) return false;
  let name = host.trim().toLowerCase();
  if (name.startsWith('[')) {
    const end = name.indexOf(']');
    return end > 0 && net.isIPv6(name.slice(1, end));
  }
  name = name.replace(/:\d+$/, '').replace(/\.$/, '');
  if (net.isIP(name) || name === 'localhost' || name.endsWith('.localhost')) return true;
  return allowed.some((a) => {
    const h = a.toLowerCase();
    return h.startsWith('.') ? name === h.slice(1) || name.endsWith(h) : name === h;
  });
}

/** Обработчик: чужой Host — отказ раньше всех обработчиков сервера */
export function hostGuard(allowed: () => readonly string[] | true | undefined): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (hostAllowed(req.headers.host, allowed() ?? [])) return next();
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Чужой адрес сервера: Slideria отвечает только по localhost или IP-адресу');
  };
}
