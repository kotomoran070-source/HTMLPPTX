import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { parseDocument } from 'yaml';
import { isLocal, remoteRelay } from './remote-relay.mjs';
import { ensureFirewall, firewallMessage } from './firewall.mjs';
import { stepToGlb, stlToGlb } from './model-convert';
import { AssetStore } from './assets';
import { BASE_ID, bindProject, importHtml, slug } from './import';
import { packDeck } from '../src/engine/pack';
import { mergeYaml } from './yaml-merge';

const VIRTUAL = 'virtual:decks';
const RESOLVED = '\0' + VIRTUAL;
/** Строки в deck.yaml, похожие на путь к файлу рядом с презентацией, превращаются в картинки */
const ASSET_RE = /^\.{1,2}\/[^\s]+\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mp3|glb|woff2?|pdf|htm)$/i;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', glb: 'model/gltf-binary',
  woff: 'font/woff', woff2: 'font/woff2', pdf: 'application/pdf',
  // Документы «живых» вставок (embed): .htm, чтобы Vite не принимал их за страницы приложения
  htm: 'text/html',
};
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
/**
 * Кроме картинок в assets/ можно положить видео, 3D-модели и документы живых вставок (.htm):
 * их переносит копирование слайда или объекта в другую презентацию
 */
const MEDIA_EXT = new Set([...IMAGE_EXT, 'mp4', 'webm', 'glb', 'htm']);
/** CAD и 3D-печать: при вставке превращаются в GLB (plugins/model-convert.ts) */
const CAD_EXT = new Set(['stl', 'step', 'stp']);
/** id тега с данными презентации внутри собранного HTML */
export const DATA_ID = 'htmlpptx-deck';
const API = '/__htmlpptx/';
const MAX_BODY = 60 * 1024 * 1024;

export interface DecksOptions {
  /** Папка с презентациями */
  dir: string;
  /** Собрать только эту презентацию (yarn build имя) */
  only?: string;
}

export function listDecks(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .filter((d) => fs.existsSync(path.join(dir, d.name, 'deck.yaml')))
    .map((d) => d.name)
    .sort();
}

/** Читает deck.yaml с понятной ошибкой: файл, строка, столбец. */
export function readYaml(file: string, source = fs.readFileSync(file, 'utf8')): unknown {
  const doc = parseDocument(source, { prettyErrors: true });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const where = e.linePos?.[0] ? `:${e.linePos[0].line}:${e.linePos[0].col}` : '';
    throw new Error(`Ошибка в ${path.relative(process.cwd(), file)}${where}\n${e.message}`);
  }
  return doc.toJS();
}

/** Обходит данные и заменяет строки-пути к файлам через fn. */
function mapAssets(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === 'string') return ASSET_RE.test(v) ? fn(v) : v;
  if (Array.isArray(v)) return v.map((x) => mapAssets(x, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapAssets(x, fn)]));
  return v;
}

/** JSON, который безопасно вставлять внутрь <script>. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Имя файла без опасных символов, с сохранением расширения. */
function safeFileName(name: string): string {
  const base = path.basename(name).normalize('NFC');
  const ext = path.extname(base).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const stem = base.slice(0, base.length - path.extname(base).length)
    .replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  return stem + ext;
}

/**
 * Презентации как данные:
 * - yarn dev: импорт *.yaml превращает YAML в JS, пути ./assets/… — в импорты картинок;
 *   режим правки сохраняет изменения обратно в deck.yaml через /__htmlpptx/save;
 * - yarn build имя: данные со встроенными картинками кладутся прямо в HTML
 *   (<script type="application/json">), чтобы сохранённая копия несла свои правки.
 */
