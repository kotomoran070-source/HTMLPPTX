/**
 * Ядро сервера Slideria: презентации на диске и всё, что с ними делают страницы студии, — список, создание,
 * удаление в корзину, запись со слиянием чужих правок, контрольные точки, файлы презентации, библиотека шрифтов,
 * свои темы и шаблоны, импорт HTML и PowerPoint, экспорт в один HTML-файл.
 *
 * Без HTTP и без Vite: тем же ядром пользуются сервер разработки (plugins/decks.ts), HTTP-обработчик
 * (server/http.ts), а дальше — программа без Vite, команды для MCP и облако. С хозяином ядро связано
 * событиями (on) и несколькими крючками (CoreHooks): как отпустить наблюдение за папкой, чем запускать сборку
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parse as parseYaml } from 'yaml';
import { merge3 } from '../src/engine/merge3';
import { packDeck } from '../src/engine/pack';
import { fontRights } from '../src/engine/font-license';
import { AssetStore } from '../plugins/assets';
import { BASE_ID, bindProject, importHtml, slug, type BindResult, type ImportResult } from '../plugins/import';
import { importPptx } from '../plugins/pptx/index';
import { stepToGlb, stlToGlb } from '../plugins/model-convert';
import { compactImage } from '../plugins/optimize';
import { mergeYaml } from '../plugins/yaml-merge';
import { DATA_ID, MIME, dropGrades, escapeHtml, listDecks, mapAssets, mapStrings, readYaml, safeFileName, scriptJson, stamp } from './deck-files';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
/**
 * Кроме картинок в assets/ можно положить видео, 3D-модели и документы живых вставок (.htm):
 * их переносит копирование слайда или объекта в другую презентацию
 */
const MEDIA_EXT = new Set([...IMAGE_EXT, 'mp4', 'webm', 'glb', 'htm', 'woff2', 'woff', 'ttf', 'otf', 'wasm', 'wad', 'cube']);
/** CAD и 3D-печать: при вставке превращаются в GLB (plugins/model-convert.ts) */
const CAD_EXT = new Set(['stl', 'step', 'stp']);
const FONT_EXT = /\.(woff2?|ttf|otf)$/i;
/** Контрольные точки (Ctrl+S в студии): сколько хранить и как называются */
const CHECKPOINTS = 30;
const CP_ID = /^\d{8}-\d{6}(?:-\d+)?$/;
/** Свои библиотеки студии: по файлу на запись (<вид>/<id>.json) — окна студии пишут каждое своё, не затирая чужие */
const LIB_KINDS = ['themes', 'templates', 'effects', 'looks'];
const LIB_ID = /^[\w-]{1,64}$/;

/** Запуск скрипта сборки отдельным процессом: код выхода и сообщения об ошибках */
export type Runner = (script: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ code: number | null; stderr: string }>;

/** Сборка тем же Node, что и сервер, отдельным процессом */
export const nodeRunner: Runner = (script, args, o) => new Promise((done) => {
  execFile(process.execPath, [script, ...args], { ...o, maxBuffer: 8 << 20 }, (err, _stdout, stderr) => done({ code: err ? 1 : 0, stderr: stderr || (err?.message ?? '') }));
});

/** Связь с хозяином: всё необязательно, без крючка — разумное поведение по умолчанию */
export interface CoreHooks {
  /**
   * Отпустить наблюдение за этими путями на время переноса папки в корзину (Windows не даёт переименовать
   * папку, за которой следят). Возвращает функцию, которая снова разрешает наблюдение
   */
  release?(paths: string[]): () => void;
  /** Чем запускать сборку экспорта; по умолчанию — этот же Node отдельным процессом */
  run?: Runner;
}

