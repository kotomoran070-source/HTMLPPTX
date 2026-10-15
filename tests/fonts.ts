// Образцы шрифтов с нужным флагом встраивания (fsType) — собираются в тесте, файлов в репозитории нет
import fs from 'node:fs';
import zlib from 'node:zlib';

const be16 = (n: number) => Buffer.from([(n >> 8) & 255, n & 255]);
const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

/** Таблица OS/2 версии 0 (78 байт): fsType по смещению 8 */
function os2(fsType: number): Buffer {
  const t = Buffer.alloc(78);
  t.writeUInt16BE(fsType, 8);
  return t;
}

/** Мини-шрифт TTF: таблицы OS/2 и name — для разбора хватает */
export function sfnt(fsType: number, opts: { otf?: boolean; noOs2?: boolean } = {}): Buffer {
  const tables: [string, Buffer][] = [...(opts.noOs2 ? [] : [['OS/2', os2(fsType)] as [string, Buffer]]), ['name', Buffer.alloc(6)]];
  const head = Buffer.concat([opts.otf ? Buffer.from('OTTO') : be32(0x00010000), be16(tables.length), be16(0), be16(0), be16(0)]);
  let off = 12 + tables.length * 16;
  const dir: Buffer[] = [], data: Buffer[] = [];
  for (const [tag, t] of tables) {
    dir.push(Buffer.concat([Buffer.from(tag), be32(0), be32(off), be32(t.length)]));
    const pad = Buffer.alloc((4 - (t.length % 4)) % 4);
    data.push(t, pad);
    off += t.length + pad.length;
  }
  return Buffer.concat([head, ...dir, ...data]);
}

/** Коллекция TTC из двух шрифтов: флаг первого */
export function ttc(a: number, b: number): Buffer {
  const f1 = sfnt(a), f2 = sfnt(b);
  const hdr = 12 + 8;
  const shift = (f: Buffer, by: number) => {
    const c = Buffer.from(f);
    for (let i = 0; i < c.readUInt16BE(4); i++) c.writeUInt32BE(c.readUInt32BE(12 + i * 16 + 8) + by, 12 + i * 16 + 8);
    return c;
  };
  return Buffer.concat([Buffer.from('ttcf'), be32(0x00010000), be32(2), be32(hdr), be32(hdr + f1.length), shift(f1, hdr), shift(f2, hdr + f1.length)]);
}

/** Мини-шрифт WOFF: таблицы сжаты zlib */
export function woff(fsType: number): Buffer {
  const tables: [string, Buffer][] = [['OS/2', os2(fsType)], ['name', Buffer.alloc(6)]];
  let off = 44 + tables.length * 20;
  const dir: Buffer[] = [], data: Buffer[] = [];
  for (const [tag, t] of tables) {
    const z = zlib.deflateSync(t);
    const use = z.length < t.length ? z : t;
    dir.push(Buffer.concat([Buffer.from(tag), be32(off), be32(use.length), be32(t.length), be32(0)]));
    const pad = Buffer.alloc((4 - (use.length % 4)) % 4);
    data.push(use, pad);
    off += use.length + pad.length;
  }
  const hdr = Buffer.alloc(44);
  hdr.write('wOFF', 0); hdr.writeUInt32BE(0x00010000, 4); hdr.writeUInt32BE(off, 8); hdr.writeUInt16BE(tables.length, 12);
  return Buffer.concat([hdr, ...dir, ...data]);
}

/** Шрифт из комплекта (WOFF2) с другим флагом: распаковать, поправить OS/2, сжать заново */
export function kitWoff2(file: string, fsType: number): Buffer {
  const d = fs.readFileSync(file);
  const n = d.readUInt16BE(12), total = d.readUInt32BE(20);
  let at = 48, inStream = 0, os2At = -1;
  const base128 = () => { let v = 0; for (;;) { const b = d[at++]; v = v * 128 + (b & 127); if (!(b & 128)) return v; } };
  for (let i = 0; i < n; i++) {
    const flags = d[at++];
    const idx = flags & 63;
    if (idx === 63) at += 4;
    const orig = base128();
    const tv = flags >> 6;
    const transformed = idx === 10 || idx === 11 ? tv === 0 : tv !== 0;
    const len = transformed ? base128() : orig;
    if (idx === 6) os2At = inStream;
    inStream += len;
  }
  const tables = Buffer.from(zlib.brotliDecompressSync(d.subarray(at, at + total)));
  tables.writeUInt16BE(fsType, os2At + 8);
  const packed = zlib.brotliCompressSync(tables);
  const pad = Buffer.alloc((4 - ((at + packed.length) % 4)) % 4);
  const out = Buffer.concat([d.subarray(0, at), packed, pad]);
  out.writeUInt32BE(out.length, 8);
  out.writeUInt32BE(packed.length, 20);
  return out;
}
