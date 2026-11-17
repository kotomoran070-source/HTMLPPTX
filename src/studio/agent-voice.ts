// Голосовой ввод чата «Агент» — кнопка «Диктовать» в поле сообщения (docs/AGENT.md → «Голос»). Запись распознаётся
// на этом компьютере (server/voice.ts) и встаёт в поле на место курсора — сама не отправляется. Модели
// распознавания ещё нет — карточка над полем предлагает скачать её или указать архив, скачанный на другом
// компьютере. Длинная запись режется на паузах и распознаётся по ходу: после «Готово» ждать только последний кусок.
// Модуль грузится при первом нажатии на микрофон (agent-chat.ts).
import { icon } from '../components/icons';
import { pageEnv } from '../engine/env';
import { esc } from '../engine/html';
import { api } from './integrations';

interface VoiceStatus {
  state: 'none' | 'download' | 'ready' | 'error';
  got: number;
  total: number;
  error?: string;
  need: number;
  unpacked: number;
  engine: boolean;
  url: string;
}

export interface VoiceHost {
  ta: HTMLTextAreaElement;
  /** Карточка над полем: скачать модель, ход загрузки */
  card: HTMLElement;
  /** Полоса записи в поле: время, уровень, «Отмена», «Готово» */
  strip: HTMLElement;
  button: HTMLButtonElement;
  /** Текст поля поменялся: высота поля, кнопка «Отправить» */
  changed(): void;
  /** Идёт запись или распознавание: поле только для чтения, «Отправить» недоступна */
  busy(on: boolean): void;
  toast(text: string, ms?: number, error?: boolean): void;
}

