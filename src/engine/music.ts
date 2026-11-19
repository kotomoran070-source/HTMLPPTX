/**
 * Музыка показа (deck.music): один трек через все слайды — как «Воспроизводить в фоне» в PowerPoint.
 *
 * Время везде — секунды самого трека: slide.at — когда появляется слайд, slide.steps — когда открываются его шаги
 * по щелчку, music.end — где показ кончается. Секунды трека, а не показа: обрезали вступление («Начало трека») —
 * слайды остаются на тех же ударах.
 *
 * С «Листать по музыке» (autoplay.music) часы автопоказа — сам трек: переход ждёт, пока трек дойдёт до нужной
 * секунды, а не отсчитывает таймер от предыдущего перехода. Поэтому за минуту ничего не уползает, а пауза и
 * перелистывание руками остаются в такте (трек перематывается к слайду).
 */
import type { Deck } from '../types';

export type DeckMusic = NonNullable<Deck['music']>;

/** Музыка у презентации есть (файл указан) */
export function musicOf(deck: Deck): DeckMusic | null {
  const m = deck.music;
  return m && typeof m.src === 'string' && m.src.trim() ? m : null;
}

/** Автопоказ листает по музыке */
export const drivenByMusic = (deck: Deck): boolean => !!musicOf(deck) && deck.autoplay?.music === true;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** С какой секунды трек играет */
export const trackStart = (m: DeckMusic): number => num(m.start) ?? 0;

/** Громкость 0…1 (по умолчанию — полная) */
export const trackVolume = (m: DeckMusic): number => Math.max(0, Math.min(1, num(m.volume) ?? 1));

/**
 * Когда открывается шаг k слайда i, секунды трека: k = 0 — сам слайд (slide.at), k ≥ 1 — шаг k (slide.steps[k-1]).
 * Не записано — undefined (автопоказ здесь идёт по своему таймеру)
 */
export function cueOf(deck: Deck, i: number, k: number): number | undefined {
  const s = deck.slides[i];
  if (!s) return undefined;
  if (k <= 0) return num(s.at);
  return Array.isArray(s.steps) ? num(s.steps[k - 1]) : undefined;
}

/** «0:07.2» — секунды трека для поля и подписи; digits — знаков после запятой (часы записи — 2, «0:18.46») */
export function fmtTime(sec: number, digits = 1): string {
  const k = 10 ** digits;
  const s = Math.max(0, Math.round(sec * k) / k);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const txt = rest.toFixed(digits);
  return `${m}:${rest < 10 ? '0' : ''}${digits === 1 ? txt.replace(/\.0$/, '') : txt}`;
}

/** Секунды из «0:07.2», «7,2» или «7.2»; не разобрали — null */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(',', '.');
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[1] ?? 0) * 60 + Number(m[2]);
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
}

/**
 * Нажатия — к ближайшей доле при темпе bpm. Где стоит сетка долей, решают все нажатия вместе (среднее по кругу
 * их сдвигов внутри доли): один промах не сдвигает всю сетку, как было бы при отсчёте от первого нажатия.
 * Два нажатия, притянутые к одной доле, — второе остаётся как было: порядок шагов не ломается
 */