export interface CoreOptions {
  /** Папка с презентациями */
  dir: string;
  /** Корень программы: шаблон новой презентации (templates/basic), сборка (scripts/build.mjs) */
  root: string;
  /** Общая библиотека шрифтов; по умолчанию — fonts/ в корне */
  fonts?: string;
  /** Свои темы, шаблоны, эффекты и образы студии; по умолчанию — library/ в корне */
  library?: string;
  /** Адрес файла для страниц; по умолчанию — от корня (/presentations/…) или /@fs/… вне его */
  urlOf?: (abs: string) => string;
  hooks?: CoreHooks;
}

/** События для страниц: записали презентацию (from — окно, которое записало), удалили презентацию */
export interface CoreEvents {
  saved: { name: string; from: string };
  removed: { name: string };
}

export interface SaveRequest {
  /** Данные из окна: адреса файлов — как их видит страница, картинки могут быть встроены (data:) */
  deck: unknown;
  /** Версия, с которой окно начинало: из окна берётся только то, что оно поменяло само */
  base?: unknown;
  /** Какое окно записывает: ему сообщение о записи не нужно */
  from?: string;
}

export interface SaveResult {
  ok: true;
  changed: boolean;
  /** Итог с чужими правками — окну, если в файле было то, чего оно не видело */
  deck?: unknown;
  /** Записанное — так, как оно читается из файла: окно сверяется с ним при следующей записи */
  base: unknown;
}

export interface ExportOptions {
  /** «Для показа»: без режима правки */
  clean: boolean;
  /** Картинки сжаты в WebP */
  compact: boolean;
  /** «Как на этом компьютере»: вид слайдов автора и анимации при «Уменьшить движение» у зрителя */
  look?: 'light' | 'dark';
  motion: boolean;
}

export interface FileRef { url: string; path: string }

/** Сборка экспорта не удалась: это сбой программы, а не неверный запрос (HTTP 500) */
export class ExportError extends Error {}

export type DecksCore = ReturnType<typeof createDecksCore>;

