/**
 * Лента «Показ» → «Музыка»: один трек на весь показ (как «Воспроизводить в фоне» в PowerPoint), начало трека,
 * громкость, затухание; «Записать время» — показ в режиме записи (engine/rehearse.ts), «Листать по музыке» —
 * автопоказ по записанному времени трека (engine/music.ts)
 */
import type { Editor } from '../engine/editor/editor';
import { uploadAsset } from '../engine/editor/persist';
import { fmtTime, musicOf, parseTime, trackStart, trackVolume } from '../engine/music';
import type { Deck } from '../types';
import { showMenu } from './menu';

interface Command {
  run(): void;
  enabled?(): boolean;
  active?(): boolean;
}

export interface MusicHost {
  deck(): Deck;
  deckKey: string;
  editor: Editor;
  /** Видимая кнопка команды — к ней прикладывается меню */
  anchor(cmd: string): HTMLElement;
  /** Показ в режиме записи времени */
  rehearse(): void;
}

const ACCEPT = 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/x-wav,.mp3,.m4a,.ogg,.wav';
const AUDIO_RE = /\.(mp3|m4a|ogg|wav)$/i;
const MAX = 60 * 1024 * 1024;

/** Поля группы «Музыка» на ленте (кнопки — из studio.ts, rb и chk) */
export const musicFieldsHtml = (): string => `<div class="st-rstack">`
  + `<label class="st-rfield" title="С какой секунды трека играет показ"><span>Начало трека</span><input type="text" id="st-mus-start" inputmode="decimal" placeholder="0:00" aria-label="Начало трека, минуты и секунды"></label>`
  + `<label class="st-rfield st-mus-vol" title="Громкость музыки"><span>Громкость</span><input type="range" id="st-mus-vol" min="0" max="100" step="5" aria-label="Громкость музыки, %"><output id="st-mus-volv"></output></label>`
  + `<label class="st-rfield" title="Музыка плавно стихает в конце показа"><span>Затухание</span><input type="number" id="st-mus-fade" min="0" max="10" step="0.5" aria-label="Затухание в конце, секунды"><span>с</span></label>`
  + `</div>`;

export function setupMusic(h: MusicHost): { cmds: Record<string, Command>; sync(): void } {
  const ed = h.editor;
  const has = () => !!musicOf(h.deck());
  const field = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  /** Прослушивание из меню: тот же трек с начала, с громкостью музыки */
  let preview: HTMLAudioElement | null = null;

  const set = (key: 'start' | 'volume' | 'fadeOut', v: number | undefined) => ed.commit((d) => {
    if (!d.music) return;
    if (v === undefined) delete d.music[key];
    else d.music[key] = v;
  }, { rebuild: false, merge: `music:${key}` });

  function pick(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.addEventListener('change', () => void (async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (!AUDIO_RE.test(f.name)) return ed.toast('Формат не поддерживается. Подойдут MP3, M4A, OGG и WAV.', 3500, true);
      if (f.size > MAX) return ed.toast(`Файл больше ${MAX / 1024 / 1024} МБ`, 4000, true);
      ed.toast('Загрузка музыки…', 0);
      try {
        const { url } = await uploadAsset(h.deckKey, f, f.name);
        stopPreview();
        ed.commit((d) => { d.music = { ...d.music, src: url }; }, { rebuild: false });
        ed.toast('Музыка добавлена', 1500);
      } catch (e) {
        ed.toast(`Не удалось загрузить файл: ${(e as Error).message}`, 5000, true);
      }
    })());
    input.click();
  }

  function stopPreview(): void {
    preview?.pause();
    preview = null;
  }
  function listen(): void {
    const m = musicOf(h.deck());
    if (!m) return;
    if (preview) return stopPreview();
    const a = new Audio(m.src);
    a.volume = trackVolume(m);
    a.currentTime = trackStart(m);
    a.addEventListener('ended', stopPreview);
    preview = a;
    a.play().catch(() => {
      stopPreview();
      ed.toast('Не удалось воспроизвести файл', 3000, true);
    });
  }

  function remove(): void {
    stopPreview();
    ed.commit((d) => {
      delete d.music;
      if (d.autoplay?.music) {
        const a = { ...d.autoplay };
        delete a.music;
        if (Object.keys(a).length) d.autoplay = a;
        else delete d.autoplay;
      }
    }, { rebuild: false });
  }

  // Поля: начало трека — по Enter или уходу из поля; громкость — сразу слышна в прослушивании, в данные — отпустив
  const start = field('st-mus-start');
  const vol = field('st-mus-vol');
  const fade = field('st-mus-fade');
  start?.addEventListener('change', () => {
    const v = parseTime(start.value);
    if (v !== null) set('start', v > 0 ? v : undefined);
    sync();
  });
  start?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start.blur();
    if (e.key === 'Escape') {
      sync(true);
      start.blur();
    }
  });
  vol?.addEventListener('input', () => {
    if (preview) preview.volume = Number(vol.value) / 100;
    const out = document.getElementById('st-mus-volv');
    if (out) out.textContent = `${vol.value} %`;
  });
  vol?.addEventListener('change', () => {
    const v = Number(vol.value) / 100;
    set('volume', v >= 1 ? undefined : v);
  });
  fade?.addEventListener('change', () => {
    const v = Number(fade.value.replace(',', '.'));
    if (Number.isFinite(v) && v >= 0) set('fadeOut', v > 0 ? Math.min(10, v) : undefined);
    sync();
  });

  /** Значения в полях — из данных (поле, которое сейчас правят, не трогаем, если не force) */
  function sync(force = false): void {
    const m = musicOf(h.deck());
    const put = (el: HTMLInputElement | null, v: string) => {
      if (!el) return;
      el.disabled = !m;
      if (force || document.activeElement !== el) el.value = v;
    };
    put(start, m ? fmtTime(trackStart(m)) : '');
    put(vol, String(Math.round((m ? trackVolume(m) : 1) * 100)));
    put(fade, m?.fadeOut ? String(m.fadeOut) : '0');
    const out = document.getElementById('st-mus-volv');
    if (out) out.textContent = m ? `${vol?.value ?? 100} %` : '';
  }

  const cmds: Record<string, Command> = {
    'show.music': {
      run: () => showMenu(h.anchor('show.music'), [
        { label: has() ? 'Заменить файл…' : 'Выбрать файл…', icon: 'upload', run: pick },
        { label: preview ? 'Остановить прослушивание' : 'Прослушать с начала трека', icon: preview ? 'stop' : 'play', disabled: !has(), run: listen },
        null,
        { label: 'Убрать музыку', icon: 'trash', danger: true, disabled: !has(), run: remove },
      ]),
    },
    'show.music.record': { run: () => h.rehearse(), enabled: has },
    'show.music.drive': {
      run: () => ed.commit((d) => {
        const a = { ...d.autoplay };
        if (a.music) delete a.music;
        else a.music = true;
        if (Object.keys(a).length) d.autoplay = a;
        else delete d.autoplay;
      }, { rebuild: false, merge: 'autoplay:music' }),
      enabled: has,
      active: () => has() && h.deck().autoplay?.music === true,
    },
  };
  return { cmds, sync };
}
