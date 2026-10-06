/**
 * Цвета плашки логотипа из самого логотипа: главный цвет (по насыщенным пикселям, с весом
 * насыщенности) — рамка и свечение, его бледный оттенок — фон плашки. Логотип без цвета
 * (чёрный, серый) — рамка его самым тёмным тоном на белом фоне.
 */
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (c: number[], to: number, t: number) => c.map((v) => v + (to - v) * t);

export async function logoColors(url: string): Promise<{ bg: string; border: string; glow: string }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('логотип не загрузился'));
    i.src = url;
  });
  const N = 64;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  // Корзины по оттенку: сумма цвета с весом насыщенности
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let dark: number[] | null = null;
  let darkL = 2;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l < darkL) { darkL = l; dark = [d[i], d[i + 1], d[i + 2]]; }
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (s < 0.25 || l < 0.12 || l > 0.92) continue;
    let h = 0;
    if (max === r) h = ((g - b) / (max - min) + 6) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    const bin = bins[Math.floor((h / 6) * 24) % 24];
    const w = s * (1 - Math.abs(l - 0.5));
    bin.w += w;
    bin.r += d[i] * w;
    bin.g += d[i + 1] * w;
    bin.b += d[i + 2] * w;
  }
  const top = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (top.w < 3) {
    const k = dark ?? [17, 24, 39];
    return { bg: '#FFFFFF', border: hex(...(mix(k, 255, 0.55) as [number, number, number])), glow: hex(k[0], k[1], k[2]) };
  }
  const main = [top.r / top.w, top.g / top.w, top.b / top.w];
  return {
    bg: hex(...(mix(main, 255, 0.92) as [number, number, number])),
    border: hex(...(mix(main, 255, 0.45) as [number, number, number])),
    glow: hex(main[0], main[1], main[2]),
  };
}
