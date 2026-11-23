/**
 * Покадровая запись показа в видео (Файл → Экспорт → Видео; программа — desktop/video.mjs). Страница показа
 * открывается с ?render=video в невидимом окне, и время у неё своё: оно идёт только по команде «кадр k». Так ролик
 * ровный на любом компьютере — тяжёлый слайд просто дольше считается, а в видео рывка нет.
 *
 * Что подчиняется этим часам:
 *  - performance.now, Date.now, setTimeout/setInterval, requestAnimationFrame — автопоказ, «Число набегает»,
 *    эффекты текста, живые фоны, 3D-модели (model-viewer считает время по ним же);
 *  - анимации CSS и Web Animations — каждая на паузе, на каждом кадре ставится ровно в свой момент
 *    (рождение — время часов, когда она появилась); конечная по концу — finish(): страница получает свои
 *    animationend и finished, как при обычном показе;
 *  - SMIL в SVG (рябь появления) — время документа SVG;
 *  - звук и видео: play/pause/currentTime — по часам, сам элемент стоит; видео на кадре перематывается к своей
 *    секунде, и кадр снимается, когда перемотка готова.
 * Пока не готовы картинки, шрифты, модели и перемотка видео — часы стоят: в кадр не попадает пустое место.
 *
 * Модуль подключается первым (src/main.ts): остальной код должен застать уже подменённые часы.
 * Без ?render=video (и в собранном файле презентации) ничего не делает.
 */

import type { Deck } from '../types';

/** Страница — кадр видео: показ без панелей, автопоказ по команде, часы — пошагово */
export const RENDER = __SERVED__ && new URLSearchParams(location.search).get('render') === 'video';

/** Что показ сообщает записи (show.ts заполняет, когда готов) */
export interface RenderShow {
  /** Автопоказ — с первого слайда, музыка — с начала */
  start(): void;
  /** Где показ: слайд (с 1) и его подпись */
  where(): { slide: number; label: string };
  /** Автопоказ дошёл до конца сам */
  ended(): boolean;
  /** Сколько, по данным, будет идти ролик с хвостом, мс (video-plan.ts) */
  estimate(): number;
  /** Сколько держать последний кадр после конца, мс (музыка затухает) */
  tail(): number;
  /** Трек показа, если есть */
  music(): HTMLAudioElement | null;
}

/** Ответ на кадр */
export interface RenderFrame {
  /** Время кадра от начала ролика, мс */
  t: number;
  slide: number;
  label: string;
  /** Ролик кончился: этот кадр — уже лишний */
  done: boolean;
  /** Трек в этот момент: секунда (null — молчит) и громкость */
  music: { pos: number | null; vol: number };
}

export interface RenderStart {
  estimate: number;
  /** Адрес трека для звуковой дорожки; null — музыки нет */
  musicUrl: string | null;
  slides: number;
}

/**
 * Автопоказ для ролика: без «по кругу», таймлайна на экране и «Сразу при открытии» (его запускает запись).
 * ?each=5 — «По 5 с»: каждый слайд по столько секунд, не по музыке (музыка, если есть, — фоном с начала)
 */
export function renderDeck(deck: Deck): void {
  const each = Number(new URLSearchParams(location.search).get('each'));
  const a = { ...deck.autoplay, loop: false, timeline: false, start: false };
  if (each > 0) {
    a.after = each;
    a.music = false;
    for (const s of deck.slides) delete s.after;
  }
  deck.autoplay = a;
}

let show: RenderShow | null = null;
/** show.ts: показ готов, запись может начинаться */
export function renderReady(s: RenderShow): void {
  show = s;
  api.ready = true;
}

type Timer = { id: number; due: number; fn: (...a: unknown[]) => void; args: unknown[]; every: number; level: number };

const api = {
  ready: false,
  start: (): Promise<RenderStart> => Promise.reject(new Error('Запись выключена')),
  frame: (_k: number, _fps: number): Promise<RenderFrame> => Promise.reject(new Error('Запись выключена')),
};

if (RENDER) install();

