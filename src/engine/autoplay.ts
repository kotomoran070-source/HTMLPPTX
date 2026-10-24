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

export interface AutoplayHost {
  slide(): HTMLElement | null;
  /** Сколько шагов слайда ещё впереди */
  stepsLeft(): number;
  /** Последний показываемый слайд */
  atEnd(): boolean;
  /** Время слайда (с) и «по кругу» — из данных: студия может их поменять на ходу */
  options(): { after?: number; loop?: boolean };
  next(): void;
  first(): void;
  /** Сейчас листать нельзя: обзор слайдов, правка, чёрный экран */
  blocked(): boolean;
  bar: { grow(ms: number): void; reset(): void; freeze(): void };
  changed(on: boolean): void;
  /** Отсчёт пошёл: через ms — следующий шаг или слайд (окну докладчика) */
  timing(ms: number): void;
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

  constructor(private h: AutoplayHost) {}

  toggle(on = !this.on): void {
    this.on = on;
    this.used ||= on;
    if (on) void this.schedule();
    else {
      clearTimeout(this.timer);
      this.run++;
      this.h.bar.freeze();
    }
    this.h.changed(on);
  }

  /** Слайд или шаг сменился — сам, руками, из окна докладчика: отсчёт заново */
  async schedule(): Promise<void> {
    clearTimeout(this.timer);
    const run = ++this.run;
    if (!this.on) return;
    this.h.bar.reset();
    const slide = this.h.slide();
    if (slide) await settled(slide);
    if (run !== this.run || !this.on) return;
    const steps = this.h.stepsLeft() > 0;
    const { after, loop } = this.h.options();
    const ms = steps ? STEP_MS : Math.max(1, Number(after) || AFTER_S) * 1000;
    const last = !steps && this.h.atEnd();
    // Полоска прогресса плавно идёт к следующему слайду; на последнем без «по кругу» идти некуда
    if (!steps && !(last && !loop)) this.h.bar.grow(ms);
    this.h.timing(ms);
    this.timer = window.setTimeout(() => {
      if (run !== this.run) return;
      if (this.h.blocked()) return void this.schedule();
      if (!last) this.h.next();
      else if (loop) this.h.first();
      else this.toggle(false);
    }, ms);
  }
}
