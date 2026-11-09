/**
 * Сервер Slideria без Vite: студия собрана заранее (scripts/build.mjs --app), а презентации, команды,
 * уведомления и слежение за папкой — тем же ядром (server/core.ts), обработчиком (server/http.ts),
 * каналом (server/events.ts) и слежением (server/watch.ts), что и в yarn dev. Им работает программа
 * (desktop/main.mjs), а дальше — облако.
 *
 * Что отдаёт, кроме команд и данных:
 *   /, /index.html — страница студии; в неё вписаны настройки страницы (<meta name="slideria-env">) и адрес
 *                    для слайдов со звуком (server/frame-host.ts);
 *   /assets/…      — код и стили студии: имена с отпечатком содержимого, браузер держит их в кэше навсегда;
 *   файлы презентаций и библиотеки шрифтов — по тем же адресам, что и в yarn dev (/@fs/… или от корня
 *   программы), только из этих папок, с проверкой «не изменился ли» и кусками (перемотка видео).
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createDecksCore, type DecksCore, type Runner } from './core';
import { MIME } from './deck-files';
import { createEvents } from './events';
import { startFrameHost } from './frame-host';
import { WORKER_CSP, createHandler } from './http';
import type { KeyStore } from './agent';
import { announce } from './running';
import { watchDecks } from './watch';

/** Код и стили студии, кроме того, что знает MIME презентаций */
const CODE_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', ico: 'image/x-icon', cube: 'text/plain; charset=utf-8',
};
const mimeOf = (file: string) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return CODE_MIME[ext] ?? (MIME[ext] === 'text/html' ? 'text/html; charset=utf-8' : MIME[ext]) ?? 'application/octet-stream';
};
const WORKER_FILE = /^\/assets\/script-worker-[\w-]+\.js$/;

export interface Package { name: string; version: string; license: string; text: string }

export interface ServeOptions {
  /** Папка с презентациями */
  dir: string;
  /** Корень программы: шаблон новой презентации, готовый проигрыватель (player/), шрифты комплекта, LICENSE */
  root: string;
  /** Собранная студия: index.html и assets/ (scripts/build.mjs --app) */
  studio: string;
  /** Общая библиотека шрифтов */
  fonts?: string;
  /** Свои темы, шаблоны, эффекты и образы студии */
  library?: string;
  /** Куда собирать недостающие варианты проигрывателя */
  playerCache?: string;
  /** Какой адрес слушать: по умолчанию только этот компьютер */
  host?: string;
  /** Порт; занят — любой свободный. 0 — сразу любой */
  port?: number;
  /** Настройки страниц: программа (без команд терминала), как называть папку с презентациями */
  env?: { app?: boolean; decks?: string };
  /** Библиотеки, собранные внутрь студии (страница «Лицензии»); по умолчанию — licenses.json рядом со студией */
  bundled?: Package[];
  /** Программа: вход для телефона, брандмауэр Windows, чем запускать сборку */
  lan?: (deck: string) => Promise<number | null>;
  firewall?: () => Promise<string>;
  run?: Runner;
  log?: (message: string) => void;
  /** Ключ Claude для чата «Агент»: программа хранит его зашифрованным (desktop/main.mjs) */
  agentKeys?: KeyStore;
}

export interface Served {
  core: DecksCore;
  /** Адрес для окна программы: http://127.0.0.1:порт */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Слушать порт; занят — любой свободный */
function listen(srv: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number) => {
      const fail = (e: NodeJS.ErrnoException) => {
        srv.off('listening', ok);
        if (e.code === 'EADDRINUSE' && p !== 0) tryPort(0);
        else reject(e);
      };
      const ok = () => { srv.off('error', fail); resolve(); };
      srv.once('error', fail);
      srv.once('listening', ok);
      srv.listen(p, host);
    };
    tryPort(port);
  });
}

