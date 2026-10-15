// Разрешение на встраивание шрифта (fsType): все форматы файлов и все значения флага
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test } from '@playwright/test';
import { fontRights, rightsOf, sfntRights } from '../../src/engine/font-license';
import { kitWoff2, sfnt, ttc, woff } from '../fonts';

const node = { inflate: (d: Uint8Array) => zlib.inflateSync(d), brotli: (d: Uint8Array) => zlib.brotliDecompressSync(d) };
const kind = async (b: Buffer, unpack = node) => (await fontRights(new Uint8Array(b), unpack)).kind;

test('флаг: свободный и «можно править» — встраивается; «только просмотр», запрет, только растр — нет', () => {
  expect(rightsOf(0)).toEqual({ ok: true, kind: 'installable' });
  expect(rightsOf(0x8).kind).toBe('editable');
  expect(rightsOf(0x2).kind).toBe('restricted');
  expect(rightsOf(0x4).kind).toBe('preview');
  expect(rightsOf(0x200 | 0x8).kind).toBe('bitmap');
  // Несколько битов — действует самый свободный; «без подмножества» встраиванию целиком не мешает
  expect(rightsOf(0x4 | 0x8).kind).toBe('editable');
  expect(rightsOf(0x2 | 0x4).kind).toBe('preview');
  expect(rightsOf(0x100 | 0x8).kind).toBe('editable');
});

test('форматы: TTF, OTF, TTC, WOFF, WOFF2 — флаг читается из файла', async () => {
  for (const f of [0, 2, 4, 8]) {
    expect(await kind(sfnt(f))).toBe(rightsOf(f).kind);
    expect(await kind(sfnt(f, { otf: true }))).toBe(rightsOf(f).kind);
    expect(await kind(woff(f))).toBe(rightsOf(f).kind);
  }
  expect(await kind(ttc(4, 0))).toBe('preview');
  // Без таблицы OS/2 автор ограничений не ставил
  expect(await kind(sfnt(0, { noOs2: true }))).toBe('installable');
  expect(sfntRights(new Uint8Array(sfnt(2))).kind).toBe('restricted');
  // Настоящие WOFF2 из комплекта (OFL) — свободные; с подменённым флагом — по флагу
  const kit = path.resolve('src/fonts');
  for (const f of fs.readdirSync(kit).filter((x) => x.endsWith('.woff2'))) expect(await kind(fs.readFileSync(path.join(kit, f)))).toBe('installable');
  expect(await kind(kitWoff2(path.join(kit, 'Manrope.woff2'), 2))).toBe('restricted');
  expect(await kind(kitWoff2(path.join(kit, 'Manrope.woff2'), 4))).toBe('preview');
  // Нечем распаковать (браузер и brotli) — «не прочитать», проверит сервер
  expect(await kind(kitWoff2(path.join(kit, 'Manrope.woff2'), 2), {} as typeof node)).toBe('unknown');
});
