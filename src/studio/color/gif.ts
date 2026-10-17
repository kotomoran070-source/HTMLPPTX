/**
 * «Цвет+» у анимированного GIF: кадры разбирает браузер (ImageDecoder), каждый проходит ту же
 * коррекцию на видеокарте, и GIF собирается заново (gifenc) — с теми же задержками и повторами.
 * Получается обычный GIF: анимация сохраняется на слайде, в собранном HTML и в PowerPoint.
 * У каждого кадра — своя палитра на 255 цветов (лучшая для него) и прозрачный цвет, если он нужен.
 */
import type { Grade } from '../../engine/color/grade';
import type { GradeGL } from '../../engine/color/gl';

interface DecodedFrame { image: VideoFrame }
interface GifDecoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; repetitionCount: number } | null };
  completed: Promise<void>;
  decode(o: { frameIndex: number }): Promise<DecodedFrame>;
  close(): void;
}
type DecoderCtor = new (o: { data: ArrayBuffer; type: string }) => GifDecoder;

export const isGif = (url: string): boolean => /^data:image\/gif[;,]|\.gif(?:[?#]|$)/i.test(url);

async function open(url: string): Promise<{ dec: GifDecoder; frames: number; repeat: number }> {
  const Ctor = (globalThis as { ImageDecoder?: DecoderCtor }).ImageDecoder;
  if (!Ctor) throw new Error('браузер не разбирает GIF по кадрам');
  const data = await (await fetch(url)).arrayBuffer();
  const dec = new Ctor({ data, type: 'image/gif' });
  await dec.tracks.ready;
  await dec.completed;
  const t = dec.tracks.selectedTrack;
  if (!t?.frameCount) throw new Error('в GIF нет кадров');
  return { dec, frames: t.frameCount, repeat: t.repetitionCount };
}

/** Первый кадр — для настройки в панели (на нём видно, что получится) */
export async function gifFirstFrame(url: string): Promise<{ src: HTMLCanvasElement; w: number; h: number; frames: number }> {
  const { dec, frames } = await open(url);
  try {
    const { image } = await dec.decode({ frameIndex: 0 });
    const c = document.createElement('canvas');
    c.width = image.displayWidth;
    c.height = image.displayHeight;
    c.getContext('2d')!.drawImage(image, 0, 0);
    image.close();
    return { src: c, w: c.width, h: c.height, frames };
  } finally {
    dec.close();
  }
}

/** Все кадры GIF с коррекцией g → новый GIF; progress — номер готового кадра */
export async function gradeGif(gl: GradeGL, url: string, g: Grade, progress?: (done: number, total: number) => void): Promise<Blob> {
  const { dec, frames, repeat } = await open(url);
  // gifenc собран как CommonJS: функции — у самого модуля, а если сборщик положил их в default — там
  const mod = await import('gifenc') as typeof import('gifenc') & { default?: unknown };
  const lib = (typeof mod.quantize === 'function' ? mod : mod.default) as typeof import('gifenc');
  const { GIFEncoder, quantize, applyPalette } = lib;
  const enc = GIFEncoder();
  try {
    for (let i = 0; i < frames; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const w = image.displayWidth;
      const h = image.displayHeight;
      // Кадр уже собран целиком (с учётом прошлых кадров): пишется полностью
      gl.setFrame(image, w, h);
      // Длительность кадра — в микросекундах; без неё браузеры показывают кадр 0,1 с
      const delay = Math.max(20, Math.round((image.duration ?? 100_000) / 1000));
      image.close();
      const px = gl.pixels(g, w, h);
      let clear = false;
      for (let k = 3; k < px.length; k += 4) if (px[k] < 128) { clear = true; break; }
      // Цвета — по RGB (565: плавные переходы без полос); прозрачные точки — отдельным, 256-м цветом
      const palette = quantize(px, clear ? 255 : 256, { format: 'rgb565' });
      const index = applyPalette(px, palette, 'rgb565');
      let transparentIndex = -1;
      if (clear) {
        transparentIndex = palette.length;
        palette.push([0, 0, 0]);
        for (let k = 0; k < index.length; k++) if (px[k * 4 + 3] < 128) index[k] = transparentIndex;
      }
      enc.writeFrame(index, w, h, {
        palette, delay,
        // Повторы — как у исходника: бесконечно (0), один раз (-1) или N раз
        ...(i === 0 ? { repeat: Number.isFinite(repeat) ? (repeat > 0 ? repeat : -1) : 0 } : {}),
        ...(clear ? { transparent: true, transparentIndex, dispose: 2 } : {}),
      });
      progress?.(i + 1, frames);
    }
    enc.finish();
    return new Blob([enc.bytes() as BlobPart], { type: 'image/gif' });
  } finally {
    dec.close();
  }
}
