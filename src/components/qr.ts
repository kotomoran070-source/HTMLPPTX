import qrcode from 'qrcode-generator';
import { esc } from '../engine/html';

/**
 * QR-код как SVG: чёткие квадратные модули (надёжно считывается), поисковые квадраты — синим,
 * в центре логотип. Уровень коррекции H, поэтому логотип не мешает считыванию.
 * Код строится из URL при каждой сборке: поменяли ссылку в данных — поменялся и QR.
 */
export function qrSvg(text: string, logoUrl?: string, label = 'QR-код'): string {
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 3;
  const size = n + m * 2;

  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  // Область под логотипом: около 20% стороны по центру (коррекция H восстанавливает до 30%)
  const box = logoUrl ? Math.round(n * 0.2) | 1 : 0;
  const b0 = (n - box) / 2;
  const inLogo = (r: number, c: number) =>
    box > 0 && r >= b0 - 0.5 && r < b0 + box + 0.5 && c >= b0 - 0.5 && c < b0 + box + 0.5;

  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      const dark = (cc: number) => cc < n && qr.isDark(r, cc) && !inFinder(r, cc) && !inLogo(r, cc);
      if (!dark(c)) { c++; continue; }
      const start = c;
      while (dark(c + 1)) c++;
      d += `M${start + m} ${r + m}h${c - start + 1}v1h-${c - start + 1}z`;
      c++;
    }
  }

  let finders = '';
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    finders += `<rect x="${c + m + 0.5}" y="${r + m + 0.5}" width="6" height="6" fill="none" stroke="#1D4ED8" stroke-width="1"/>`
      + `<rect x="${c + m + 2}" y="${r + m + 2}" width="3" height="3" fill="#1D4ED8"/>`;
  }

  let logo = '';
  if (logoUrl) {
    const lx = b0 + m - 0.3;
    const ls = box + 0.6;
    logo = `<rect x="${lx}" y="${lx}" width="${ls}" height="${ls}" rx="${(ls * 0.24).toFixed(2)}" fill="#FDFEFF" stroke="#93C5FD" stroke-width=".18"/>`
      + `<image href="${esc(logoUrl)}" x="${lx + ls * 0.12}" y="${lx + ls * 0.12}" width="${ls * 0.76}" height="${ls * 0.76}"/>`;
  }

  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#FDFEFF"/>`
    + `<path d="${d}" fill="#0F2557"/>`
    + finders + logo + `</svg>`;
}
