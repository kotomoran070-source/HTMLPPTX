import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { parseDocument } from 'yaml';
import { mergeYaml } from './yaml-merge';

const VIRTUAL = 'virtual:decks';
const RESOLVED = '\0' + VIRTUAL;
/** Строки в deck.yaml, похожие на путь к файлу рядом с презентацией, превращаются в картинки */
const ASSET_RE = /^\.{1,2}\/[^\s]+\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mp3|woff2?|pdf)$/i;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
  woff: 'font/woff', woff2: 'font/woff2', pdf: 'application/pdf',
};
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
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
  /** Что редактор записал в deck.yaml последним: такое изменение не перезагружает страницу */
  const written = new Map<string, string>();

  /** Путь от корня проекта: /presentations/имя/… (одинаково работает на Windows) */
  const urlOf = (abs: string) => '/' + path.relative(root, abs).split(path.sep).join('/');
  const deckFile = (n: string) => path.join(dir, n, 'deck.yaml');

  const assertDeck = (name: string | null): string => {
    if (!name || !listDecks(dir).includes(name)) throw new Error(`Презентация «${name}» не найдена`);
    return name;
  };

  async function handleSave(name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = JSON.parse((await readBody(req)).toString('utf8')) as { deck?: unknown };
    if (!body.deck || typeof body.deck !== 'object') throw new Error('Нет данных презентации');
    // Адреса картинок из yarn dev (/presentations/имя/assets/x.png) → снова ./assets/x.png,
    // встроенные картинки (data:) → файлы в assets/: в deck.yaml остаются только пути
    const prefix = urlOf(path.join(dir, name)) + '/';
    const toPaths = (v: unknown): unknown => {
      if (typeof v === 'string') {
        const data = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,([a-z0-9+/=\s]+)$/i.exec(v);
        if (data) return saveDataUrl(name, data[1].toLowerCase(), Buffer.from(data[2], 'base64'));
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
    if (next !== source) {
      written.set(file, next);
      fs.writeFileSync(file, next);
    }
    send(res, 200, { ok: true, changed: next !== source });
  }

  function saveDataUrl(name: string, type: string, data: Buffer): string {
    const ext = type === 'jpeg' ? 'jpg' : type === 'svg+xml' ? 'svg' : type;
    const file = `image-${createHash('sha1').update(data).digest('hex').slice(0, 10)}.${ext}`;
    const assets = path.join(dir, name, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    const target = path.join(assets, file);
    if (!fs.existsSync(target)) fs.writeFileSync(target, data);
    return './assets/' + file;
  }

  async function handleAsset(name: string, fileName: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const safe = safeFileName(fileName);
    const ext = path.extname(safe).slice(1);
    if (!IMAGE_EXT.has(ext)) throw new Error('Поддерживаются картинки: png, jpg, gif, webp, avif, svg');
    const data = await readBody(req);
    if (!data.length) throw new Error('Пустой файл');
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

      s.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(API)) return next();
        try {
          if (req.method !== 'POST') return send(res, 405, { error: 'Только POST' });
          // Запросы только со страниц этого же сервера
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Чужой источник запроса' });
          const url = new URL(req.url, 'http://localhost');
          const name = assertDeck(url.searchParams.get('deck'));
          if (url.pathname === API + 'save') return await handleSave(name, req, res);
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
      const mine = written.get(ctx.file);
      if (mine !== undefined) {
        const now = await ctx.read();
        if (now === mine) return [];
        written.delete(ctx.file);
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
        return `const el = document.getElementById(${JSON.stringify(DATA_ID)});\n`
          + `export const decks = { ${JSON.stringify(opts.only)}: async () => JSON.parse(el.textContent) };\n`
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
      return out.replace('<body>', `<body>\n<script type="application/json" id="${DATA_ID}">${scriptJson(embedded)}</script>`);
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