export function decksPlugin(opts: DecksOptions): Plugin {
  const dir = path.resolve(opts.dir);
  let root = process.cwd();
  let server: ViteDevServer | undefined;
  /**
   * Что редактор записал в deck.yaml последним: такое изменение не перезагружает страницу.
   * Ключ — нормализованный путь: на Windows редактор пишет C:\\…\\deck.yaml, а Vite сообщает
   * об изменении C:/…/deck.yaml — без нормализации это разные строки и страница перезагружалась.
   */
  const written = new Map<string, { text: string; at: number }>();
  const fileKey = (f: string) => {
    const r = path.resolve(f).split(path.sep).join('/');
    return process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r;
  };

  /** Путь от корня проекта: /presentations/имя/… (одинаково работает на Windows) */
  const urlOf = (abs: string) => '/' + path.relative(root, abs).split(path.sep).join('/');
  const deckFile = (n: string) => path.join(dir, n, 'deck.yaml');

  const assertDeck = (name: string | null): string => {
    if (!name || !listDecks(dir).includes(name)) throw new Error(`Презентация «${name}» не найдена`);
    return name;
  };

  /**
   * Удаление с карточки на странице выбора: папка не стирается, а переносится в
   * presentations/.trash/<имя>-<время> — вернуть можно, перенеся её обратно.
   */
  function trashDeck(name: string): { trashed: string } {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const trash = path.join(dir, '.trash');
    fs.mkdirSync(trash, { recursive: true });
    const target = path.join(trash, `${name}-${stamp}`);
    fs.renameSync(path.join(dir, name), target);
    return { trashed: path.relative(root, target).split(path.sep).join('/') };
  }

  /**
   * Новая презентация со страницы выбора — то же, что yarn new: копия templates/basic.
   * Пустая — только титульный слайд; с примерами — весь шаблон. Папка — из названия латиницей.
   */
  function createDeck(rawTitle: string, sample: boolean): { name: string } {
    const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Новая презентация';
    const base = slug(title) || 'deck';
    const taken = new Set([...listDecks(dir), ...fs.readdirSync(dir)]);
    let name = base;
    for (let k = 2; taken.has(name); k++) name = `${base}-${k}`;
    const dst = path.join(dir, name);
    fs.cpSync(path.join(root, 'templates', 'basic'), dst, { recursive: true });
    const file = deckFile(name);
    let text = fs.readFileSync(file, 'utf8');
    if (!sample) {
      // Только титульный: без остальных слайдов и без текстов-заглушек
      const cut = text.indexOf('\n  - id: points');
      if (cut > 0) text = text.slice(0, cut + 1);
      text = text.replace(/^ {4}(lead|meta|notes): .*\n/gm, '');
    }
    // Кавычки и обратная косая черта в названии не ломают YAML
    fs.writeFileSync(file, text.replaceAll('{{title}}', title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')));
    return { name };
  }

  async function handleSave(name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = JSON.parse((await readBody(req)).toString('utf8')) as { deck?: unknown };
    if (!body.deck || typeof body.deck !== 'object') throw new Error('Нет данных презентации');
    // Адреса картинок из yarn dev (/presentations/имя/assets/x.png) → снова ./assets/x.png,
    // встроенные картинки (data:) → файлы в assets/: в deck.yaml остаются только пути
    const prefix = urlOf(path.join(dir, name)) + '/';
    const store = new AssetStore(path.join(dir, name));
    const toPaths = (v: unknown): unknown => {
      if (typeof v === 'string') {
        if (v.startsWith('data:')) return store.pathFor(v) ?? v;
        const clean = v.split('?')[0];
        return clean.startsWith(prefix) ? './' + decodeURI(clean.slice(prefix.length)) : v;
      }
      if (Array.isArray(v)) return v.map(toPaths);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPaths(x)]));
      return v;
    };
    const file = deckFile(name);
    const source = fs.readFileSync(file, 'utf8');
    const next = mergeYaml(source, toPaths(body.deck));
    store.flush();
    if (next !== source) {
      written.set(fileKey(file), { text: next, at: Date.now() });
      fs.writeFileSync(file, next);
    }
    send(res, 200, { ok: true, changed: next !== source });
  }

  async function handleImport(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Текст файла или JSON { html, raw }: снимок после скриптов и исходный файл (для живых слайдов)
    const body = (await readBody(req)).toString('utf8');
    let html = body;
    let raw: string | undefined;
    if (String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      const j = JSON.parse(body) as { html?: string; raw?: string };
      html = String(j.html ?? '');
      raw = typeof j.raw === 'string' ? j.raw : undefined;
    }
    const result = await importHtml(html, {
      raw,
      live: url.searchParams.get('live') === '1',
      dir,
      name: url.searchParams.get('deck') || undefined,
      fileName: url.searchParams.get('file') || undefined,
      dryRun: url.searchParams.get('dry') === '1',
      theme: url.searchParams.get('theme') !== '0',
    });
    send(res, 200, result);
  }

  async function handleAsset(name: string, fileName: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const safe = safeFileName(fileName);
    const ext = path.extname(safe).slice(1);
    const cad = CAD_EXT.has(ext.toLowerCase());
    if (!MEDIA_EXT.has(ext.toLowerCase()) && !cad) throw new Error('Поддерживаются изображения (PNG, JPG, GIF, WebP, AVIF, SVG), видео (MP4, WebM), 3D-модели (GLB, STL, STEP) и живые вставки (HTM)');
    let data = await readBody(req);
    if (!data.length) throw new Error('Пустой файл');
    if (cad) {
      // STL / STEP → GLB: на слайде это обычная 3D-модель
      data = ext.toLowerCase() === 'stl' ? stlToGlb(data) : await stepToGlb(data);
      return saveAsset(name, `${safe.slice(0, safe.length - ext.length - 1)}.glb`, data, res);
    }
    return saveAsset(name, safe, data, res);
  }

  function saveAsset(name: string, safe: string, data: Buffer, res: ServerResponse): void {
    const ext = path.extname(safe).slice(1);
    const assets = path.join(dir, name, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    let target = path.join(assets, safe);
    const stem = safe.slice(0, safe.length - ext.length - 1);
    // Такой же файл уже есть — используем его; другой с тем же именем — добавляем номер
    for (let i = 2; fs.existsSync(target); i++) {
      if (fs.readFileSync(target).equals(data)) break;
      target = path.join(assets, `${stem}-${i}.${ext}`);
    }
    if (!fs.existsSync(target)) fs.writeFileSync(target, data);
    send(res, 200, { url: urlOf(target), path: './assets/' + path.basename(target) });
  }

  return {
    name: 'htmlpptx-decks',
    enforce: 'pre',

    configResolved(c) {
      root = c.root;
    },

    configureServer(s) {
      server = s;
      const refresh = (file: string) => {
        if (!file.startsWith(dir) || path.basename(file) !== 'deck.yaml') return;
        const mod = s.moduleGraph.getModuleById(RESOLVED);
        if (mod) s.moduleGraph.invalidateModule(mod);
        s.ws.send({ type: 'full-reload' });
      };
      s.watcher.add(dir);
      s.watcher.on('add', refresh);
      s.watcher.on('unlink', refresh);

      // Пульт с телефона: пересылка сообщений показа (телефон в той же сети, yarn dev --host)
      s.middlewares.use((req, res, next) => {
        const net = () => {
          const a = s.httpServer?.address();
          const info = a && typeof a === 'object' ? a : null;
          return { port: info?.port ?? 5173, localOnly: !info || info.address === '127.0.0.1' || info.address === '::1' };
        };
        if (!remoteRelay(req, res, net)) next();
      });
      // yarn dev --host: пульт с телефона — брандмауэр Windows настраивается сам (один раз, с запросом администратора)
      s.httpServer?.once('listening', () => {
        const a = s.httpServer?.address();
        const host = a && typeof a === 'object' ? a.address : '127.0.0.1';
        if (host === '127.0.0.1' || host === '::1' || process.platform !== 'win32') return;
        void ensureFirewall({ log: (m) => s.config.logger.info(m) }).then((st) => {
          const msg = firewallMessage(st);
          if (msg) s.config.logger.info(msg);
        });
      });

      s.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(API)) return next();
        // С других устройств сети (yarn dev --host для пульта) проект только смотрят — не правят
        if (!isLocal(req)) return send(res, 403, { error: 'Правка проекта — только с этого компьютера' });
        try {
          if (req.method !== 'POST') return send(res, 405, { error: 'Только POST' });
          // Запросы только со страниц этого же сервера
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Чужой источник запроса' });
          const url = new URL(req.url, 'http://localhost');
          if (url.pathname === API + 'import') return await handleImport(url, req, res);
          // Для страницы выбора: когда каждую презентацию меняли в последний раз
          if (url.pathname === API + 'list') {
            return send(res, 200, listDecks(dir).map((n) => ({ name: n, mtime: Math.round(fs.statSync(deckFile(n)).mtimeMs) })));
          }
          if (url.pathname === API + 'create') return send(res, 200, createDeck(url.searchParams.get('title') ?? '', url.searchParams.get('sample') === '1'));
          const name = assertDeck(url.searchParams.get('deck'));
          if (url.pathname === API + 'delete') return send(res, 200, trashDeck(name));
          if (url.pathname === API + 'bind-theme') return send(res, 200, bindProject(dir, name, url.searchParams.get('dry') === '1'));
          if (url.pathname === API + 'save') return await handleSave(name, req, res);
          if (url.pathname === API + 'export') return await handleExport(root, name, url.searchParams.get('mode') === 'clean', res);
          if (url.pathname === API + 'asset') return await handleAsset(name, url.searchParams.get('name') ?? 'image.png', req, res);
          send(res, 404, { error: 'Неизвестная команда' });
        } catch (e) {
          s.config.logger.error(`[htmlpptx] ${(e as Error).message}`, { timestamp: true });
          send(res, 400, { error: (e as Error).message });
        }
      });
    },

    async handleHotUpdate(ctx) {
      // Файл записал редактор: страница уже показывает эти данные, перезагружать не нужно
      const key = fileKey(ctx.file);
      const mine = written.get(key);
      if (mine !== undefined) {
        const lf = (x: string) => x.replace(/\r\n/g, '\n');
        const now = lf(await ctx.read());
        if (now === lf(mine.text)) return [];
        // Файл ещё дописывается (на Windows событие приходит раньше конца записи): не перезагружаем
        if (Date.now() - mine.at < 1500 && lf(mine.text).startsWith(now)) return [];
        written.delete(key);
      }
      return undefined;
    },

    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },

    load(id) {
      if (id !== RESOLVED) return null;
      const all = listDecks(dir);
      if (opts.only) {
        if (!all.includes(opts.only)) {
          throw new Error(`Презентация «${opts.only}» не найдена. Есть: ${all.join(', ') || 'ни одной'}`);
        }
        // Данные лежат в HTML: так сохранённая из браузера копия несёт свои правки
        return `import { unpackDeck } from ${JSON.stringify(path.join(root, 'src/engine/pack.ts'))};\n`
          + `const el = document.getElementById(${JSON.stringify(DATA_ID)});\n`
          + `export const decks = { ${JSON.stringify(opts.only)}: async () => unpackDeck(JSON.parse(el.textContent)) };\n`
          + `export const fixed = ${JSON.stringify(opts.only)};\n`;
      }
      const entries = all.map((n) => `  ${JSON.stringify(n)}: () => import(${JSON.stringify(urlOf(deckFile(n)))}).then((m) => m.default)`);
      return `export const decks = {\n${entries.join(',\n')}\n};\nexport const fixed = null;\n`;
    },

    transform(code, id) {
      const file = id.split('?')[0];
      if (!/\.ya?ml$/.test(file)) return null;
      let data: unknown;
      try {
        data = readYaml(file, code);
      } catch (e) {
        if (!server) throw e;
        // В yarn dev показываем ошибку прямо на странице, а не «Failed to fetch module»
        const msg = (e as Error).message;
        server.config.logger.error(msg, { timestamp: true });
        return { code: `export default ${JSON.stringify({ __error: msg })};\n`, map: null };
      }
      const imports: string[] = [];
      const walked = mapAssets(data, (v) => {
        const abs = path.resolve(path.dirname(file), v);
        if (!fs.existsSync(abs)) {
          this.warn(`Файл не найден: ${v} (из ${path.relative(process.cwd(), file)})`);
          return v;
        }
        imports.push(v);
        return `__ASSET_${imports.length - 1}__`;
      });
      const json = JSON.stringify(walked, null, 1).replace(/"__ASSET_(\d+)__"/g, (_, i) => `__asset${i}`);
      const head = imports.map((p, i) => `import __asset${i} from ${JSON.stringify(p)};`).join('\n');
      return { code: `${head}\nexport default ${json};\n`, map: null };
    },

    transformIndexHtml(html) {
      if (!opts.only) return html;
      const file = deckFile(opts.only);
      const deck = readYaml(file) as { title?: string; lang?: string };
      const embedded = mapAssets(deck, (v) => {
        const abs = path.resolve(path.dirname(file), v);
        if (!fs.existsSync(abs)) {
          console.warn(`Файл не найден: ${v} (из ${path.relative(process.cwd(), file)})`);
          return v;
        }
        const ext = path.extname(abs).slice(1).toLowerCase();
        return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${fs.readFileSync(abs).toString('base64')}`;
      });
      let out = html;
      if (deck?.title) out = out.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(deck.title)}</title>`);
      if (deck?.lang) out = out.replace(/<html lang="[^"]*">/, `<html lang="${escapeHtml(deck.lang)}">`);
      // Рядом — исходная версия данных (с путями к файлам): по ней yarn merge-html сольёт правки из файла с проектом
      const base = { name: opts.only, deck };
      return out.replace('<body>', `<body>\n<script type="application/json" id="${DATA_ID}">${scriptJson(packDeck(embedded))}</script>`
        + `\n<script type="application/json" id="${BASE_ID}">${scriptJson(base)}</script>`);
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * «Экспорт» из редактора: та же сборка, что yarn build, в отдельном процессе и во временную папку
 * (сервер разработки не видит промежуточных файлов). Ответ — готовый HTML.
 */
function handleExport(root: string, name: string, clean: boolean, res: ServerResponse): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlpptx-export-'));
  const out = path.join(tmp, `${name}.html`);
  const args = [path.join(root, 'scripts/build.mjs'), name, `--out=${out}`, ...(clean ? ['--clean'] : [])];
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: root, env: { ...process.env, BUILD_TMP: tmp }, maxBuffer: 8 << 20 }, (err, _stdout, stderr) => {
      try {
        if (err || !fs.existsSync(out)) {
          const msg = (stderr || (err as Error | null)?.message || 'Сборка не удалась').trim().split('\n').slice(-3).join(' ');
          send(res, 500, { error: msg });
        } else {
          const body = fs.readFileSync(out);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
          res.end(body);
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        resolve();
      }
    });
  });
}
