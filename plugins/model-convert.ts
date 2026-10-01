/**
 * CAD и 3D-печать → GLB (формат блока «3D-модель»): STL — своим разбором, STEP — ядром
 * OpenCascade (occt-import-js). Работает только в yarn dev, при вставке файла: в собранную
 * презентацию попадает уже готовый GLB.
 *
 * CAD рисуют в миллиметрах и «Z вверх»; glTF — метры и «Y вверх». Корневой узел модели
 * поворачивает и масштабирует её, сама геометрия остаётся как в файле.
 */
import { createRequire } from 'node:module';

interface Part {
  positions: Float32Array;
  normals: Float32Array | null;
  /** Треугольники по цвету: одна часть модели — несколько материалов (плата, контакты, корпуса) */
  groups: { color: [number, number, number]; indices: Uint32Array | null }[];
}

/** Цвет модели без своих цветов (STL): спокойный светло-серый с оттенком, как пластик прототипа */
const BASE: [number, number, number] = [0.52, 0.58, 0.68];

// ------------------------------------------------------------------ STL

export function stlToGlb(buf: Buffer): Buffer {
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  const binary = buf.length >= 84 && 84 + n * 50 === buf.length;
  const pos: number[] = [];
  if (binary) {
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) pos.push(buf.readFloatLE(o + k * 4));
    }
  } else {
    const text = buf.toString('latin1');
    if (!/facet/i.test(text)) throw new Error('Это не STL: нет треугольников');
    for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) pos.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (pos.length < 9 || pos.some((v) => !Number.isFinite(v))) throw new Error('В STL нет треугольников или числа повреждены');
  const positions = new Float32Array(pos);
  // Нормали по граням: в STL они часто неверные или нулевые
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
    const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { normals[i + k] = nx; normals[i + k + 1] = ny; normals[i + k + 2] = nz; }
  }
  return writeGlb([{ positions, normals, groups: [{ color: BASE, indices: null }] }], 'STL');
}

// ------------------------------------------------------------------ STEP

interface OcctMesh {
  color?: [number, number, number];
  brep_faces?: { first: number; last: number; color: [number, number, number] | null }[];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
interface Occt { ReadStepFile(content: Uint8Array, params: object | null): { success: boolean; meshes: OcctMesh[] } }

let occt: Promise<Occt> | null = null;

export async function stepToGlb(buf: Buffer): Promise<Buffer> {
  // Ядро OpenCascade (~7 МБ wasm) загружается при первой вставке STEP и остаётся в памяти
  occt ??= (createRequire(import.meta.url)('occt-import-js') as () => Promise<Occt>)();
  const lib = await occt;
  const r = lib.ReadStepFile(new Uint8Array(buf), {
    linearUnit: 'millimeter',
    // Точность сетки — доля размера модели: мелкие детали платы не превращаются в кубики
    linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0015, angularDeflection: 0.35,
  });
  if (!r.success || !r.meshes?.length) throw new Error('Не удалось прочитать STEP: файл повреждён или пустой');
  const parts: Part[] = r.meshes.map((m) => {
    const idx = m.index.array;
    const tri = idx.length / 3;
    const base = colorOf(m.color) ?? BASE;
    // Цвет каждого треугольника: грань со своим цветом — её, иначе цвет детали
    const triColor: string[] = new Array(tri).fill(key(base));
    const palette = new Map<string, [number, number, number]>([[key(base), base]]);
    for (const f of m.brep_faces ?? []) {
      const c = colorOf(f.color);
      if (!c) continue;
      palette.set(key(c), c);
      for (let t = f.first; t <= f.last && t < tri; t++) triColor[t] = key(c);
    }
    const groups = [...palette.entries()].map(([k, color]) => {
      const list: number[] = [];
      for (let t = 0; t < tri; t++) if (triColor[t] === k) list.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
      return { color, indices: Uint32Array.from(list) };
    }).filter((g) => g.indices.length);
    return {
      positions: Float32Array.from(m.attributes.position.array),
      normals: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null,
      groups,
    };
  }).filter((p) => p.positions.length && p.groups.length);
  if (!parts.length) throw new Error('В STEP нет поверхностей для показа');
  return writeGlb(parts, 'STEP');
}

const key = (c: [number, number, number]) => c.map((v) => v.toFixed(3)).join(',');
/** Цвет из OpenCascade: 0…1 (или 0…255 у некоторых файлов) */
function colorOf(c: [number, number, number] | null | undefined): [number, number, number] | null {
  if (!c || c.length < 3 || c.some((v) => !Number.isFinite(v))) return null;
  const k = Math.max(...c) > 1 ? 255 : 1;
  return [c[0] / k, c[1] / k, c[2] / k];
}

// ------------------------------------------------------------------ GLB

function writeGlb(parts: Part[], source: string): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const add = (data: Float32Array | Uint32Array, target: number, acc: object): number => {
    const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (b.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length, target });
    chunks.push(b, Buffer.alloc(pad));
    offset += b.length + pad;
    accessors.push({ bufferView: bufferViews.length - 1, ...acc });
    return accessors.length - 1;
  };
  const materials: object[] = [];
  const matIndex = new Map<string, number>();
  const material = (c: [number, number, number]) => {
    const k = key(c);
    if (!matIndex.has(k)) {
      // Металлом выглядят светлые серые (контакты, винты), остальное — матовый пластик
      const grey = Math.max(...c) - Math.min(...c) < 0.06 && c[0] > 0.6;
      materials.push({ pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: grey ? 0.55 : 0.05, roughnessFactor: grey ? 0.35 : 0.6 }, doubleSided: true });
      matIndex.set(k, materials.length - 1);
    }
    return matIndex.get(k)!;
  };
  const meshes = parts.map((p) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p.positions[i + k]);
        max[k] = Math.max(max[k], p.positions[i + k]);
      }
    }
    const count = p.positions.length / 3;
    const pos = add(p.positions, 34962, { componentType: 5126, count, type: 'VEC3', min, max });
    const nor = p.normals ? add(p.normals, 34962, { componentType: 5126, count, type: 'VEC3' }) : undefined;
    return {
      primitives: p.groups.map((g) => ({
        attributes: { POSITION: pos, ...(nor !== undefined ? { NORMAL: nor } : {}) },
        ...(g.indices ? { indices: add(g.indices, 34963, { componentType: 5125, count: g.indices.length, type: 'SCALAR' }) } : {}),
        material: material(g.color),
      })),
    };
  });
  const json = {
    asset: { version: '2.0', generator: `Slideria (${source} → GLB)` },
    scene: 0,
    scenes: [{ nodes: [0] }],
    // Миллиметры → метры, «Z вверх» → «Y вверх»
    nodes: [{ children: meshes.map((_m, i) => i + 1), rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [0.001, 0.001, 0.001] },
      ...meshes.map((_m, i) => ({ mesh: i }))],
    meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: offset }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, jsonBuf, bh, bin]);
}
