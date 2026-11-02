/**
 * Файлы презентаций на диске: папки, deck.yaml, пути к файлам внутри данных. Без сервера и без Vite —
 * этим пользуются ядро сервера (core.ts), импорт и сборка
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

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
