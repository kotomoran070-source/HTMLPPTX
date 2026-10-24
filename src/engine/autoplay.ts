/**
 * Автопоказ: показ сам нажимает «Далее». Отсчёт идёт, когда слайд «досказал»: доиграли переход, появления,
 * прорисовки, «Число набегает» и ролик без повтора; бесконечное (живые фоны, бегущая строка, наплыв камеры)
 * не ждём. Шаги слайда (объекты по щелчку, кадры по «Далее», формула по шагам) — через короткую паузу,
 * сам слайд — через deck.autoplay.after секунд.
 */

/** Пауза между шагами слайда */
export const STEP_MS = 1500;
/** Сколько стоит слайд, если время не задано */
export const AFTER_S = 5;
/** Дольше ждать анимации не стоит: что-то зависло (ролик ждём до конца) */
const MAX_WAIT_MS = 60_000;

/**
 * Таймлайн слайда (окно докладчика, полоса внизу экрана): чёрточки шагов — доли полосы, и отрезок, который идёт сейчас:
 * от from до to за ms (ms 0 — стоит: доигрывают анимации или пауза). total — сколько всего ждать на слайде, мс (без анимаций)
 */
export interface Timeline { ticks: number[]; from: number; to: number; ms: number; total: number; paused?: boolean }

/** План слайда: steps шагов по STEP_MS, потом сам слайд — afterMs; seg(k) — отрезок после k открытых шагов */
export function plan(steps: number, afterMs: number) {
  const total = steps * STEP_MS + afterMs;
  return {
    total,
    ticks: Array.from({ length: steps }, (_, k) => ((k + 1) * STEP_MS) / total),
    seg: (k: number) => (k < steps
      ? { from: (k * STEP_MS) / total, to: ((k + 1) * STEP_MS) / total, ms: STEP_MS }
      : { from: (steps * STEP_MS) / total, to: 1, ms: afterMs }),
  };
}

/** Заливка таймлайна: стоит на from, потом линейно идёт к to за ms (ширина в %) */
export function runFill(el: HTMLElement, t: Timeline): void {
  el.style.transition = 'none';
  el.style.width = `${t.from * 100}%`;
  if (!t.ms) return;
  void el.offsetWidth;
  el.style.transition = `width ${t.ms}ms linear`;
  el.style.width = `${t.to * 100}%`;
}

export interface AutoplayHost {
  slide(): HTMLElement | null;
  /** Сколько шагов у слайда и сколько ещё впереди */
  stepsTotal(): number;
  stepsLeft(): number;
  /** Последний показываемый слайд */
  atEnd(): boolean;
  /** Время слайда (с), «по кругу», таймлайн на экране — из данных: студия может их поменять на ходу */
  options(): { after?: number; loop?: boolean; timeline?: boolean };
  next(): void;
  first(): void;
  /** Сейчас листать нельзя: обзор слайдов, правка, чёрный экран */
  blocked(): boolean;
  bar: { grow(ms: number): void; reset(): void; freeze(): void };
  changed(on: boolean): void;
  /** Таймлайн слайда изменился; null — убрать (листали руками на паузе, автопоказ закончился) */
  timeline(t: Timeline | null): void;
}

/** Слайд досказал: конечные анимации внутри него доиграли, ролик без повтора — тоже */
export async function settled(slide: HTMLElement): Promise<void> {
  // Анимации нового слайда появляются после пересчёта стилей
  await new Promise((r) => requestAnimationFrame(r));
  const anims = slide.getAnimations({ subtree: true }).filter((a) => {
    const end = a.effect?.getComputedTiming().endTime;
    return typeof end === 'number' && Number.isFinite(end) && a.playState !== 'finished';
  });
  const videos = [...slide.querySelectorAll('video')].filter((v) => !v.loop && !v.paused && !v.ended);
  const wait = Math.max(MAX_WAIT_MS, ...videos.map((v) => ((v.duration || 0) - v.currentTime) * 1000 + 1000));
  await Promise.race([
    Promise.all([
      ...anims.map((a) => a.finished.catch(() => {})),
      // Ролик остановили руками — дальше не ждём
      ...videos.map((v) => new Promise((r) => { v.addEventListener('ended', r, { once: true }); v.addEventListener('pause', r, { once: true }); })),
    ]),
    new Promise((r) => setTimeout(r, wait)),
  ]);
}

export class Autoplay {
  on = false;
  /** Автопоказ включали в этом показе: кнопка паузы на панели нужна */
  used = false;
  private timer = 0;
  /** Номер отсчёта: слайд сменился, пока ждали анимации, — старое ожидание не листает */
  private run = 0;
  /** Таймлайн, который сейчас показан, и когда пошёл его отрезок */
  private tl: (Timeline & { t0: number }) | null = null;

  constructor(private h: AutoplayHost) {}

  toggle(on = !this.on): void {
    this.on = on;
    this.used ||= on;
    if (on) void this.schedule();
    else {
      clearTimeout(this.timer);
      this.run++;
      this.h.bar.freeze();
      // Таймлайн замирает там, где был
      const t = this.now();
      if (t) this.show({ ...t, to: t.from, ms: 0, paused: true });
    }
    this.h.changed(on);
  }

  /** Таймлайн сейчас: где полоса и сколько её отрезку ещё идти (новому окну докладчика, паузе) */
  now(): Timeline | null {
    if (!this.tl) return null;
    const { t0: _t0, ...t } = this.tl;
    if (!t.ms) return t;
    const p = Math.min(1, (performance.now() - this.tl.t0) / t.ms);
    return { ...t, from: t.from + (t.to - t.from) * p, ms: Math.round(t.ms * (1 - p)) };
  }

  private show(t: Timeline | null): void {
    this.tl = t && { ...t, t0: performance.now() };
    this.h.timeline(t);
  }

  /** Слайд или шаг сменился — сам, руками, из окна докладчика: отсчёт заново */
  async schedule(): Promise<void> {
    clearTimeout(this.timer);
    const run = ++this.run;
    if (!this.on) {
      // Листали руками на паузе: замерший таймлайн — про прежний шаг
      if (this.tl) this.show(null);
      return;
    }
    this.h.bar.reset();
    const { after, loop, timeline } = this.h.options();
    const left = this.h.stepsLeft();
    const p = plan(this.h.stepsTotal(), Math.max(1, Number(after) || AFTER_S) * 1000);
    const seg = p.seg(this.h.stepsTotal() - left);
    // Пока доигрывают анимации — таймлайн стоит у своей чёрточки
    this.show({ ticks: p.ticks, total: p.total, from: seg.from, to: seg.from, ms: 0 });
    const slide = this.h.slide();
    if (slide) await settled(slide);
    if (run !== this.run || !this.on) return;
    const last = !left && this.h.atEnd();
    // Полоска прогресса плавно идёт к следующему слайду (с таймлайном на экране — стоит);
    // на последнем без «по кругу» идти некуда
    if (!left && !(last && !loop) && !timeline) this.h.bar.grow(seg.ms);
    this.show({ ticks: p.ticks, total: p.total, ...seg });
    this.timer = window.setTimeout(() => {
      if (run !== this.run) return;
      if (this.h.blocked()) return void this.schedule();
      if (!last) this.h.next();
      else if (loop) this.h.first();
      else {
        this.toggle(false);
        this.show(null);
      }
    }, seg.ms);
  }
}
