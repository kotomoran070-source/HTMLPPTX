/**
 * Раздел «Файл» студии — на всё окно под полосой заголовка, как в Office. Слева разделы, справа содержимое:
 *
 * - Сведения — сводка презентации: числа, тяжёлые и лишние файлы, шрифты, название и папка;
 * - Экспорт — форматы карточками, справа — настройки выбранного и «Сохранить»;
 * - Версии — контрольные точки по дням, с первым слайдом каждой; «Вернуть» — одной правкой (Ctrl+Z — обратно);
 * - Параметры — лента (ribbon-setup.ts) и интерфейс: тема, цвет, вид слайдов, облегчённый режим.
 *
 * Внизу — «Все презентации», «Лицензии» и сборка программы. Esc или «Назад» — обратно к слайдам.
 * Кнопка «Файл» — в начале строки вкладок (studio.ts); туда же ведут «Экспорт» из поиска команд, «Сводка»,
 * «Настроить ленту» и щелчок по «Сохранено». Клавиши студии, пока раздел открыт, до слайдов не доходят.
 */
import { icon } from '../components/icons';
import type { Deck } from '../types';
import { staticSlide } from '../engine/deck-view';
import { clock } from '../engine/editor/editor';
import { plural } from '../engine/editor/font-picker';
import { esc } from '../engine/html';
import { onThemeChange } from '../engine/theme';
import { collectSummary, fileSize, numText, removeFont, replaceFont, trashUnused, type Summary, type ToolsHost } from './tools';
import './file-panel.css';

export type FileSection = 'info' | 'export' | 'versions' | 'prefs';
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
  };
  ribbon: { mount(el: HTMLElement): void };
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
    look(): Look;
    setLook(v: Look): void;
    /** У презентации свой вид слайдов («Дизайн» → «Слайды») */
    lookLocked(): boolean;
    /** Вид окна программы — проба для Windows (только в программе); выбор — программа откроется заново */
    windowMode?: { current: string; set(m: string): void };
  };
  licenses: { run(): void; enabled(): boolean };
  /** «Slideria 1.4 · сборка от …» (запуск из проекта — без сборки); пусто вне программы */
  build(): string;
  /** Раздел открылся или закрылся */
  toggled(open: boolean): void;
}

const SECTIONS: [FileSection, string, string][] = [
  ['info', 'chart', 'Сведения'],
  ['export', 'save', 'Экспорт'],
  ['versions', 'clock', 'Версии'],
  ['prefs', 'sliders', 'Параметры'],
];
/** Значки форматов — как у файлов: цвет и подпись */
const BADGE: Record<string, [string, string]> = {
  clean: ['HTML', '#2563EB'],
  edit: ['HTML', '#7C3AED'],
  pptx: ['PPTX', '#C2410C'],
  pdf: ['PDF', '#DC2626'],
};
const FORMAT_KEY = 'slideria-export-format';

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

