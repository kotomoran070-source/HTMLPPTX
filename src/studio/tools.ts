/**
 * Вкладка «Инструменты»: то, что нужно не каждый день и не должно занимать место на «Главной».
 * Сводка презентации — слайды, слова, время доклада, тяжёлые и лишние файлы, шрифты.
 * Заменить шрифт — во всей презентации одним действием (Ctrl+Z — как было).
 * Лицензии — программы, её библиотек и шрифтов, страницей в новом окне.
 */
import type { Editor } from '../engine/editor/editor';
import { fontItems, fontPicker, plural } from '../engine/editor/font-picker';
import { getAt, setAt, type Path } from '../engine/data';
import { deckFonts, fontNameOk, fontStack } from '../engine/fonts';
import { FONTS } from '../engine/text-style';
import { formatSpanAttrs, parseSpanAttrs } from '../engine/span-attrs';
import type { Deck } from '../types';
import { texts } from './find';
import { showPopover } from './menu';
import { applyFixes, findFixes } from './tidy';

export interface ToolsHost {
  deck: Deck;
  deckKey: string;
  editor: Editor;
  go(i: number): void;
  /** Открытый слайд (с 0): «Заменить шрифт» — на нём или во всей презентации */
  slide?(): number;
  /** Открыть «Файл → Сведения» */
  info(): void;
  /** Открыть «Файл → Лицензии» */
  licenses(): void;
}

interface Command { run(): void; enabled?(): boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n: number) => n.toLocaleString('ru-RU');
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
/** Темп доклада: слов в минуту */
const WPM = 130;

const fontLabel = (v: string) => FONTS[v]?.name ?? v;

