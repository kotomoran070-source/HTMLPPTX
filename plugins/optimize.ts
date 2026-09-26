/**
 * Сжатие картинок при импорте. Экспорт Claude Design хранит заставки вставок в 4K PNG
 * (3840×2160, даже почти пустые): каждая такая картинка — десятки мегабайт в памяти
 * видеокарты, а браузер держит все слайды сразу. Здесь картинка уменьшается до нужного
 * размера (вдвое больше места на слайде — для экранов высокой чёткости) и сохраняется
 * в WebP, если так она меньше.
 */
type Block = Record<string, unknown>;

/** Самая большая ширина картинки без свободного места на слайде (слайд 1280, ×2) */
const MAX_W = 2560;
const RASTER = /^data:image\/(png|jpeg|webp);base64,/i;

export interface OptimizeReport {
  images: number;
  before: number;
  after: number;
}

async function shrink(url: string, maxW: number, report: OptimizeReport): Promise<string> {
  if (!RASTER.test(url)) return url;
  const { default: sharp } = await import('sharp');
  const input = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  try {
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) return url;
    const width = Math.min(meta.width, Math.max(64, Math.round(maxW)));
    const base = () => (width < meta.width! ? sharp(input).resize({ width }) : sharp(input));
    const [lossless, lossy] = await Promise.all([
      base().webp({ lossless: true, effort: 4 }).toBuffer(),
      base().webp({ quality: 82, effort: 4 }).toBuffer(),
    ]);
    // Без потерь, если это не намного больше: текст и линии остаются чёткими
    const best = lossless.length <= lossy.length * 1.5 ? lossless : lossy;
    if (best.length >= input.length * 0.9) return url;
    report.images++;
    report.before += input.length;
    report.after += best.length;
    return `data:image/webp;base64,${best.toString('base64')}`;
  } catch {
    return url;
  }
}

function blocksOf(v: unknown, out: Block[] = []): Block[] {
  if (Array.isArray(v)) v.forEach((x) => blocksOf(x, out));
  else if (v && typeof v === 'object') {
    const b = v as Block;
    if (typeof b.type === 'string') out.push(b);
    for (const x of Object.values(b)) if (x && typeof x === 'object') blocksOf(x, out);
  }
  return out;
}

/** Уменьшает и сжимает встроенные картинки презентации (меняет deck на месте). */
export async function optimizeImages(deck: { slides?: Record<string, unknown>[] }): Promise<OptimizeReport> {
  const report: OptimizeReport = { images: 0, before: 0, after: 0 };
  const jobs: Promise<void>[] = [];
  for (const s of deck.slides ?? []) {
    for (const b of blocksOf([s.body, s.free])) {
      const w = Number((b.place as { w?: number } | undefined)?.w) || 0;
      if (b.type === 'embed' && typeof b.poster === 'string') {
        jobs.push(shrink(b.poster, w ? w * 2 : MAX_W, report).then((u) => { b.poster = u; }));
      }
      if (Array.isArray(b.images)) {
        for (const img of b.images as Record<string, unknown>[]) {
          // Размер картинки внутри вёрстки неизвестен: не больше двойной ширины блока на слайде
          const cap = w ? Math.min(MAX_W, w * 2) : MAX_W;
          if (img && typeof img.src === 'string') jobs.push(shrink(img.src, cap, report).then((u) => { img.src = u; }));
        }
      }
      if (b.type === 'image' && typeof b.src === 'string') jobs.push(shrink(b.src, MAX_W, report).then((u) => { b.src = u; }));
    }
  }
  await Promise.all(jobs);
  return report;
}
