/**
 * Вкладка «Инструменты»: то, что нужно не каждый день и не должно занимать место на «Главной».
 * Сводка презентации — слайды, слова, время доклада, тяжёлые и лишние файлы, шрифты.
 * Заменить шрифт — во всей презентации одним действием (Ctrl+Z — как было).
 */
import type { Editor } from '../engine/editor/editor';
import { fontItems, fontPicker } from '../engine/editor/font-picker';
import { getAt, type Path } from '../engine/data';
import { deckFonts, fontNameOk, fontStack } from '../engine/fonts';
import { FONTS } from '../engine/text-style';
import type { Deck } from '../types';
import { texts } from './find';
import { showPopover } from './menu';

export interface ToolsHost {
  deck: Deck;
  deckKey: string;
  editor: Editor;
  go(i: number): void;
}

interface Command { run(): void; enabled?(): boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n: number) => n.toLocaleString('ru-RU');
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
/** Темп доклада: слов в минуту */
const WPM = 130;

const fontLabel = (v: string) => FONTS[v]?.name ?? v;

/** Где задан шрифт: шрифт презентации (theme.font) и оформление полей (styles.*.font) */
function fontUses(deck: Deck): Map<string, { path: Path; weight?: number }[]> {
  const out = new Map<string, { path: Path; weight?: number }[]>();
  const walk = (v: unknown, path: Path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
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
    'tools.summary': { run: () => void summary(h, anchor('tools.summary')) },
    'tools.font': { run: () => replaceFont(h, anchor('tools.font')) },
  };
}

// ---------------- сводка ----------------

async function summary(h: ToolsHost, at: HTMLElement): Promise<void> {
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
  let files: { path: string; size: number; slides: number[]; used: boolean }[] | null = null;
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
    return { name, n: uses.length, state };
  });

  const tile = (v: string, l: string) => `<div class="st-sum-t"><b>${v}</b><span>${l}</span></div>`;
  const slideLink = (i: number) => `<button type="button" class="st-link" data-go="${i}">слайд ${i + 1}</button>`;
  const html = `<h3 class="st-sum-h">Сводка презентации</h3>
<div class="st-sum-tiles">
  ${tile(num(deck.slides.length), 'слайдов')}
  ${tile(num(slideWords), 'слов на слайдах')}
  ${tile(noteWords ? `≈ ${minutes} мин` : '—', noteWords ? 'доклад по заметкам' : 'заметок нет')}
  ${tile(files ? size(total) : '—', 'файлы')}
</div>
${withNotes && withNotes < deck.slides.length ? `<p class="st-sum-note">Заметки есть у ${withNotes} из ${deck.slides.length} слайдов.</p>` : ''}
${heavy.length ? `<h4>Самые тяжёлые файлы</h4><ul class="st-sum-list">${heavy.map((f) => `<li><span class="st-sum-n" title="${esc(f.path)}">${esc(f.path.replace(/^assets\//, ''))}</span><b>${size(f.size)}</b>${f.slides.length ? slideLink(f.slides[0]) : '<i>оформление</i>'}</li>`).join('')}</ul>` : ''}
${fonts.length ? `<h4>Шрифты</h4><ul class="st-sum-list">${fonts.map((f) => `<li><span class="st-sum-n" style="font-family:${esc(FONTS[f.name]?.css ?? fontStack(f.name))}">${esc(fontLabel(f.name))}</span>${f.state ? `<small>${esc(f.state)}</small>` : '<small class="warn" title="Файла шрифта в презентации нет: на компьютере без этого шрифта текст будет другим">не встроен</small>'}<button type="button" class="st-link" data-font="${esc(f.name)}">заменить</button></li>`).join('')}</ul>` : ''}
${unused.length ? `<div class="st-sum-unused"><span>Не используются: ${unused.length} ${unused.length === 1 ? 'файл' : unused.length < 5 ? 'файла' : 'файлов'} · ${size(unused.reduce((a, f) => a + f.size, 0))}</span><button type="button" class="btn ghost small" data-trash title="${esc(unused.map((f) => f.path.replace(/^assets\//, '')).join('\n'))}">Убрать в корзину</button></div>` : ''}`;

  showPopover(at, html, (b) => {
    if (b.dataset.go) return { run: () => h.go(Number(b.dataset.go)) };
    if (b.dataset.font !== undefined) return { run: () => replaceFont(h, at, b.dataset.font) };
    if (b.hasAttribute('data-trash')) {
      return {
        run: () => {
          if (!confirm(`Убрать ${unused.length} неиспользуемых файлов в корзину проекта (папка .trash)? Их можно вернуть оттуда вручную.`)) return;
          void store.trashAssets!(h.deckKey, unused.map((f) => f.path))
            .then((r) => h.editor.toast(`Убрано в корзину: ${r.moved}`, 3000))
            .catch((e: Error) => h.editor.toast(`Не удалось: ${e.message}`, 5000, true));
        },
      };
    }
    return null;
  }, 'st-sumpop');
}