function install(): void {
  const native = {
    now: performance.now.bind(performance),
    dateNow: Date.now,
    setTimeout: window.setTimeout.bind(window),
    raf: window.requestAnimationFrame.bind(window),
  };
  const perf0 = native.now();
  const date0 = native.dateNow();

  /** Часы, мс (как performance.now). До start() идут сами (загрузка страницы), после — только по кадрам */
  let vnow = perf0;
  let manual = false;
  const now = () => (manual ? vnow : (vnow = Math.max(vnow, native.now())));

  // --- таймеры: своя очередь; вложенные «через 0» — не чаще 4 мс, как в браузере (иначе опрос в цикле не даёт часам идти)
  const timers = new Map<number, Timer>();
  let nextId = 1;
  let level = 0;
  const add = (fn: unknown, ms: unknown, args: unknown[], every: boolean): number => {
    if (typeof fn !== 'function') return 0;
    let d = Math.max(0, Number(ms) || 0);
    if (level >= 5 && d < 4) d = 4;
    const id = nextId++;
    timers.set(id, { id, due: now() + d, fn: fn as Timer['fn'], args, every: every ? Math.max(d, 1) : 0, level: level + 1 });
    if (!manual) pump();
    return id;
  };
  const clear = (id: unknown) => { timers.delete(Number(id)); };
  const w = window as unknown as Record<string, unknown>;
  w.setTimeout = (fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, false);
  w.setInterval = (fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, true);
  w.clearTimeout = clear;
  w.clearInterval = clear;

  // --- кадры анимации
  let frames = new Map<number, FrameRequestCallback>();
  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, cb);
    if (!manual) pumpFrames();
    return id;
  };
  w.cancelAnimationFrame = (id: number) => { frames.delete(id); };

  performance.now = () => now();
  Date.now = () => Math.round(date0 + (now() - perf0));

  /** Все отложенные обещания (микрозадачи) доиграли: ответ — настоящей задачей, она идёт после них */
  const drain = () => new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

  async function runTimer(t: Timer): Promise<void> {
    vnow = Math.max(vnow, t.due);
    if (t.every) t.due += t.every;
    else timers.delete(t.id);
    level = t.level;
    try { t.fn(...t.args); } catch (e) { console.error(e); }
    level = 0;
    await drain();
  }

  /** Таймеры до T — по порядку, каждый в свою миллисекунду; после каждого — новые анимации рождаются в его время */
  async function runTimers(T: number): Promise<void> {
    for (let guard = 0; guard < 100_000; guard++) {
      let best: Timer | null = null;
      for (const t of timers.values()) if (t.due <= T && (!best || t.due < best.due || (t.due === best.due && t.id < best.id))) best = t;
      if (!best) break;
      await runTimer(best);
      adopt();
    }
    vnow = Math.max(vnow, T);
  }

  async function runFrames(): Promise<void> {
    const list = frames;
    frames = new Map();
    for (const cb of list.values()) {
      try { cb(vnow); } catch (e) { console.error(e); }
    }
    await drain();
  }

  // До start() часы идут сами: таймеры и кадры — по настоящему времени
  let pumping = false;
  function pump(): void {
    if (pumping || manual) return;
    pumping = true;
    native.setTimeout(() => {
      pumping = false;
      if (manual) return;
      void runTimers(now()).then(() => { if (timers.size) pump(); });
    }, 4);
  }
  let framing = false;
  function pumpFrames(): void {
    if (framing || manual) return;
    framing = true;
    native.raf(() => {
      framing = false;
      if (manual) return;
      now();
      void runFrames().then(() => { if (frames.size) pumpFrames(); });
    });
  }

  // --- анимации CSS и Web Animations: на паузе, время — от рождения по часам
  const born = new WeakMap<Animation, number>();
  /** Время, которое поставили мы: другое — его поставила страница (перемотка к концу), рождение пересчитывается */
  const mine = new WeakMap<Animation, number>();
  const over = new WeakSet<Animation>();
  const rateOf = (a: Animation) => (a.playbackRate || 1);
  function adopt(): void {
    for (const a of document.getAnimations()) {
      const st = a.playState;
      if (born.has(a) && st !== 'running') continue;
      // Новая или страница запустила заново
      born.set(a, vnow - Number(a.currentTime ?? 0) / rateOf(a));
      over.delete(a);
      mine.delete(a);
      if (st !== 'finished') a.pause();
    }
  }
  function stepAnimations(): void {
    for (const a of document.getAnimations()) {
      let b = born.get(a);
      if (b === undefined || over.has(a) || a.playState === 'idle') continue;
      const rate = rateOf(a);
      const cur = Number(a.currentTime ?? 0);
      const set = mine.get(a);
      if (set !== undefined && Math.abs(cur - set) > 0.5) {
        b = vnow - cur / rate;
        born.set(a, b);
      }
      const ct = (vnow - b) * rate;
      const end = a.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end) && rate > 0 && ct >= end) {
        a.finish();
        over.add(a);
        continue;
      }
      a.currentTime = ct;
      mine.set(a, Number(a.currentTime ?? ct));
    }
  }

  // --- SMIL: у каждого SVG с <animate> время документа — по часам
  const svgBorn = new WeakMap<SVGSVGElement, number>();
  function stepSvg(): void {
    const roots = new Set<SVGSVGElement>();
    for (const el of document.querySelectorAll<SVGElement>('animate, animateTransform, animateMotion, set')) {
      let svg = el.ownerSVGElement;
      while (svg?.ownerSVGElement) svg = svg.ownerSVGElement;
      if (svg) roots.add(svg);
    }
    for (const svg of roots) {
      if (!svgBorn.has(svg)) {
        svgBorn.set(svg, vnow - svg.getCurrentTime() * 1000);
        svg.pauseAnimations();
      }
      svg.setCurrentTime(Math.max(0, (vnow - svgBorn.get(svg)!) / 1000));
    }
  }

  // --- звук и видео: сами элементы стоят, позиция — по часам
  type Media = { playing: boolean; pos: number; at: number };
  const P = HTMLMediaElement.prototype;
  const cur = Object.getOwnPropertyDescriptor(P, 'currentTime')!;
  const nativePause = P.pause;
  const media = new Map<HTMLMediaElement, Media>();
  const stateOf = (el: HTMLMediaElement): Media => {
    let s = media.get(el);
    if (!s) {
      s = { playing: false, pos: Number(cur.get!.call(el)) || 0, at: vnow };
      media.set(el, s);
    }
    return s;
  };
  const posOf = (el: HTMLMediaElement, s: Media): number => {
    if (!s.playing) return s.pos;
    let p = s.pos + ((now() - s.at) / 1000) * (el.playbackRate || 1);
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) p = el.loop ? p % d : Math.min(p, d);
    return p;
  };
  const fire = (el: HTMLMediaElement, type: string) => add(() => el.dispatchEvent(new Event(type)), 0, [], false);
  Object.defineProperty(P, 'currentTime', {
    configurable: true,
    get(this: HTMLMediaElement) { return posOf(this, stateOf(this)); },
    set(this: HTMLMediaElement, v: number) {
      const s = stateOf(this);
      s.pos = Math.max(0, Number(v) || 0);
      s.at = now();
      cur.set!.call(this, s.pos);
    },
  });
  Object.defineProperty(P, 'paused', { configurable: true, get(this: HTMLMediaElement) { return !stateOf(this).playing; } });
  Object.defineProperty(P, 'ended', {
    configurable: true,
    get(this: HTMLMediaElement) {
      const s = stateOf(this);
      const d = this.duration;
      return !this.loop && !s.playing && Number.isFinite(d) && d > 0 && s.pos >= d - 1e-3;
    },
  });
  P.play = function (this: HTMLMediaElement) {
    const s = stateOf(this);
    nativePause.call(this);
    if (!s.playing) {
      const d = this.duration;
      s.pos = !this.loop && Number.isFinite(d) && d > 0 && s.pos >= d - 1e-3 ? 0 : s.pos;
      s.at = now();
      s.playing = true;
      fire(this, 'play');
      fire(this, 'playing');
    }
    return Promise.resolve();
  };
  P.pause = function (this: HTMLMediaElement) {
    const s = stateOf(this);
    nativePause.call(this);
    if (s.playing) {
      s.pos = posOf(this, s);
      s.at = now();
      s.playing = false;
      fire(this, 'pause');
    }
  };
  // Ролик с autoplay браузер запускает сам — переводим его на часы
  document.addEventListener('play', (e) => {
    const el = e.target as HTMLMediaElement;
    if (!e.isTrusted || !(el instanceof HTMLMediaElement)) return;
    nativePause.call(el);
    const s = stateOf(el);
    if (!s.playing) {
      s.at = now();
      s.playing = true;
    }
  }, true);

  /** Ход звука и видео к кадру: конец ролика, timeupdate; видео — перемотка к своей секунде (её ждём) */
  function stepMedia(): Promise<unknown>[] {
    const wait: Promise<unknown>[] = [];
    for (const [el, s] of media) {
      if (!el.isConnected) {
        media.delete(el);
        continue;
      }
      if (s.playing) {
        const d = el.duration;
        const raw = s.pos + ((vnow - s.at) / 1000) * (el.playbackRate || 1);
        if (!el.loop && Number.isFinite(d) && d > 0 && raw >= d) {
          s.pos = d;
          s.at = vnow;
          s.playing = false;
          fire(el, 'pause');
          fire(el, 'ended');
        }
        fire(el, 'timeupdate');
      }
      if (el instanceof HTMLVideoElement && el.readyState >= 1 && shown(el)) {
        const want = posOf(el, s);
        if (Math.abs(Number(cur.get!.call(el)) - want) > 0.004) {
          cur.set!.call(el, want);
          wait.push(seeked(el));
        }
      }
    }
    return wait;
  }
  /** Перемотка готова и кадр ролика дошёл до экрана (если браузер не умеет его декодировать — не ждём дольше пары кадров) */
  const seeked = (el: HTMLVideoElement) => within(new Promise<void>((r) => {
    el.addEventListener('seeked', () => {
      const v = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      v.requestVideoFrameCallback?.(() => r());
      native.raf(() => native.raf(() => native.setTimeout(r, 30)));
    }, { once: true });
  }), 3000);

  /** Элемент на странице нарисован: не display:none (закрытые слайды — display:none, base.css) */
  const shown = (el: Element) => el.getClientRects().length > 0;

  const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<void>((r) => native.setTimeout(r, ms))]);

  /** Всё видимое догрузилось: картинки, шрифты, 3D-модели (часы стоят, пока ждём) */
  async function ready(extra: Promise<unknown>[]): Promise<void> {
    const wait: Promise<unknown>[] = [...extra];
    if (document.fonts.status !== 'loaded') wait.push(document.fonts.ready);
    for (const img of document.querySelectorAll('img')) {
      if (!img.getAttribute('src') || !shown(img)) continue;
      if (!img.complete) wait.push(img.decode().catch(() => {}));
    }
    for (const m of document.querySelectorAll<HTMLElement & { loaded?: boolean }>('model-viewer')) {
      if (m.loaded === false && shown(m) && m.getAttribute('src')) {
        wait.push(new Promise((r) => { m.addEventListener('load', r, { once: true }); m.addEventListener('error', r, { once: true }); }));
      }
    }
    if (wait.length) await within(Promise.all(wait), 20_000);
  }

  /** Два настоящих кадра: изменения дошли до экрана окна, снимок будет свежим */
  const painted = () => new Promise<void>((r) => native.raf(() => native.raf(() => r())));

  let T0 = 0;
  let endAt = Infinity;
  let busy = false;

  api.start = async (): Promise<RenderStart> => {
    if (!show) throw new Error('Показ ещё не готов');
    // Трек и ролики знают свою длину до старта: по ней считается конец показа
    await within(Promise.all([...document.querySelectorAll('audio, video')].map((m) => (m as HTMLMediaElement).readyState >= 1
      ? null : new Promise((r) => { m.addEventListener('loadedmetadata', r, { once: true }); m.addEventListener('error', r, { once: true }); }))), 15_000);
    await ready([]);
    manual = true;
    T0 = now();
    show.start();
    await drain();
    await runTimers(vnow);
    adopt();
    const m = show.music();
    return { estimate: show.estimate(), musicUrl: m?.currentSrc || m?.src || null, slides: show.where().slide };
  };

  api.frame = async (k: number, fps: number): Promise<RenderFrame> => {
    if (!show || !manual) throw new Error('Запись не начата');
    if (busy) throw new Error('Предыдущий кадр ещё не готов');
    busy = true;
    try {
      const T = T0 + (k * 1000) / fps;
      await runTimers(T);
      vnow = T;
      await runFrames();
      adopt();
      stepAnimations();
      stepSvg();
      const seeks = stepMedia();
      // timeupdate и конец роликов — событиями в это же мгновение
      await runTimers(T);
      await ready(seeks);
      await painted();
      if (show.ended() && endAt === Infinity) endAt = T - T0 + show.tail();
      const m = show.music();
      const ms = m ? media.get(m) : undefined;
      return {
        t: T - T0,
        ...show.where(),
        done: T - T0 > endAt || T - T0 > 3 * 3600_000,
        music: { pos: m && ms?.playing ? posOf(m, ms) : null, vol: m ? m.volume : 0 },
      };
    } finally {
      busy = false;
    }
  };

  (window as unknown as { slideriaRender: typeof api }).slideriaRender = api;
}
