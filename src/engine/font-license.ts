/**
 * Можно ли встроить шрифт в презентацию — по разрешению автора в самом файле: таблица OS/2, поле fsType
 * (как это делают PowerPoint и Word). Презентацию потом правят, поэтому встраивается только шрифт,
 * который автор разрешил устанавливать или править; «только просмотр и печать» и запрет — нет.
 *
 * Читает TTF, OTF, коллекции TTC, WOFF и WOFF2. Сжатые таблицы распаковывает тот, кто вызвал:
 * WOFF — zlib (в браузере DecompressionStream, на сервере zlib), WOFF2 — brotli (только сервер:
 * браузер brotli не распаковывает, и тогда ответ — «не прочитать», проверку делает сервер студии).
 */

export type FontRights =
  | { ok: true; kind: 'installable' | 'editable' }
  | { ok: false; kind: 'restricted' | 'preview' | 'bitmap'; reason: string }
  /** Флаг не прочитать: файл повреждён или WOFF2 без распаковщика brotli */
  | { ok: null; kind: 'unknown' };

export interface Unpack {
  inflate?: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  brotli?: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;
}

const UNKNOWN: FontRights = { ok: null, kind: 'unknown' };

/** Права по значению fsType (спецификация OpenType, таблица OS/2) */
export function rightsOf(fsType: number): FontRights {
  // Бит 9: встраивать можно только растровые копии — контуры, которые нужны странице, нельзя
  if (fsType & 0x0200) return { ok: false, kind: 'bitmap', reason: 'автор шрифта разрешил встраивать только его растровые копии' };
  const p = fsType & 0x000f;
  // Несколько битов сразу — действует самый свободный
  if (p === 0) return { ok: true, kind: 'installable' };
  if (p & 0x0008) return { ok: true, kind: 'editable' };
  if (p & 0x0004) return { ok: false, kind: 'preview', reason: 'автор шрифта разрешил встраивать его только для просмотра и печати, а презентацию можно править' };
  return { ok: false, kind: 'restricted', reason: 'автор шрифта запретил его встраивать' };
}

const u16 = (d: Uint8Array, at: number) => (d[at] << 8) | d[at + 1];
const u32 = (d: Uint8Array, at: number) => ((d[at] << 24) >>> 0) + (d[at + 1] << 16) + (d[at + 2] << 8) + d[at + 3];
const tag = (d: Uint8Array, at: number) => String.fromCharCode(d[at], d[at + 1], d[at + 2], d[at + 3]);
const OS2 = 'OS/2';

/** fsType из несжатого шрифта (TTF, OTF; start — начало шрифта внутри коллекции) */
function sfntFsType(d: Uint8Array, start = 0): number | null {
  if (start + 12 > d.length) return null;
  const n = u16(d, start + 4);
  for (let i = 0; i < n; i++) {
    const at = start + 12 + i * 16;
    if (at + 16 > d.length) return null;
    if (tag(d, at) !== OS2) continue;
    const off = u32(d, at + 8);
    return off + 10 <= d.length ? u16(d, off + 8) : null;
  }
  return null;
}

async function woffFsType(d: Uint8Array, unpack: Unpack): Promise<number | null> {
  const n = u16(d, 12);
  for (let i = 0; i < n; i++) {
    const at = 44 + i * 20;
    if (at + 20 > d.length) return null;
    if (tag(d, at) !== OS2) continue;
    const off = u32(d, at + 4), comp = u32(d, at + 8), orig = u32(d, at + 12);
    let t = d.subarray(off, off + comp);
    if (comp < orig) {
      if (!unpack.inflate) throw new Error('нечем распаковать');
      t = await unpack.inflate(t);
    }
    return t.length >= 10 ? u16(t, 8) : null;
  }
  return null;
}

/** Таблицы с номером вместо имени в каталоге WOFF2 (спецификация WOFF2, раздел 5.1) */
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

async function woff2FsType(d: Uint8Array, unpack: Unpack): Promise<number | null> {
  if (!unpack.brotli) throw new Error('нечем распаковать');
  if (tag(d, 4) === 'ttcf') throw new Error('коллекция'); // коллекция в WOFF2 — редкость, каталог сложнее
  const n = u16(d, 12), total = u32(d, 20);
  let at = 48, inStream = 0, os2: number | null = null;
  const base128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = d[at++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    return NaN;
  };
  for (let i = 0; i < n; i++) {
    if (at >= d.length) return null;
    const flags = d[at++];
    const idx = flags & 0x3f;
    let name = KNOWN[idx] ?? '';
    if (idx === 63) { name = tag(d, at); at += 4; }
    const tv = flags >> 6;
    const orig = base128();
    // glyf и loca с версией 0 и любые другие таблицы с версией ≠ 0 хранятся преобразованными
    const transformed = name === 'glyf' || name === 'loca' ? tv === 0 : tv !== 0;
    const len = transformed ? base128() : orig;
    if (Number.isNaN(orig) || Number.isNaN(len)) return null;
    if (name === OS2) os2 = inStream;
    inStream += len;
  }
  if (os2 === null) return null;
  const tables = await unpack.brotli!(d.subarray(at, at + total));
  return os2 + 10 <= tables.length ? u16(tables, os2 + 8) : null;
}

/** Права на встраивание файла шрифта */
export async function fontRights(data: Uint8Array, unpack: Unpack = {}): Promise<FontRights> {
  if (data.length < 12) return UNKNOWN;
  let fs: number | null = null;
  try {
    const t = tag(data, 0);
    if (t === 'wOFF') fs = await woffFsType(data, unpack);
    else if (t === 'wOF2') fs = await woff2FsType(data, unpack);
    // Коллекция: у начертаний внутри общий автор — смотрим первое
    else if (t === 'ttcf') fs = sfntFsType(data, u32(data, 12));
    else fs = sfntFsType(data);
  } catch {
    return UNKNOWN;
  }
  // В шрифте нет таблицы OS/2 (старые шрифты Mac) — ограничений автор не ставил
  return rightsOf(fs ?? 0);
}

/** fsType несжатого шрифта сразу, без распаковки (шрифты компьютера приходят TTF/OTF/TTC) */
export function sfntRights(data: Uint8Array): FontRights {
  if (data.length < 12) return UNKNOWN;
  const t = tag(data, 0);
  const fs = t === 'ttcf' ? sfntFsType(data, u32(data, 12)) : sfntFsType(data);
  return rightsOf(fs ?? 0);
}

/** Распаковка zlib в браузере (WOFF) */
export async function browserInflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
