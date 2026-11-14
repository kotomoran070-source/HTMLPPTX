/**
 * Картинки слайдов для агента (MCP view_slides, docs/MCP.md): агент видит, что получилось после правки, —
 * без «компьютера» (computer use) и без открытой студии.
 *
 * Как: страница проигрывателя (тот же, что у экспорта в HTML) в режиме снимка (?shot=3,5, src/engine/print.ts) —
 * слайды в конечном виде, как при печати, — открывается в невидимом браузере и снимается по слайду. Файлы
 * презентации страница берёт с маленького сервера здесь же (127.0.0.1, случайный порт и ключ в адресе), а не
 * вложенными в HTML: видео и большие картинки не перекодируются на каждый снимок.
 *
 * Браузер — снаружи (Shooter): в программе (--mcp) — скрытое окно Electron (desktop/shot.mjs), из папки проекта —
 * Playwright (scripts/mcp.mjs). Нет браузера — инструмент отвечает, как его получить
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { SLIDE_H, widthOf } from '../src/engine/slide-size';
import type { DecksCore } from './core';
import { MIME } from './deck-files';

export interface ShotRequest {
  /** Страница снимка: дождаться data-shot у <html> ("ready" или "error: …"), потом slideriaShot.show(k) */
  url: string;
  /** Сколько слайдов снять (k — с 0 по count − 1) */
  count: number;
  width: number;
  height: number;
}

/** Снять слайды страницы снимка: PNG по каждому, по порядку */
export type Shooter = (r: ShotRequest) => Promise<Buffer[]>;

export interface ShotOptions {
  /** Слайды — номера с 1 */
  slides: number[];
  /** Ширина картинки; без неё — ширина слайда (один к одному). Высота — по пропорции презентации */
  width?: number;
  /** Вид слайдов, если тема презентации меняется вместе с темой интерфейса */
  look?: 'light' | 'dark';
}

export function createShots(core: DecksCore, shooter: Shooter) {
  const key = randomBytes(12).toString('hex');
  const pages = new Map<string, string>();
  const files = new Map<string, string>();
  let base: Promise<string> | null = null;

  function serve(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parts = (req.url ?? '').split('?')[0].split('/');
    // /<ключ>/p/<страница> — страница снимка; /<ключ>/f/<файл>/<имя> — файл презентации
    if (parts[1] !== key || req.method !== 'GET') return void res.writeHead(404).end();
    if (parts[2] === 'p' && pages.has(parts[3])) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(pages.get(parts[3]));
    }
    const abs = parts[2] === 'f' ? files.get(parts[3]) : undefined;
    if (!abs || !fs.existsSync(abs)) return void res.writeHead(404).end();
    const ext = path.extname(abs).slice(1).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'content-length': fs.statSync(abs).size, 'cache-control': 'no-store' });
    fs.createReadStream(abs).pipe(res);
  }

  function start(): Promise<string> {
    base ??= new Promise((done, fail) => {
      const srv = http.createServer(serve);
      srv.once('error', fail);
      srv.listen(0, '127.0.0.1', () => {
        // Сервер не держит процесс: агент закрыл вход — MCP выходит
        srv.unref();
        done(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/${key}`);
      });
    });
    return base;
  }

  /** Картинки слайдов презентации name (PNG), по порядку slides */
  async function shoot(name: string, o: ShotOptions): Promise<Buffer[]> {
    const root = await start();
    const link = (abs: string) => {
      const id = createHash('sha1').update(abs).digest('hex').slice(0, 16);
      files.set(id, abs);
      return `${root}/f/${id}/${encodeURIComponent(path.basename(abs))}`;
    };
    const html = (await core.exportHtml(name, { clean: true, compact: false, motion: false, link })).toString('utf8');
    const id = randomBytes(8).toString('hex');
    pages.set(id, html);
    try {
      // Пропорция слайда — из презентации: 16:9, 4:3 или 21:9
      const sw = widthOf(core.read(name) as { size?: unknown });
      const width = o.width ?? sw;
      const q = new URLSearchParams({ shot: o.slides.join(','), w: String(width), ...(o.look ? { look: o.look } : {}) });
      const height = Math.round((width * SLIDE_H) / sw);
      const shots = await shooter({ url: `${root}/p/${id}?${q}`, count: o.slides.length, width, height });
      if (shots.length !== o.slides.length) throw new Error('Снимок слайдов не удался: браузер вернул не все картинки');
      return shots;
    } finally {
      pages.delete(id);
    }
  }

  return { shoot };
}

export type Shots = ReturnType<typeof createShots>;
