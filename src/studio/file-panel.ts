/**
 * Раздел «Файл» студии — на всё окно под полосой заголовка, как в Office. Слева разделы, справа содержимое:
 *
 * - Сведения — сводка презентации: числа, тяжёлые и лишние файлы, шрифты, название и папка;
 * - Экспорт — форматы карточками, справа — настройки выбранного и «Сохранить»;
 * - Версии — история по дням: свои точки (Ctrl+S), «когда открыли» и «когда закрыли», сеансы агентов и запуски
 *   скриптов (из журнала); «Вернуть» точку — вся презентация как в ней, сеанс агента или скрипт — только их правки
 *   (то, что поправили после, остаётся); одной правкой, Ctrl+Z — обратно;
 * - Параметры — лента (ribbon-setup.ts) и интерфейс: тема, цвет, вид слайдов, облегчённый режим; модель распознавания
 *   речи для голосового ввода — «Удалить модель»;
 * - Интеграции — агенты, скрипты, журнал правок, плагины, коннекторы (integrations-file.ts; точка — агент на связи);
 * - Лицензии (внизу, рядом со сборкой программы) — списком и текстом (engine/licenses-view.ts).
 *
 * Внизу — ещё «Все презентации» и сборка программы. Esc или «Назад» — обратно к слайдам.
 * Кнопка «Файл» — в начале строки вкладок (studio.ts); туда же ведут «Экспорт» из поиска команд, «Сводка»,
 * «Настроить ленту» и щелчок по «Сохранено». Клавиши студии, пока раздел открыт, до слайдов не доходят.
 */
import { icon } from '../components/icons';
import type { Deck } from '../types';
import { staticSlide } from '../engine/deck-view';
import { clock } from '../engine/editor/editor';
import type { PointKind } from '../engine/editor/persist';
import { plural } from '../engine/editor/font-picker';
import { esc } from '../engine/html';
import { brandMark } from '../engine/brand';
import { licensesSummary, loadLicenses, mountLicenses, newLicensesState } from '../engine/licenses-view';
import { agentLook, agentMark, canRevert, edits, type JournalEntry } from './integrations';
import { onThemeChange } from '../engine/theme';
import { collectSummary, fileSize, numText, removeFont, replaceFont, trashUnused, type Summary, type ToolsHost } from './tools';
import { VIDEO_SIZES, type VideoExport, type VideoRun, type VideoSize } from './video-export';
import './file-panel.css';

export type FileSection = 'info' | 'export' | 'versions' | 'prefs' | 'int' | 'licenses';
export type Quality = 'compact' | 'normal' | 'high';
export type UiTheme = 'light' | 'dark' | 'system';
type Look = 'light' | 'dark' | null;

export interface FileHost {
  /** Презентация, редактор, переход к слайду */
  tools: ToolsHost;
  rename(title: string): void;
  /** Первый слайд — обложка в «Сведениях» */
  cover(): HTMLElement | null;
  /** «Показать в папке» — только в программе */
  reveal?: () => void;
  exporter: {
    kinds: [mode: string, icon: string, title: string, about: string][];
    qualities: [Quality, string, string][];
    quality(): Quality;
    setQuality(q: Quality): void;
    same(): boolean;
    setSame(v: boolean): void;
    fileName(mode: string): string;
    run(mode: string): void;
    /** «Видео»: настройки, подписи и идущая запись (video-export.ts) */
    video?: VideoExport;
  };
  ribbon: { mount(el: HTMLElement): void };
  /** Панель быстрого доступа (qat.ts) */
  qat: { mount(el: HTMLElement): void };
  ui: {
    theme(): UiTheme;
    setTheme(t: UiTheme): void;
    /** T — светлая ↔ тёмная, как в студии */
    toggleTheme(): void;
    /** Цвет презентации и свой цвет интерфейса (null — как у презентации) */
    accent(): string;
    ownColor(): string | null;
    /** Цвет тянут в палитре — интерфейс сразу в нём; setOwnColor — выбран (null — как у презентации) */
    previewColor(c: string): void;
    setOwnColor(c: string | null): void;
    lite(): boolean;
    setLite(v: boolean): void;
    /** Своя плавная прокрутка колесом (engine/hscroll.ts) */
    smooth(): boolean;
    setSmooth(v: boolean): void;
    look(): Look;
    setLook(v: Look): void;
    /** У презентации свой вид слайдов («Дизайн» → «Слайды») */
    lookLocked(): boolean;
  };
  /** «Лицензии» — только со своим сервером (данные — с него) */
  licenses: { enabled(): boolean };
  /**
   * Правки агентов и скриптов этой презентации (журнал) — для «Версий»: журнал, «Вернуть» правки (только их,
   * не трогая того, что поправили после) и «Журнал правок» в «Интеграциях»
   */
  history?: { journal(): Promise<JournalEntry[]>; revert(list: JournalEntry[], label: string): Promise<void>; log(): void };
  /** «Интеграции» — только со своим сервером; mount рисует раздел в el, live — агент на связи */
  integrations: { enabled(): boolean; mount(el: HTMLElement): void; live(): boolean };
  /** «Slideria 1.4 · сборка от …» (запуск из проекта — без сборки); пусто вне программы */
  /** Сборка программы (в браузере — null) */
  build(): { version?: string; date?: string; commit?: string } | null;
  /** Раздел открылся или закрылся */
  toggled(open: boolean): void;
}

/** Разделы сверху; «Лицензии» — внизу, но стрелками до них тоже доходишь */
const SECTIONS: [FileSection, string, string][] = [
  ['info', 'chart', 'Сведения'],
  ['export', 'save', 'Экспорт'],
  ['versions', 'clock', 'Версии'],
  ['prefs', 'sliders', 'Параметры'],
  ['int', 'agent', 'Интеграции'],
];
/** Значки форматов — как у файлов: цвет и подпись */
const BADGE: Record<string, [string, string]> = {
  clean: ['HTML', '#2563EB'],
  edit: ['HTML', '#7C3AED'],
  pptx: ['PPTX', '#C2410C'],
  pptx2007: ['PPTX', '#9A3412'],
  pdf: ['PDF', '#DC2626'],
  video: ['MP4', '#DB2777'],
};
const FORMAT_KEY = 'slideria-export-format';

