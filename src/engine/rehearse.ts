/**
 * «Показ → Записать время» (как «Настройка времени» в PowerPoint): показ идёт под музыку, на каждом ударе —
 * пробел или →; каждый переход к слайду и каждый шаг по щелчку запоминается секундой трека. Последнее нажатие
 * после конца слайдов — конец показа (music.end). «Сохранить» пишет slide.at, slide.steps, music.end и включает
 * «Листать по музыке». Окно записи — поверх самого показа: видно, что именно меняется на удар.
 *
 * «Притягивать к доле»: нажатия встают на ближайшую долю при заданном темпе (music.ts, snapToBeat) — попадать
 * идеально не нужно.
 */
import { icon } from '../components/icons';
import type { Deck } from '../types';
import { saveToProject } from './editor/persist';
import { esc } from './html';
import { fmtTime, snapToBeat, trackStart, type ShowMusic } from './music';
import './rehearse.css';

export interface RehearseHost {
  deck: Deck;
  deckKey: string;
  music: ShowMusic;
  /** Записанное можно сохранить в файл (страница с сервером) */
  canSave: boolean;
  /** Где показ: номер среди видимых, сколько слайдов, номер открытого слайда, шаг */
  where(): { pos: number; total: number; index: number; step: number; steps: number };
  /** Дальше: шаг слайда, следующий слайд или конец (дальше некуда) — без проверок тестов и автопоказа */
  advance(): 'step' | 'slide' | 'end';
  back(): void;
  /** К первому видимому слайду, шаги — с начала */
  restart(): void;
  /** Закрыть запись: показ дальше как обычно */
  close(): void;
}

/** Нажатие записано: слайд i, шаг k (0 — сам слайд), секунда трека */
interface Tap { i: number; k: number; t: number }

const BPM_KEY = 'slideria.rehearse.bpm';
const SNAP_KEY = 'slideria.rehearse.snap';
const BARS = 220;