/** Шрифт части текста: {f:Имя|…} внутри строки (span-attrs.ts) */
const SPAN_HEAD = /\{([^{}|\n]+)\|/g;
const spanFonts = (s: string) => new Set([...s.matchAll(SPAN_HEAD)].map((m) => parseSpanAttrs(m[1])?.font).filter((f): f is string => !!f));

/** Шрифт частей строки from → to ('' — шрифт всего текста: часть без своего шрифта) */
function swapSpanFont(s: string, from: string, to: string): string {
  return s.replace(/\{([^{}|\n]+)\|([^{}]*)\}/g, (m, a: string, inner: string, at: number) => {
    const o = at > 0 && s[at - 1] === '\\' ? null : parseSpanAttrs(a);
    if (!o || o.font !== from) return m;
    if (to) o.font = to;
    else delete o.font;
    const out = formatSpanAttrs(o);
    return out ? `{${out}|${inner}}` : inner;
  });
}

/** Где задан шрифт: шрифт презентации (theme.font), оформление полей (styles.*.font) и части текста ({f:…|…}) */
function fontUses(deck: Deck): Map<string, { path: Path; weight?: number; text?: true }[]> {
  const out = new Map<string, { path: Path; weight?: number; text?: true }[]>();
  const walk = (v: unknown, path: Path) => {
    if (typeof v === 'string') {
      if (!v.includes('f:')) return;
      for (const f of spanFonts(v)) {
        const list = out.get(f) ?? [];
        list.push({ path, text: true });
        out.set(f, list);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const [k, x] of Object.entries(o)) {
        if (k === 'font' && typeof x === 'string' && x && (FONTS[x] || fontNameOk(x))) {
          const list = out.get(x) ?? [];
          list.push({ path: [...path, k], weight: Number(o.weight) || undefined });
          out.set(x, list);
        } else if (!(path.length === 0 && k === 'fonts')) walk(x, [...path, k]);
      }
    }
  };
  walk(deck, []);
  return out;
}

const words = (s: string) => (s.replace(/\{#[0-9a-f]{3,8}\|/gi, ' ').replace(/\]\([^)]*\)/g, ']').match(WORD) ?? []).length;

export function toolsCommands(h: ToolsHost): Record<string, Command> {
  const anchor = (cmd: string) => document.querySelector<HTMLElement>(`.st-ribbon [data-cmd="${cmd}"]`)!;
  return {
    // Сводка — в «Файл → Сведения»
    'tools.summary': { run: () => h.info() },
    'tools.font': { run: () => replaceFont(h, anchor('tools.font')) },
    'tools.tidy': { run: () => tidy(h, anchor('tools.tidy')) },
    // Страницу отдаёт сервер студии (server/http.ts): у файла, открытого с диска, его нет — лицензии лежат в самом файле
    'tools.licenses': { run: () => h.licenses(), enabled: () => location.protocol.startsWith('http') },
    'tools.notes-clear': { run: () => clearNotes(h), enabled: () => h.deck.slides.some((s) => typeof s.notes === 'string' && s.notes.trim()) },
  };
}

// ---------------- сводка ----------------

/** Сводка презентации — для раздела «Файл → Сведения» (file-panel.ts) */
export interface Summary {
  slides: number;
  slideWords: number;
  noteWords: number;
  /** Доклад по заметкам, минут */
  minutes: number;
  /** Слайдов с заметками */
  withNotes: number;
  /** Файлы презентации; null — список недоступен (файл открыт с диска) */
  files: { path: string; size: number; slides: number[]; used: boolean }[] | null;
  total: number;
  heavy: { path: string; size: number; slides: number[] }[];
  unused: { path: string; size: number }[];
  fonts: { name: string; label: string; css: string; n: number; state: string }[];
  /** Встроенные шрифты, которые нигде не заданы */
  idle: { name: string; css: string }[];
}

export async function collectSummary(h: ToolsHost): Promise<Summary> {
  const { deck } = h;
  let slideWords = 0;
  let noteWords = 0;
  for (const t of texts(deck, true)) {
    const s = getAt(deck, t.path);
    if (typeof s !== 'string' || t.path[0] === 'title') continue;
    if (t.notes) noteWords += words(s);
    else slideWords += words(s);
  }
  const withNotes = deck.slides.filter((s) => typeof s.notes === 'string' && s.notes.trim()).length;
  const minutes = Math.max(1, Math.round(noteWords / WPM));

  // Файлы: размеры с сервера; используется ли — по ссылке в данных или внутри живой вставки
  const store = h.editor.files;
  let files: Summary['files'] = null;
  if (store.listAssets) {
    try {
      const list = await store.listAssets(h.deckKey);
      const json = JSON.stringify(deck);
      const inSlide = deck.slides.map((s) => JSON.stringify(s));
      const has = (hay: string, p: string) => hay.includes(p) || hay.includes(encodeURI(p));
      // Документы живых вставок ссылаются на свои файлы относительно себя (doom.htm → doom1.wad)
      let inner = '';
      for (const f of list.filter((x) => /\.(html?|js|css|json)$/i.test(x.path) && has(json, x.path))) {
        const url = new RegExp(`[^"\\s]*${f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(json)?.[0];
        if (url) inner += await fetch(url).then((r) => (r.ok ? r.text() : '')).catch(() => '');
      }
      files = list.map((f) => ({
        ...f,
        slides: inSlide.flatMap((s, i) => (has(s, f.path) ? [i] : [])),
        used: has(json, f.path) || (!!inner && inner.includes(f.path.split('/').pop()!)),
      }));
    } catch { files = null; }
  }

  const total = files?.reduce((a, f) => a + f.size, 0) ?? 0;
  const heavy = (files ?? []).filter((f) => f.used).sort((a, b) => b.size - a.size).slice(0, 5);
  const unused = (files ?? []).filter((f) => !f.used);

  const embedded = deckFonts(deck.fonts);
  const fileSize = (src: string) => files?.find((f) => src.endsWith(f.path))?.size ?? 0;
  const fonts = [...fontUses(deck)].map(([name, uses]) => {
    const own = embedded.filter((f) => f.name.trim() === name);
    const state = FONTS[name] ? 'общий' : own.length ? `встроен · ${size(own.reduce((a, f) => a + fileSize(f.src), 0))}` : '';
    return { name, label: fontLabel(name), css: FONTS[name]?.css ?? fontStack(name), n: uses.length, state };
  });
  // Встроенные, но нигде не заданные (и не у заголовков темы): их можно убрать из презентации
  const idle = [...new Set(embedded.map((f) => f.name.trim()))]
    .filter((n) => n && !fonts.some((f) => f.name === n) && deck.theme?.head !== n)
    .map((n) => ({ name: n, css: fontStack(n) }));
  return { slides: deck.slides.length, slideWords, noteWords, minutes, withNotes, files, total, heavy, unused, fonts, idle };
}

/** Убрать файл шрифта, который нигде не задан (Ctrl+Z — вернуть) */
export function removeFont(h: ToolsHost, name: string): void {
  h.editor.commit((d) => {
    const list = (Array.isArray(d.fonts) ? d.fonts : []).filter((f) => f?.name?.trim() !== name);
    if (list.length) d.fonts = list;
    else delete d.fonts;
  }, { rebuild: true });
  h.editor.toast(`Шрифт «${name}» убран из презентации. Вернуть — Ctrl+Z`, 4000);
}

/** Неиспользуемые файлы — в корзину проекта (.trash): вернуть можно оттуда вручную */
export async function trashUnused(h: ToolsHost, paths: string[]): Promise<boolean> {
  if (!paths.length || !h.editor.files.trashAssets) return false;
  if (!confirm(`Убрать ${paths.length} ${plural(paths.length, 'неиспользуемый файл', 'неиспользуемых файла', 'неиспользуемых файлов')} в корзину проекта (папка .trash)? Файлы можно восстановить из этой папки вручную.`)) return false;
  try {
    const r = await h.editor.files.trashAssets(h.deckKey, paths);
    h.editor.toast(`Убрано в корзину: ${r.moved}`, 3000);
    return true;
  } catch (e) {
    h.editor.toast(`Не удалось: ${(e as Error).message}`, 5000, true);
    return false;
  }
}

export const fileSize = size;
export const numText = num;

// ---------------- привести в порядок ----------------

const slidesText = (s: number[]) => (s.length === 1 ? `слайд ${s[0] + 1}` : `слайды ${s.slice(0, 6).map((i) => i + 1).join(', ')}${s.length > 6 ? '…' : ''}`);

function tidy(h: ToolsHost, at: HTMLElement): void {
  const fixes = findFixes(h.deck);
  const swatch = (c: string) => (c.startsWith('#') ? `<i class="st-tidy-sw" style="background:${esc(c)}"></i>` : '');
  const html = fixes.length
    ? `<h3 class="st-sum-h">Привести в порядок</h3>
<ul class="st-tidy">${fixes.map((f, i) => `<li><label><input type="checkbox" data-i="${i}" checked><span><b>${esc(f.what)}</b> ${swatch(f.from)}${esc(f.from)} → ${swatch(f.to)}${esc(f.to)}<small>${slidesText(f.slides)} · <button type="button" class="st-link" data-go="${f.slides[0]}">показать</button></small></span></label></li>`).join('')}</ul>
<div class="st-fr-btns"><button type="button" class="btn primary small" data-tidy>Исправить</button></div>`
    : `<h3 class="st-sum-h">Привести в порядок</h3><p class="st-sum-note">Всё ровно — исправлять нечего.</p>`;
  const pop = showPopover(at, html, (b) => {
    if (b.dataset.go) return { keep: true, run: () => h.go(Number(b.dataset.go)) };
    if (!b.hasAttribute('data-tidy')) return null;
    return {
      run: () => {
        const on = [...pop.querySelectorAll<HTMLInputElement>('input[data-i]')].filter((x) => x.checked).map((x) => fixes[Number(x.dataset.i)]);
        if (!on.length) return;
        h.editor.commit((d) => applyFixes(d, on), { rebuild: true });
        h.editor.toast(`Исправлено: ${on.length}. Отменить — Ctrl+Z`, 4000);
      },
    };
  }, 'st-sumpop');
  const go = pop.querySelector<HTMLButtonElement>('[data-tidy]');
  pop.addEventListener('change', () => { if (go) go.disabled = !pop.querySelector('input[data-i]:checked'); });
}

// ---------------- заметки ----------------

/** Заметки докладчика со всех слайдов — одним действием (перед тем как отдать файл); Ctrl+Z — вернуть */
function clearNotes(h: ToolsHost): void {
  const n = h.deck.slides.filter((s) => typeof s.notes === 'string' && s.notes.trim()).length;
  if (!n) return;
  h.editor.commit((d) => {
    for (const s of d.slides) {
      delete s.notes;
      delete s.notesEdited;
    }
  }, { rebuild: false });
  h.editor.toast(`Заметки удалены: ${n}. Отменить — Ctrl+Z`, 4000);
}

// ---------------- замена шрифта ----------------

/** «Шрифт темы»: весь текст без своего шрифта — у презентации ещё не задан шрифт */
const THEME = '#theme';

export function replaceFont(h: ToolsHost, at: HTMLElement, preset?: string): void {
  const all = fontUses(h.deck);
  const here = h.slide?.() ?? -1;
  // Где менять: во всей презентации или только на открытом слайде
  let only: number | null = null;
  const onSlide = (i: number) => new Map([...all].map(([k, u]) => [k, u.filter((x) => x.path[0] === 'slides' && x.path[1] === i)] as const).filter(([, u]) => u.length));
  const usesNow = () => (only === null ? all : onSlide(only));
  const themeFree = !h.deck.theme?.font;
  let from = preset && all.has(preset) ? preset : themeFree ? THEME : [...all.keys()][0];
  // Шрифт всей презентации — только настоящий шрифт (не «Шрифт темы» и не общие «С засечками»…)
  const forTheme = () => from === THEME || !!usesNow().get(from)?.some((u) => u.path[0] === 'theme');
  let to: string | null = forTheme() ? null : '';
  const options = () => (themeFree && only === null ? `<option value="${THEME}"${from === THEME ? ' selected' : ''}>Шрифт темы — весь текст без своего шрифта</option>` : '')
    + [...usesNow()].map(([v, u]) => `<option value="${esc(v)}"${v === from ? ' selected' : ''}>${esc(fontLabel(v))} — ${u.length}</option>`).join('');
  const slideFonts = here >= 0 ? onSlide(here).size : 0;
  const where = here >= 0 ? `<label class="st-fr-row"><span>Где</span><select data-fr="where"><option value="all" selected>Во всей презентации</option><option value="slide"${slideFonts ? '' : ' disabled'}>На этом слайде (${here + 1})${slideFonts ? '' : ' — своих шрифтов нет'}</option></select></label>` : '';
  const html = `<h3 class="st-sum-h">Заменить шрифт</h3>
${where}<label class="st-fr-row"><span>Шрифт</span><select data-fr="from">${options()}</select></label>
<div class="st-fr-row"><span>Заменить на</span><button type="button" class="edfont st-p-font" data-fr="to" aria-haspopup="listbox"><span>${to === null ? 'Выберите шрифт' : 'Шрифт темы'}</span></button></div>
<p class="st-sum-note" data-fr="hint"></p>
<div class="st-fr-btns"><button type="button" class="btn primary small" data-fr="go">Заменить</button></div>`;
  const pop = showPopover(at, html, (b) => {
    if (b.dataset.fr === 'to') {
      return {
        keep: true,
        run: () => fontPicker().toggle(b, () => fontItems(forTheme() ? [] : [{ value: '', label: 'Шрифт темы', css: 'inherit', group: 'Шрифты темы' },
          ...Object.entries(FONTS).map(([k, f]) => ({ value: k, label: f.name, css: f.css, group: 'Шрифты темы' }))], h.editor.fontChoices(), fontStack), to ?? '', (v) => {
          to = v;
          const span = b.querySelector('span')!;
          span.textContent = v ? fontLabel(v) : 'Шрифт темы';
          span.style.fontFamily = v ? FONTS[v]?.css ?? fontStack(v) : '';
          hint();
        }),
      };
    }
    if (b.dataset.fr === 'go') return { run: () => void (to !== null && apply(h, from, to, only)) };
    return null;
  }, 'st-frpop');
  const toBtn = pop.querySelector<HTMLElement>('[data-fr="to"] span')!;
  const fromSel = pop.querySelector<HTMLSelectElement>('[data-fr="from"]')!;
  const hint = () => {
    const n = usesNow().get(from)?.length ?? 0;
    const bad = to === null || from === to;
    pop.querySelector('[data-fr="hint"]')!.textContent = to === null ? '' : from === to ? 'Выберите другой шрифт.'
      : from === THEME ? 'Сменится шрифт всего текста, у которого нет своего. Отменить — Ctrl+Z.'
        : `Заменится в ${n} ${n === 1 ? 'месте' : 'местах'}${only !== null ? ` на слайде ${only + 1}` : ''}. Отменить — Ctrl+Z.`;
    pop.querySelector<HTMLButtonElement>('[data-fr="go"]')!.disabled = bad;
  };
  const fromChanged = () => {
    // Для шрифта всей презентации «Шрифт темы» и общие шрифты не подходят — выбор заново
    if (forTheme() && (to === '' || (to && FONTS[to]))) { to = null; toBtn.textContent = 'Выберите шрифт'; toBtn.style.fontFamily = ''; }
    hint();
  };
  fromSel.addEventListener('change', () => {
    from = fromSel.value;
    fromChanged();
  });
  pop.querySelector<HTMLSelectElement>('[data-fr="where"]')?.addEventListener('change', (e) => {
    only = (e.target as HTMLSelectElement).value === 'slide' ? here : null;
    // На слайде — только шрифты, что на нём есть («Шрифт темы» меняется для всей презентации)
    if (!usesNow().has(from)) from = [...usesNow().keys()][0] ?? (themeFree ? THEME : from);
    fromSel.innerHTML = options();
    fromSel.value = from;
    if (to === null && !forTheme()) { to = ''; toBtn.textContent = 'Шрифт темы'; }
    fromChanged();
  });
  hint();
}

async function apply(h: ToolsHost, from: string, to: string, only: number | null = null): Promise<void> {
  const ed = h.editor;
  if (from === THEME) {
    if (!to || !(await ed.ensureFont(to))) return;
    ed.commit((d) => { d.theme = { ...(d.theme ?? {}), font: to }; }, { rebuild: true });
    ed.toast(`Шрифт презентации — «${to}». Отменить — Ctrl+Z`, 4000);
    return;
  }
  const uses = (fontUses(h.deck).get(from) ?? []).filter((u) => only === null || (u.path[0] === 'slides' && u.path[1] === only));
  if (!uses.length || from === to) return;
  // Шрифт библиотеки или компьютера — сначала копией в презентацию, с теми же начертаниями
  if (to && !FONTS[to]) {
    if (!(await ed.ensureFont(to))) return;
    for (const w of new Set(uses.map((u) => u.weight).filter((w): w is number => !!w))) await ed.ensureFont(to, w);
  }
  ed.commit((d) => {
    for (const u of uses) {
      if (u.text) {
        const v = getAt(d, u.path);
        if (typeof v === 'string') setAt(d, u.path, swapSpanFont(v, from, to));
        continue;
      }
      const owner = getAt(d, u.path.slice(0, -1)) as Record<string, unknown> | undefined;
      if (!owner) continue;
      if (to) owner.font = to;
      else delete owner.font;
    }
    // Старый шрифт больше нигде не нужен — его файлы уходят из презентации
    if (!FONTS[from] && !fontUses(d).has(from) && Array.isArray(d.fonts)) {
      d.fonts = d.fonts.filter((f) => f?.name?.trim() !== from);
      if (!d.fonts.length) delete d.fonts;
    }
  }, { rebuild: true });
  ed.toast(`«${fontLabel(from)}» → «${to ? fontLabel(to) : 'Шрифт темы'}»${only !== null ? ` на слайде ${only + 1}` : ''}: ${uses.length}. Отменить — Ctrl+Z`, 4000);
}