/** Полоса записи видео, % */
const videoPct = (r: VideoRun) => (r.total ? Math.min(100, Math.round((r.frame / r.total) * 1000) / 10) : 0);
/** «Кадр 1640 из 4020 · слайд 14 «Цвет: Кино» · осталось около минуты» */
function videoText(r: VideoRun): string {
  if (!r.total) return 'Подготовка показа…';
  const ms = r.leftMs;
  const left = ms === null ? '' : ms < 45_000 ? ' · осталось меньше минуты' : ms < 90_000 ? ' · осталось около минуты' : ` · осталось около ${Math.round(ms / 60_000)} мин`;
  return `Кадр ${r.frame} из ${r.total} · слайд ${r.slide}${r.label ? ` «${r.label}»` : ''}${left}`;
}

const sw = (on: boolean, attrs: string, title: string, sub = '') =>
  `<label class="fp-sw"><input type="checkbox" ${attrs}${on ? ' checked' : ''}><span><span class="fp-sw-t">${title}</span>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
const seg = (name: string, label: string, items: [string, string, string?][], cur: string, disabled = false) =>
  `<div class="fp-seg" role="radiogroup" aria-label="${esc(label)}">${items.map(([v, t, swatch]) => `<button type="button" role="radio" data-${name}="${v}" aria-checked="${v === cur}"${disabled ? ' disabled' : ''}>${swatch ? `<i class="fp-dot" style="background:${esc(swatch)}"></i>` : ''}${esc(t)}</button>`).join('')}</div>`;

const dayOf = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};

/** Ответ сервера — не дольше ms: зависший запрос не держит раздел пустым */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, no) => { setTimeout(() => no(new Error('сервер не ответил')), ms); })]);
}

export function initFilePanel(host: FileHost, app: HTMLElement, button: HTMLElement): {
  /** at — показать часть раздела: «qat» — настройку панели быстрого доступа в «Параметрах» */
  open(section?: FileSection, at?: 'qat'): void;
  close(): void;
  isOpen(): boolean;
  /** Открытый (или последний открытый) раздел */
  section(): FileSection;
  /** Презентация или состояние сохранения поменялись — открытый раздел обновляется */
  sync(): void;
  /** Перерисовать открытый раздел сейчас (сделана точка) */
  refresh(): void;
  /** Запись видео продвинулась (full — началась или кончилась) */
  video(full: boolean): void;
} {
  const ed = host.tools.editor;
  const deck = (): Deck => host.tools.deck;
  let section: FileSection = 'info';
  let format = 'pptx';
  try { const f = localStorage.getItem(FORMAT_KEY); if (f && host.exporter.kinds.some(([k]) => k === f)) format = f; } catch { /* нет доступа */ }

  const root = document.createElement('div');
  root.className = 'fp';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Файл');
  root.innerHTML = `<nav class="fp-nav">
    <button type="button" class="fp-back" data-a="close" title="Назад к слайдам (Esc)">${icon('arr-left')}<span>Назад</span><kbd>Esc</kbd></button>
    <div class="fp-tabs" role="tablist" aria-orientation="vertical" aria-label="Разделы">${SECTIONS.map(([id, ic, name]) => `<button type="button" role="tab" class="fp-i" id="fp-t-${id}" data-fs="${id}" aria-controls="fp-main" aria-selected="false" tabindex="-1">${icon(ic)}<span>${name}</span></button>`).join('')}</div>
    <div class="fp-hr"></div>
    <a class="fp-i" href="./?all">${icon('grid')}<span>Все презентации</span></a>
    <button type="button" class="fp-i" id="fp-t-licenses" data-fs="licenses" aria-controls="fp-main" aria-selected="false" tabindex="-1">${icon('shield')}<span>Лицензии</span></button>
  </nav>
  <main class="fp-main" id="fp-main" role="tabpanel" tabindex="-1"></main>`;
  app.append(root);
  const main = root.querySelector<HTMLElement>('.fp-main')!;

  // ---------------- разделы ----------------

  let summary: Summary | null = null;
  /** Сводка, досчитанная после того, как раздел нарисовали без неё, или её ошибка — для следующей отрисовки */
  let fresh: Summary | null = null;
  let failed: Error | null = null;
  async function infoHtml(): Promise<string> {
    if (failed) {
      const e = failed;
      failed = null;
      throw e;
    }
    // Сводка — каждый раз заново: презентация могла поменяться. Файлы — запрос к серверу: если он не ответил
    // за долю секунды (занят сохранением или экспортом), раздел рисуется сразу, сводка дорисовывается следом.
    // Раньше раздел ждал ответа пустым, и Esc не работал — фокус ещё не перешёл в него
    let s = fresh;
    fresh = null;
    if (!s) {
      const job = collectSummary(host.tools);
      s = await Promise.race([job, new Promise<null>((r) => { setTimeout(() => r(null), 600); })]);
      if (!s) {
        void job.then((v) => { fresh = v; }, (e: Error) => { failed = e; })
          .then(() => { if (!root.hidden && section === 'info') void render(); });
        return '<header class="fp-head"><h2>Сведения</h2><p>Что внутри презентации и где она лежит</p></header><p class="fp-wait">Сведения собираются…</p>';
      }
    }
    summary = s;
    const d = deck();
    const tile = (v: string, l: string) => `<div class="fp-card fp-tile"><b>${v}</b><span>${l}</span></div>`;
    const slideLink = (i: number) => `<button type="button" class="fp-link" data-go="${i}">слайд ${i + 1}</button>`;
    const notes = s.withNotes ? (s.withNotes === s.slides ? 'у всех слайдов' : `у ${s.withNotes} из ${s.slides} ${plural(s.slides, 'слайда', 'слайдов', 'слайдов')}`) : 'нет';
    return `<header class="fp-head"><h2>Сведения</h2><p>Что внутри презентации и где она лежит</p></header>
    <div class="fp-info">
      <div class="fp-col">
        <div class="fp-card fp-cover" data-go="0" title="К первому слайду"></div>
        <div class="fp-tiles">
          ${tile(numText(s.slides), plural(s.slides, 'слайд', 'слайда', 'слайдов'))}
          ${tile(s.noteWords ? `≈ ${s.minutes} мин` : '—', s.noteWords ? 'доклад по заметкам' : 'заметок нет')}
          ${tile(numText(s.slideWords), `${plural(s.slideWords, 'слово', 'слова', 'слов')} на слайдах`)}
          ${tile(s.files ? fileSize(s.total) : '—', 'картинки и файлы')}
        </div>
      </div>
      <div class="fp-col">
        <div class="fp-card fp-facts">
          <label class="fp-fact"><span>Название</span><input class="fp-name" id="fp-name" value="${esc(d.title ?? '')}" spellcheck="false" aria-label="Название презентации"></label>
          <div class="fp-fact"><span>Папка</span><span class="fp-v" title="${esc(host.tools.deckKey)}">${esc(host.tools.deckKey)}</span>${host.reveal ? '<button type="button" class="fp-link" data-a="reveal">Показать в папке</button>' : ''}</div>
          <div class="fp-fact"><span>Заметки</span><span class="fp-v">${notes}</span></div>
        </div>
        ${s.heavy.length ? `<section><h3 class="fp-k">Самые тяжёлые файлы</h3><div class="fp-card fp-list">${s.heavy.map((f) => `<div class="fp-row">${icon(/\.(mp4|webm|mov)$/i.test(f.path) ? 'frames' : 'image')}<span class="fp-n" title="${esc(f.path)}">${esc(f.path.replace(/^assets\//, ''))}</span><small>${fileSize(f.size)}</small>${f.slides.length ? slideLink(f.slides[0]) : '<small>оформление</small>'}</div>`).join('')}</div></section>` : ''}
        ${s.unused.length ? `<div class="fp-warn"><span>Не используются: ${s.unused.length} ${plural(s.unused.length, 'файл', 'файла', 'файлов')} · ${fileSize(s.unused.reduce((a, f) => a + f.size, 0))}</span><button type="button" class="fp-btn" data-a="trash" title="${esc(s.unused.map((f) => f.path.replace(/^assets\//, '')).join('\n'))}">Убрать в корзину</button></div>` : ''}
        ${s.fonts.length || s.idle.length ? `<section><h3 class="fp-k">Шрифты</h3><div class="fp-card fp-list">${s.fonts.map((f) => `<div class="fp-row"><span class="fp-n" style="font-family:${esc(f.css)}">${esc(f.label)}</span>${f.state ? `<small>${esc(f.state)}</small>` : '<small class="fp-bad" title="Шрифт не встроен: на другом компьютере текст будет другим">не встроен</small>'}<button type="button" class="fp-link" data-font="${esc(f.name)}">заменить</button></div>`).join('')}${s.idle.map((f) => `<div class="fp-row"><span class="fp-n" style="font-family:${esc(f.css)}">${esc(f.name)}</span><small>не используется</small><button type="button" class="fp-link" data-unfont="${esc(f.name)}" title="Убрать файл шрифта (в библиотеке шрифт останется)">убрать</button></div>`).join('')}</div></section>` : ''}
      </div>
    </div>`;
  }

  /** «Видео»: размер, кадры, время слайдов, музыка; во время записи — полоса, где запись, и «Отменить» */
  function videoSide(v: VideoExport, file: string): string {
    const o = v.opts;
    const r = v.run;
    const off = !!r;
    const size = VIDEO_SIZES.find(([h]) => h === o.size) ?? VIDEO_SIZES[1];
    const m = v.music();
    return `<h3>Видео</h3>
        <div class="fp-field"><span class="fp-k">Размер</span>${seg('vs', 'Размер видео', VIDEO_SIZES.map(([h, t]) => [String(h), t]), String(o.size), off)}<small>${esc(size[2])}</small></div>
        <div class="fp-field"><span class="fp-k">Кадров в секунду</span>${seg('vr', 'Кадров в секунду', [['30', '30'], ['60', '60']], String(o.fps), off)}<small>${o.fps === 60 ? '60 — плавнее движение, файл больше' : '30 — файл меньше, запись быстрее'}</small></div>
        <div class="fp-field"><span class="fp-k">Время слайдов</span>${seg('vt', 'Время слайдов', [['0', 'Как в автопоказе'], ['5', 'По 5 с']], String(o.each), off)}<small>${esc(v.timing())}</small></div>
        ${m ? sw(o.music, `data-vmusic${off ? ' disabled' : ''}`, 'Музыка показа', esc(`${m.name}${m.fade ? ', с затуханием в конце' : ''}`)) : ''}
        ${r ? `<div class="fp-field fp-vrun"><span class="fp-k">Запись</span><div class="fp-vbar"><i style="width:${videoPct(r)}%"></i></div><small class="fp-vtxt">${esc(videoText(r))}</small></div>` : ''}
        ${v.available ? '' : '<small class="fp-vnote">Видео записывает программа Slideria: в браузере этой кнопки нет</small>'}
        <div class="fp-file"><span>Файл</span><span title="${esc(file)}">${esc(file)}</span></div>
        ${r ? '<button type="button" class="fp-btn" data-a="vcancel">Отменить</button>'
          : `<button type="button" class="fp-btn go" data-a="export"${v.available ? '' : ' disabled'}>${icon('save')}Сохранить MP4</button>`}`;
  }
  /** Запись продвинулась: только полоса и подпись, раздел целиком не перерисовывается */
  function videoProgress(full: boolean): void {
    if (root.hidden || section !== 'export') return;
    if (full) { void render(); return; }
    // Открыт другой формат — полосы нет, раздел не перерисовывается на каждом кадре
    const r = host.exporter.video?.run;
    const bar = main.querySelector<HTMLElement>('.fp-vbar > i');
    if (!r || !bar) return;
    bar.style.width = `${videoPct(r)}%`;
    const txt = main.querySelector('.fp-vtxt');
    const t = videoText(r);
    if (txt && txt.textContent !== t) txt.textContent = t;
  }

  function exportHtml(): string {
    const x = host.exporter;
    const k = x.kinds.find(([m]) => m === format) ?? x.kinds[0];
    const html = k[0] === 'clean' || k[0] === 'edit';
    const q = x.qualities.find(([v]) => v === x.quality())!;
    const [ext] = BADGE[k[0]] ?? ['', ''];
    const side = k[0] === 'video' && x.video ? videoSide(x.video, x.fileName('video')) : `<h3>${esc(k[2])}</h3>
        <div class="fp-field"><span class="fp-k">Качество</span>${seg('q', 'Качество файла', x.qualities.map(([v, t]) => [v, t]), q[0])}<small>${esc(q[2])}</small></div>
        ${html ? sw(x.same(), 'data-same', 'Как на этом компьютере', 'Тот же вид слайдов и анимации на любом компьютере') : ''}
        <div class="fp-file"><span>Файл</span><span title="${esc(x.fileName(k[0]))}">${esc(x.fileName(k[0]))}</span></div>
        <button type="button" class="fp-btn go" data-a="export">${icon('save')}Сохранить ${esc(ext)}</button>`;
    return `<header class="fp-head"><h2>Экспорт</h2><p>Один файл, чтобы показать, отправить или открыть в другой программе</p></header>
    <div class="fp-x">
      <div class="fp-formats" role="radiogroup" aria-label="Формат">${x.kinds.map(([m, , t, about]) => {
        const [b, c] = BADGE[m] ?? ['', 'var(--ac)'];
        return `<button type="button" class="fp-card fp-fmt" role="radio" aria-checked="${m === k[0]}" data-x="${m}"><span class="fp-badge" style="--c:${c}">${b}</span><span class="fp-fmt-t">${esc(t)}</span><small>${esc(about)}</small><i class="fp-radio" aria-hidden="true"></i></button>`;
      }).join('')}</div>
      <div class="fp-card fp-side">
        ${side}
      </div>
    </div>`;
  }

  /** Строка «Версий»: точка (своя, открытие, закрытие, отброшенное при выходе) или правки из журнала (сеанс агента, запуск скрипта) */
  type Item = { kind: 'point'; id: string; time: number; point: PointKind } | { kind: 'edits'; key: string; time: number; end: number; by: JournalEntry['by']; list: JournalEntry[] };
  let points: { id: string; time: number; kind: PointKind }[] | null = null;
  /** Сеансы агентов и скрипты — по ключу строки: для «Вернуть» */
  const groups = new Map<string, Item & { kind: 'edits' }>();
  let vfilter: 'all' | 'points' | 'edits' = 'all';
  const POINT_NAME: Record<PointKind, string> = { mine: 'Ваша точка', auto: 'Точка', open: 'Когда открыли', close: 'Когда закрыли', drop: 'Не сохранено при выходе' };
  /** Перерыв дольше этого — новый сеанс агента */
  const SESSION_GAP = 30 * 60_000;

  /** Правки журнала этой презентации → строки: подряд идущие правки одного агента — один сеанс, скрипт — запуск */
  function editRows(journal: JournalEntry[]): (Item & { kind: 'edits' })[] {
    const rows: (Item & { kind: 'edits' })[] = [];
    for (const e of [...journal].sort((a, b) => a.t.localeCompare(b.t))) {
      const t = Date.parse(e.t);
      const prev = rows.at(-1);
      if (prev && e.by.kind === 'agent' && prev.by.kind === 'agent' && prev.by.name === e.by.name && t - prev.end <= SESSION_GAP) {
        prev.list.push(e);
        prev.end = t;
        continue;
      }
      rows.push({ kind: 'edits', key: `${e.by.kind}:${e.t}`, time: t, end: t, by: e.by, list: [e] });
    }
    return rows;
  }

  async function versionsHtml(): Promise<string> {
    const head = '<header class="fp-head"><h2>Версии</h2><p>Программа сохраняет сама. Точки — снимки, к которым можно вернуться: ваши (Ctrl+S), когда открыли и закрыли презентацию, что не сохранили при выходе, а ещё каждая правка агентов и скриптов</p></header>';
    if (ed.mode !== 'project') {
      return `${head}<div class="fp-card fp-empty">${icon('clock')}<div><span class="fp-sw-t">Версии — у презентаций из папки программы</span><small>Файл открыт с диска, изменения сохраняются в него по Ctrl+S</small></div></div>`;
    }
    const [pts, journal] = await within(Promise.all([ed.checkpoints(), host.history?.journal().catch(() => []) ?? Promise.resolve([])]), 8000);
    points = pts;
    const st = ed.statusInfo;
    const last = points[0];
    groups.clear();
    const edited = editRows(journal);
    for (const g of edited) groups.set(g.key, g);
    const all: Item[] = [
      ...points.map((p) => ({ kind: 'point' as const, id: p.id, time: p.time, point: p.kind })),
      ...edited,
    ].sort((a, b) => b.time - a.time);
    const both = points.length > 0 && edited.length > 0;
    const shown = all.filter((x) => vfilter === 'all' || !both || (vfilter === 'points' ? x.kind === 'point' : x.kind === 'edits')).slice(0, 60);
    const days = new Map<string, Item[]>();
    for (const x of shown) {
      const d = dayOf(x.time);
      days.set(d, [...(days.get(d) ?? []), x]);
    }
    const row = (x: Item) => {
      if (x.kind === 'point') {
        const tip = 'Вернуть всю презентацию к этой точке. Ctrl+Z — обратно';
        return `<div class="fp-ver" data-cp="${esc(x.id)}"><time>${clock(x.time)}</time><span class="fp-ver-th" data-th="${esc(x.id)}"></span>`
          + `<span class="fp-ver-x"><span class="fp-ver-t${x.point === 'mine' ? ' mine' : ''}">${POINT_NAME[x.point]}</span><span class="fp-ver-n" data-n="${esc(x.id)}"></span></span>`
          + `<button type="button" class="fp-btn" data-restore="${esc(x.id)}" data-time="${x.time}" title="${tip}">Вернуть</button></div>`;
      }
      const n = x.list.reduce((s, e) => s + e.changes.length, 0);
      const labels = x.list.flatMap((e) => e.changes.map((c) => c.label));
      const sub = labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` и ещё ${labels.length - 2}` : '');
      const script = x.by.kind === 'script';
      const look = agentLook(x.by.name);
      const ok = x.list.every(canRevert);
      const when = x.end - x.time >= 60_000 ? `${clock(x.time)}–${clock(x.end)}` : clock(x.time);
      return `<div class="fp-ver fp-ver-e" data-g="${esc(x.key)}"><time title="${esc(when)}">${clock(x.end)}</time>`
        + `<span class="fp-ver-who">${script ? `<i class="k">${icon('script')}</i>` : `<i style="background:${look.bg}">${agentMark(look)}</i>`}</span>`
        + `<span class="fp-ver-x"><span class="fp-ver-t">${script ? `Скрипт «${esc(x.by.name)}»` : esc(x.by.name)} <small>${edits(n)}${when.includes('–') ? ` · ${when}` : ''}</small></span><span class="fp-ver-n">${esc(sub)}</span></span>`
        + `<span class="fp-ver-a">${script ? '' : '<button type="button" class="fp-btn fp-ver-log" data-a="log">Журнал</button>'}${ok
          ? `<button type="button" class="fp-btn" data-revert="${esc(x.key)}" title="Вернуть как было до ${script ? 'скрипта' : 'этих правок'} — то, что поправили после, останется. Ctrl+Z — обратно">Вернуть</button>`
          : '<span class="fp-ver-gone" title="Точки этих правок уже не хранятся (старше 30 дней)">точек нет</span>'}</span></div>`;
    };
    return `${head}<div class="fp-v-list">
      <div class="fp-card fp-now"><i class="fp-led ${esc(st.cls)}"></i><div><span class="fp-sw-t">${esc(st.cls === 'err' ? st.text : st.cls === 'ok' ? 'Всё сохранено' : st.text || 'Всё сохранено')}</span><small>${last ? `Последняя точка — ${dayOf(last.time).toLowerCase()} в ${clock(last.time)}` : 'Каждая правка сразу записывается в файл'}</small></div><button type="button" class="fp-btn go" data-a="point">${icon('save')}Сделать точку<kbd>Ctrl+S</kbd></button></div>
      ${both ? `<div>${seg('vf', 'Что показать', [['all', 'Всё'], ['points', 'Точки'], ['edits', 'Агенты и скрипты']], vfilter)}</div>` : ''}
      ${shown.length ? [...days].map(([day, list]) => `<section><h3 class="fp-k">${esc(day)}</h3><div class="fp-card">${list.map(row).join('')}</div></section>`).join('')
        : `<div class="fp-card fp-empty">${icon('clock')}<div><span class="fp-sw-t">Точек пока нет</span><small>Первая появится, когда откроете презентацию снова; перед большими правками — Ctrl+S</small></div></div>`}
    </div>`;
  }
  /** Точка не меняется: её миниатюра и подпись читаются с диска один раз */
  const seen = new Map<string, { thumb: HTMLElement; label: string } | null>();
  /** Первый слайд и число слайдов каждой точки — по мере чтения, сверху вниз */
  async function fillVersions(): Promise<void> {
    const read = ed.files.readCheckpoint;
    if (!read || !points) return;
    for (const th of [...main.querySelectorAll<HTMLElement>('[data-th]')]) {
      if (root.hidden || section !== 'versions') return;
      const id = th.dataset.th!;
      if (th.childElementCount) continue;
      if (!seen.has(id)) {
        try {
          const d = (await read(host.tools.deckKey, id)).deck as Deck;
          seen.set(id, d && Array.isArray(d.slides) && d.slides.length
            ? { thumb: staticSlide(d, 0, 96), label: `${d.title ? `${d.title} · ` : ''}${d.slides.length} ${plural(d.slides.length, 'слайд', 'слайда', 'слайдов')}` }
            : null);
        } catch { seen.set(id, null); /* точку не прочитать — строка остаётся без миниатюры */ }
      }
      const got = seen.get(id);
      if (!got || !th.isConnected) continue;
      th.replaceChildren(got.thumb.cloneNode(true));
      const n = main.querySelector<HTMLElement>(`[data-n="${CSS.escape(id)}"]`);
      if (n) n.textContent = got.label;
    }
  }

  function prefsHtml(): string {
    const u = host.ui;
    voiceAsk = false;
    const own = u.ownColor();
    const locked = u.lookLocked();
    return `<header class="fp-head"><h2>Параметры</h2><p>Как выглядит студия на этом компьютере. На презентацию не влияет</p></header>
    <div class="fp-prefs">
      <section><h3 class="fp-k">Интерфейс</h3><div class="fp-card fp-grid">
        <div class="fp-field"><span>Тема</span>${seg('uitheme', 'Тема интерфейса', [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в системе']], u.theme())}</div>
        <div class="fp-field"><span>Цвет интерфейса</span><div class="fp-seg" role="radiogroup" aria-label="Цвет интерфейса">
          <button type="button" role="radio" data-color="deck" aria-checked="${!own}"><i class="fp-dot" style="background:${esc(u.accent())}"></i>Как у презентации</button>
          <label class="fp-pick" role="radio" aria-checked="${!!own}" title="Свой цвет — на этом компьютере"><input type="color" id="fp-uiac" value="${esc(own ?? u.accent())}" aria-label="Свой цвет интерфейса"><i class="fp-dot" style="background:${esc(own ?? '#94A3B8')}"></i>${own ? 'Свой' : 'Свой…'}</label>
        </div></div>
        <div class="fp-field"><span>Вид слайдов в редакторе</span>${seg('look', 'Вид слайдов', [['', 'Как интерфейс'], ['light', 'Светлые'], ['dark', 'Тёмные']], u.look() ?? '', locked)}${locked ? '<small>У этой презентации свой вид: «Дизайн» → «Слайды»</small>' : ''}</div>
        <div class="fp-field">${sw(u.lite(), 'data-lite', 'Облегчённый режим', 'Для слабых компьютеров: анимации на слайде в редакторе остановлены')}</div>
        <div class="fp-field">${sw(u.smooth(), 'data-smooth', 'Плавная прокрутка колесом', 'Ровная скорость без рывков на каждом щелчке колеса. Выключите, чтобы сравнить с обычной прокруткой')}</div>
      </div></section>
      <section class="fp-voice-sec"><h3 class="fp-k">Голосовой ввод</h3><div class="fp-card fp-list fp-voice">${voiceRow(voice, voiceAsk)}</div></section>
      <section id="fp-qat-sec"><h3 class="fp-k">Панель быстрого доступа</h3><div class="fp-qat"></div></section>
      <section><h3 class="fp-k">Лента</h3><div class="fp-ribbon"></div></section>
      <section><h3 class="fp-k">О программе</h3>${aboutHtml()}</section>
    </div>`;
  }

  /** О программе: знак, версия и сборка (установленная программа — снимок кода на день сборки), «Лицензии» */
  function aboutHtml(): string {
    const b = host.build();
    const built = b?.date ? `Сборка от ${esc(b.date)}${b.commit ? ` · ${esc(b.commit)}` : ''}` : b ? 'Запущена из проекта — код всегда свежий' : 'Открыта в браузере';
    return `<div class="fp-card fp-about"><span class="fp-about-mark">${brandMark()}</span>
      <div class="fp-about-t"><b>Slideria</b><span>${b?.version ? `Версия ${esc(b.version)}` : 'Презентации как данные'}</span><small>${built}</small></div>
      <button type="button" class="fp-btn" data-fs="licenses">${icon('shield')}Лицензии</button></div>`;
  }

  // Голосовой ввод (server/voice.ts): модель распознавания речи — установлена ли и сколько занимает, «Удалить модель»
  interface VoiceInfo { state: 'none' | 'download' | 'ready' | 'error'; got: number; total: number; unpacked: number }
  let voice: VoiceInfo | null = null;
  /** Удаление ждёт подтверждения в строке */
  let voiceAsk = false;
  const mbs = (n: number) => `${Math.round(n / 1048576)} МБ`;
  function voiceRow(v: VoiceInfo | null, ask: boolean): string {
    const name = (text: string) => `${icon('mic')}<span class="fp-n">${text}</span>`;
    if (!v) return `<div class="fp-row">${name('Модель распознавания речи')}</div>`;
    const part = v.state !== 'ready' && v.state !== 'download' && v.got > 0;
    if (ask) {
      return `<div class="fp-row fp-ask">${name(part ? 'Удалить скачанное? Загрузка модели начнётся заново' : `Удалить модель? Для голосового ввода понадобится скачать модель заново (${mbs(v.total)})`)}
        <button type="button" class="fp-btn" data-voice="keep">Отмена</button><button type="button" class="fp-btn del" data-voice="remove">${icon('trash')}Удалить</button></div>`;
    }
    const del = (label: string) => `<button type="button" class="fp-btn" data-voice="ask">${icon('trash')}${label}</button>`;
    if (v.state === 'ready') return `<div class="fp-row">${name('Модель распознавания речи')}<small>GigaAM v3 · ${mbs(v.unpacked)} на диске</small>${del('Удалить модель')}</div>`;
    if (v.state === 'download') return `<div class="fp-row">${name('Модель распознавания речи')}<small>загружается: ${mbs(v.got)} из ${mbs(v.total)}</small></div>`;
    if (part) return `<div class="fp-row">${name('Модель распознавания речи')}<small>скачано ${mbs(v.got)} из ${mbs(v.total)} — загрузка продолжится</small>${del('Удалить скачанное')}</div>`;
    return `<div class="fp-row">${name('Модель распознавания речи не установлена')}<small>скачивается при первом нажатии на микрофон в чате «Агент»</small></div>`;
  }
  async function fillVoice(n: number): Promise<void> {
    let v: VoiceInfo | null = null;
    try {
      const r = await fetch('/__htmlpptx/voice-status', { method: 'POST' });
      if (r.ok) v = await r.json() as VoiceInfo;
    } catch { /* нет сервера */ }
    const sec = main.querySelector<HTMLElement>('.fp-voice-sec');
    if (n !== drawn || !sec) return;
    voice = v;
    // Без сервера студии (собранный файл) голосового ввода нет
    sec.hidden = !v;
    main.querySelector('.fp-voice')!.innerHTML = voiceRow(voice, voiceAsk);
  }

  // Лицензии: данные — один раз за страницу; поиск, фильтр и выбор — те же, когда раздел открывают снова
  const licState = newLicensesState();
  let licView: { focusSearch(): void } | null = null;
  async function fillLicenses(n: number): Promise<void> {
    licView = null;
    const box = main.querySelector<HTMLElement>('.fp-lic');
    try {
      const data = await loadLicenses();
      if (n !== drawn || !box?.isConnected) return;
      main.querySelector('.fp-lic-sum')!.textContent = licensesSummary(data).join(' · ');
      licView = mountLicenses(box, data, licState);
    } catch (e) {
      if (box?.isConnected) box.innerHTML = `<p class="fp-lic-fail">Список лицензий не загрузился: ${esc((e as Error).message)}. Откройте раздел ещё раз.</p>`;
    }
  }

  // ---------------- рисование ----------------

  let drawn = 0;
  async function render(focusMain = false): Promise<void> {
    const n = ++drawn;
    root.querySelectorAll<HTMLElement>('[data-fs]').forEach((t) => {
      const on = t.dataset.fs === section;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    main.setAttribute('aria-labelledby', `fp-t-${section}`);
    const lic = root.querySelector<HTMLButtonElement>('[data-fs="licenses"]')!;
    lic.disabled = !host.licenses.enabled();
    const int = root.querySelector<HTMLButtonElement>('[data-fs="int"]')!;
    int.disabled = !host.integrations.enabled();
    int.classList.toggle('live', host.integrations.live());
    let html: string;
    try {
      html = section === 'info' ? await infoHtml()
        : section === 'versions' ? await versionsHtml()
          : section === 'export' ? exportHtml()
            : section === 'licenses' ? '<div class="fp-head"><h2>Лицензии</h2><p class="fp-lic-sum">&nbsp;</p></div><div class="fp-lic"></div>'
              : section === 'int' ? '<div class="fp-int"></div>' : prefsHtml();
    } catch (e) {
      // Раздел не собрался (сервер не ответил, ошибка в данных) — сказать об этом, а не оставить пустое место
      const name = SECTIONS.find(([id]) => id === section)?.[2] ?? 'Раздел';
      html = `<header class="fp-head"><h2>${esc(name)}</h2></header><div class="fp-card fp-fail"><p>Раздел не открылся: ${esc((e as Error)?.message || String(e))}</p><button type="button" class="fp-btn" data-a="retry">Повторить</button></div>`;
    }
    // Пока считалось, выбрали другой раздел или закрыли
    if (n !== drawn || root.hidden) return;
    // Тот же раздел перерисовывается на месте (выбор, тема, сохранение): без появления и с той же прокруткой
    const same = main.dataset.sec === section;
    const keep = same ? main.scrollTop : 0;
    const focusSel = focusMain ? '' : focusKey();
    main.innerHTML = `<div class="fp-sec${same ? '' : ' in'}">${html}</div>`;
    main.dataset.sec = section;
    main.scrollTop = keep;
    if (section === 'info') {
      // Обложка — копия первого слайда: рисуется следующим кадром, раздел появляется без неё не дольше кадра
      const box = main.querySelector('.fp-cover');
      requestAnimationFrame(() => {
        if (n !== drawn || !box?.isConnected) return;
        const c = host.cover();
        if (c) box.append(c);
      });
    }
    if (section === 'prefs') {
      host.qat.mount(main.querySelector<HTMLElement>('.fp-qat')!);
      host.ribbon.mount(main.querySelector<HTMLElement>('.fp-ribbon')!);
      void fillVoice(n);
    }
    if (section === 'versions') void fillVersions();
    if (section === 'licenses') void fillLicenses(n);
    if (section === 'int') host.integrations.mount(main.querySelector<HTMLElement>('.fp-int')!);
    if (focusSel) main.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
    else if (focusMain) main.focus({ preventScroll: true });
  }
  /** Фокус на элементе раздела — вернуть его после перерисовки (клавиатура) */
  function focusKey(): string {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !main.contains(a)) return '';
    for (const k of ['x', 'q', 'vs', 'vr', 'vt', 'uitheme', 'color', 'look', 'a', 'restore', 'revert', 'vf', 'go', 'font', 'unfont', 'voice']) {
      const v = a.dataset[k];
      if (v !== undefined) return `[data-${k}="${CSS.escape(v)}"]`;
    }
    if (a.hasAttribute('data-same')) return '[data-same]';
    if (a.hasAttribute('data-vmusic')) return '[data-vmusic]';
    if (a.hasAttribute('data-lite')) return '[data-lite]';
    if (a.hasAttribute('data-smooth')) return '[data-smooth]';
    return a.id ? `#${CSS.escape(a.id)}` : '';
  }

  // ---------------- открыть и закрыть ----------------

  /** Раздел гаснет на своём месте (не копией поверх окна — та сдвинулась бы на полосу заголовка) */
  let fading = 0;
  const stopFade = () => {
    if (!fading) return;
    clearTimeout(fading);
    fading = 0;
    root.classList.remove('out');
  };
  const open = (s?: FileSection, at?: 'qat') => {
    if (s) section = s;
    // Закрывали и тут же открыли снова — гаснуть перестаёт, остаётся открытым
    if (fading) { stopFade(); root.hidden = true; }
    const was = !root.hidden;
    if (!was) {
      root.hidden = false;
      document.body.classList.add('fp-open');
      button.setAttribute('aria-expanded', 'true');
      host.toggled(true);
      root.querySelector<HTMLElement>(`[data-fs="${section}"]`)?.focus({ preventScroll: true });
    }
    void render().then(() => {
      if (!was || !root.contains(document.activeElement)) root.querySelector<HTMLElement>(`[data-fs="${section}"]`)?.focus({ preventScroll: true });
      // «Другие команды…» — сразу к настройке панели, поиск команд — в фокусе
      if (at === 'qat' && section === 'prefs') {
        main.querySelector('#fp-qat-sec')?.scrollIntoView({ block: 'start' });
        main.querySelector<HTMLElement>('.fp-qat [data-qe="q"]')?.focus({ preventScroll: true });
      }
    });
  };
  const close = () => {
    if (root.hidden || fading) return;
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-out')) || 0;
    if (ms > 0) {
      root.classList.add('out');
      fading = window.setTimeout(() => { fading = 0; root.classList.remove('out'); root.hidden = true; }, ms + 20);
    } else root.hidden = true;
    document.body.classList.remove('fp-open');
    button.setAttribute('aria-expanded', 'false');
    host.toggled(false);
    // Фокус — обратно на «Файл», но без рамки: раздел просто закрыли
    button.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  };

  // ---------------- действия ----------------

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button, [data-go], a');
    if (!b || !root.contains(b)) return;
    const d = b.dataset;
    if (b.getAttribute('role') === 'radio') {
      b.closest('[role="radiogroup"]')?.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', String(r === b)));
    }
    if (d.fs) { section = d.fs as FileSection; void render(); return; }
    if (d.a === 'close') return close();
    if (d.a === 'retry') { void render(); return; }
    if (d.a === 'reveal') return host.reveal?.();
    if (d.a === 'export') {
      const mode = format;
      // Видео пишется долго: раздел остаётся открытым — на нём полоса записи и «Отменить»
      if (mode !== 'video') close();
      host.exporter.run(mode);
      return;
    }
    if (d.a === 'vcancel') { host.exporter.video?.cancel(); return; }
    const v = host.exporter.video;
    if (v && (d.vs || d.vr || d.vt)) {
      if (d.vs) v.set({ size: Number(d.vs) as VideoSize });
      if (d.vr) v.set({ fps: Number(d.vr) === 30 ? 30 : 60 });
      if (d.vt) v.set({ each: Number(d.vt) === 5 ? 5 : 0 });
      void render();
      return;
    }
    if (d.a === 'point') { void ed.save().then(() => render()); return; }
    if (d.a === 'trash') { void trashUnused(host.tools, summary?.unused.map((f) => f.path) ?? []).then((ok) => { if (ok) void render(); }); return; }
    if (d.go !== undefined) { close(); host.tools.go(Number(d.go)); return; }
    if (d.font !== undefined) return replaceFont(host.tools, b, d.font);
    if (d.unfont !== undefined) { removeFont(host.tools, d.unfont); return; }
    if (d.vf) { vfilter = d.vf as typeof vfilter; void render(); return; }
    if (d.a === 'log') { host.history?.log(); return; }
    if (d.revert) {
      const g = groups.get(d.revert);
      if (!g || !host.history) return;
      const who = g.by.kind === 'script' ? `скрипта «${g.by.name}»` : `«${g.by.name}»`;
      void host.history.revert(g.list, who).then(() => render(), (err: Error) => host.tools.editor.toast(`Не удалось вернуть: ${err.message}`, 4000, true));
      return;
    }
    if (d.restore) {
      const time = Number(d.time);
      void ed.restoreCheckpoint(d.restore, `${dayOf(time) === 'Сегодня' ? '' : `${dayOf(time).toLowerCase()} `}${clock(time)}`).then(() => render());
      return;
    }
    if (d.x) {
      format = d.x;
      try { localStorage.setItem(FORMAT_KEY, format); } catch { /* нет доступа */ }
      void render();
      return;
    }
    if (d.q) { host.exporter.setQuality(d.q as Quality); void render(); return; }
    if (d.voice) {
      const box = main.querySelector<HTMLElement>('.fp-voice');
      if (!box) return;
      if (d.voice === 'remove') {
        voiceAsk = false;
        b.setAttribute('disabled', '');
        void fetch('/__htmlpptx/voice-remove', { method: 'POST' })
          .then((r) => (r.ok ? '' : r.json().then((j: { error?: string }) => j.error ?? `ошибка ${r.status}`, () => `ошибка ${r.status}`)), () => 'нет связи с сервером студии')
          .then((err) => {
            ed.toast(err ? `Модель не удалена: ${err}` : 'Модель распознавания речи удалена', err ? 4000 : 2600, !!err);
            return fillVoice(drawn);
          });
        return;
      }
      voiceAsk = d.voice === 'ask';
      box.innerHTML = voiceRow(voice, voiceAsk);
      box.querySelector<HTMLElement>(voiceAsk ? '[data-voice="keep"]' : '[data-voice="ask"]')?.focus();
      return;
    }
    // Тема меняется растворением (themeFade); раздел перерисуется, когда она сменилась (onThemeChange ниже)
    if (d.uitheme) { host.ui.setTheme(d.uitheme as UiTheme); return; }
    if (d.color) { host.ui.setOwnColor(null); void render(); return; }
    if (d.look !== undefined) { host.ui.setLook((d.look || null) as Look); void render(); }
  });
  root.addEventListener('dblclick', (e) => {
    // Двойной щелчок по формату — сразу сохранить
    const f = (e.target as Element).closest<HTMLElement>('[data-x]');
    if (!f) return;
    if (f.dataset.x !== 'video') close();
    host.exporter.run(f.dataset.x!);
  });
  // Свой цвет: пока тянут — интерфейс сразу в нём, выбрали — запоминается
  let colorFrame = 0;
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'fp-uiac' || colorFrame) return;
    colorFrame = requestAnimationFrame(() => { colorFrame = 0; host.ui.previewColor(t.value); });
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'fp-uiac') {
      cancelAnimationFrame(colorFrame);
      colorFrame = 0;
      host.ui.setOwnColor(t.value);
      void render();
      return;
    }
    if (t.hasAttribute('data-same')) host.exporter.setSame(t.checked);
    else if (t.hasAttribute('data-vmusic')) host.exporter.video?.set({ music: t.checked });
    else if (t.hasAttribute('data-lite')) host.ui.setLite(t.checked);
    else if (t.hasAttribute('data-smooth')) host.ui.setSmooth(t.checked);
    else if (t.id === 'fp-name') {
      const v = t.value.trim();
      if (v) host.rename(v);
      else t.value = deck().title ?? '';
    }
  });
  root.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return close();
    }
    // Ctrl+S — точка и здесь; остальные клавиши студии до слайдов не доходят
    if (mod && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'ы')) {
      e.preventDefault();
      e.stopPropagation();
      void ed.save().then(() => { if (section === 'versions') void render(); });
      return;
    }
    // Лицензии: Ctrl+K или «/» — поиск по ним
    const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
    if (section === 'licenses' && licView && ((mod && 'kл'.includes(e.key.toLowerCase())) || (e.key === '/' && !typing))) {
      e.preventDefault();
      e.stopPropagation();
      licView.focusSearch();
      return;
    }
    if (!mod && !e.altKey && !typing && (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'е')) {
      e.preventDefault();
      e.stopPropagation();
      host.ui.toggleTheme();
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-fs]');
    if (tab && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const ids: FileSection[] = [...SECTIONS.map(([id]) => id).filter((id) => id !== 'int' || host.integrations.enabled()), ...(host.licenses.enabled() ? ['licenses' as const] : [])];
      const i = ids.indexOf(tab.dataset.fs as FileSection);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length;
      section = ids[next];
      void render();
      root.querySelector<HTMLElement>(`[data-fs="${section}"]`)?.focus();
    } else if (tab && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
      e.preventDefault();
      main.querySelector<HTMLElement>('button, input, a, [tabindex="0"]')?.focus();
    }
    if (e.key !== 'Tab') e.stopPropagation();
  });
  // Фокус вне раздела (потерялся при перерисовке, остался на «Файле» в шапке) — клавиши всё равно у «Файла»:
  // Esc закрывает, Tab возвращает в раздел, до слайдов ничего не доходит. Поля ввода вне раздела (название
  // в полосе заголовка программы) работают как обычно
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (root.hidden || fading || root.contains(t) || t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); root.querySelector<HTMLElement>(`[data-fs="${section}"]`)?.focus(); }
  }, true);
  // Название в «Сведениях»: Enter — готово, Esc — как было
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'fp-name' || (e.key !== 'Enter')) return;
    t.blur();
  }, true);

  onThemeChange(() => { if (!root.hidden && section === 'prefs') void render(); });

  let syncTimer = 0;
  return {
    open,
    close,
    video: videoProgress,
    isOpen: () => !root.hidden && !fading,
    section: () => section,
    sync() {
      if (root.hidden) return;
      // Правка из полосы заголовка (Отменить, название) — сведения и состояние сохранения обновляются
      clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        if (root.hidden) return;
        if (section === 'info' && document.activeElement?.id !== 'fp-name') void render();
        // Версии: точка могла появиться (Ctrl+S из студии), состояние сохранения — смениться
        if (section === 'versions' && !main.querySelector('.fp-ver:hover, .fp-ver:focus-within')) void render();
      }, 250);
    },
    refresh() { if (!root.hidden) void render(); },
  };
}
