/**
 * Длина ролика «Экспорт → Видео» по данным презентации — для подписи «1:07» в панели экспорта и полосы записи.
 * По музыке длина точная: от первого слайда до конца трека (music.end) и затухания. По таймеру — шаги по щелчку
 * и время слайдов; автопоказ ещё ждёт, пока доиграют появления, поэтому настоящий ролик бывает чуть длиннее.
 */
import type { Deck } from '../types';
import { AFTER_S, STEP_MS } from './autoplay';
import { isHidden, stepVisible } from './hidden';
import { cueOf, drivenByMusic, musicOf, trackStart } from './music';

/** Сколько держать последний кадр после конца показа, мс: пока затухает музыка; без музыки — секунду */
export function videoTail(deck: Deck): number {
  const m = musicOf(deck);
  return m ? Math.max(500, (Number(m.fadeOut) || 0) * 1000) : 1000;
}

/** Ролик листается по музыке (each — «По N с»: нет) */
export const videoByMusic = (deck: Deck, each = 0): boolean => !(each > 0) && drivenByMusic(deck);

/**
 * Длина ролика, мс, с хвостом. each > 0 — каждый слайд по столько секунд. trackSec — длина файла трека, если
 * конец (music.end) не записан. null — по музыке, но конца не узнать
 */
export function videoLength(deck: Deck, each = 0, trackSec?: number): number | null {
  const tail = videoTail(deck);
  if (videoByMusic(deck, each)) {
    const m = musicOf(deck)!;
    const end = typeof m.end === 'number' && Number.isFinite(m.end) ? m.end : trackSec;
    if (end === undefined || !Number.isFinite(end)) return null;
    const from = cueOf(deck, stepVisible(deck, -1, 1), 0) ?? trackStart(m);
    return Math.max(0, end - from) * 1000 + tail;
  }
  let ms = 0;
  deck.slides.forEach((s, i) => {
    if (isHidden(deck, i)) return;
    const clicks = (s.free ?? []).filter((o) => o.click && !o.clickWith).length;
    ms += clicks * STEP_MS + (each > 0 ? each : Number(s.after ?? deck.autoplay?.after) || AFTER_S) * 1000;
  });
  return ms + tail;
}

/** Показываемых слайдов */
export const shownSlides = (deck: Deck): number => deck.slides.filter((_, i) => !isHidden(deck, i)).length;

/** Поток видео: 0,15 бита на пиксель кадра — градиенты, зерно и мелкий текст без «ступенек»; не меньше 6 Мбит/с */
export const videoBitrate = (w: number, h: number, fps: number): number => Math.round(Math.min(80e6, Math.max(6e6, w * h * fps * 0.15)));
/** Поток звука (трек показа) */
export const AUDIO_BITRATE = 192_000;

/**
 * Сколько займёт ролик, байт, — оценка сверху: кодировщику задан средний поток, и спокойные слайды он сжимает
 * сильнее (файл выходит меньше), а движение на всё время ролика — до этого потока. null — длину не узнать
 */
export function videoBytes(deck: Deck, o: { width: number; height: number; fps: number; each?: number; music?: boolean }): number | null {
  const ms = videoLength(deck, o.each ?? 0);
  if (ms === null) return null;
  const bps = videoBitrate(o.width, o.height, o.fps) + (o.music !== false && musicOf(deck) ? AUDIO_BITRATE : 0);
  // Ещё ~1 % — заголовки MP4 и таблицы кадров
  return (bps * ms) / 8000 * 1.01;
}

/** «160 МБ», «1,3 ГБ», «8,4 МБ»: две значащие цифры, с округлением вверх — оценка сверху так и остаётся сверху */
export function sizeText(bytes: number): string {
  const up = (v: number) => {
    const p = 10 ** (Math.floor(Math.log10(Math.max(v, 1e-9))) - 1);
    return String(Number((Math.ceil(v / p - 1e-9) * p).toPrecision(2))).replace('.', ',');
  };
  const mb = bytes / 1048576;
  return mb >= 1000 ? `${up(mb / 1024)} ГБ` : `${up(Math.max(mb, 0.1))} МБ`;
}

/** «1:07» — длина ролика */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