export function createDecksCore(opts: CoreOptions) {
  const dir = path.resolve(opts.dir);
  const root = path.resolve(opts.root);
  const hooks = opts.hooks ?? {};

  // ---------------- события ----------------
  const listeners = new Map<keyof CoreEvents, Set<(e: never) => void>>();
  function on<K extends keyof CoreEvents>(type: K, fn: (e: CoreEvents[K]) => void): () => void {
    let set = listeners.get(type);
    if (!set) listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => { set.delete(fn); };
  }
  function emit<K extends keyof CoreEvents>(type: K, e: CoreEvents[K]): void {
    listeners.get(type)?.forEach((fn) => (fn as (e: CoreEvents[K]) => void)(e));
  }

  // ---------------- адреса ----------------
  /**
   * Адрес файла для страницы: от корня — /presentations/имя/… (одинаково на Windows);
   * вне корня (приложение: «Документы/Slideria») — /@fs/C:/…
   */
  const urlOf = opts.urlOf ?? ((abs: string) => {
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return '/' + rel.split(path.sep).join('/');
    return '/@fs/' + path.resolve(abs).split(path.sep).join('/').replace(/^\/+/, '');
  });
  /** Хвост адреса после prefix (адрес раскодирован: в путях бывает кириллица) или null */
  const fold = process.platform === 'win32' || process.platform === 'darwin' ? (x: string) => x.toLowerCase() : (x: string) => x;
  const under = (url: string, prefix: string): string | null => {
    let clean = url.split('?')[0];
    try { clean = decodeURI(clean); } catch { /* не адрес */ }
    return fold(clean).startsWith(fold(prefix)) ? clean.slice(prefix.length) : null;
  };

  // ---------------- свои записи ----------------
  /**
   * Что сервер записал в файл последним: такое изменение не должно перезагружать страницу, она уже его
   * показывает. Ключ — нормализованный путь: на Windows запись идёт в C:\\…\\deck.yaml, а наблюдение
   * сообщает о C:/…/deck.yaml — без нормализации это разные строки
   */
  const written = new Map<string, { text: string; at: number }>();
  const fileKey = (f: string) => {
    const r = path.resolve(f).split(path.sep).join('/');
    return process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r;
  };
  function remember(file: string, text: string): void {
    written.set(fileKey(file), { text, at: Date.now() });
  }
  /** Этот файл сервер записывал сам (дальше — сверить содержимое: ownWrite) */
  const wrote = (file: string) => written.has(fileKey(file));
  /**
   * Изменение файла — запись самого сервера: страницу перезагружать не нужно. now — содержимое файла сейчас.
   * Файл ещё дописывается (на Windows событие приходит раньше конца записи) — тоже своё
   */
  function ownWrite(file: string, now: string): boolean {
    const key = fileKey(file);
    const mine = written.get(key);
    if (!mine) return false;
    const lf = (x: string) => x.replace(/\r\n/g, '\n');
    if (lf(now) === lf(mine.text)) return true;
    if (Date.now() - mine.at < 1500 && lf(mine.text).startsWith(lf(now))) return true;
    written.delete(key);
    return false;
  }

  // ---------------- презентации ----------------
  const deckFile = (n: string) => path.join(dir, n, 'deck.yaml');
  const names = () => listDecks(dir);
  const assertDeck = (name: string | null | undefined): string => {
    if (!name || !names().includes(name)) throw new Error(`Презентация «${name}» не найдена`);
    return name;
  };

  /** Для страницы выбора: когда каждую презентацию меняли в последний раз */
  function list(): { name: string; mtime: number }[] {
    return names().map((n) => ({ name: n, mtime: Math.round(fs.statSync(deckFile(n)).mtimeMs) }));
  }

  /**
   * Данные презентации. urls — пути к файлам (./assets/…) заменены адресами для страницы, как их видит
   * студия; без него — как в deck.yaml
   */
  function read(name: string, o: { urls?: boolean } = {}): unknown {
    const file = deckFile(assertDeck(name));
    const data = readYaml(file);
    if (!o.urls) return data;
    return mapAssets(data, (v) => {
      const abs = path.resolve(path.dirname(file), v);
      return fs.existsSync(abs) ? urlOf(abs) : v;
    });
  }

  /**
   * Новая презентация со страницы выбора — то же, что yarn new: копия templates/basic.
   * Пустая — только титульный слайд; с примерами — весь шаблон. Папка — из названия латиницей.
   */
  function create(rawTitle: string, sample: boolean): { name: string } {
    const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Новая презентация';
    const base = slug(title) || 'deck';
    fs.mkdirSync(dir, { recursive: true });
    const taken = new Set([...names(), ...fs.readdirSync(dir)]);
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

  /** Презентации, которые сейчас уходят в корзину: события наблюдения за их папкой — не правка */
  const trashing = new Set<string>();
  /** Папка и всё внутри: наблюдение снимается со всего — вложенные папки (assets/) тоже держат её на Windows */
  const tree = (p: string): string[] => [p, ...fs.readdirSync(p, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tree(path.join(p, e.name)) : [path.join(p, e.name)]))];

  /**
   * Удаление: папка не стирается, а переносится в .trash/<имя>-<время> — вернуть можно, перенеся её обратно.
   * Мгновенно (переименование). Windows не даёт переименовать папку, пока за ней следят (EPERM / EBUSY):
   * наблюдение снимается со всей папки (крючок release), попытки повторяются, не останавливая сервер, —
   * иначе всё кончалось бы копированием всей презентации (с картинками и видео) в корзину.
   * Страницы узнают об удалении событием removed и убирают карточку на месте — без перезагрузки
   */
  async function trash(name: string): Promise<{ trashed: string }> {
    assertDeck(name);
    const trashDir = path.join(dir, '.trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const target = path.join(trashDir, `${name}-${stamp()}`);
    const src = path.join(dir, name);
    trashing.add(name);
    const restore = hooks.release?.(tree(src));
    try {
      let moved = false;
      for (let i = 0; i < 16 && !moved; i++) {
        try {
          await fs.promises.rename(src, target);
          moved = true;
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw e;
          await new Promise((r) => setTimeout(r, 50 + i * 25));
        }
      }
      if (!moved) {
        await fs.promises.cp(src, target, { recursive: true });
        await fs.promises.rm(src, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    } finally {
      // События наблюдения могут прийти и после переименования
      setTimeout(() => trashing.delete(name), 3000);
      restore?.();
    }
    emit('removed', { name });
    return { trashed: path.relative(path.dirname(dir), target).split(path.sep).join('/') };
  }

  /** Папку этой презентации сейчас переносят в корзину: её исчезновение — не правка файлов */
  const isTrashing = (name: string) => trashing.has(name);

  // ---------------- запись ----------------
  /**
   * Запись данных из окна. base — версия, с которой окно начинало: тогда из его данных берётся только
   * то, что оно поменяло само, а чужие правки в файле (заметки из окна докладчика, вторая вкладка)
   * остаются. Итог с чужими правками возвращается окну (deck), а остальным окнам этой презентации
   * сообщается, что файл изменился (событие saved)
   */
  function save(name: string, req: SaveRequest): SaveResult {
    assertDeck(name);
    if (!req.deck || typeof req.deck !== 'object') throw new Error('Нет данных презентации');
    // Адреса файлов страницы (/presentations/имя/assets/x.png) → снова ./assets/x.png,
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
    let data = toPaths(req.deck);
    let theirs: unknown;
    let disk: unknown = null;
    try { disk = readYaml(file, source); } catch { /* файл правили руками и сломали — пишем как есть */ }
    if (disk && req.base && typeof req.base === 'object') {
      // База — только для сравнения: встроенные картинки в ней в файлы не превращаются
      const base = mapStrings(req.base, (v) => { const rest = under(v, prefix); return rest !== null ? './' + rest : v; });
      const m = merge3(base, data, disk);
      data = m.result;
      if (m.changed) theirs = mapAssets(m.result, (v) => { const abs = path.resolve(dir, name, v); return fs.existsSync(abs) ? urlOf(abs) : v; });
    }
    const next = mergeYaml(source, data);
    store.flush();
    if (next !== source) {
      remember(file, next);
      fs.writeFileSync(file, next);
      emit('saved', { name, from: req.from ?? '' });
    }
    // Записанное — так, как оно читается из файла: мелкие расхождения записи (перевод строки в конце CSS)
    // иначе выглядели бы чужими правками
    let saved: unknown = null;
    try { saved = next === source && disk ? disk : readYaml(file, next); } catch { /* сломанный файл */ }
    return { ok: true, changed: next !== source, ...(theirs !== undefined ? { deck: theirs } : {}), base: saved };
  }

  // ---------------- контрольные точки ----------------
  // Копии deck.yaml в .checkpoints/<имя>/<время>.yaml, последние CHECKPOINTS. Та же, что последняя, не повторяется
  const cpDir = (name: string) => path.join(dir, '.checkpoints', name);
  const cpList = (name: string) => (fs.existsSync(cpDir(name)) ? fs.readdirSync(cpDir(name)) : [])
    .filter((f) => f.endsWith('.yaml') && CP_ID.test(f.slice(0, -5))).sort();

  function checkpoint(name: string): { id: string; time: number; same: boolean } {
    const text = fs.readFileSync(deckFile(assertDeck(name)), 'utf8');
    const list = cpList(name);
    const last = list[list.length - 1];
    if (last && fs.readFileSync(path.join(cpDir(name), last), 'utf8') === text) {
      return { id: last.slice(0, -5), time: Math.round(fs.statSync(path.join(cpDir(name), last)).mtimeMs), same: true };
    }
    const d = new Date();
    const base = stamp(d);
    let id = base;
    for (let i = 2; list.includes(`${id}.yaml`); i++) id = `${base}-${i}`;
    fs.mkdirSync(cpDir(name), { recursive: true });
    fs.writeFileSync(path.join(cpDir(name), `${id}.yaml`), text);
    for (const old of [...list, `${id}.yaml`].slice(0, -CHECKPOINTS)) fs.rmSync(path.join(cpDir(name), old), { force: true });
    return { id, time: d.getTime(), same: false };
  }

  /** Точки — новые первыми */
  function checkpoints(name: string): { id: string; time: number }[] {
    assertDeck(name);
    return cpList(name).reverse().map((f) => ({ id: f.slice(0, -5), time: Math.round(fs.statSync(path.join(cpDir(name), f)).mtimeMs) }));
  }

  function readCheckpoint(name: string, id: string): { deck: unknown } {
    assertDeck(name);
    if (!CP_ID.test(id) || !fs.existsSync(path.join(cpDir(name), `${id}.yaml`))) throw new Error('Контрольная точка не найдена');
    return { deck: parseYaml(fs.readFileSync(path.join(cpDir(name), `${id}.yaml`), 'utf8')) };
  }

  // ---------------- файлы презентации ----------------
  /** Файлы презентации (assets/, вложенные папки тоже) с размерами — для сводки */
  function assets(name: string): { path: string; size: number }[] {
    const base = path.join(dir, assertDeck(name), 'assets');
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

  /** Неиспользуемые файлы — в корзину проекта (.trash/<презентация>-files-<время>), не насовсем */
  function trashAssets(name: string, list: unknown): { moved: number } {
    if (!Array.isArray(list)) throw new Error('Нужен список файлов');
    const base = path.join(dir, assertDeck(name), 'assets');
    const target = path.join(dir, '.trash', `${name}-files-${stamp()}`);
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

  /** Файл в папке с тем же содержимым (под любым именем): второй такой же не нужен */
  function sameFile(folder: string, data: Buffer, ok: (file: string) => boolean = () => true): string | null {
    for (const f of fs.readdirSync(folder)) {
      if (!ok(f)) continue;
      const abs = path.join(folder, f);
      const st = fs.statSync(abs);
      if (st.isFile() && st.size === data.length && fs.readFileSync(abs).equals(data)) return f;
    }
    return null;
  }

  function putAsset(name: string, safe: string, data: Buffer): FileRef {
    const ext = path.extname(safe).slice(1);
    const folder = path.join(dir, name, 'assets');
    fs.mkdirSync(folder, { recursive: true });
    // Тот же файл под другим именем (перетащили второй раз, переименовали) — используем его
    const twin = sameFile(folder, data, (f) => path.extname(f).slice(1).toLowerCase() === ext.toLowerCase());
    if (twin) return { url: urlOf(path.join(folder, twin)), path: './assets/' + twin };
    let target = path.join(folder, safe);
    const stem = safe.slice(0, safe.length - ext.length - 1);
    // Такой же файл уже есть — используем его; другой с тем же именем — добавляем номер
    for (let i = 2; fs.existsSync(target); i++) {
      if (fs.readFileSync(target).equals(data)) break;
      target = path.join(folder, `${stem}-${i}.${ext}`);
    }
    if (!fs.existsSync(target)) fs.writeFileSync(target, data);
    return { url: urlOf(target), path: './assets/' + path.basename(target) };
  }

  /** Файл в презентацию: картинка, видео, модель, шрифт, документ вставки; STL и STEP — сразу в GLB */
  async function addAsset(name: string, fileName: string, input: Buffer): Promise<FileRef> {
    assertDeck(name);
    const safe = safeFileName(fileName);
    const ext = path.extname(safe).slice(1);
    const cad = CAD_EXT.has(ext.toLowerCase());
    if (!MEDIA_EXT.has(ext.toLowerCase()) && !cad) throw new Error('Поддерживаются изображения (PNG, JPG, GIF, WebP, AVIF, SVG), видео (MP4, WebM), 3D-модели (GLB, STL, STEP) живые вставки (HTM, WASM, WAD), шрифты (WOFF2, WOFF, TTF, OTF) и LUT (.cube)');
    if (!input.length) throw new Error('Пустой файл');
    if (FONT_EXT.test(safe)) await mayEmbed(input);
    if (cad) {
      // STL / STEP → GLB: на слайде это обычная 3D-модель
      const glb = ext.toLowerCase() === 'stl' ? stlToGlb(input) : await stepToGlb(input);
      return putAsset(name, `${safe.slice(0, safe.length - ext.length - 1)}.glb`, glb);
    }
    return putAsset(name, safe, input);
  }

  /**
   * Код живой вставки правят в студии (панель «Код» → «Анимации»): файл assets/*.htm
   * перезаписывается на месте, а не копией — иначе каждая правка давала бы новый файл
   */
  function writeAssetText(name: string, assetUrl: string, text: string): { ok: true } {
    const prefix = urlOf(path.join(dir, assertDeck(name), 'assets')) + '/';
    let file = under(assetUrl, prefix) ?? '';
    try { file = decodeURIComponent(file); } catch { /* уже раскодирован */ }
    if (!file || /[\\/]|\.\./.test(file) || !/\.html?$/i.test(file)) throw new Error('Перезаписать можно только файл живой вставки (.htm) этой презентации');
    const target = path.join(dir, name, 'assets', file);
    if (!fs.existsSync(target)) throw new Error('Файла вставки нет — его переместили или удалили');
    // Страница уже показывает новый код: перезагружать её из-за этого файла не нужно
    remember(target, text);
    fs.writeFileSync(target, text);
    return { ok: true };
  }

  // ---------------- библиотека шрифтов ----------------
  /**
   * Шрифт встраивается в презентацию, только если автор разрешил его устанавливать или править
   * (флаг в файле, src/engine/font-license.ts). Здесь же проверяется и WOFF2: браузер его не распаковывает
   */
  async function mayEmbed(data: Buffer): Promise<void> {
    const r = await fontRights(new Uint8Array(data), { inflate: (d) => zlib.inflateSync(d), brotli: (d) => zlib.brotliDecompressSync(d) });
    if (r.ok === false) throw new Error(`Шрифт не встраивается: ${r.reason}`);
  }
  const fontsDir = () => (opts.fonts ? path.resolve(opts.fonts) : path.join(root, 'fonts'));
  /** Общая библиотека шрифтов: видна во всех презентациях */
  function fonts(): { file: string; url: string }[] {
    if (!fs.existsSync(fontsDir())) return [];
    return fs.readdirSync(fontsDir()).filter((f) => FONT_EXT.test(f)).sort().map((f) => ({ file: f, url: urlOf(path.join(fontsDir(), f)) }));
  }
  /** Шрифт в библиотеку; такой же файл уже есть (под любым именем) — второй не появляется */
  async function addFont(fileName: string, data: Buffer): Promise<{ file: string }> {
    const safe = safeFileName(fileName);
    if (!FONT_EXT.test(safe)) throw new Error('Подойдут шрифты WOFF2, WOFF, TTF или OTF');
    if (!data.length) throw new Error('Пустой файл');
    await mayEmbed(data);
    fs.mkdirSync(fontsDir(), { recursive: true });
    const twin = sameFile(fontsDir(), data, (f) => FONT_EXT.test(f));
    if (twin) return { file: twin };
    let file = safe;
    for (let i = 2; fs.existsSync(path.join(fontsDir(), file)); i++) file = safe.replace(FONT_EXT, (m) => `-${i}${m}`);
    fs.writeFileSync(path.join(fontsDir(), file), data);
    return { file };
  }
  /** Шрифт из библиотеки — копией в assets/ презентации: собранный файл несёт его с собой */
  async function useFont(name: string, fileName: string): Promise<FileRef> {
    assertDeck(name);
    const safe = path.basename(fileName);
    const src = path.join(fontsDir(), safe);
    if (!FONT_EXT.test(safe) || !fs.existsSync(src)) throw new Error('Шрифта нет в библиотеке');
    // В библиотеке может лежать шрифт, добавленный до проверки, или положенный в папку руками
    await mayEmbed(fs.readFileSync(src));
    const own = path.join(dir, name, 'assets', safe);
    if (fs.existsSync(own) && fs.readFileSync(own).equals(fs.readFileSync(src))) return { url: urlOf(own), path: './assets/' + safe };
    return putAsset(name, safe, fs.readFileSync(src));
  }

  // ---------------- свои библиотеки студии: темы, шаблоны, эффекты появления, образы «Цвет+» ----------------
  const libDir = () => (opts.library ? path.resolve(opts.library) : path.join(root, 'library'));
  function libFile(kind: string, id: string): string {
    if (!LIB_KINDS.includes(kind)) throw new Error('Неизвестная библиотека');
    if (!LIB_ID.test(id)) throw new Error('Неверный id записи');
    return path.join(libDir(), kind, `${id}.json`);
  }
  /** Все записи всех библиотек; испорченный файл пропускается */
  function library(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const kind of LIB_KINDS) {
      const d = path.join(libDir(), kind);
      out[kind] = (fs.existsSync(d) ? fs.readdirSync(d) : []).filter((f) => f.endsWith('.json')).flatMap((f) => {
        try {
          const v = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
          return v && typeof v === 'object' && v.id === f.slice(0, -5) ? [v] : [];
        } catch { return []; }
      });
    }
    return out;
  }
  function putLibrary(kind: string, id: string, value: unknown): { ok: true } {
    const file = libFile(kind, id);
    if (!value || typeof value !== 'object' || (value as { id?: unknown }).id !== id) throw new Error('Запись не совпадает с id');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Сначала во временный файл: оборванная запись не портит прежнюю
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
    fs.renameSync(`${file}.tmp`, file);
    return { ok: true };
  }
  function deleteLibrary(kind: string, id: string): { ok: true } {
    fs.rmSync(libFile(kind, id), { force: true });
    return { ok: true };
  }

  // ---------------- импорт ----------------
  /** HTML-страница → новая презентация (или слайды в презентацию name); raw — исходный файл для живых слайдов */
  function importPage(html: string, o: { raw?: string; live?: boolean; name?: string; fileName?: string; dryRun?: boolean; theme?: boolean }): Promise<ImportResult> {
    return importHtml(html, { raw: o.raw, live: !!o.live, dir, name: o.name, fileName: o.fileName, dryRun: !!o.dryRun, theme: o.theme !== false });
  }

  /** PowerPoint (.pptx) → новая презентация; dryRun — только отчёт, без записи; adapt — под темы Slideria */
  function importPowerPoint(data: Buffer, o: { name?: string; fileName?: string; dryRun?: boolean; adapt?: boolean }) {
    if (!data.length) throw new Error('Пустой файл');
    if (data.subarray(0, 2).toString('latin1') !== 'PK') throw new Error('Это не файл PowerPoint (.pptx). Старый формат .ppt сначала пересохраните в PowerPoint как .pptx');
    if (o.name && !/^[a-z0-9][a-z0-9-_]*$/i.test(o.name)) throw new Error('Имя презентации: латиница, цифры, дефис');
    return importPptx(data, { dir, name: o.name, fileName: o.fileName, dryRun: !!o.dryRun, adapt: !!o.adapt });
  }

  /** Цвета и шрифты презентации — в переменные темы (dry — только отчёт) */
  function bindTheme(name: string, dry: boolean): BindResult {
    return bindProject(dir, assertDeck(name), dry);
  }

  // ---------------- экспорт ----------------
  /**
   * «Экспорт»: сборка в один HTML-файл, та же, что yarn build, — отдельным процессом и во временную папку
   * (наблюдение за файлами не видит промежуточных). В программе процесс запускает Electron (крючок run)
   */
  async function exportHtml(name: string, o: ExportOptions): Promise<Buffer> {
    assertDeck(name);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlpptx-export-'));
    const out = path.join(tmp, `${name}.html`);
    const script = path.join(root, 'scripts/build.mjs');
    const args = [name, `--out=${out}`,
      ...(o.clean ? ['--clean'] : []), ...(o.compact ? ['--compact'] : []), ...(o.look ? [`--look=${o.look}`] : []), ...(o.motion ? ['--motion'] : [])];
    const run = hooks.run ?? nodeRunner;
    try {
      const { code, stderr } = await run(script, args, { cwd: root, env: { ...process.env, BUILD_TMP: tmp } });
      if (code || !fs.existsSync(out)) throw new ExportError((stderr || 'Сборка не удалась').trim().split('\n').slice(-3).join(' '));
      return fs.readFileSync(out);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /**
   * Страница собранного файла: данные презентации со встроенными файлами — прямо в HTML
   * (<script type="application/json">), чтобы сохранённая из браузера копия несла свои правки.
   * Рядом — исходная версия данных (с путями к файлам): по ней yarn merge-html сольёт правки из файла с проектом.
   * compact — картинки заранее сжимаются в WebP, видео и модели — как есть
   */
  async function fileHtml(html: string, name: string, o: { compact?: boolean } = {}): Promise<string> {
    const file = deckFile(assertDeck(name));
    // Цветокоррекция (grade у картинки) нужна только для правки в студии: исходники и LUT в файл не едут
    const deck = dropGrades(readYaml(file)) as { title?: string; lang?: string };
    const packed = new Map<string, { mime: string; data: Buffer }>();
    if (o.compact) {
      const files = new Set<string>();
      mapAssets(deck, (v) => { files.add(path.resolve(path.dirname(file), v)); return v; });
      await Promise.all([...files].filter((abs) => fs.existsSync(abs)).map(async (abs) => {
        const r = await compactImage(fs.readFileSync(abs), path.extname(abs).slice(1));
        if (r) packed.set(abs, r);
      }));
    }
    // Шрифт, который автор не разрешил встраивать (добавлен до проверки или положен в assets руками), в файл не едет:
    // текст остаётся с его именем и виден там, где шрифт установлен
    const fontList = (deck as { fonts?: { name?: string; src?: string }[] }).fonts;
    if (Array.isArray(fontList)) {
      const keep = await Promise.all(fontList.map(async (f) => {
        const abs = typeof f?.src === 'string' && !/^(data:|https?:)/.test(f.src) ? path.resolve(path.dirname(file), f.src) : '';
        if (!abs || !fs.existsSync(abs)) return true;
        try { await mayEmbed(fs.readFileSync(abs)); return true; } catch (e) {
          console.warn(`Шрифт «${f.name ?? f.src}» не встроен в файл: ${(e as Error).message.replace(/^Шрифт не встраивается: /, '')}`);
          return false;
        }
      }));
      (deck as { fonts?: unknown[] }).fonts = fontList.filter((_, i) => keep[i]);
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
    const base = { name, deck };
    return out.replace('<body>', `<body>\n<script type="application/json" id="${DATA_ID}">${scriptJson(packDeck(embedded))}</script>`
      + `\n<script type="application/json" id="${BASE_ID}">${scriptJson(base)}</script>`);
  }

  return {
    dir,
    root,
    on,
    urlOf,
    deckFile,
    names,
    has: (name: string) => names().includes(name),
    wrote,
    ownWrite,
    isTrashing,
    list,
    read,
    create,
    trash,
    save,
    checkpoint,
    checkpoints,
    readCheckpoint,
    assets,
    trashAssets,
    addAsset,
    writeAssetText,
    fonts,
    addFont,
    useFont,
    library,
    putLibrary,
    deleteLibrary,
    importPage,
    importPowerPoint,
    bindTheme,
    exportHtml,
    fileHtml,
  };
}