/** Путь внутри папки (без выхода наружу и без служебных .файлов внутри неё) или null */
function inside(base: string, rel: string): string | null {
  const abs = path.resolve(base, rel);
  const r = path.relative(base, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  if (r.split(path.sep).some((p) => p.startsWith('.'))) return null;
  return abs;
}

/**
 * Файл с проверкой «не изменился ли» (ETag) и кусками (Range: видео перематывается, не скачиваясь целиком).
 * forever — имя с отпечатком содержимого: кэш навсегда
 */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, o: { forever?: boolean; headers?: Record<string, string> } = {}): void {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return notFound(res); }
  if (!st.isFile()) return notFound(res);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  res.setHeader('Content-Type', mimeOf(file));
  res.setHeader('Cache-Control', o.forever ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(o.headers ?? {})) res.setHeader(k, v);
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    return void res.end();
  }
  let start = 0;
  let end = st.size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && st.size > 0 && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    } else {
      // «Последние N байт»
      start = Math.max(0, st.size - Number(range[2]));
    }
    if (start > end || start >= st.size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${st.size}`);
      return void res.end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
  } else {
    res.statusCode = 200;
  }
  res.setHeader('Content-Length', String(st.size ? end - start + 1 : 0));
  if (req.method === 'HEAD' || !st.size) return void res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function notFound(res: http.ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Не найдено');
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

interface ManifestChunk { file: string; name?: string; imports?: string[]; css?: string[]; assets?: string[]; isEntry?: boolean }

/**
 * Подсказки браузеру, какой код понадобится странице (по манифесту сборки студии, .vite/manifest.json).
 * Студии — сразу: её части грузятся вместе с основным кодом и данными, а не после них (без этого браузер
 * узнаёт о них, только когда основной код уже выполнился). Странице выбора — студия про запас, без спешки:
 * переход в редактор потом не ждёт загрузки
 */
export function codeHints(studio: string): { studio: string; picker: string } {
  let m: Record<string, ManifestChunk>;
  try { m = JSON.parse(fs.readFileSync(path.join(studio, '.vite', 'manifest.json'), 'utf8')) as Record<string, ManifestChunk>; } catch { return { studio: '', picker: '' }; }
  const entry = Object.values(m).find((c) => c.isEntry);
  const loaded = new Set(entry ? [entry.file, ...(entry.imports ?? []).map((k) => m[k]?.file)] : []);
  const files = (keys: string[]) => {
    const js = new Set<string>();
    const css = new Set<string>();
    const fonts = new Set<string>();
    const walk = (k: string) => {
      const c = m[k];
      if (!c || js.has(c.file)) return;
      if (!loaded.has(c.file)) js.add(c.file);
      for (const f of c.css ?? []) css.add(f);
      for (const f of c.assets ?? []) if (f.endsWith('.woff2')) fonts.add(f);
      for (const i of c.imports ?? []) walk(i);
    };
    keys.forEach(walk);
    return { js: [...js], css: [...css].filter((f) => !(entry?.css ?? []).includes(f)), fonts: [...fonts] };
  };
  // Часть по имени исходника или, если сборка вынесла её в общий кусок, — по имени куска (studio)
  const key = (src: string, name: string) => (m[src] ? src : Object.keys(m).find((k) => m[k].name === name && !m[k].isEntry) ?? src);
  const st = files([key('src/studio/studio.ts', 'studio'), key('src/studio/user-library.ts', 'user-library')]);
  const pk = files([key('src/engine/picker.ts', 'picker')]);
  return {
    studio: [...st.css.map((f) => `<link rel="stylesheet" href="/${f}">`), ...st.js.map((f) => `<link rel="modulepreload" href="/${f}">`)].join('\n'),
    // Шрифты страницы выбора — сразу, вместе со стилями: название не рисуется запасным шрифтом
    picker: [...pk.css.map((f) => `<link rel="stylesheet" href="/${f}">`), ...pk.fonts.map((f) => `<link rel="preload" as="font" type="font/woff2" href="/${f}" crossorigin>`), ...pk.js.map((f) => `<link rel="modulepreload" href="/${f}">`),
      ...[...st.js, ...st.css].map((f) => `<link rel="prefetch" href="/${f}">`)].join('\n'),
  };
}

export async function startServer(o: ServeOptions): Promise<Served> {
  const dir = path.resolve(o.dir);
  const root = path.resolve(o.root);
  const studio = path.resolve(o.studio);
  const log = o.log ?? ((m: string) => console.error(m));
  const index = path.join(studio, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`Нет собранной студии: ${index} (scripts/build.mjs --app)`);

  let watch: ReturnType<typeof watchDecks> | null = null;
  const core = createDecksCore({
    dir, root, fonts: o.fonts, library: o.library, playerCache: o.playerCache,
    hooks: { release: (paths) => watch?.release(paths) ?? (() => {}), run: o.run },
  });
  const events = createEvents();
  core.on('saved', (e) => events.send('deck-saved', e));
  core.on('removed', (e) => events.send('deck-removed', e));
  core.on('agents', (e) => events.send('agents', e));
  core.on('journal', (e) => events.send('journal', e));
  watch = watchDecks(core, {
    changed: (name, rev) => events.send('deck-changed', { name, rev }),
    list: (e) => events.send('decks', e),
    error: (m) => log(`Слежение за папкой презентаций: ${m}`),
  });
  const frames = startFrameHost(log);
  await frames.ready;

  let bundled = o.bundled;
  if (!bundled) {
    try { bundled = (JSON.parse(fs.readFileSync(path.join(studio, '..', 'licenses.json'), 'utf8')) as { packages: Package[] }).packages; } catch { bundled = []; }
  }

  // Страница студии: настройки страниц и адрес для слайдов со звуком — прямо в ней
  const envMeta = `<meta name="slideria-env" content="${esc(JSON.stringify({ app: !!o.env?.app, decks: o.env?.decks ?? 'presentations/' }))}">`;
  const page = fs.readFileSync(index, 'utf8').replace(/<head>/i, (m) => `${m}\n${envMeta}\n${frames.meta()}`);
  const hints = codeHints(studio);
  /** Страница с подсказками: какой код ей понадобится (студии — сразу, странице выбора — студия про запас) */
  const pageFor = (query: URLSearchParams) => {
    const tags = query.has('studio') ? hints.studio : !query.get('deck') || query.has('all') ? hints.picker : '';
    return tags ? page.replace(/<\/head>/i, (m) => `${tags}\n${m}`) : page;
  };

  /** Адреса файлов — те же, что выдаёт ядро (core.urlOf): /@fs/<путь> или от корня программы */
  const allowed = [dir, ...(o.fonts ? [path.resolve(o.fonts)] : [path.join(root, 'fonts')])];
  function deckFile(url: string): string | null {
    let p = url;
    try { p = decodeURIComponent(url); } catch { return null; }
    if (p.includes('\0')) return null;
    const abs = p.startsWith('/@fs/') ? path.resolve(process.platform === 'win32' ? p.slice(5) : p.slice(4)) : path.join(root, p);
    for (const base of allowed) {
      const rel = path.relative(base, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return inside(base, rel);
    }
    return null;
  }

  let server: http.Server | null = null;
  const handler = createHandler(core, {
    address: () => server?.address(),
    lan: o.lan,
    firewall: o.firewall,
    log,
    bundled: () => bundled ?? [],
    agentKeys: o.agentKeys,
  });

  server = http.createServer((req, res) => {
    handler(req, res, () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        return void res.end();
      }
      const url = (req.url ?? '/').split('?')[0];
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        return void res.end(req.method === 'HEAD' ? undefined : pageFor(new URL(req.url ?? '/', 'http://local').searchParams));
      }
      if (url.startsWith('/assets/')) {
        const file = inside(studio, url.slice(1));
        if (!file) return notFound(res);
        return sendFile(req, res, file, { forever: true, headers: WORKER_FILE.test(url) ? { 'Content-Security-Policy': WORKER_CSP } : {} });
      }
      const own = deckFile(url);
      if (own) return sendFile(req, res, own);
      // Прочие файлы сборки студии (то, что лежит рядом с index.html)
      const file = inside(studio, url.slice(1));
      if (file && fs.existsSync(file)) return sendFile(req, res, file);
      notFound(res);
    });
  });
  // Поток событий пульта живёт долго
  server.requestTimeout = 0;
  server.on('upgrade', (req, socket, head) => {
    if (!events.upgrade(req, socket, head)) socket.destroy();
  });
  await listen(server, o.port ?? 0, o.host ?? '127.0.0.1');
  const a = server.address() as AddressInfo;
  // MCP находит открытую студию по записи в папке презентаций и шлёт правки через неё (server/running.ts)
  const unannounce = announce(dir, a);
  const host = a.address === '0.0.0.0' || a.address === '::' ? '127.0.0.1' : a.family === 'IPv6' ? `[${a.address}]` : a.address;

  return {
    core,
    port: a.port,
    url: `http://${host}:${a.port}`,
    async close() {
      unannounce();
      watch?.close();
      events.close();
      await frames.close();
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
        server?.closeAllConnections?.();
      });
    },
  };
}
