import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { parse as parseYaml, parseDocument } from 'yaml';
import { denyPage, isLocal, lanPass, remoteRelay } from './remote-relay.mjs';
import { checkFirewall, checkMessage } from './firewall.mjs';
import { stepToGlb, stlToGlb } from './model-convert';
import { AssetStore } from './assets';
import { BASE_ID, bindProject, importHtml, slug } from './import';
import { importPptx } from './pptx/index';
import { merge3 } from '../src/engine/merge3';
import { packDeck } from '../src/engine/pack';
import { compactImage } from './optimize';
import { mergeYaml } from './yaml-merge';

const VIRTUAL = 'virtual:decks';
const RESOLVED = '\0' + VIRTUAL;
/** Строки в deck.yaml, похожие на путь к файлу рядом с презентацией, превращаются в картинки */
const ASSET_RE = /^\.{1,2}\/[^\s]+\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mp3|glb|woff2?|ttf|otf|pdf|htm|wasm|wad|cube)$/i;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', glb: 'model/gltf-binary',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf',
  // Документы «живых» вставок (embed): .htm, чтобы Vite не принимал их за страницы приложения
  htm: 'text/html',
  // Файлы для живых вставок (embed.files): движок WebAssembly и данные к нему (DOOM — .wad)
  wasm: 'application/wasm', wad: 'application/octet-stream',
};
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
/**
 * Кроме картинок в assets/ можно положить видео, 3D-модели и документы живых вставок (.htm):
 * их переносит копирование слайда или объекта в другую презентацию
 */
const MEDIA_EXT = new Set([...IMAGE_EXT, 'mp4', 'webm', 'glb', 'htm', 'woff2', 'woff', 'ttf', 'otf', 'wasm', 'wad', 'cube']);
/** CAD и 3D-печать: при вставке превращаются в GLB (plugins/model-convert.ts) */
const CAD_EXT = new Set(['stl', 'step', 'stp']);
/** id тега с данными презентации внутри собранного HTML */
export const DATA_ID = 'htmlpptx-deck';
const API = '/__htmlpptx/';
const MAX_BODY = 60 * 1024 * 1024;
/** Презентации PowerPoint с видео бывают большими */
const MAX_PPTX = 400 * 1024 * 1024;

export interface DecksOptions {
  /** Папка с презентациями */
  dir: string;
  /** Собрать только эту презентацию (yarn build имя) */
  only?: string;
  /** Общая библиотека шрифтов; по умолчанию — fonts/ в корне проекта */
  fonts?: string;
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

/** Все строки данных через fn */
function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}

/** Данные без параметров цветокоррекции картинок (grade: { src, … }) — для собранного файла */
function dropGrades(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropGrades);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k, x]) => !(k === 'grade' && x && typeof x === 'object' && typeof (x as { src?: unknown }).src === 'string'))
    .map(([k, x]) => [k, dropGrades(x)]));
}