export function startRehearse(h: RehearseHost): void {
  const m = h.music;
  const start = trackStart(h.deck.music!);
  const taps: Tap[] = [];
  let end: number | null = null;
  let started = false;
  let bpm = 130;
  let snap = true;
  try {
    bpm = Number(localStorage.getItem(BPM_KEY)) || bpm;
    snap = localStorage.getItem(SNAP_KEY) !== '0';
  } catch { /* без хранилища — по умолчанию */ }

  const el = document.createElement('div');
  el.className = 'rh';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Запись времени');
  el.innerHTML = `
<div class="rh-head"><b>Запись времени</b><span class="rh-clock">${icon('music')}<span id="rh-t">${fmtTime(start, 2)}</span></span><span class="rh-where" id="rh-w"></span></div>
<div class="rh-wave"><canvas id="rh-c" height="44" aria-hidden="true"></canvas></div>
<p class="rh-hint" id="rh-h"></p>
<div class="rh-foot">
  <label class="rh-snap"><input type="checkbox" id="rh-snap"${snap ? ' checked' : ''}> Притягивать к доле</label>
  <label class="rh-bpm">Темп <input type="number" id="rh-bpm" min="40" max="240" step="1" value="${bpm}" aria-label="Темп, ударов в минуту"> уд/мин</label>
  <span class="rh-gap"></span>
  <button type="button" class="btn ghost small" id="rh-x">Отмена</button>
  <button type="button" class="btn primary small" id="rh-ok" disabled>Сохранить</button>
</div>`;
  document.body.appendChild(el);
  document.body.classList.add('rehearsing');
  const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const canvas = $<HTMLCanvasElement>('rh-c');
  const ok = $<HTMLButtonElement>('rh-ok');

  // Волна трека — чтобы видеть, где удары; не разобрали файл — ровная полоса
  let peaks: number[] = [];
  let dur = 0;
  void (async () => {
    try {
      const buf = await (await fetch(m.el.currentSrc || m.el.src)).arrayBuffer();
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(buf);
      void ctx.close();
      dur = audio.duration;
      const data = audio.getChannelData(0);
      const from = Math.floor(start * audio.sampleRate);
      const span = Math.max(1, Math.floor((data.length - from) / BARS));
      peaks = Array.from({ length: BARS }, (_, b) => {
        let mx = 0;
        for (let j = from + b * span, e = Math.min(data.length, j + span); j < e; j += 8) mx = Math.max(mx, Math.abs(data[j]));
        return mx;
      });
      const top = Math.max(0.01, ...peaks);
      peaks = peaks.map((p) => p / top);
    } catch { /* волны не будет */ }
    draw();
  })();

  const total = () => (dur || m.el.duration || 0) - start;
  function draw(): void {
    const w = canvas.clientWidth || 520;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(44 * dpr);
    const c = canvas.getContext('2d');
    if (!c) return;
    const cs = getComputedStyle(el);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, 44);
    const len = total();
    const x = (t: number) => (len > 0 ? ((t - start) / len) * w : 0);
    const now = x(m.time());
    const bw = w / BARS;
    for (let b = 0; b < BARS; b++) {
      const v = peaks.length ? Math.max(0.06, peaks[b]) : 0.12;
      c.fillStyle = b * bw < now ? cs.getPropertyValue('--rh-played') : cs.getPropertyValue('--rh-bar');
      const hgt = v * 36;
      c.fillRect(b * bw + 0.5, 22 - hgt / 2, Math.max(1, bw - 1.5), hgt);
    }
    c.fillStyle = cs.getPropertyValue('--rh-mark');
    for (const tp of shownTimes()) c.fillRect(x(tp) - 1, 2, 2, 40);
    c.fillStyle = cs.getPropertyValue('--rh-head');
    c.fillRect(now - 1, 0, 2, 44);
  }
  /** Отметки на волне — уже притянутые, если включено: видно, куда встанут переходы */
  const times = () => [...taps.slice(1).map((x) => x.t), ...(end !== null ? [end] : [])];
  const shownTimes = () => (snap ? snapToBeat(times(), bpm) : times());

  function render(): void {
    const w = h.where();
    $('rh-w').textContent = `Слайд ${w.pos} из ${w.total}${w.steps ? ` · шаг ${w.step} из ${w.steps}` : ''}`;
    $('rh-h').innerHTML = !started
      ? 'Пробел — начать: музыка пойдёт с начала трека, первый слайд — сразу'
      : end !== null
        ? 'Конец показа записан. Backspace — назад'
        : `Пробел или → — на удар · Backspace — назад${atEnd() ? ' · следующее нажатие — конец показа' : ''}`;
    ok.disabled = taps.length < 2 && end === null;
    draw();
  }
  const atEnd = () => {
    const w = h.where();
    return w.step >= w.steps && w.pos >= w.total;
  };

  let raf = 0;
  const loop = () => {
    $('rh-t').textContent = fmtTime(m.time(), 2);
    draw();
    raf = requestAnimationFrame(loop);
  };

  async function begin(): Promise<void> {
    h.restart();
    started = true;
    taps.push({ i: h.where().index, k: 0, t: start });
    await m.play(start);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    render();
  }

  function tap(): void {
    if (!started) return void begin();
    if (end !== null) return;
    const t = Math.round(m.time() * 1000) / 1000;
    const r = h.advance();
    const w = h.where();
    if (r === 'end') {
      end = t;
      m.stop();
    } else taps.push({ i: w.index, k: r === 'step' ? w.step : 0, t });
    render();
  }

  function undo(): void {
    if (end !== null) {
      end = null;
      if (!m.playing) void m.play();
    } else if (taps.length > 1) {
      taps.pop();
      h.back();
    } else if (started) {
      // Сняли самое первое — запись с начала
      taps.length = 0;
      started = false;
      m.pause();
      m.seek(start);
      h.restart();
    }
    render();
  }

  // Клавиши записи — раньше клавиш показа: пробел и стрелки здесь только отмечают удары
  const keys = (e: KeyboardEvent) => {
    // Поле темпа — как обычное поле. Пробел на флажке или кнопке окна — всё равно удар: щёлкнули флажок мышью,
    // и фокус остался на нём; Enter на кнопке («Сохранить» с клавиатуры) — как обычно
    if ((e.target as HTMLElement | null)?.matches?.('.rh input[type="number"]') && e.key !== 'Escape') return;
    const k = e.key;
    if (k === 'Enter') return;
    let used = true;
    if (k === ' ' || k === 'ArrowRight' || k === 'PageDown') tap();
    else if (k === 'Backspace' || k === 'ArrowLeft' || k === 'PageUp') undo();
    else if (k === 'Escape') void finish(false);
    else used = false;
    if (used) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  addEventListener('keydown', keys, { capture: true });

  $('rh-snap').addEventListener('change', (e) => {
    snap = (e.target as HTMLInputElement).checked;
    try { localStorage.setItem(SNAP_KEY, snap ? '1' : '0'); } catch { /* не запомним */ }
    draw();
  });
  $('rh-bpm').addEventListener('change', (e) => {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (v >= 40 && v <= 240) {
      bpm = v;
      try { localStorage.setItem(BPM_KEY, String(v)); } catch { /* не запомним */ }
    }
    (e.target as HTMLInputElement).value = String(bpm);
    draw();
  });
  $('rh-x').addEventListener('click', () => void finish(false));
  ok.addEventListener('click', () => void finish(true));

  /** Записанное — в данные презентации: секунды трека у слайдов и шагов, конец показа, «Листать по музыке» */
  function apply(d: Deck): void {
    const rest = shownTimes();
    const all = [...taps.slice(0, 1).map((x) => x.t), ...rest];
    for (const s of d.slides) {
      delete s.at;
      delete s.steps;
    }
    taps.forEach((tp, n) => {
      const s = d.slides[tp.i];
      if (!s) return;
      const t = all[n];
      if (tp.k === 0) s.at = t;
      else (s.steps ??= [])[tp.k - 1] = t;
    });
    // Шаги без записи посередине (листали назад) — не дыры в списке
    for (const s of d.slides) if (s.steps) s.steps = s.steps.filter((x) => typeof x === 'number');
    if (d.music) {
      if (end !== null) d.music.end = all[taps.length];
      else delete d.music.end;
    }
    d.autoplay = { ...d.autoplay, music: true };
  }

  async function finish(save: boolean): Promise<void> {
    if (save && h.canSave) {
      ok.disabled = true;
      const base = JSON.parse(JSON.stringify(h.deck)) as Deck;
      const next = JSON.parse(JSON.stringify(h.deck)) as Deck;
      apply(next);
      try {
        await saveToProject(h.deckKey, next, false, base);
        apply(h.deck);
      } catch (e) {
        $('rh-h').innerHTML = `<span class="rh-err">Не удалось сохранить: ${esc((e as Error).message)}</span>`;
        ok.disabled = false;
        return;
      }
    }
    cancelAnimationFrame(raf);
    removeEventListener('keydown', keys, { capture: true });
    m.pause();
    el.remove();
    document.body.classList.remove('rehearsing');
    h.close();
  }

  addEventListener('resize', draw);
  render();
}
