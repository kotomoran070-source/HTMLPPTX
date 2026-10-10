/**
 * «Сохранить как рисунок» (как в PowerPoint): выделенные объекты — файлом PNG с прозрачным
 * фоном, такими, какими они видны на слайде: с кадром, фильтрами, рамкой и тенью. Остальное на
 * слайде (фон, соседние объекты, карточка вокруг картинки) скрывается на время снимка.
 */

/** Сколько пикселей файла на пиксель слайда (слайд 1280 — рисунок до 2560) */
const RATIO = 2;
/** Запас вокруг объектов: тень и повёрнутые углы не обрезаются; пустые края потом срезаются */
const MARGIN = 60;

export async function savePicture(slide: HTMLElement, els: HTMLElement[], name: string): Promise<void> {
  if (!els.length) throw new Error('нечего сохранять');
  const sr = slide.getBoundingClientRect();
  const k = sr.width / slide.offsetWidth;
  const rs = els.map((e) => e.getBoundingClientRect());
  const W = slide.offsetWidth;
  const H = slide.offsetHeight;
  const x0 = (Math.min(...rs.map((r) => r.left)) - sr.left) / k - MARGIN;
  const y0 = (Math.min(...rs.map((r) => r.top)) - sr.top) / k - MARGIN;
  const x1 = (Math.max(...rs.map((r) => r.right)) - sr.left) / k + MARGIN;
  const y1 = (Math.max(...rs.map((r) => r.bottom)) - sr.top) / k + MARGIN;

  slide.classList.add('st-shot');
  els.forEach((e) => e.classList.add('st-shot-keep'));
  let url: string;
  try {
    const { toPng } = await import('html-to-image');
    const opts = { pixelRatio: RATIO, width: W, height: H, cacheBust: false, style: { transform: 'none' } };
    // Свои шрифты — внутрь снимка; не вышло (файл шрифта недоступен) — снимок без них
    url = await toPng(slide, opts).catch(() => toPng(slide, { ...opts, skipFonts: true }));
  } finally {
    slide.classList.remove('st-shot');
    els.forEach((e) => e.classList.remove('st-shot-keep'));
  }
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

  // Область объектов с запасом, затем — по краям непрозрачных пикселей
  const cx = Math.max(0, Math.floor(x0 * RATIO));
  const cy = Math.max(0, Math.floor(y0 * RATIO));
  const cw = Math.min(img.width, Math.ceil(x1 * RATIO)) - cx;
  const ch = Math.min(img.height, Math.ceil(y1 * RATIO)) - cy;
  const c = document.createElement('canvas');
  c.width = Math.max(1, cw);
  c.height = Math.max(1, ch);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  const out = trim(c);
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
  if (!blob) throw new Error('не удалось собрать PNG');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Рисунок'}.png`;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Холст без прозрачных полей по краям */
function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const { width: w, height: h } = c;
  const d = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  let top = h;
  let left = w;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 2) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  if (right < 0) return c;
  const t = document.createElement('canvas');
  t.width = right - left + 1;
  t.height = bottom - top + 1;
  t.getContext('2d')!.drawImage(c, left, top, t.width, t.height, 0, 0, t.width, t.height);
  return t;
}

/** Имя файла по объекту: у картинки — имя её файла, иначе — «Рисунок» */
export function pictureName(block: unknown): string {
  const b = block as { type?: string; src?: unknown; image?: unknown } | null;
  const src = typeof b?.src === 'string' ? b.src : typeof b?.image === 'string' ? b.image : '';
  if (src && !src.startsWith('data:')) {
    const file = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
    if (file) return file;
  }
  return 'Рисунок';
}