/** JSON, который безопасно вставлять внутрь <script>. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
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

  /**
   * Адрес файла для страницы: от корня проекта — /presentations/имя/… (одинаково на Windows);
   * вне проекта (приложение: «Документы/Slideria») — /@fs/C:/…, так их отдаёт Vite
   */
  const urlOf = (abs: string) => {
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return '/' + rel.split(path.sep).join('/');
    return '/@fs/' + path.resolve(abs).split(path.sep).join('/').replace(/^\/+/, '');
  };
  /** Хвост адреса после prefix (адрес раскодирован: в путях бывает кириллица) или null */
  const fold = process.platform === 'win32' || process.platform === 'darwin' ? (x: string) => x.toLowerCase() : (x: string) => x;
  const under = (url: string, prefix: string): string | null => {
    let clean = url.split('?')[0];
    try { clean = decodeURI(clean); } catch { /* не адрес */ }
    return fold(clean).startsWith(fold(prefix)) ? clean.slice(prefix.length) : null;
  };
  const deckFile = (n: string) => path.join(dir, n, 'deck.yaml');

  const assertDeck = (name: string | null): string => {
    if (!name || !listDecks(dir).includes(name)) throw new Error(`Презентация «${name}» не найдена`);
    return name;
  };

  /**
   * Удаление с карточки на странице выбора: папка не стирается, а переносится в
   * presentations/.trash/<имя>-<время> — вернуть можно, перенеся её обратно.
   */
  /** Файлы презентации (assets/, вложенные папки тоже) с размерами — для сводки */
  function listAssets(name: string): { path: string; size: number }[] {
    const base = path.join(dir, name, 'assets');
    const out: { path: string; size: number }[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else out.push({ path: 'assets/' + path.relative(base, abs).split(path.sep).join('/'), size: fs.statSync(abs).size });
      }
    };
    walk(base);
    return out;
  }

  /**
   * Контрольные точки (Ctrl+S в студии): копии deck.yaml в presentations/.checkpoints/<имя>/<время>.yaml,
   * последние CHECKPOINTS. Та же, что последняя, не повторяется
   */
  const CHECKPOINTS = 30;
  const CP_ID = /^\d{8}-\d{6}(?:-\d+)?$/;
  const cpDir = (name: string) => path.join(dir, '.checkpoints', name);
  const cpList = (name: string) => (fs.existsSync(cpDir(name)) ? fs.readdirSync(cpDir(name)) : [])
    .filter((f) => f.endsWith('.yaml') && CP_ID.test(f.slice(0, -5))).sort();

  function makeCheckpoint(name: string): { id: string; time: number; same: boolean } {
    const text = fs.readFileSync(deckFile(name), 'utf8');
    const list = cpList(name);
    const last = list[list.length - 1];
    if (last && fs.readFileSync(path.join(cpDir(name), last), 'utf8') === text) {
      return { id: last.slice(0, -5), time: Math.round(fs.statSync(path.join(cpDir(name), last)).mtimeMs), same: true };
    }
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    let id = stamp;
    for (let i = 2; list.includes(`${id}.yaml`); i++) id = `${stamp}-${i}`;
    fs.mkdirSync(cpDir(name), { recursive: true });
    fs.writeFileSync(path.join(cpDir(name), `${id}.yaml`), text);
    for (const old of [...list, `${id}.yaml`].slice(0, -CHECKPOINTS)) fs.rmSync(path.join(cpDir(name), old), { force: true });
    return { id, time: d.getTime(), same: false };
  }

  /** Точки — новые первыми */
  function listCheckpoints(name: string): { id: string; time: number }[] {
    return cpList(name).reverse().map((f) => ({ id: f.slice(0, -5), time: Math.round(fs.statSync(path.join(cpDir(name), f)).mtimeMs) }));
  }

  function readCheckpoint(name: string, id: string): { deck: unknown } {
    if (!CP_ID.test(id) || !fs.existsSync(path.join(cpDir(name), `${id}.yaml`))) throw new Error('Контрольная точка не найдена');
    return { deck: parseYaml(fs.readFileSync(path.join(cpDir(name), `${id}.yaml`), 'utf8')) };
  }

  /** Неиспользуемые файлы — в корзину проекта (.trash/<презентация>-files-<время>), не насовсем */
  function trashAssets(name: string, list: unknown): { moved: number } {
    if (!Array.isArray(list)) throw new Error('Нужен список файлов');
    const base = path.join(dir, name, 'assets');
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const target = path.join(dir, '.trash', `${name}-files-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`);
    let moved = 0;
    for (const rel of list) {
      if (typeof rel !== 'string' || !rel.startsWith('assets/')) continue;
      const abs = path.resolve(base, rel.slice('assets/'.length));
      // Только файлы внутри assets/ этой презентации
      if (!abs.startsWith(base + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const to = path.join(target, path.relative(base, abs));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try { fs.renameSync(abs, to); } catch { fs.copyFileSync(abs, to); fs.unlinkSync(abs); }
      moved++;
    }
    return { moved };
  }

  function trashDeck(name: string): { trashed: string } {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const trash = path.join(dir, '.trash');
    fs.mkdirSync(trash, { recursive: true });
    const target = path.join(trash, `${name}-${stamp}`);
    const src = path.join(dir, name);
    // Windows не даёт переименовать папку, за которой следит сервер (EPERM / EBUSY):
    // снимаем наблюдение, пробуем ещё раз, в крайнем случае — копия в корзину и удаление
    server?.watcher.unwatch(src);
    let moved = false;
    for (let i = 0; i < 6 && !moved; i++) {
      try {
        fs.renameSync(src, target);
        moved = true;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      }
    }
    if (!moved) {
      fs.cpSync(src, target, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    }
    return { trashed: path.relative(path.dirname(dir), target).split(path.sep).join('/') };
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
      // Только титульный: всё со второго слайда отрезается, у титула — без текстов-заглушек
      // (поле с многострочным значением «notes: |» — вместе с его строками)
      const starts = [...text.matchAll(/\n {2}- id: /g)].map((m) => m.index!);
      if (starts.length > 1) text = text.slice(0, starts[1] + 1);
      text = text.replace(/^ {4}(lead|meta|notes):(?: \|-?\n(?: {6}.*\n|\s*\n)*| .*\n)/gm, '');
      // Картинки нужны только слайдам с примерами: в пустой презентации остаётся логотип
      const assets = path.join(dst, 'assets');
      for (const f of fs.readdirSync(assets)) if (f !== 'logo.svg') fs.rmSync(path.join(assets, f), { force: true });
    }
    // Кавычки и обратная косая черта в названии не ломают YAML
    fs.writeFileSync(file, text.replaceAll('{{title}}', title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')));
    return { name };
  }

  /**
   * Запись данных из окна. base — версия, с которой окно начинало: тогда из его данных берётся только
   * то, что оно поменяло само, а чужие правки в файле (заметки из окна докладчика, вторая вкладка)
   * остаются. Итог с чужими правками возвращается окну (deck), а остальным окнам этой презентации
   * сообщается, что файл изменился
   */
  async function handleSave(name: string, req: IncomingMessage, res: ServerResponse, from: string): Promise<void> {
    const body = JSON.parse((await readBody(req)).toString('utf8')) as { deck?: unknown; base?: unknown };
    if (!body.deck || typeof body.deck !== 'object') throw new Error('Нет данных презентации');
    // Адреса картинок из yarn dev (/presentations/имя/assets/x.png) → снова ./assets/x.png,
    // встроенные картинки (data:) → файлы в assets/: в deck.yaml остаются только пути
    const prefix = urlOf(path.join(dir, name)) + '/';
    const store = new AssetStore(path.join(dir, name));
    const toPaths = (v: unknown): unknown => {
      if (typeof v === 'string') {
        if (v.startsWith('data:')) return store.pathFor(v) ?? v;
        const rest = under(v, prefix);
        return rest !== null ? './' + rest : v;
      }
      if (Array.isArray(v)) return v.map(toPaths);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPaths(x)]));
      return v;
    };
    const file = deckFile(name);
    const source = fs.readFileSync(file, 'utf8');
    let data = toPaths(body.deck);
    let theirs: unknown;
    let disk: unknown = null;
    try { disk = readYaml(file, source); } catch { /* файл правили руками и сломали — пишем как есть */ }
    if (disk && body.base && typeof body.base === 'object') {
      // База — только для сравнения: встроенные картинки в ней в файлы не превращаются
      const base = mapStrings(body.base, (v) => { const rest = under(v, prefix); return rest !== null ? './' + rest : v; });
      const m = merge3(base, data, disk);
      data = m.result;
      if (m.changed) theirs = mapAssets(m.result, (v) => { const abs = path.resolve(dir, name, v); return fs.existsSync(abs) ? urlOf(abs) : v; });
    }
    const next = mergeYaml(source, data);
    store.flush();
    if (next !== source) {
      written.set(fileKey(file), { text: next, at: Date.now() });
      fs.writeFileSync(file, next);
      server?.ws.send({ type: 'custom', event: 'slideria:deck-saved', data: { name, from } });
    }
    send(res, 200, { ok: true, changed: next !== source, deck: theirs });
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

  /** PowerPoint (.pptx) → новая презентация; dry=1 — только отчёт, без записи */
  async function handleImportPptx(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const data = await readBody(req, MAX_PPTX);
    if (!data.length) throw new Error('Пустой файл');
    if (data.subarray(0, 2).toString('latin1') !== 'PK') throw new Error('Это не файл PowerPoint (.pptx). Старый формат .ppt сначала пересохраните в PowerPoint как .pptx');
    const name = url.searchParams.get('deck') || undefined;
    if (name && !/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new Error('Имя презентации: латиница, цифры, дефис');
    const result = await importPptx(data, { dir, name, fileName: url.searchParams.get('file') || undefined, dryRun: url.searchParams.get('dry') === '1' });
    send(res, 200, result);
  }

  /**
   * Код живой вставки правят в студии (панель «Код» → «Анимации»): файл assets/*.htm
   * перезаписывается на месте, а не копией — иначе каждая правка давала бы новый файл
   */
  async function handleAssetText(name: string, assetUrl: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const prefix = urlOf(path.join(dir, name, 'assets')) + '/';
    let file = under(assetUrl, prefix) ?? '';
    try { file = decodeURIComponent(file); } catch { /* уже раскодирован */ }
    if (!file || /[\\/]|\.\./.test(file) || !/\.html?$/i.test(file)) throw new Error('Перезаписать можно только файл живой вставки (.htm) этой презентации');
    const target = path.join(dir, name, 'assets', file);
    if (!fs.existsSync(target)) throw new Error('Файла вставки нет — его переместили или удалили');
    const text = (await readBody(req)).toString('utf8');
    // Страница уже показывает новый код: Vite не должен перезагружать её из-за этого файла
    written.set(fileKey(target), { text, at: Date.now() });
    fs.writeFileSync(target, text);
    send(res, 200, { ok: true });
  }

  async function handleAsset(name: string, fileName: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const safe = safeFileName(fileName);
    const ext = path.extname(safe).slice(1);
    const cad = CAD_EXT.has(ext.toLowerCase());
    if (!MEDIA_EXT.has(ext.toLowerCase()) && !cad) throw new Error('Поддерживаются изображения (PNG, JPG, GIF, WebP, AVIF, SVG), видео (MP4, WebM), 3D-модели (GLB, STL, STEP) живые вставки (HTM, WASM, WAD), шрифты (WOFF2, WOFF, TTF, OTF) и LUT (.cube)');
    let data = await readBody(req);
    if (!data.length) throw new Error('Пустой файл');
    if (cad) {
      // STL / STEP → GLB: на слайде это обычная 3D-модель
      data = ext.toLowerCase() === 'stl' ? stlToGlb(data) : await stepToGlb(data);
      return saveAsset(name, `${safe.slice(0, safe.length - ext.length - 1)}.glb`, data, res);
    }
    return saveAsset(name, safe, data, res);
  }

  // ---------- общая библиотека шрифтов ----------
  const FONT_EXT = /\.(woff2?|ttf|otf)$/i;
  const fontsDir = () => opts.fonts ? path.resolve(opts.fonts) : path.join(root, 'fonts');
  function listFonts(): { file: string; url: string }[] {
    if (!fs.existsSync(fontsDir())) return [];
    return fs.readdirSync(fontsDir()).filter((f) => FONT_EXT.test(f)).sort().map((f) => ({ file: f, url: urlOf(path.join(fontsDir(), f)) }));
  }
  /** Шрифт в библиотеку; такой же файл уже есть — второй не появляется */
  function saveLibraryFont(fileName: string, data: Buffer): { file: string } {
    const safe = safeFileName(fileName);
    if (!FONT_EXT.test(safe)) throw new Error('Подойдут шрифты WOFF2, WOFF, TTF или OTF');
    if (!data.length) throw new Error('Пустой файл');
    fs.mkdirSync(fontsDir(), { recursive: true });
    const target = path.join(fontsDir(), safe);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(data)) return { file: safe };
    let file = safe;
    for (let i = 2; fs.existsSync(path.join(fontsDir(), file)); i++) file = safe.replace(FONT_EXT, (m) => `-${i}${m}`);
    fs.writeFileSync(path.join(fontsDir(), file), data);
    return { file };
  }
  /** Шрифт из библиотеки — копией в assets/ презентации: собранный файл несёт его с собой */
  function useLibraryFont(name: string, fileName: string, res: ServerResponse): void {
    const safe = path.basename(fileName);
    const src = path.join(fontsDir(), safe);
    if (!FONT_EXT.test(safe) || !fs.existsSync(src)) throw new Error('Шрифта нет в библиотеке');
    const own = path.join(dir, name, 'assets', safe);
    if (fs.existsSync(own) && fs.readFileSync(own).equals(fs.readFileSync(src))) return send(res, 200, { url: urlOf(own), path: './assets/' + safe });
    return saveAsset(name, safe, fs.readFileSync(src), res);
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
        const net = async () => {
          // Приложение (desktop/main.mjs): сервер виден только этому компьютеру, а для телефона
          // по запросу открывается отдельный вход в сети — только для показа
          const lan = (globalThis as { __slideriaLan?: (deck: string) => Promise<number | null> }).__slideriaLan;
          if (lan) {
            // Телефону видна только презентация, которую показывают
            const deck = new URL(req.url ?? '/', 'http://local').searchParams.get('deck') ?? '';
            const port = isLocal(req) && listDecks(dir).includes(deck) ? await lan(deck) : null;
            const firewall = !!(globalThis as { __slideriaFirewall?: unknown }).__slideriaFirewall;
            return { port: port ?? 0, localOnly: !port, app: true, firewall };
          }
          const a = s.httpServer?.address();
          const info = a && typeof a === 'object' ? a : null;
          return { port: info?.port ?? 5173, localOnly: !info || info.address === '127.0.0.1' || info.address === '::1' };
        };
        if (remoteRelay(req, res, net)) return;
        // yarn dev --host: из сети — только телефону с пропуском (одноразовая ссылка из QR)
        if (!lanPass(req)) {
          if (req.method === 'GET' && /text\/html/.test(req.headers.accept ?? '')) return denyPage(res);
          res.statusCode = 403;
          res.end();
          return;
        }
        next();
      });
      // yarn dev --host: пульт с телефона — брандмауэр Windows только проверяется (без запроса администратора);
      // если что-то мешает, в терминале подсказка: yarn firewall
      s.httpServer?.once('listening', () => {
        const a = s.httpServer?.address();
        const host = a && typeof a === 'object' ? a.address : '127.0.0.1';
        if (host === '127.0.0.1' || host === '::1' || process.platform !== 'win32') return;
        void checkFirewall().then((st) => {
          const msg = checkMessage(st);
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
          if (url.pathname === API + 'import-pptx') return await handleImportPptx(url, req, res);
          // Для страницы выбора: когда каждую презентацию меняли в последний раз
          if (url.pathname === API + 'list') {
            return send(res, 200, listDecks(dir).map((n) => ({ name: n, mtime: Math.round(fs.statSync(deckFile(n)).mtimeMs) })));
          }
          if (url.pathname === API + 'create') return send(res, 200, createDeck(url.searchParams.get('title') ?? '', url.searchParams.get('sample') === '1'));
          // Общая библиотека шрифтов: папка fonts/ в корне проекта — видна во всех презентациях
          if (url.pathname === API + 'font-list') return send(res, 200, listFonts());
          // Приложение под Windows: разрешить пульт в брандмауэре (desktop/firewall.mjs)
          if (url.pathname === API + 'firewall') {
            const fix = (globalThis as { __slideriaFirewall?: () => Promise<string> }).__slideriaFirewall;
            return send(res, 200, { state: fix ? await fix() : 'skip' });
          }
          if (url.pathname === API + 'font-save') return send(res, 200, saveLibraryFont(url.searchParams.get('file') ?? '', await readBody(req)));
          const name = assertDeck(url.searchParams.get('deck'));
          if (url.pathname === API + 'delete') return send(res, 200, trashDeck(name));
          if (url.pathname === API + 'assets-list') return send(res, 200, listAssets(name));
          if (url.pathname === API + 'checkpoint') return send(res, 200, makeCheckpoint(name));
          if (url.pathname === API + 'checkpoints') return send(res, 200, listCheckpoints(name));
          if (url.pathname === API + 'checkpoint-read') return send(res, 200, readCheckpoint(name, url.searchParams.get('id') ?? ''));
          if (url.pathname === API + 'assets-trash') return send(res, 200, trashAssets(name, JSON.parse((await readBody(req)).toString('utf8') || '[]')));
          if (url.pathname === API + 'font-use') return useLibraryFont(name, url.searchParams.get('file') ?? '', res);
          if (url.pathname === API + 'bind-theme') return send(res, 200, bindProject(dir, name, url.searchParams.get('dry') === '1'));
          if (url.pathname === API + 'save') return await handleSave(name, req, res, url.searchParams.get('from') ?? '');
          if (url.pathname === API + 'export') return await handleExport(root, name, url.searchParams.get('mode') === 'clean', url.searchParams.get('quality') === 'compact', res);
          if (url.pathname === API + 'asset') return await handleAsset(name, url.searchParams.get('name') ?? 'image.png', req, res);
          if (url.pathname === API + 'asset-text') return await handleAssetText(name, url.searchParams.get('url') ?? '', req, res);
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
        // .wasm и .wad — просто файлы: адрес, а не модуль (у Vite свой разбор .wasm)
        imports.push(/\.(wasm|wad)$/i.test(v) ? `${v}?url` : v);
        return `__ASSET_${imports.length - 1}__`;
      });
      const json = JSON.stringify(walked, null, 1).replace(/"__ASSET_(\d+)__"/g, (_, i) => `__asset${i}`);
      const head = imports.map((p, i) => `import __asset${i} from ${JSON.stringify(p)};`).join('\n');
      return { code: `${head}\nexport default ${json};\n`, map: null };
    },

    async transformIndexHtml(html) {
      if (!opts.only) return html;
      const file = deckFile(opts.only);
      // Цветокоррекция (grade у картинки) нужна только для правки в студии: исходники и LUT в файл не едут
      const deck = dropGrades(readYaml(file)) as { title?: string; lang?: string };
      // Компактный файл (--compact): картинки заранее сжимаются в WebP, видео и модели — как есть
      const packed = new Map<string, { mime: string; data: Buffer }>();
      if (process.env.COMPACT === '1') {
        const files = new Set<string>();
        mapAssets(deck, (v) => { files.add(path.resolve(path.dirname(file), v)); return v; });
        await Promise.all([...files].filter((abs) => fs.existsSync(abs)).map(async (abs) => {
          const r = await compactImage(fs.readFileSync(abs), path.extname(abs).slice(1));
          if (r) packed.set(abs, r);
        }));
      }
      const embedded = mapAssets(deck, (v) => {
        const abs = path.resolve(path.dirname(file), v);
        if (!fs.existsSync(abs)) {
          console.warn(`Файл не найден: ${v} (из ${path.relative(process.cwd(), file)})`);
          return v;
        }
        const small = packed.get(abs);
        if (small) return `data:${small.mime};base64,${small.data.toString('base64')}`;
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
function handleExport(root: string, name: string, clean: boolean, compact: boolean, res: ServerResponse): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlpptx-export-'));
  const out = path.join(tmp, `${name}.html`);
  const args = [path.join(root, 'scripts/build.mjs'), name, `--out=${out}`, ...(clean ? ['--clean'] : []), ...(compact ? ['--compact'] : [])];
  return new Promise((resolve) => {
    // В приложении process.execPath — сам Electron: ELECTRON_RUN_AS_NODE запускает его как обычный Node
    const env = { ...process.env, BUILD_TMP: tmp, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
    execFile(process.execPath, args, { cwd: root, env, maxBuffer: 8 << 20 }, (err, _stdout, stderr) => {
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
