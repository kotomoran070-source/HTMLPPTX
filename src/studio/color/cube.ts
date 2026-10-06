/**
 * 3D LUT в формате .cube (Adobe / DaVinci Resolve): LUT_3D_SIZE N, затем N³ строк «r g b»,
 * красный меняется быстрее всего. DOMAIN_MIN / DOMAIN_MAX — пределы входа (обычно 0 и 1).
 */
export interface Lut {
  size: number;
  /** RGBA, 32 бита на канал: готово для 3D-текстуры */
  data: Float32Array;
  title: string;
  min: [number, number, number];
  max: [number, number, number];
}

export function parseCube(text: string): Lut {
  let size = 0;
  let title = '';
  let min: [number, number, number] = [0, 0, 0];
  let max: [number, number, number] = [1, 1, 1];
  const rows: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const word = /^[A-Z_0-9]+/.exec(line)?.[0];
    if (word === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (word === 'LUT_3D_SIZE') { size = parseInt(line.slice(11), 10); continue; }
    if (word === 'LUT_1D_SIZE') throw new Error('одномерный LUT не поддерживается — нужен 3D');
    if (word === 'DOMAIN_MIN' || word === 'DOMAIN_MAX') {
      const v = line.slice(word.length).trim().split(/\s+/).map(Number) as [number, number, number];
      if (v.length === 3 && v.every(Number.isFinite)) { if (word === 'DOMAIN_MIN') min = v; else max = v; }
      continue;
    }
    if (word && /^[A-Z]/.test(word)) continue;
    const v = line.split(/\s+/).map(Number);
    if (v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) rows.push(v[0], v[1], v[2]);
  }
  if (!(size >= 2 && size <= 128)) throw new Error('в файле нет LUT_3D_SIZE');
  if (rows.length !== size * size * size * 3) throw new Error(`ожидалось ${size ** 3} строк цвета, а их ${rows.length / 3}`);
  const data = new Float32Array(size * size * size * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    data[j] = rows[i];
    data[j + 1] = rows[i + 1];
    data[j + 2] = rows[i + 2];
    data[j + 3] = 1;
  }
  return { size, data, title, min, max };
}