export function snapToBeat(times: number[], bpm: number): number[] {
  if (!(bpm >= 30 && bpm <= 300) || !times.length) return times.slice();
  const beat = 60 / bpm;
  let sx = 0;
  let sy = 0;
  for (const t of times) {
    const a = ((t % beat) / beat) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const phase = ((Math.atan2(sy, sx) / (2 * Math.PI) + 1) % 1) * beat;
  const out: number[] = [];
  for (const t of times) {
    const snapped = Math.round((t - phase) / beat) * beat + phase;
    const prev = out.length ? out[out.length - 1] : -Infinity;
    out.push(Math.round((snapped > prev ? snapped : t > prev ? t : prev + 0.001) * 1000) / 1000);
  }
  return out;
}

/** Ответ проигрывателя: звук пошёл или браузер ждёт действия зрителя (собранный файл без щелчка) */
export type PlayResult = 'playing' | 'blocked';

/**
 * Трек показа: одно <audio> на всё окно. Затухание — к end и к концу самого трека, а при stop() — сразу;
 * громкость возвращается, когда трек снова играет
 */
export class ShowMusic {
  readonly el: HTMLAudioElement;
  private fadeTimer = 0;
  /** Браузер не дал играть без действия зрителя: первое нажатие запускает */
  private waiting: (() => void) | null = null;
  /** Звук пошёл (после ожидания щелчка) — показ узнаёт и продолжает */
  onPlaying: (() => void) | null = null;
  /** Трек ведёт автопоказ: у end его останавливает сам автопоказ (по кругу — перематывает к началу), не хвост */
  driven = false;

  constructor(private m: DeckMusic) {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.src = m.src;
    a.volume = trackVolume(m);
    a.hidden = true;
    a.className = 'show-music';
    document.body.appendChild(a);
    this.el = a;
    // Затухание к концу: к end показа или к концу самого трека
    a.addEventListener('timeupdate', () => this.tail());
    a.addEventListener('playing', () => this.onPlaying?.());
  }

  /** Музыку поправили (студия, другое окно): громкость и начало — новые */
  update(m: DeckMusic): void {
    const src = m.src !== this.m.src;
    this.m = m;
    if (src) this.el.src = m.src;
    if (!this.fadeTimer) this.el.volume = trackVolume(m);
  }

  get playing(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  /** Сейчас в треке, с */
  time(): number {
    return this.el.currentTime;
  }

  /** Перемотать; метаданных ещё нет — сразу, как появятся */
  seek(t: number): void {
    const to = Math.max(0, t);
    if (this.el.readyState >= 1) this.el.currentTime = to;
    else this.el.addEventListener('loadedmetadata', () => { this.el.currentTime = to; }, { once: true });
  }

  /** Играть (at — с этой секунды) */
  async play(at?: number): Promise<PlayResult> {
    this.cancelFade();
    this.el.volume = trackVolume(this.m);
    if (at !== undefined) this.seek(at);
    try {
      await this.el.play();
      return 'playing';
    } catch (e) {
      if ((e as DOMException)?.name !== 'NotAllowedError') return 'blocked';
      // Собранный файл в браузере: звук — только после действия зрителя. Первое нажатие или щелчок — и пошло
      this.armGesture();
      return 'blocked';
    }
  }

  private armGesture(): void {
    if (this.waiting) return;
    const go = () => {
      this.disarm();
      void this.el.play().catch(() => {});
    };
    this.waiting = go;
    addEventListener('keydown', go, { capture: true });
    addEventListener('pointerdown', go, { capture: true });
  }

  private disarm(): void {
    if (!this.waiting) return;
    removeEventListener('keydown', this.waiting, { capture: true });
    removeEventListener('pointerdown', this.waiting, { capture: true });
    this.waiting = null;
  }

  /** Ждёт щелчка зрителя, чтобы зазвучать */
  get blocked(): boolean {
    return !!this.waiting;
  }

  pause(): void {
    this.disarm();
    this.cancelFade();
    this.el.pause();
    this.el.volume = trackVolume(this.m);
  }

  /** Конец показа: затухает за fadeOut и останавливается */
  stop(): void {
    this.disarm();
    const sec = num(this.m.fadeOut) ?? 0;
    if (!sec || !this.playing) {
      this.pause();
      return;
    }
    this.cancelFade();
    const from = this.el.volume;
    const t0 = performance.now();
    this.fadeTimer = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / (sec * 1000));
      this.el.volume = from * (1 - p);
      if (p >= 1) this.pause();
    }, 40);
  }

  /** Хвост трека: к end (или к концу файла) громкость сходит на нет за fadeOut; дошли до end — стоп */
  private tail(): void {
    if (this.fadeTimer || this.el.paused) return;
    const end = num(this.m.end);
    const t = this.el.currentTime;
    if (end !== undefined && t >= end && !this.driven) {
      this.stop();
      return;
    }
    const sec = num(this.m.fadeOut) ?? 0;
    const dur = this.el.duration;
    if (!sec || !Number.isFinite(dur)) return;
    const left = dur - t;
    const vol = trackVolume(this.m);
    this.el.volume = left < sec ? vol * Math.max(0, left / sec) : vol;
  }

  private cancelFade(): void {
    clearInterval(this.fadeTimer);
    this.fadeTimer = 0;
  }

  destroy(): void {
    this.pause();
    this.el.remove();
  }
}