export function initFilePanel(host: FileHost, app: HTMLElement, button: HTMLElement): {
  open(section?: FileSection): void;
  close(): void;
  isOpen(): boolean;
  /** Презентация или состояние сохранения поменялись — открытый раздел обновляется */
  sync(): void;
  /** Перерисовать открытый раздел сейчас (сделана точка) */
  refresh(): void;
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
    <button type="button" class="fp-i" data-a="licenses">${icon('shield')}<span>Лицензии</span></button>
    <div class="fp-build"></div>
  </nav>
  <main class="fp-main" id="fp-main" role="tabpanel" tabindex="-1"></main>`;
  app.append(root);
  const main = root.querySelector<HTMLElement>('.fp-main')!;

  // ---------------- разделы ----------------

  let summary: Summary | null = null;
  async function infoHtml(): Promise<string> {
    // Сводка — каждый раз заново: презентация могла поменяться (файлы — запрос к серверу)
    const s = summary = await collectSummary(host.tools);
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
        ${s.fonts.length || s.idle.length ? `<section><h3 class="fp-k">Шрифты</h3><div class="fp-card fp-list">${s.fonts.map((f) => `<div class="fp-row"><span class="fp-n" style="font-family:${esc(f.css)}">${esc(f.label)}</span>${f.state ? `<small>${esc(f.state)}</small>` : '<small class="fp-bad" title="Шрифт не встроен: на другом компьютере текст будет другим">не встроен</small>'}<button type="button" class="fp-link" data-font="${esc(f.name)}">заменить</button></div>`).join('')}${s.idle.map((f) => `<div class="fp-row"><span class="fp-n" style="font-family:${esc(f.css)}">${esc(f.name)}</span><small>не используется</small><button type="button" class="fp-link" data-unfont="${esc(f.name)}" title="Убрать файл шрифта (в библиотеке он останется)">убрать</button></div>`).join('')}</div></section>` : ''}
      </div>
    </div>`;
  }

  function exportHtml(): string {
    const x = host.exporter;
    const k = x.kinds.find(([m]) => m === format) ?? x.kinds[0];
    const html = k[0] === 'clean' || k[0] === 'edit';
    const q = x.qualities.find(([v]) => v === x.quality())!;
    const [ext] = BADGE[k[0]] ?? ['', ''];
    return `<header class="fp-head"><h2>Экспорт</h2><p>Один файл, чтобы показать, отправить или открыть в другой программе</p></header>
    <div class="fp-x">
      <div class="fp-formats" role="radiogroup" aria-label="Формат">${x.kinds.map(([m, , t, about]) => {
        const [b, c] = BADGE[m] ?? ['', 'var(--ac)'];
        return `<button type="button" class="fp-card fp-fmt" role="radio" aria-checked="${m === k[0]}" data-x="${m}"><span class="fp-badge" style="--c:${c}">${b}</span><span class="fp-fmt-t">${esc(t)}</span><small>${esc(about)}</small><i class="fp-radio" aria-hidden="true"></i></button>`;
      }).join('')}</div>
      <div class="fp-card fp-side">
        <h3>${esc(k[2])}</h3>
        <div class="fp-field"><span class="fp-k">Качество</span>${seg('q', 'Качество файла', x.qualities.map(([v, t]) => [v, t]), q[0])}<small>${esc(q[2])}</small></div>
        ${html ? sw(x.same(), 'data-same', 'Как на этом компьютере', 'Тот же вид слайдов и анимации на любом компьютере') : ''}
        <div class="fp-file"><span>Файл</span><span title="${esc(x.fileName(k[0]))}">${esc(x.fileName(k[0]))}</span></div>
        <button type="button" class="fp-btn go" data-a="export">${icon('save')}Сохранить ${esc(ext)}</button>
      </div>
    </div>`;
  }

  let points: { id: string; time: number }[] | null = null;
  async function versionsHtml(): Promise<string> {
    const head = '<header class="fp-head"><h2>Версии</h2><p>Программа сохраняет сама. Точка — снимок, к которому можно вернуться</p></header>';
    if (ed.mode !== 'project') {
      return `${head}<div class="fp-card fp-empty">${icon('clock')}<div><span class="fp-sw-t">Версии — у презентаций из папки программы</span><small>Этот файл открыт с диска: сохранить правки в него — Ctrl+S</small></div></div>`;
    }
    points = await ed.checkpoints();
    const st = ed.statusInfo;
    const last = points[0];
    const days = new Map<string, { id: string; time: number }[]>();
    for (const p of points.slice(0, 40)) {
      const d = dayOf(p.time);
      days.set(d, [...(days.get(d) ?? []), p]);
    }
    return `${head}<div class="fp-v-list">
      <div class="fp-card fp-now"><i class="fp-led ${esc(st.cls)}"></i><div><span class="fp-sw-t">${esc(st.cls === 'err' ? st.text : st.cls === 'ok' ? 'Всё сохранено' : st.text || 'Всё сохранено')}</span><small>${last ? `Последняя точка — ${dayOf(last.time).toLowerCase()} в ${clock(last.time)}` : 'Каждая правка сразу записывается в файл'}</small></div><button type="button" class="fp-btn go" data-a="point">${icon('save')}Сделать точку<kbd>Ctrl+S</kbd></button></div>
      ${points.length ? [...days].map(([day, list]) => `<section><h3 class="fp-k">${esc(day)}</h3><div class="fp-card">${list.map((p) => `<div class="fp-ver" data-cp="${esc(p.id)}"><time>${clock(p.time)}</time><span class="fp-ver-th" data-th="${esc(p.id)}"></span><span class="fp-ver-n" data-n="${esc(p.id)}">Контрольная точка</span><button type="button" class="fp-btn" data-restore="${esc(p.id)}" data-time="${p.time}">Вернуть</button></div>`).join('')}</div></section>`).join('')
        : `<div class="fp-card fp-empty">${icon('clock')}<div><span class="fp-sw-t">Точек пока нет</span><small>Сделайте первую перед большими правками — Ctrl+S</small></div></div>`}
    </div>`;
  }
  /** Точка не меняется: её миниатюра и подпись читаются с диска один раз */
  const seen = new Map<string, { thumb: HTMLElement; label: string } | null>();
  /** Первый слайд и число слайдов каждой точки — по мере чтения, сверху вниз */
  async function fillVersions(): Promise<void> {
    const read = ed.files.readCheckpoint;
    if (!read || !points) return;
    for (const p of points.slice(0, 40)) {
      if (root.hidden || section !== 'versions') return;
      const th = main.querySelector<HTMLElement>(`[data-th="${CSS.escape(p.id)}"]`);
      if (!th || th.childElementCount) continue;
      if (!seen.has(p.id)) {
        try {
          const d = (await read(host.tools.deckKey, p.id)).deck as Deck;
          seen.set(p.id, d && Array.isArray(d.slides) && d.slides.length
            ? { thumb: staticSlide(d, 0, 96), label: `${d.title ? `${d.title} · ` : ''}${d.slides.length} ${plural(d.slides.length, 'слайд', 'слайда', 'слайдов')}` }
            : null);
        } catch { seen.set(p.id, null); /* точку не прочитать — строка остаётся без миниатюры */ }
      }
      const got = seen.get(p.id);
      if (!got || !th.isConnected) continue;
      th.replaceChildren(got.thumb.cloneNode(true));
      const n = main.querySelector<HTMLElement>(`[data-n="${CSS.escape(p.id)}"]`);
      if (n) n.textContent = got.label;
    }
  }

  function prefsHtml(): string {
    const u = host.ui;
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
      </div></section>
      <section><h3 class="fp-k">Лента</h3><div class="fp-ribbon"></div></section>
      ${u.windowMode ? `<section><h3 class="fp-k">Окно (проба)</h3><div class="fp-card fp-grid">
        <div class="fp-field" style="grid-column: 1 / -1">${seg('wmode', 'Вид окна', [['own', 'Свой'], ['overlay', 'Системные кнопки'], ['mica', 'Свой + Mica'], ['system', 'Системная рамка']], u.windowMode.current)}
          <small>Временно, для проверки в Windows: в каком виде сворачивание и разворачивание идёт плавно. После выбора программа откроется заново</small></div>
      </div></section>` : ''}
    </div>`;
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
    const lic = root.querySelector<HTMLButtonElement>('[data-a="licenses"]')!;
    lic.disabled = !host.licenses.enabled();
    root.querySelector('.fp-build')!.textContent = host.build();
    const html = section === 'info' ? await infoHtml()
      : section === 'versions' ? await versionsHtml()
        : section === 'export' ? exportHtml() : prefsHtml();
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
      const c = host.cover();
      if (c) main.querySelector('.fp-cover')?.append(c);
    }
    if (section === 'prefs') host.ribbon.mount(main.querySelector<HTMLElement>('.fp-ribbon')!);
    if (section === 'versions') void fillVersions();
    if (focusSel) main.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
    else if (focusMain) main.focus({ preventScroll: true });
  }
  /** Фокус на элементе раздела — вернуть его после перерисовки (клавиатура) */
  function focusKey(): string {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !main.contains(a)) return '';
    for (const k of ['x', 'q', 'uitheme', 'color', 'look', 'a', 'restore', 'go', 'font', 'unfont']) {
      const v = a.dataset[k];
      if (v !== undefined) return `[data-${k}="${CSS.escape(v)}"]`;
    }
    if (a.hasAttribute('data-same')) return '[data-same]';
    if (a.hasAttribute('data-lite')) return '[data-lite]';
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
  const open = (s?: FileSection) => {
    if (s) section = s;
    // Закрывали и тут же открыли снова — гаснуть перестаёт, остаётся открытым
    if (fading) { stopFade(); root.hidden = true; }
    const was = !root.hidden;
    if (!was) {
      root.hidden = false;
      document.body.classList.add('fp-open');
      button.setAttribute('aria-expanded', 'true');
      host.toggled(true);
    }
    void render().then(() => {
      if (!was || !root.contains(document.activeElement)) root.querySelector<HTMLElement>(`[data-fs="${section}"]`)?.focus({ preventScroll: true });
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
    if (d.a === 'licenses') return host.licenses.run();
    if (d.a === 'reveal') return host.reveal?.();
    if (d.a === 'export') {
      const mode = format;
      close();
      host.exporter.run(mode);
      return;
    }
    if (d.a === 'point') { void ed.save().then(() => render()); return; }
    if (d.a === 'trash') { void trashUnused(host.tools, summary?.unused.map((f) => f.path) ?? []).then((ok) => { if (ok) void render(); }); return; }
    if (d.go !== undefined) { close(); host.tools.go(Number(d.go)); return; }
    if (d.font !== undefined) return replaceFont(host.tools, b, d.font);
    if (d.unfont !== undefined) { removeFont(host.tools, d.unfont); return; }
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
    // Тема меняется растворением (themeFade); раздел перерисуется, когда она сменилась (onThemeChange ниже)
    if (d.uitheme) { host.ui.setTheme(d.uitheme as UiTheme); return; }
    if (d.color) { host.ui.setOwnColor(null); void render(); return; }
    if (d.look !== undefined) { host.ui.setLook((d.look || null) as Look); void render(); }
    if (d.wmode) host.ui.windowMode?.set(d.wmode);
  });
  root.addEventListener('dblclick', (e) => {
    // Двойной щелчок по формату — сразу сохранить
    const f = (e.target as Element).closest<HTMLElement>('[data-x]');
    if (!f) return;
    close();
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
    else if (t.hasAttribute('data-lite')) host.ui.setLite(t.checked);
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
    const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
    if (!mod && !e.altKey && !typing && (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'е')) {
      e.preventDefault();
      e.stopPropagation();
      host.ui.toggleTheme();
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-fs]');
    if (tab && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const ids = SECTIONS.map(([id]) => id);
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
    isOpen: () => !root.hidden && !fading,
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
