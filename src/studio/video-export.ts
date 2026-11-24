/**
 * «Файл → Экспорт → Видео»: ролик MP4 покадрово, как в видеоредакторе. Показ идёт в невидимом окне программы
 * (desktop/video.mjs) со своими часами (engine/render-clock.ts): кадр k — ровно момент k / fps, сколько бы он ни
 * считался. Кадр приходит пикселями, здесь кодируется (WebCodecs: H.264; звук — AAC, где его кодирует система,
 * иначе Opus) и складывается в MP4 (mp4-muxer); куски файла программа пишет на диск сразу — ролик не копится
 * в памяти, и 4K на час не упирается в её размер.
 */
import type { Deck } from '../types';
import { musicOf } from '../engine/music';
import { clockText, shownSlides, sizeText, videoBitrate, videoByMusic, videoBytes, videoLength } from '../engine/video-plan';

export type VideoSize = 720 | 1080 | 1440 | 2160;
export interface VideoOpts { size: VideoSize; fps: 30 | 60; each: 0 | 5; music: boolean }

/** Размер: высота, подпись на переключателе, подсказка */
export const VIDEO_SIZES: [VideoSize, string, string][] = [
  [720, '720p', '1280 × 720 — файл меньше, для почты и мессенджеров'],
  [1080, '1080p', '1920 × 1080 — для YouTube, Telegram, ВКонтакте'],
  [1440, '2K', '2560 × 1440 — для больших экранов'],
  [2160, '4K', '3840 × 2160 — для экранов 4K, запись дольше'],
];
const WIDTH: Record<VideoSize, number> = { 720: 1280, 1080: 1920, 1440: 2560, 2160: 3840 };

/** Сейчас идёт запись: кадр, сколько всего (оценка), где показ, сколько осталось ждать */
export interface VideoRun { frame: number; total: number; slide: number; label: string; leftMs: number | null }

export interface AppFrame { data: Uint8Array; width: number; height: number; t: number; slide: number; label: string; done: boolean; music: { pos: number | null; vol: number } }
export interface AppVideo {
  pick(name: string): Promise<string | null>;
  open(o: { deck: string; width: number; height: number; each: number }): Promise<{ estimate: number; musicUrl: string | null }>;
  frame(k: number, fps: number): Promise<AppFrame>;
  write(pos: number, data: Uint8Array): Promise<boolean>;
  close(ok: boolean): Promise<string | null>;
}
const appVideo = (): AppVideo | null => (window as { slideriaApp?: { video?: AppVideo } }).slideriaApp?.video ?? null;

const KEY = 'slideria-video';
const DEFAULTS: VideoOpts = { size: 1080, fps: 60, each: 0, music: true };

/** Через сколько ждать конца, мс: по средней скорости последних кадров (times — когда они пришли) */
export function leftMs(times: number[], framesLeft: number): number | null {
  if (times.length < 10) return null;
  const span = times[times.length - 1] - times[0];
  return Math.max(0, (span / (times.length - 1)) * framesLeft);
}

export class VideoExport {
  opts: VideoOpts = { ...DEFAULTS };
  run: VideoRun | null = null;
  private cancelled = false;

