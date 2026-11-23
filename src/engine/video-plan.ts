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

/** «1:07» — длина ролика */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