// ---------------- замена шрифта ----------------

/** «Шрифт темы»: весь текст без своего шрифта — у презентации ещё не задан шрифт */
const THEME = '#theme';

function replaceFont(h: ToolsHost, at: HTMLElement, preset?: string): void {
  const uses = fontUses(h.deck);
  const themeFree = !h.deck.theme?.font;
  let from = preset && uses.has(preset) ? preset : themeFree ? THEME : [...uses.keys()][0];
  // Шрифт всей презентации — только настоящий шрифт (не «Шрифт темы» и не общие «С засечками»…)
  const forTheme = () => from === THEME || !!uses.get(from)?.some((u) => u.path[0] === 'theme');
  let to: string | null = forTheme() ? null : '';
  const opts = (themeFree ? `<option value="${THEME}"${from === THEME ? ' selected' : ''}>Шрифт темы — весь текст без своего шрифта</option>` : '')
    + [...uses].map(([v, u]) => `<option value="${esc(v)}"${v === from ? ' selected' : ''}>${esc(fontLabel(v))} — ${u.length}</option>`).join('');
  const html = `<h3 class="st-sum-h">Заменить шрифт</h3>
<label class="st-fr-row"><span>Шрифт</span><select data-fr="from">${opts}</select></label>
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
    if (b.dataset.fr === 'go') return { run: () => void (to !== null && apply(h, from, to)) };
    return null;
  }, 'st-frpop');
  const toBtn = pop.querySelector<HTMLElement>('[data-fr="to"] span')!;
  const hint = () => {
    const n = uses.get(from)?.length ?? 0;
    const bad = to === null || from === to;
    pop.querySelector('[data-fr="hint"]')!.textContent = to === null ? '' : from === to ? 'Выберите другой шрифт.'
      : from === THEME ? 'Сменится шрифт всего текста, у которого нет своего. Отменить — Ctrl+Z.'
        : `Заменится в ${n} ${n === 1 ? 'месте' : 'местах'}. Отменить — Ctrl+Z.`;
    pop.querySelector<HTMLButtonElement>('[data-fr="go"]')!.disabled = bad;
  };
  pop.querySelector<HTMLSelectElement>('[data-fr="from"]')!.addEventListener('change', (e) => {
    from = (e.target as HTMLSelectElement).value;
    // Для шрифта всей презентации «Шрифт темы» и общие шрифты не подходят — выбор заново
    if (forTheme() && (to === '' || (to && FONTS[to]))) { to = null; toBtn.textContent = 'Выберите шрифт'; toBtn.style.fontFamily = ''; }
    hint();
  });
  hint();
}

async function apply(h: ToolsHost, from: string, to: string): Promise<void> {
  const ed = h.editor;
  if (from === THEME) {
    if (!to || !(await ed.ensureFont(to))) return;
    ed.commit((d) => { d.theme = { ...(d.theme ?? {}), font: to }; }, { rebuild: true });
    ed.toast(`Шрифт презентации — «${to}». Отменить — Ctrl+Z`, 4000);
    return;
  }
  const uses = fontUses(h.deck).get(from) ?? [];
  if (!uses.length || from === to) return;
  // Шрифт библиотеки или компьютера — сначала копией в презентацию, с теми же начертаниями
  if (to && !FONTS[to]) {
    if (!(await ed.ensureFont(to))) return;
    for (const w of new Set(uses.map((u) => u.weight).filter((w): w is number => !!w))) await ed.ensureFont(to, w);
  }
  ed.commit((d) => {
    for (const u of uses) {
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
  ed.toast(`«${fontLabel(from)}» → «${to ? fontLabel(to) : 'Шрифт темы'}»: ${uses.length}. Отменить — Ctrl+Z`, 4000);
}