  constructor(
    private deck: () => Deck,
    private deckKey: () => string,
    private toast: (text: string, ms: number, err?: boolean) => void,
    /** Запись началась, кончилась или продвинулась (full — перерисовать раздел целиком) */
    private changed: (full: boolean) => void,
  ) {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VideoOpts>;
      if (VIDEO_SIZES.some(([s]) => s === o.size)) this.opts.size = o.size!;
      if (o.fps === 30 || o.fps === 60) this.opts.fps = o.fps;
      if (o.each === 0 || o.each === 5) this.opts.each = o.each;
      if (typeof o.music === 'boolean') this.opts.music = o.music;
    } catch { /* нет доступа или испорчено */ }
  }

  /** Видео записывает программа: в браузере (yarn dev) — нет */
  get available(): boolean {
    return !!appVideo() && typeof VideoEncoder === 'function';
  }

  set(o: Partial<VideoOpts>): void {
    this.opts = { ...this.opts, ...o };
    try { localStorage.setItem(KEY, JSON.stringify(this.opts)); } catch { /* нет доступа */ }
  }

  /** Подпись под «Время слайдов»: по чему листается ролик, сколько слайдов и сколько он идёт */
  timing(): string {
    const deck = this.deck();
    const n = shownSlides(deck);
    const slides = `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'слайд' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'слайда' : 'слайдов'}`;
    const ms = videoLength(deck, this.opts.each);
    const byMusic = videoByMusic(deck, this.opts.each);
    const how = this.opts.each ? `По ${this.opts.each} с на слайд` : byMusic ? 'По музыке и времени слайдов' : 'По времени слайдов';
    return `${how}: ${slides}${ms === null ? '' : `, ${byMusic ? '' : 'около '}${clockText(ms)}`}`;
  }

  /**
   * Сколько займёт файл при выбранных настройках — «до 160 МБ» (оценка сверху) и откуда она; null — длина ролика
   * неизвестна (листается по музыке, а конец трека не записан)
   */
  size(): { text: string; tip: string } | null {
    const { size, fps, each, music } = this.opts;
    const bytes = videoBytes(this.deck(), { width: WIDTH[size], height: size, fps, each, music });
    if (bytes === null) return null;
    const mbps = String(Math.round(videoBitrate(WIDTH[size], size, fps) / 1e5) / 10).replace('.', ',');
    return { text: `до ${sizeText(bytes)}`, tip: `Оценка сверху: ${mbps} Мбит/с видео на всю длину ролика. Чем меньше движения на слайдах, тем меньше файл` };
  }

  /** Трек показа: имя файла и есть ли затухание */
  music(): { name: string; fade: boolean } | null {
    const m = musicOf(this.deck());
    return m ? { name: m.src.split(/[\\/]/).pop() ?? m.src, fade: Number(m.fadeOut) > 0 } : null;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async start(): Promise<void> {
    const app = appVideo();
    if (!app || this.run) return;
    const file = await app.pick(this.deckKey());
    if (!file) return;
    const { size, fps, each } = this.opts;
    const width = WIDTH[size];
    const height = size;
    this.cancelled = false;
    this.run = { frame: 0, total: 0, slide: 1, label: '', leftMs: null };
    this.changed(true);
    let opened = false;
    let ok = false;
    try {
      const start = await app.open({ deck: this.deckKey(), width, height, each });
      opened = true;
      const fpsN = Number(fps);
      this.run.total = Math.max(1, Math.ceil((start.estimate / 1000) * fpsN));
      // Кодировщик (mp4-muxer, WebCodecs) — только когда пишут видео: студия без него открывается быстрее
      const { decodeTrack, encode } = await import('./video-encode');
      const track = this.opts.music && start.musicUrl ? await decodeTrack(start.musicUrl) : null;
      const times: number[] = [];
      const out = await encode(app, { width, height, fps: fpsN, track }, (k, f) => {
        if (!this.run) return;
        times.push(performance.now());
        if (times.length > 60) times.shift();
        this.run.frame = k + 1;
        this.run.slide = f.slide;
        this.run.label = f.label;
        // Оценка оказалась короче (автопоказ ждал анимации) — полоса не упирается в конец
        this.run.total = Math.max(this.run.total, k + 2);
        this.run.leftMs = leftMs(times, this.run.total - k - 1);
        this.changed(false);
      }, () => this.cancelled);
      ok = out && !this.cancelled;
      const saved = await app.close(ok);
      opened = false;
      if (ok && saved) this.toast(`Видео сохранено: ${saved.split(/[\\/]/).slice(-2).join('/')}`, 6000);
      else if (this.cancelled) this.toast('Запись видео остановлена', 2500);
    } catch (e) {
      if (opened) await app.close(false).catch(() => null);
      this.toast(`Видео не записалось: ${(e as Error)?.message || String(e)}`, 8000, true);
    } finally {
      this.run = null;
      this.changed(true);
    }
  }
}
