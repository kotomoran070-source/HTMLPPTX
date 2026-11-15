/**
 * Файлы презентаций на диске: папки, deck.yaml, пути к файлам внутри данных. Без сервера и без Vite —
 * этим пользуются ядро сервера (core.ts), импорт и сборка
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument, type Document } from 'yaml';

/** Строки в deck.yaml, похожие на путь к файлу рядом с презентацией, — это картинки, видео, шрифты… */
export const ASSET_RE = /^\.{1,2}\/[^\s]+\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mp3|glb|woff2?|ttf|otf|pdf|htm|wasm|wad|cube)$/i;

export const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', glb: 'model/gltf-binary',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf',
  // Документы «живых» вставок (embed): .htm, чтобы сервер разработки не принимал их за страницы приложения
  htm: 'text/html',
  // Файлы для живых вставок (embed.files): движок WebAssembly и данные к нему (DOOM — .wad)
  wasm: 'application/wasm', wad: 'application/octet-stream',
};

/**
 * Версия deck.yaml — по его тексту. Страница помнит, какую версию открыла (заголовок X-Slideria-Rev у данных),
 * а уведомление «файл поправили со стороны» несёт новую: совпали — страница уже показывает свежее
 */
export const deckRev = (text: string) => createHash('sha1').update(text).digest('base64url').slice(0, 12);

/** id тега с данными презентации внутри собранного HTML */
export const DATA_ID = 'htmlpptx-deck';

/** Презентации — папки с deck.yaml; «_», «.» в начале имени (корзина, контрольные точки) — служебные */
export function listDecks(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .filter((d) => fs.existsSync(path.join(dir, d.name, 'deck.yaml')))
    .map((d) => d.name)
    .sort();
}

/** Разбирает deck.yaml с понятной ошибкой: файл, строка, столбец. Документ — с комментариями и видом записи */
export function parseDeck(file: string, source: string): Document {
  const doc = parseDocument(source, { prettyErrors: true });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const where = e.linePos?.[0] ? `:${e.linePos[0].line}:${e.linePos[0].col}` : '';
    throw new Error(`Ошибка в ${path.relative(process.cwd(), file)}${where}\n${e.message}`);
  }
  return doc;
}

/** Читает deck.yaml с понятной ошибкой: файл, строка, столбец. */
export function readYaml(file: string, source = fs.readFileSync(file, 'utf8')): unknown {
  return parseDeck(file, source).toJS();
}

/**
 * Разобранные файлы презентаций — в памяти сервера. Разбор YAML — самое долгое в записи: на шаблоне из 31 слайда
 * 45–67 мс, на 155 слайдах — 230–260 мс, а запись разбирала файл трижды (что на диске, для переноса правок,
 * что получилось). Теперь разбор один на версию файла: текст совпал с запомненным — берутся готовые данные.
 * Сверка — по самому тексту, а не по времени файла: правка со стороны не пройдёт мимо.
 */
export function createYamlCache(limit = 24) {
  /** Файл → текст, его данные и документ (документ — пока его не забрала запись: она его меняет) */
  const files = new Map<string, { text: string; js: unknown; doc: Document | null }>();
  const entry = (file: string, source: string) => {
    const key = path.resolve(file);
    let e = files.get(key);
    if (!e || e.text !== source) {
      const doc = parseDeck(file, source);
      e = { text: source, js: doc.toJS(), doc };
    }
    // Недавние — в конце; самые давние уходят
    files.delete(key);
    files.set(key, e);
    while (files.size > limit) files.delete(files.keys().next().value as string);
    return e;
  };
  return {
    /** Данные файла только для чтения (без копии): сводка для страницы выбора */
    peek(file: string, source = fs.readFileSync(file, 'utf8')): unknown {
      return entry(file, source).js;
    },
    /** Данные файла (копия: её можно менять) */
    read(file: string, source = fs.readFileSync(file, 'utf8')): unknown {
      return structuredClone(entry(file, source).js);
    },
    /** Документ этого текста для записи правок (mergeYaml), если он разобран и ещё не отдан */
    take(file: string, source: string): Document | undefined {
      const e = files.get(path.resolve(file));
      if (!e || e.text !== source || !e.doc) return undefined;
      const doc = e.doc;
      e.doc = null;
      return doc;
    },
  };
}

/** Обходит данные и заменяет строки-пути к файлам через fn. */
export function mapAssets(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === 'string') return ASSET_RE.test(v) ? fn(v) : v;
  if (Array.isArray(v)) return v.map((x) => mapAssets(x, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapAssets(x, fn)]));
  return v;
}

/** Все строки данных через fn */
export function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}

/** Данные без параметров цветокоррекции картинок (grade: { src, … }) — для собранного файла */
export function dropGrades(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropGrades);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k, x]) => !(k === 'grade' && x && typeof x === 'object' && typeof (x as { src?: unknown }).src === 'string'))
    .map(([k, x]) => [k, dropGrades(x)]));
}

/** JSON, который безопасно вставлять внутрь <script>. */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Заменить первый тег страницы, подходящий под tag, — вне <script> и <style>: в коде собранной страницы такие
 * строки тоже встречаются («<body>», «<head>» в шаблонах). Замена — функцией: «$» в ней не служебный знак
 */
export function replaceTag(html: string, tag: RegExp, to: (m: string) => string): string {
  const re = new RegExp(`<(script|style)\\b[^>]*>[\\s\\S]*?</\\1\\s*>|${tag.source}`, 'gi');
  for (let m: RegExpExecArray | null; (m = re.exec(html));) {
    if (m[1]) continue;
    return html.slice(0, m.index) + to(m[0]) + html.slice(m.index + m[0].length);
  }
  return html;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Имя файла без опасных символов, с сохранением расширения. */
export function safeFileName(name: string): string {
  const base = path.basename(name).normalize('NFC');
  const ext = path.extname(base).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const stem = base.slice(0, base.length - path.extname(base).length)
    .replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  return stem + ext;
}

/** Время для имён файлов: 20261102-091530 */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