const RATE = 16_000;
/** Кусок записи для отправки на распознавание — 0,1 с */
const CHUNK = 1600;
/** Самая длинная запись: дальше «Готово» само */
const MAX_MS = 10 * 60_000;
const mb = (n: number) => `${Math.round(n / 1048576)} МБ`;
const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Отсчёты с микрофона — кусками по 0,1 с в основной поток страницы (AudioWorklet: звук не ждёт страницу) */
const TAP = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.b[this.n++] = ch[i];
      if (this.n === ${CHUNK}) { this.port.postMessage(this.b, [this.b.buffer]); this.b = new Float32Array(${CHUNK}); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('slideria-voice-tap', Tap);`;

interface Recording {
  /** Остановить запись и дождаться всего текста */
  stop(): Promise<string>;
  /** Остановить без текста */
  cancel(): void;
}

/** Ошибка микрофона — понятным текстом */
function micError(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return pageEnv().app ? 'Нет доступа к микрофону: разрешите его программам в настройках системы' : 'Нет доступа к микрофону: разрешите его этой странице в браузере';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Микрофон не найден';
  if (name === 'NotReadableError') return 'Микрофон занят другой программой';
  return `Не удалось включить микрофон: ${(e as Error)?.message ?? e}`;
}

/** Запись: куски речи уходят на распознавание по ходу; text — весь текст на сейчас */
async function record(on: { level(v: number): void; text(t: string): void }): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  // Частота 16 кГц — у модели такая: звук пересчитывает сам браузер
  const ctx = new AudioContext({ sampleRate: RATE });
  const shutMic = () => { stream.getTracks().forEach((t) => t.stop()); void ctx.close().catch(() => {}); };
  try {
    const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  } catch (e) {
    shutMic();
    throw e;
  }
  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, 'slideria-voice-tap');
  src.connect(tap);
  // Узел без выхода в динамики браузер может не вызывать; сам он ничего не выводит — тишина
  tap.connect(ctx.destination);

  let chunks: Float32Array[] = [];
  let energy: number[] = [];
  const texts: string[] = [];
  let chain = Promise.resolve();
  let failure: Error | null = null;
  let dead = false;
  const joined = () => texts.filter(Boolean).join(' ');

  /** Кусок записи — на распознавание (по очереди: текст складывается по порядку) */
  const send = (parts: Float32Array[]) => {
    const n = parts.reduce((s, p) => s + p.length, 0);
    if (n < RATE * 0.2) return;
    const pcm = new Int16Array(n);
    let o = 0;
    for (const p of parts) for (let i = 0; i < p.length; i++) { const v = Math.max(-1, Math.min(1, p[i])); pcm[o++] = v < 0 ? v * 32768 : v * 32767; }
    const k = texts.push('') - 1;
    chain = chain.then(async () => {
      if (dead) return;
      const r = await fetch('/__htmlpptx/voice-recognize', { method: 'POST', body: pcm.buffer });
      const d = await r.json().catch(() => ({})) as { text?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? `ошибка ${r.status}`);
      texts[k] = d.text ?? '';
      if (!dead) on.text(joined());
    }).catch((e: Error) => { failure ??= e.message === 'Failed to fetch' ? new Error('Нет связи с сервером студии') : e; });
  };

  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const c = e.data;
    let s = 0;
    for (let i = 0; i < c.length; i++) s += c[i] * c[i];
    const rms = Math.sqrt(s / c.length);
    chunks.push(c);
    energy.push(rms);
    on.level(Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 55) / 40)));
    // 20 с без остановки — отрезать кусок в самом тихом месте после 12-й секунды: слово не режется, а модель
    // получает куски той длины, на которой её учили. Тихое место — окно 0,3 с, а не одна десятая: шумоподавление
    // браузера глушит и короткие щели между словами, а нужна пауза между фразами
    if (chunks.length >= 200) {
      const quiet = (i: number) => energy[i - 1] + energy[i] + energy[i + 1];
      let cut = 121;
      for (let i = 122; i < chunks.length - 1; i++) if (quiet(i) < quiet(cut)) cut = i;
      send(chunks.slice(0, cut + 1));
      chunks = chunks.slice(cut + 1);
      energy = energy.slice(cut + 1);
    }
  };

  const shut = () => {
    tap.port.onmessage = null;
    src.disconnect();
    tap.disconnect();
    shutMic();
  };
  return {
    async stop() {
      shut();
      send(chunks);
      chunks = [];
      await chain;
      if (failure) throw failure;
      return joined();
    },
    cancel() {
      dead = true;
      shut();
    },
  };
}

export function mountVoice(h: VoiceHost) {
  let st: VoiceStatus | null = null;
  /** Модель только что установили — карточка с «Начать запись» */
  let installed = false;
  /** Указанный файл читается сервером */
  let reading = false;
  let poll = 0;
  let phase: 'idle' | 'start' | 'rec' | 'wait' = 'idle';
  let rec: Recording | null = null;
  let t0 = 0;
  let tick = 0;
  /** Текст поля до и после места диктовки */
  let before = '';
  let after = '';
  let bars: HTMLElement[] = [];
  let shown = [-1, -1, -1, -1, -1];

  // ---------------- карточка: скачать модель ----------------

  function cardHtml(s: VoiceStatus): string {
    const close = `<button type="button" class="ac-ib" data-v="close" title="Закрыть" aria-label="Закрыть">${icon('close')}</button>`;
    const head = (title: string, ic = 'mic', cls = '') => `<div class="vh"><span class="bi${cls}">${icon(ic)}</span><b>${title}</b>${close}</div>`;
    if (!s.engine) return `${head('Голосовой ввод')}<p>Голосовой ввод на этой системе недоступен.</p>`;
    if (installed) {
      return `${head('Модель распознавания установлена', 'check', ' ok')}<p>Речь распознаётся на этом компьютере. Текст встаёт в поле — перед отправкой его можно поправить.</p>
        <div class="va"><button type="button" class="ac-btn p" data-v="start">${icon('mic')}Начать запись</button></div>`;
    }
    if (reading || s.state === 'download') {
      const pct = s.total ? Math.min(100, Math.floor((s.got / s.total) * 100)) : 0;
      return `${head(reading ? 'Чтение файла модели' : 'Загрузка модели распознавания речи', 'download')}
        <div class="vbar" role="progressbar" aria-label="Загрузка модели" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${reading ? 0 : pct}"><i style="width:${reading ? 0 : pct}%"></i></div>
        <div class="vrow"><span>${reading ? 'Файл передаётся…' : `${mb(s.got)} из ${mb(s.total)} · ${pct} %`}</span>${reading ? '' : '<button type="button" class="ac-btn q" data-v="cancel">Отмена</button>'}</div>
        <p class="vnote">Архив проверяется и распаковывается по ходу загрузки. Окно можно закрыть — загрузка продолжится.</p>`;
    }
    const resume = s.got > 0 ? `<p class="vnote">Скачано ${mb(s.got)} из ${mb(s.total)} — загрузка продолжится с этого места.</p>` : '';
    const text = s.state === 'error'
      ? `<p class="ac-kerr" role="alert">${esc(s.error ?? 'Загрузка не удалась')}</p>`
      : `<p>Для распознавания речи нужна модель: ${mb(s.total)} загрузки, около ${mb(s.unpacked)} на диске. Речь распознаётся на этом компьютере и никуда не отправляется.</p>`;
    return `${head('Голосовой ввод')}${text}${resume}
      <div class="va"><button type="button" class="ac-btn p" data-v="get">${icon('download')}${s.state === 'error' ? 'Повторить' : 'Скачать'}</button><button type="button" class="ac-btn" data-v="file">Указать файл…</button></div>
      <p class="vnote">Нет интернета на этом компьютере? Скачайте <a class="vlink" href="${esc(s.url)}" target="_blank" rel="noopener">архив модели</a> на другом и укажите файл.</p>
      <input type="file" class="vfile" accept=".bz2" hidden>`;
  }

  function paintCard(): void {
    if (!st) return;
    h.card.innerHTML = cardHtml(st);
    h.card.hidden = false;
  }

  function closeCard(): void {
    h.card.hidden = true;
    h.card.innerHTML = '';
    installed = false;
    clearTimeout(poll);
  }

  /** Пока карточка открыта и модель качается — ход загрузки */
  function follow(): void {
    clearTimeout(poll);
    if (h.card.hidden || !st || (st.state !== 'download' && !reading)) return;
    poll = window.setTimeout(() => {
      void api<VoiceStatus>('voice-status').then((s) => {
        if (h.card.hidden) return;
        if (s.state === 'ready' && st?.state !== 'ready') installed = true;
        st = s;
        paintCard();
        follow();
      }, () => follow());
    }, 300);
  }

  async function act(what: string): Promise<void> {
    if (what === 'close') return closeCard();
    if (what === 'start') {
      closeCard();
      return start();
    }
    if (what === 'file') return h.card.querySelector<HTMLInputElement>('.vfile')?.click();
    try {
      st = await api<VoiceStatus>(what === 'get' ? 'voice-install' : 'voice-cancel');
    } catch (e) {
      h.toast((e as Error).message, 4000, true);
    }
    paintCard();
    follow();
  }

  /** Архив, скачанный вручную: на сервер, там — та же проверка и распаковка */
  async function upload(file: File): Promise<void> {
    reading = true;
    paintCard();
    try {
      const r = await fetch('/__htmlpptx/voice-install-file', { method: 'POST', body: file });
      const d = await r.json().catch(() => ({})) as VoiceStatus & { error?: string };
      if (!r.ok) throw new Error(d.error ?? `ошибка ${r.status}`);
      st = d;
    } catch (e) {
      st = st ? { ...st, state: 'error', error: (e as Error).message } : st;
    } finally {
      reading = false;
    }
    paintCard();
    follow();
  }

  h.card.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
    if (b?.dataset.v) void act(b.dataset.v);
  });
  h.card.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void upload(f);
  });

  // ---------------- запись ----------------

  function paintButton(): void {
    const on = phase === 'rec';
    h.button.classList.toggle('on', on);
    h.button.title = on ? 'Готово — текст в поле (Enter)' : 'Диктовать';
    h.button.setAttribute('aria-label', on ? 'Закончить запись' : 'Диктовать');
    h.button.setAttribute('aria-pressed', String(on));
  }

  function paintStrip(): void {
    if (phase === 'idle') {
      h.strip.hidden = true;
      h.strip.innerHTML = '';
      bars = [];
      return;
    }
    h.strip.hidden = false;
    if (phase === 'wait' || phase === 'start') {
      h.strip.innerHTML = `<div class="vln"><i class="ac-spin"></i><span class="vw">${phase === 'wait' ? 'Распознавание…' : 'Включается микрофон…'}</span></div>`;
      bars = [];
      return;
    }
    // Две строки: при обычной ширине панели «Не уходит с компьютера» рядом с кнопками не помещается
    h.strip.innerHTML = `<div class="vln"><span class="vdot" aria-hidden="true"></span><span class="vt" role="timer">${clock(Date.now() - t0)}</span>
      <span class="vlv" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="ac-sp"></span>
      <button type="button" class="ac-btn q" data-v="drop" title="Без текста (Esc)">Отмена</button>
      <button type="button" class="ac-btn" data-v="done" title="Текст — в поле (Enter)">${icon('check')}Готово</button></div>
      <span class="vnt" title="Речь распознаётся на этом компьютере">${icon('lock')}Не уходит с компьютера</span>`;
    bars = [...h.strip.querySelectorAll<HTMLElement>('.vlv i')];
    shown = [-1, -1, -1, -1, -1];
  }

  const SHAPE = [0.55, 0.8, 1, 0.8, 0.55];
  function level(v: number): void {
    bars.forEach((b, i) => {
      // Записываем стиль, только когда высота заметно поменялась: запись того же значения тоже стоит пересчёта
      const s = Math.round(Math.max(0.15, v * SHAPE[i]) * 20) / 20;
      if (s === shown[i]) return;
      shown[i] = s;
      b.style.transform = `scaleY(${s})`;
    });
  }

  function setText(t: string): void {
    const lead = before && t && !/\s$/.test(before) ? ' ' : '';
    const tail = after && t && !/^\s/.test(after) ? ' ' : '';
    h.ta.value = before + lead + t + tail + after;
    const caret = (before + lead + t).length;
    h.ta.setSelectionRange(caret, caret);
    h.changed();
  }

  /** Фаза сейчас — после await она могла поменяться */
  const now = () => phase;
  function setPhase(p: typeof phase): void {
    phase = p;
    h.busy(p !== 'idle');
    paintButton();
    paintStrip();
  }

  async function start(): Promise<void> {
    if (phase !== 'idle') return;
    setPhase('start');
    // Модель — в память, пока человек начинает говорить: первая фраза не ждёт загрузки
    void api('voice-load').catch(() => {});
    before = h.ta.value.slice(0, h.ta.selectionStart);
    after = h.ta.value.slice(h.ta.selectionEnd);
    try {
      rec = await record({ level, text: setText });
    } catch (e) {
      setPhase('idle');
      h.toast(micError(e), 5000, true);
      return;
    }
    // Пока включался микрофон, запись отменили (Esc, панель закрыли)
    if (now() !== 'start') { rec.cancel(); rec = null; return; }
    t0 = Date.now();
    setPhase('rec');
    tick = window.setInterval(() => {
      const ms = Date.now() - t0;
      const t = h.strip.querySelector('.vt');
      if (t) t.textContent = clock(ms);
      if (ms >= MAX_MS) void finish();
    }, 250);
  }

  async function finish(): Promise<void> {
    if (phase !== 'rec' || !rec) return;
    clearInterval(tick);
    const r = rec;
    rec = null;
    setPhase('wait');
    try {
      setText(await r.stop());
    } catch (e) {
      h.toast((e as Error).message, 5000, true);
    }
    setPhase('idle');
    h.ta.focus();
  }

  function cancel(): void {
    if (phase === 'idle') return;
    clearInterval(tick);
    rec?.cancel();
    rec = null;
    // Уже распознанное по ходу записи — тоже убрать: «Отмена» — как будто записи не было
    if (phase === 'rec' || phase === 'wait') {
      h.ta.value = before + after;
      h.ta.setSelectionRange(before.length, before.length);
      h.changed();
    }
    setPhase('idle');
    h.ta.focus();
  }

  h.strip.addEventListener('click', (e) => {
    const v = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v;
    if (v === 'done') void finish();
    else if (v === 'drop') cancel();
  });

  /** Кнопка микрофона: модели нет — карточка; есть — запись; идёт запись — «Готово» */
  async function toggle(): Promise<void> {
    if (phase === 'rec') return finish();
    if (phase !== 'idle') return;
    if (!h.card.hidden && st?.state === 'download') return;
    try {
      st = await api<VoiceStatus>('voice-status');
    } catch (e) {
      h.toast((e as Error).message, 4000, true);
      return;
    }
    if (st.state === 'ready' && st.engine) {
      closeCard();
      return start();
    }
    installed = false;
    paintCard();
    follow();
  }

  return {
    toggle,
    finish,
    cancel,
    /** Идёт запись или распознавание */
    active: () => phase !== 'idle',
    /** Панель закрыли: микрофон — выключить, карточку — убрать */
    hide(): void {
      cancel();
      closeCard();
    },
  };
}
