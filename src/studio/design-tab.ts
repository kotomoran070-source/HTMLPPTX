/**
 * Вкладка «Дизайн»: оформление презентации целиком. Галерея тем (каждая — на одном и том же
 * слайде-образце), пары цветов, шрифты заголовков и текста, фон, карточки, углы и вид слайдов:
 * светлые, тёмные или как тема у зрителя. Наведение примеряет вариант на открытом слайде,
 * щелчок применяет его одним шагом (Ctrl+Z возвращает прежнее).
 */
import { icon } from '../components/icons';
import { previewAccent } from '../engine/accent';
import { replaceContents } from '../engine/data';
import { CARD_STYLES, hasThemeLook, lookFor, previewTheme, THEME_BGS, themeMode, themeVars, type SlideMode } from '../engine/deck-theme';
import { reducedMotion, staticSlide } from '../engine/deck-view';
import type { Editor } from '../engine/editor/editor';
import { fontItems, fontPicker, tryFontOn } from '../engine/editor/font-picker';
import { deckFonts, fontStack } from '../engine/fonts';
import { esc } from '../engine/html';
import { currentTheme, setTheme } from '../engine/theme';
import type { DarkLook, Deck, DeckTheme } from '../types';
import { logoMark, logoPlate } from '../engine/render';
import { logoImg } from '../components/templates/content';
import { logoColors } from './logo-colors';
import { showPopover } from './menu';
import { backdropStrip, bindBackdropStrip, bindTune, tuneHtml } from './backdrop-pick';
import { previewBackdrop } from '../components/backdrop/backdrop';
import { isBackdrop } from '../engine/backdrops';
import { addMyTheme, captureTheme, downloadTheme, downloadThemes, listMyThemes, MY, parseThemeFiles, registerMyFonts, removeMyTheme, sameTheme, type MyTheme } from './my-themes';
import { freeName } from './same';
import { registerThemeFonts, SPECIMEN, THEME_FONTS, THEME_PRESETS, themeFont, themeFontWeights, type ThemePreset } from './theme-presets';

interface Command {
  run(): void;
  enabled?(): boolean;
  active?(): boolean;
}

export interface DesignHost {
  deck: Deck;
  editor: Editor;
  /** Сцена студии: на ней примеряется тема */
  stage(): HTMLElement;
  /** Спросить название (сохранение своей темы) */
  askName(anchor: HTMLElement, title: string, note: string, suggestion: string, save: (name: string) => void): void;
}

/** Своя тема — как тема галереи: id «my:<id>» */
const asPreset = (m: MyTheme): ThemePreset & { my: MyTheme } => ({ id: MY + m.id, name: m.name, theme: m.theme, my: m });
/** Тема «Как в файле»: оформление исходного файла импортированной презентации (deck.origin) */
const FILE = 'file';
function fileTheme(deck: Deck): ThemePreset | null {
  const t = deck.origin?.theme;
  return t && typeof t === 'object' ? { id: FILE, name: 'Как в файле', theme: t } : null;
}
/** Тема галереи, своя или «Как в файле» — по id плитки */
function findTheme(deck: Deck, id: string | undefined): (ThemePreset & { my?: MyTheme }) | null {
  if (!id) return null;
  if (id === FILE) return fileTheme(deck);
  if (id.startsWith(MY)) {
    const m = listMyThemes().find((x) => MY + x.id === id);
    return m ? asPreset(m) : null;
  }
  return THEME_PRESETS.find((x) => x.id === id) ?? null;
}
/** Применить тему по id плитки (задаётся в designCommands) */
let applyById: ((id: string) => void) | null = null;
/** Свои темы поменялись — плитки на ленте перерисовываются */
let myVersion = 0;
/** Файлы тем (.json) → «Мои темы»: кнопка «Из файлов…», перетаскивание на студию и в галерею тем */
let importThemes: ((files: File[]) => Promise<void>) | null = null;
export const isThemeFile = (f: File) => /\.json$/i.test(f.name) || f.type === 'application/json';
export function importThemeFiles(files: File[]): void { void importThemes?.(files); }

const group = (label: string, body: string) =>
  `<div class="st-rgroup" role="group" aria-label="${esc(label)}"><div class="st-rgroup-body">${body}</div><div class="st-rgroup-label">${esc(label)}</div></div>`;

const btn = (cmd: string, ic: string, label: string, o: { big?: boolean; menu?: boolean; title?: string } = {}) =>
  `<button type="button" class="st-rb${o.big ? ' big' : ''}" data-cmd="${cmd}" title="${esc(o.title ?? label)}"${o.menu ? ' aria-haspopup="true" aria-expanded="false"' : ''}>`
  + `${icon(ic)}<span>${esc(label)}${o.menu ? '<b class="st-caret"></b>' : ''}</span></button>`;

const chk = (cmd: string, label: string, title: string) =>
  `<button type="button" class="st-rb st-chk" data-cmd="${cmd}" title="${esc(title)}"><i class="st-box">${icon('check')}</i><span>${esc(label)}</span></button>`;

/** Кнопка шрифта на ленте: что настраивает и каким шрифтом сейчас */
const fontBtn = (cmd: string, label: string, title: string) =>
  `<button type="button" class="st-rb st-dz-font" data-cmd="${cmd}" title="${esc(title)}" aria-haspopup="true" aria-expanded="false"><span>${esc(label)}</span><b></b><b class="st-caret"></b></button>`;

export function designTabHtml(): string {
  return '<button type="button" role="tab" data-tab="design" aria-selected="false">Дизайн</button>';
}

export function designPanelHtml(): string {
  return `<div class="st-rpanel" data-panel="design" hidden>
  ${group('Темы', `<div class="st-dz-strip" id="st-dz-strip" role="group" aria-label="Темы"></div>${btn('design.themes', 'grid', 'Все темы', { big: true, menu: true, title: 'Все темы на одном слайде-образце. Наведите — тема примерится на ваш слайд' })}`)}
  ${group('Цвета', `<label class="st-accent" title="Акцентный цвет презентации"><input type="color" id="st-accent" aria-label="Акцентный цвет"><span>Акцент</span></label>`
    + `<label class="st-accent" title="Второй цвет: акцентные заливки становятся градиентом от акцента к нему"><input type="color" id="st-accent2" aria-label="Второй цвет градиента"><span>Градиент</span></label>`
    + `<div class="st-rstack">${btn('design.palettes', 'fill', 'Палитры', { menu: true, title: 'Готовые пары цветов' })}${btn('design.accent2-off', 'close', 'Без градиента', { title: 'Ровный акцент без второго цвета' })}${chk('design.accent-flow', 'Переливание', 'Цвета градиента акцента плавно текут по акцентным элементам слайда')}</div>`)}
  ${group('Шрифты', `<div class="st-rstack st-dz-fonts">${fontBtn('design.font.head', 'Заголовки', 'Шрифт заголовков и крупных чисел')}${fontBtn('design.font.body', 'Текст', 'Шрифт текста презентации')}</div>`)}
  ${group('Оформление', btn('design.bg', 'image', 'Фон', { big: true, menu: true, title: 'Фон слайдов' }) + btn('design.cards', 'frame', 'Карточки', { big: true, menu: true, title: 'Вид карточек, таблиц и плашек' }) + btn('design.radius', 'corner', 'Углы', { big: true, menu: true, title: 'Скругление углов карточек и картинок' }) + btn('design.backdrop', 'play', 'Анимация', { big: true, menu: true, title: 'Анимированный фон всех слайдов: переливы, волны, звёзды, сеть… У отдельного слайда — свой в панели слайда' }) + btn('design.logo', 'sparkle', 'Логотип', { big: true, menu: true, title: 'Логотип: плашка в цветах темы или логотипа, знак в цвет темы, угол и размер, размер знака в плашке' }))}
  ${group('Слайды', `<div class="st-rstack">${chk('design.mode.auto', 'Как у зрителя', 'Слайды светлые или тёмные — как тема у того, кто смотрит')}${chk('design.mode.light', 'Всегда светлые', 'Слайды светлые при любой теме у зрителя')}${chk('design.mode.dark', 'Всегда тёмные', 'Слайды тёмные при любой теме у зрителя')}</div>`)}
</div>`;
}

/**
 * Примерка темы на открытом слайде целиком: палитра, шрифты, фон — и её анимированный фон.
 * У темы его нет — анимация прежней темы на время примерки прячется. Свой фон слайда важнее темы.
 * null — примерка заканчивается
 */
export function tryTheme(deck: Deck, stage: HTMLElement, t: DeckTheme | null): void {
  previewTheme(t, stage, deck.origin);
  if (!t) return previewBackdrop(stage, null);
  const idx = Number(stage.querySelector<HTMLElement>('.slide.on')?.dataset.index);
  const own = deck.slides[idx]?.backdrop;
  if (own === 'none' || isBackdrop(own)) return previewBackdrop(stage, null);
  // Фон того вида слайдов, что на экране: у тёмных он может быть своим (theme.darkLook)
  const tt = lookFor(t, shownMode(t));
  const was = lookFor(deck.theme ?? {}, shownMode(deck.theme));
  const want = isBackdrop(tt.backdrop) ? tt.backdrop : null;
  const look = { opacity: tt.backdropOpacity, speed: tt.backdropSpeed };
  const now = isBackdrop(was.backdrop) ? was.backdrop : null;
  // Тот же фон с тем же видом — живой остаётся, без мигания
  if (want === now && look.opacity === was.backdropOpacity && look.speed === was.backdropSpeed) return previewBackdrop(stage, null);
  previewBackdrop(stage, want ?? 'none', look);
}

/** Вид слайдов, которые видно сейчас: постоянный у темы или как у интерфейса */
const shownMode = (t: DeckTheme | undefined): SlideMode => themeMode(t) ?? currentTheme();

const decl = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');

/** Переменные темы для плитки (образец без слайда): в виде слайдов на экране или в заданном */
function tileStyle(t: DeckTheme, mode = shownMode(t)): string {
  const v = themeVars(t, mode);
  const head = t.head ? `"${t.head}", ` : t.font ? `"${t.font}", ` : '';
  return `${decl(v)};--tile-font:${head}var(--font-base, system-ui, sans-serif)`;
}

/** Тема из галереи, к которой относится оформление презентации ('' — своя, без галереи) */
function currentPreset(deck: Deck): string {
  if (!hasThemeLook(deck.theme)) return 'standard';
  return typeof deck.theme?.preset === 'string' ? deck.theme.preset : '';
}

/** Мини-образец темы на ленте: «Аа» шрифтом заголовков, полоса акцента и карточка */
function miniTile(p: ThemePreset, cur: string): string {
  return `<button type="button" class="st-dz-mini${p.id === cur ? ' active' : ''}" data-theme-id="${esc(p.id)}" title="${esc(p.name)}" aria-label="${esc(p.name)}">`
    + `<span class="st-dz-mini-in" style="${esc(tileStyle(p.theme))}"><b>Аа</b><i></i><u></u></span></button>`;
}

/** Презентация из одного слайда-образца в теме: для плиток большой галереи */
function specimenDeck(t: DeckTheme): Deck {
  return { title: 'Образец', theme: structuredClone(t), slides: [structuredClone(SPECIMEN)] };
}

/** Тема — в данные: рядом с brand, а не в конце файла; null — без темы */
function putTheme(d: Deck, t: DeckTheme | null): void {
  if (!t || !Object.keys(t).length) {
    delete d.theme;
    return;
  }
  if (!d.theme) {
    const entries = Object.entries(d);
    const at = entries.findIndex(([k]) => k === 'brand');
    entries.splice(at >= 0 ? at + 1 : Math.min(1, entries.length), 0, ['theme', {}]);
    replaceContents(d as unknown as Record<string, unknown>, Object.fromEntries(entries));
  }
  replaceContents(d.theme as unknown as Record<string, unknown>, t as unknown as Record<string, unknown>);
}

/** Шрифты, добавленные темами и больше нигде не нужные, уходят из списка (файлы остаются в assets) */
function dropUnusedThemeFonts(d: Deck): void {
  if (!Array.isArray(d.fonts)) return;
  const used = new Set([d.theme?.font, d.theme?.head].filter((x): x is string => typeof x === 'string'));
  const text = JSON.stringify(d.slides);
  d.fonts = d.fonts.filter((f) => f.from !== 'theme' || used.has(f.name) || text.includes(f.name));
  if (!d.fonts.length) delete d.fonts;
}

/** Применение с плавной сменой вида (View Transitions), если она есть и движение не отключено */
function smoothly(fn: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reducedMotion()) doc.startViewTransition(fn);
  else fn();
}

/** Готовые пары цветов: акцент и второй цвет градиента */
const PALETTES: [string, string | null, string][] = [
  ['#2563EB', null, 'Синий'], ['#4F46E5', '#06B6D4', 'Индиго и бирюза'], ['#7C3AED', '#EC4899', 'Фиолетовый и розовый'],
  ['#0D9488', '#34D399', 'Бирюзовый'], ['#16A34A', '#A3E635', 'Зелёный'], ['#0369A1', '#14B8A6', 'Океан'],
  ['#E11D48', null, 'Красный'], ['#DB2777', '#F97316', 'Закат'], ['#EA580C', '#FACC15', 'Солнечный'],
  ['#C9A227', '#F3D98B', 'Золото'], ['#0EA5E9', '#6366F1', 'Небо'], ['#334155', null, 'Графит'],
];

/** Логотип в углу обычных слайдов: угол и размер */
const CORNER_POS: [string, string][] = [['tl', 'Слева вверху'], ['tr', 'Справа вверху'], ['bl', 'Слева внизу'], ['br', 'Справа внизу']];
const CORNER_SIZE: [string, string][] = [['s', 'Маленький'], ['', 'Обычный'], ['l', 'Крупный']];
/** Размер знака в плашке (brand.mark): доля стороны плашки; '' — по умолчанию, 70 % */
const MARKS: [string, string][] = [['0.45', 'Знак 45 % плашки'], ['0.55', 'Знак 55 % плашки'], ['', 'Знак 70 % плашки — обычный'], ['0.85', 'Знак 85 % плашки']];

/** Скругление углов: множитель и название */
const RADII: [number, string][] = [[0, 'Прямые'], [0.5, 'Небольшие'], [1, 'Обычные'], [1.5, 'Мягкие'], [2, 'Круглые']];

export function designCommands(h: DesignHost): Record<string, Command> {
  const { deck, editor: ed } = h;
  registerThemeFonts();
  // Шрифты тем — в списках шрифтов редактора (копируются в презентацию при выборе)
  ed.themeFonts = { names: Object.keys(THEME_FONTS), get: themeFont, weights: themeFontWeights };
  const theme = (): DeckTheme => deck.theme ?? {};
  const anchor = (cmd: string) => [...document.querySelectorAll<HTMLElement>(`.st-ribbon [data-cmd="${cmd}"]`)].find((b) => b.offsetParent) ?? null;

  /** Правка темы одним шагом; undefined убирает поле */
  const patch = (p: Partial<Record<keyof DeckTheme, unknown>>, add: Deck['fonts'] = []) => {
    ed.commit((d) => {
      const t: Record<string, unknown> = { ...(d.theme ?? {}) };
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined || v === null || v === '') delete t[k];
        else t[k] = v;
      }
      if (add?.length) d.fonts = [...(Array.isArray(d.fonts) ? d.fonts : []), ...add];
      putTheme(d, t as DeckTheme);
      dropUnusedThemeFonts(d);
    }, { rebuild: true });
  };

  /** Шрифты темы — в презентацию (если их ещё нет) и в браузер: смена вида без мигания букв */
  const fontsFor = async (names: (string | undefined)[]): Promise<NonNullable<Deck['fonts']> | null> => {
    const list = [...new Set(names.filter((n): n is string => !!n))];
    try {
      const add = await ed.importFonts(list.map(themeFont).filter((f): f is NonNullable<typeof f> => !!f));
      await Promise.all(list.map((n) => document.fonts.load(`600 40px "${n}"`).catch(() => [])));
      return add;
    } catch (e) {
      ed.toast(`Не удалось добавить шрифт темы: ${(e as Error).message}`, 5000, true);
      return null;
    }
  };

  /** Свои шрифты своей темы — файлами в assets/ презентации (если таких ещё нет) */
  const ownFonts = async (m: MyTheme | undefined): Promise<NonNullable<Deck['fonts']>> => {
    const out: NonNullable<Deck['fonts']> = [];
    for (const f of m?.fonts ?? []) {
      if (deck.fonts?.some((x) => x.name === f.name && (x.weight ?? 400) === (f.weight ?? 400) && (x.style ?? '') === (f.style ?? ''))) continue;
      const blob = await (await fetch(f.data)).blob();
      const src = await ed.storeAsset(blob, f.file);
      out.push({ name: f.name, src, ...(f.weight ? { weight: f.weight } : {}), ...(f.style ? { style: f.style } : {}) });
    }
    return out;
  };

  const applyPreset = async (p: ThemePreset & { my?: MyTheme }) => {
    tryTheme(deck, h.stage(), null);
    let add = p.id === 'standard' ? [] : await fontsFor([p.theme.font, p.theme.head]);
    if (!add) return;
    if (p.my) {
      try {
        add = [...add, ...await ownFonts(p.my)];
      } catch (e) {
        ed.toast(`Не удалось добавить шрифт темы: ${(e as Error).message}`, 5000, true);
        return;
      }
    }
    smoothly(() => ed.commit((d) => {
      putTheme(d, p.id === 'standard' ? null : { preset: p.id, ...structuredClone(p.theme) });
      if (add.length) d.fonts = [...(Array.isArray(d.fonts) ? d.fonts : []), ...add];
      dropUnusedThemeFonts(d);
    }, { rebuild: true }));
    ed.toast(p.id === 'standard' ? 'Стандартное оформление' : `Тема «${p.name}». Вернуть прежнюю: Ctrl+Z`, 2200);
  };

  /** Примерка при наведении: на открытом слайде, пока указатель над вариантом */
  const tryOn = (t: DeckTheme | null) => tryTheme(deck, h.stage(), t);

  /** Наведение и уход с вариантов всплывающей панели: примерка темы */
  const hoverTry = (el: HTMLElement, sel: string, make: (b: HTMLElement) => DeckTheme | null) => {
    el.addEventListener('pointerover', (e) => {
      const b = (e.target as Element).closest<HTMLElement>(sel);
      if (b) tryOn(make(b));
    });
    el.addEventListener('pointerleave', () => tryOn(null));
    // Панель закрылась (выбор, Esc, щелчок мимо) — примерка заканчивается
    new MutationObserver((_m, o) => {
      if (!el.isConnected) { tryOn(null); o.disconnect(); }
    }).observe(document.body, { childList: true });
  };

  // ---------- галерея тем ----------
  const gallery = () => {
    const at = anchor('design.themes');
    if (!at) return;
    const cur = currentPreset(deck);
    const mine = listMyThemes();
    registerMyFonts(mine);
    const tile = (p: ThemePreset, my = false) => {
      const m = themeMode(p.theme);
      return `<div class="st-dz-cell"><button type="button" class="st-dz-tile${p.id === cur ? ' active' : ''}" data-theme-id="${esc(p.id)}" role="option" aria-selected="${p.id === cur}">`
        + `<span class="st-dz-shot"></span><span class="st-dz-name">${esc(p.name)}${m ? `<i title="${m === 'dark' ? 'Тёмные слайды' : 'Светлые слайды'}">${icon(m === 'dark' ? 'moon' : 'sun')}</i>` : ''}</span></button>`
        + (my ? `<span class="st-dz-acts"><button type="button" data-my="file" data-id="${esc(p.id)}" title="Файл темы — поделиться">${icon('save')}</button><button type="button" data-my="del" data-id="${esc(p.id)}" title="Удалить тему">${icon('trash')}</button></span>` : '')
        + '</div>';
    };
    // Своё оформление, ещё не сохранённое темой, — предложение сохранить
    const unsaved = hasThemeLook(deck.theme) && !cur.startsWith(MY) && !THEME_PRESETS.some((p) => p.id === cur);
    const html = `<div class="st-dz-sec"><b>Мои темы</b><span>`
      + (mine.length > 1 ? `<button type="button" class="st-link" data-my="pack" title="Все свои темы одним файлом — перенести на другой компьютер">Все в файл</button>` : '')
      + `<button type="button" class="st-link" data-my="load" title="Можно выбрать несколько файлов или перетащить их сюда">Из файлов…</button></span></div>`
      + `<div class="st-dz-gal" role="listbox" aria-label="Мои темы">`
      + `<button type="button" class="st-dz-add${unsaved ? ' hint' : ''}" data-my="save">${icon('plus')}<b>Сохранить текущую</b><small>${unsaved ? 'Оформление презентации — темой для других презентаций' : 'Цвета, шрифты, фон, карточки и углы этой презентации'}</small></button>`
      + `${mine.map((m) => tile(asPreset(m), true)).join('')}</div>`
      + `<div class="st-dz-sec"><b>Темы Slideria</b></div>`
      + `<div class="st-dz-gal" role="listbox" aria-label="Темы">${[fileTheme(deck), ...THEME_PRESETS].filter((p): p is ThemePreset => !!p).map((p) => tile(p)).join('')}</div>`;
    const el = showPopover(at, html, (b) => {
      const act = b.dataset.my;
      if (act === 'save') return { run: () => saveTheme(at) };
      if (act === 'load') return { run: () => loadTheme() };
      if (act === 'pack') return { run: () => downloadThemes(listMyThemes()), keep: true };
      if (act === 'file') return { run: () => { const p = findTheme(deck, b.dataset.id); if (p?.my) downloadTheme(p.my); }, keep: true };
      if (act === 'del') {
        return { run: () => {
          const p = findTheme(deck, b.dataset.id);
          if (!p?.my) return;
          removeMyTheme(p.my.id);
          myVersion++;
          b.closest('.st-dz-cell')?.remove();
          ed.toast(`Тема «${p.name}» удалена`, 2000);
        }, keep: true };
      }
      const p = findTheme(deck, b.dataset.themeId);
      return p ? { run: () => void applyPreset(p) } : null;
    }, 'st-dz-galpop');
    // Справа: открытый слайд в середине окна остаётся на виду — на нём примеряется тема
    el.style.left = `${Math.max(8, innerWidth - el.offsetWidth - 12)}px`;
    el.querySelectorAll<HTMLElement>('.st-dz-tile').forEach((b) => {
      const p = findTheme(deck, b.dataset.themeId);
      if (p) b.querySelector('.st-dz-shot')!.appendChild(staticSlide(specimenDeck(p.theme), 0, 284));
    });
    hoverTry(el, '.st-dz-tile', (b) => findTheme(deck, b.dataset.themeId)?.theme ?? null);
    // Файлы тем можно бросить прямо в галерею — она откроется заново уже с ними
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      el.classList.add('st-drop');
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget as Node)) el.classList.remove('st-drop'); });
    el.addEventListener('drop', (e) => {
      el.classList.remove('st-drop');
      const files = [...(e.dataTransfer?.files ?? [])].filter(isThemeFile);
      if (!files.length) return;
      e.preventDefault();
      void importThemes?.(files).then(() => gallery());
    });
  };

  // ---------- анимация фона всех слайдов ----------
  /** «Для тёмных» — свой фон у тёмных слайдов: «Без фона» у них — none, тот же, что у всех, — своё убирается */
  const BD_KEYS: (keyof DarkLook)[] = ['backdrop', 'backdropOpacity', 'backdropSpeed'];
  const backdropMenu = (dark = darkFirst(BD_KEYS)) => {
    const at = anchor('design.backdrop');
    if (!at) return;
    const t = theme();
    const head = scope(BD_KEYS, dark, backdropMenu);
    const inDark = dark && !!head;
    const d = inDark ? lookFor(t, 'dark') : t;
    const tune = isBackdrop(d.backdrop) ? tuneHtml({ backdropOpacity: d.backdropOpacity ?? 1, backdropSpeed: d.backdropSpeed ?? 1 }) : '';
    const el = showPopover(at, `${head?.html ?? '<div class="st-plabel">Анимация фона всех слайдов</div>'}${backdropStrip(d.backdrop ?? '')}${tune}<p class="st-bdnote">Наведите — фон примерится на слайде. У отдельного слайда фон меняется в панели слайда</p>`, (b) => {
      if (b.dataset.scope) return head?.pick(b) ?? null;
      const v = b.dataset.backdrop;
      if (v === undefined) return null;
      if (!inDark) return { run: () => patch({ backdrop: v || undefined }) };
      return { run: () => patchDark({ backdrop: v === (t.backdrop ?? '') ? undefined : v || 'none' }) };
    }, 'st-bdpop');
    bindBackdropStrip(el, h.stage);
    // У тёмных — своё значение; совпало с общим — своё убирается (1 у ползунка — «по умолчанию»)
    bindTune(el, h.stage, (k, v) => {
      if (!inDark) return patch({ [k]: v });
      const key = k as 'backdropOpacity' | 'backdropSpeed';
      patchDark({ [key]: (v ?? 1) === (t[key] ?? 1) ? undefined : v ?? 1 });
    });
  };

  // ---------- свои темы ----------
  const saveTheme = (at: HTMLElement) => {
    if (!hasThemeLook(deck.theme)) {
      ed.toast('Сначала оформите презентацию: тема, цвета, шрифты или фон — на этой вкладке', 3500);
      return;
    }
    const base = findTheme(deck, currentPreset(deck));
    const suggestion = base?.my ? base.name : base && base.id !== FILE ? `${base.name} (своя)` : deck.title ? `Тема «${deck.title}»`.slice(0, 50) : 'Моя тема';
    h.askName(at, 'Сохранить тему', 'Цвета, шрифты (вместе с файлами), фон, карточки, углы и вид слайдов — в «Мои темы» для любой презентации.', suggestion, (name) => void (async () => {
      const t = await captureTheme(deck, name);
      // Такая тема уже есть (под любым именем) — второй не появляется: презентация отмечается ею
      const twin = sameTheme(t);
      if (twin) {
        ed.commit((d) => { if (d.theme) d.theme.preset = MY + twin.id; }, { rebuild: false, merge: 'theme-preset' });
        ed.toast(`Такая тема уже есть в «Моих темах» — «${twin.name}»`, 3500);
        return;
      }
      // То же имя — обновление темы, а не вторая с тем же названием
      const same = listMyThemes().find((x) => x.name === name);
      if (same) t.id = same.id;
      if (!addMyTheme(t)) { ed.toast('Не хватило места в браузере: удалите ненужные темы или шаблоны', 5000, true); return; }
      myVersion++;
      ed.commit((d) => { if (d.theme) d.theme.preset = MY + t.id; }, { rebuild: false, merge: 'theme-preset' });
      ed.toast(`Тема «${name}» ${same ? 'обновлена' : 'сохранена'} — она в «Все темы» и в ряду тем на ленте`, 3000);
    })());
  };
  /**
   * Одна тема — добавляется и сразу применяется; несколько (файлов или в наборе) — только добавляются.
   * Тема, которая уже есть (то же содержимое под любым именем), второй раз не добавляется;
   * другая тема с занятым именем получает номер: «Тема (2)»
   */
  importThemes = async (files) => {
    const added: MyTheme[] = [];
    const known: MyTheme[] = [];
    const bad: string[] = [];
    for (const f of files) {
      try {
        for (const t of parseThemeFiles(await f.text())) {
          const list = listMyThemes();
          const twin = sameTheme(t, list);
          if (twin) { if (!known.includes(twin)) known.push(twin); continue; }
          t.name = freeName(t.name, list.map((x) => x.name));
          if (!addMyTheme(t)) throw new Error('не хватило места в браузере');
          added.push(t);
        }
      } catch (e) {
        bad.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (added.length) {
      myVersion++;
      registerMyFonts(added);
    }
    // Одна тема (новая или уже бывшая) — применяется
    const one = added.length + known.length === 1 ? added[0] ?? known[0] : null;
    if (one) await applyPreset(asPreset(one));
    const list = (l: MyTheme[]) => l.map((t) => `«${t.name}»`).join(', ');
    const parts = [
      added.length > 1 ? `Добавлено тем: ${added.length} — ${list(added)}. Они в «Все темы» → «Мои темы»` : added.length ? `Тема ${list(added)} добавлена в «Мои темы»${one ? ' и применена' : ''}` : '',
      known.length ? `${known.length > 1 ? 'Уже есть в «Моих темах»' : 'Такая тема уже есть в «Моих темах»'}: ${list(known)}${one ? ' — применена' : ''}` : '',
      bad.length ? `Не загрузилось — ${bad.join('; ')}` : '',
    ].filter(Boolean);
    if (parts.length) ed.toast(parts.join('. '), bad.length || parts.length > 1 ? 6000 : 3500, !!bad.length);
  };
  const loadTheme = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = '.json,application/json';
    inp.onchange = () => { if (inp.files?.length) void importThemes?.([...inp.files]); };
    inp.click();
  };
  applyById = (id) => { const p = findTheme(deck, id); if (p) void applyPreset(p); };

  // ---------- палитры ----------
  const palettes = () => {
    const at = anchor('design.palettes');
    if (!at) return;
    const own = THEME_PRESETS.find((p) => p.id === deck.theme?.preset && p.theme.accent);
    const mine: [string, string | null, string] | null = own ? [own.theme.accent!, own.theme.accent2 ?? null, `Как в теме «${own.name}»`] : null;
    const list: [string, string | null, string][] = [
      ...(mine ? [mine] : []),
      // Пара темы уже первая — без повтора
      ...PALETTES.filter(([c1, c2]) => !mine || c1 !== mine[0].toUpperCase() || c2 !== (mine[1]?.toUpperCase() ?? null)),
    ];
    const a = theme().accent?.toUpperCase();
    const a2 = theme().accent2?.toUpperCase() ?? null;
    const html = `<div class="st-dz-pals">${list.map(([c1, c2, name], k) =>
      `<button type="button" class="st-dz-pal${c1 === a && c2 === a2 ? ' active' : ''}" data-k="${k}" title="${esc(name)}" aria-label="${esc(name)}" style="--c1:${c1};--c2:${c2 ?? c1}"><i></i></button>`).join('')}</div>`;
    const el = showPopover(at, html, (b) => {
      const p = list[Number(b.dataset.k)];
      return p ? { run: () => patch({ accent: p[0], accent2: p[1] ?? undefined, accentFlow: p[1] ? theme().accentFlow : undefined }) } : null;
    });
    el.addEventListener('pointerover', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.st-dz-pal');
      const p = b ? list[Number(b.dataset.k)] : null;
      if (p) previewAccent(p[0], h.stage(), p[1], true);
    });
    el.addEventListener('pointerleave', () => ed.endAccentPreview());
    new MutationObserver((_m, o) => {
      if (!el.isConnected) { ed.endAccentPreview(); o.disconnect(); }
    }).observe(document.body, { childList: true });
  };

  // ---------- шрифты ----------
  const pickFont = (key: 'head' | 'font') => {
    const at = anchor(key === 'head' ? 'design.font.head' : 'design.font.body');
    if (!at) return;
    const first = key === 'head'
      ? { value: '', label: 'Как у текста', css: 'inherit', group: '' }
      : { value: '', label: 'Шрифт по умолчанию', css: 'var(--font-base)', group: '' };
    // Наведение — открытый слайд сразу этим шрифтом (заголовки или весь текст)
    const slide = h.stage().querySelector<HTMLElement>(':scope > .slide.on');
    const prop = key === 'head' ? '--font-head' : '--font';
    fontPicker().toggle(at, () => fontItems([first], ed.fontChoices(), fontStack), theme()[key] ?? '', (name) => void setFont(key, name),
      (f) => tryFontOn(slide, prop, f ? (f.value ? f.css : key === 'head' ? 'var(--font)' : 'var(--font-base)') : null));
  };
  const setFont = async (key: 'head' | 'font', name: string) => {
    if (!name) return patch({ [key]: undefined });
    const own = deckFonts(deck.fonts).some((f) => f.name.trim() === name);
    if (!own && themeFont(name)) {
      const add = await fontsFor([name]);
      if (add) patch({ [key]: name }, add);
      return;
    }
    // Шрифт библиотеки или компьютера — копией в презентацию, как в списке шрифтов текста
    if (!own && !(await ed.ensureFont(name))) return;
    patch({ [key]: name });
  };

  // ---------- своё у тёмных слайдов (theme.darkLook) ----------
  const darkLook = (): DarkLook => { const d = theme().darkLook; return d && typeof d === 'object' ? d : {}; };
  const ownDark = (keys: (keyof DarkLook)[]) => keys.some((k) => darkLook()[k] !== undefined);
  /** Своё у тёмных одним шагом; undefined убирает поле — у тёмных снова как у всех */
  const patchDark = (p: Partial<Record<keyof DarkLook, unknown>>) => {
    const d: Record<string, unknown> = { ...darkLook() };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === null || v === '') delete d[k];
      else d[k] = v;
    }
    patch({ darkLook: Object.keys(d).length ? d : undefined });
  };
  /** Открыть сразу «Для тёмных»: на экране тёмные слайды, и у них уже своё */
  const darkFirst = (keys: (keyof DarkLook)[]) => !themeMode(deck.theme) && currentTheme() === 'dark' && ownDark(keys);
  /**
   * Над вариантами — «Для всех | Для тёмных», если слайды бывают и светлыми, и тёмными (вид не постоянный).
   * Точка у «Для тёмных» — у них своё; «Как у всех» убирает своё. Выбор «Для тёмных» включает тёмную
   * тему студии: правится то, что видно
   */
  const scope = (keys: (keyof DarkLook)[], dark: boolean, reopen: (dark: boolean) => void) => {
    if (themeMode(deck.theme)) return null;
    const own = ownDark(keys);
    const tab = (v: string, label: string, on: boolean, title: string) =>
      `<button type="button" role="tab" data-scope="${v}" aria-selected="${on}" title="${esc(title)}">${label}</button>`;
    const reset = '<button type="button" class="st-link" data-scope="reset" title="Убрать своё у тёмных слайдов">Как у всех</button>';
    const note = dark ? (own ? `Своё у тёмных · ${reset}` : 'Сейчас как у всех') : own ? `${icon('moon')}У тёмных — своё · ${reset}` : '';
    return {
      html: `<div class="st-dz-scope"><div class="st-seg" role="tablist" aria-label="Для каких слайдов">`
        + tab('all', 'Для всех', !dark, own ? 'Для светлых слайдов (у тёмных — своё)' : 'Для светлых и тёмных слайдов')
        + tab('dark', `${icon('moon')}Для тёмных${own ? '<i class="st-dz-dot"></i>' : ''}`, dark, 'Своё у тёмных слайдов: у светлых остаётся как есть')
        + `</div>${note ? `<span>${note}</span>` : ''}</div>`,
      pick: (b: HTMLElement) => {
        const v = b.dataset.scope;
        if (v === 'all') return { run: () => reopen(false) };
        if (v === 'dark') return { run: () => { if (currentTheme() !== 'dark') setTheme('dark'); reopen(true); } };
        if (v === 'reset') return { run: () => patchDark(Object.fromEntries(keys.map((k) => [k, undefined]))) };
        return null;
      },
    };
  };

  // ---------- фон, карточки, углы ----------
  /**
   * Всплывающая панель вариантов: образцы в цветах темы, наведение — примерка, щелчок — выбор.
   * head — строка над вариантами (для всех или для тёмных) и её кнопки; mode — в каком виде образцы
   */
  const options = <T>(cmd: string, items: [T, string][], cur: T, make: (v: T) => DeckTheme, sample: (v: T) => string, apply: (v: T) => void, cls: string,
    head: ReturnType<typeof scope> = null, mode?: SlideMode) => {
    const at = anchor(cmd);
    if (!at) return;
    const html = `${head?.html ?? ''}<div class="st-dz-opts ${cls}">${items.map(([v, name], k) =>
      `<button type="button" class="st-dz-opt${v === cur ? ' active' : ''}" data-k="${k}"><span class="st-dz-opt-in" style="${esc(tileStyle(make(v), mode))}">${sample(v)}</span><small>${esc(name)}</small></button>`).join('')}</div>`;
    const el = showPopover(at, html, (b) => {
      if (b.dataset.scope) return head?.pick(b) ?? null;
      const it = items[Number(b.dataset.k)];
      return it ? { run: () => apply(it[0]) } : null;
    });
    hoverTry(el, '.st-dz-opt', (b) => {
      const it = items[Number(b.dataset.k)];
      return it ? make(it[0]) : null;
    });
  };
  const card = '<i class="st-dz-card"><b></b><b></b></i>';

  /**
   * Фон или карточки: для всех слайдов или своё у тёмных. «Для тёмных» — образцы тёмные, выбор пишется
   * в theme.darkLook (тот же, что у всех, — своё убирается)
   */
  const themed = (cmd: string, key: 'bg' | 'cards', items: [string, string][], def: string, sample: () => string, cls: string, dark = darkFirst([key])) => {
    const base = theme()[key] ?? def;
    const own = darkLook()[key];
    const head = scope([key], dark, (d) => themed(cmd, key, items, def, sample, cls, d));
    if (!dark || !head) {
      // Своё у тёмных есть — образцы «для всех» светлые: у тёмных на экране было бы своё
      // Обычные карточки — без поля; фон пишется всегда (как раньше)
      return options(cmd, items, base, (v) => ({ ...theme(), [key]: v }), sample, (v) => patch({ [key]: key === 'cards' && v === def ? undefined : v }), cls, head, head && ownDark([key]) ? 'light' : undefined);
    }
    options(cmd, items, own ?? base, (v) => ({ ...theme(), darkLook: { ...darkLook(), [key]: v } }), sample,
      (v) => patchDark({ [key]: v === base ? undefined : v }), cls, head, 'dark');
  };

  const setMode = (m: SlideMode | null) => smoothly(() => patch({ mode: m ?? undefined }));

  // ---------- плашка логотипа ----------
  const setPlate = (plate: NonNullable<Deck['brand']>['plate'] | null, tint = false) => ed.commit((d) => {
    if (!d.brand) return;
    if (plate) d.brand.plate = plate;
    else delete d.brand.plate;
    if (tint) d.brand.tint = true;
    else delete d.brand.tint;
  }, { rebuild: true });
  /** Примерка плашки на открытом слайде: переменные --lp-* у слайда, null — как в данных */
  const tryPlate = (vars: Record<string, string> | null) => {
    const slide = h.stage().querySelector<HTMLElement>('.slide.on');
    if (!slide) return;
    for (const k of ['--lp-bg', '--lp-bd', '--lp-glow']) slide.style.removeProperty(k);
    if (vars) for (const [k, v] of Object.entries(vars)) slide.style.setProperty(k, v);
    else {
      const own = logoPlate(deck);
      if (own) for (const part of own.split(';')) { const [k, v] = part.split(':'); slide.style.setProperty(k, v); }
    }
  };
  const markKey = () => { const m = logoMark(deck); return m === undefined || m === 0.7 ? '' : String(m); };
  const setMark = (v: string) => ed.commit((d) => {
    if (!d.brand) return;
    if (v) d.brand.mark = Number(v);
    else delete d.brand.mark;
  }, { rebuild: true });
  /** Примерка размера знака: --logo-mark у открытого слайда; без значения — как в данных */
  const tryMark = (v?: string) => {
    const slide = h.stage().querySelector<HTMLElement>('.slide.on');
    if (!slide) return;
    const m = v === undefined ? logoMark(deck) : v ? Number(v) : undefined;
    if (m === undefined) slide.style.removeProperty('--logo-mark');
    else slide.style.setProperty('--logo-mark', `${Math.round(m * 100)}%`);
  };
  const corner = () => deck.brand?.corner ?? {};
  const setCorner = (p: { pos?: string; size?: string }) => ed.commit((d) => {
    if (!d.brand) return;
    const c: Record<string, unknown> = { ...(d.brand.corner ?? {}), ...p };
    if (c.pos === 'tr') delete c.pos;
    if (!c.size) delete c.size;
    if (Object.keys(c).length) d.brand.corner = c as NonNullable<Deck['brand']>['corner'];
    else delete d.brand.corner;
  }, { rebuild: true });
  const logoMenu = async () => {
    const at = anchor('design.logo');
    const logo = deck.brand?.logo;
    if (!at) return;
    if (!logo) return ed.pickImage(['brand', 'logo']);
    let pal: Awaited<ReturnType<typeof logoColors>>;
    try { pal = await logoColors(logo); } catch (e) { return ed.toast(`Не удалось прочитать логотип: ${(e as Error).message}`, 4000, true); }
    const fromLogo = deck.brand?.plate?.from === 'logo';
    const tinted = deck.brand?.tint === true;
    // Образцы — тем же логотипом на фоне слайда темы; у «из темы» — переменные темы, у «из логотипа» — свои,
    // «в цвет темы» — знак градиентом акцента на плашке цвета карточки
    const mk = logoMark(deck);
    const sample = (vars: string, tint = false) => `<span class="st-dz-opt-in" style="${esc(`${tileStyle(theme())};${vars}${mk === undefined ? '' : `;--logo-mark:${Math.round(mk * 100)}%`}`)}"><i class="st-dz-plate${tint ? ' tint' : ''}">${logoImg(logo, undefined, tint)}</i></span>`;
    const logoVars = `--lp-bg:${pal.bg};--lp-bd:${pal.border};--lp-glow:${pal.glow}`;
    const el = showPopover(at, `<div class="st-dz-opts radii">`
      + `<button type="button" class="st-dz-opt${fromLogo || tinted ? '' : ' active'}" data-k="theme">${sample('')}<small>Из темы</small></button>`
      + `<button type="button" class="st-dz-opt${fromLogo && !tinted ? ' active' : ''}" data-k="logo">${sample(logoVars)}<small>Из логотипа</small></button>`
      + `<button type="button" class="st-dz-opt${tinted ? ' active' : ''}" data-k="tint" title="Одноцветный знак с прозрачным фоном перекрашивается в цвета темы">${sample('', true)}<small>В цвет темы</small></button></div>`
      // Угол и размер на обычных слайдах
      + `<div class="st-dz-corners">${CORNER_POS.map(([v, l]) => `<button type="button" class="st-dz-corner${(corner().pos ?? 'tr') === v ? ' active' : ''}" data-pos="${v}" title="${l}" aria-label="${l}"><i class="at-${v}"></i></button>`).join('')}`
      + `<span class="st-dz-sep"></span>${CORNER_SIZE.map(([v, l]) => `<button type="button" class="st-dz-corner${(corner().size ?? '') === v ? ' active' : ''}" data-size="${v}" title="${l}" aria-label="${l}"><i class="at-tr size-${v || 'm'}"></i></button>`).join('')}</div>`
      // Размер знака внутри плашки — отдельно от плашки
      + `<div class="st-dz-corners"><span class="st-dz-lbl">Знак</span>${MARKS.map(([v, l]) => `<button type="button" class="st-dz-corner st-dz-mark${markKey() === v ? ' active' : ''}" data-mark="${v}" title="${l}" aria-label="${l}"><i style="--m:${Math.round(Number(v || 0.7) * 100)}%"></i></button>`).join('')}</div>`, (b) => {
      if (b.dataset.k === 'theme') return { run: () => setPlate(null) };
      if (b.dataset.k === 'logo') return { run: () => setPlate({ from: 'logo', src: logo, ...pal }) };
      if (b.dataset.k === 'tint') return { run: () => setPlate(null, true) };
      if (b.dataset.pos) return { run: () => setCorner({ pos: b.dataset.pos }) };
      if (b.dataset.size !== undefined) return { run: () => setCorner({ size: b.dataset.size }) };
      if (b.dataset.mark !== undefined) return { run: () => setMark(b.dataset.mark!) };
      return null;
    });
    /** Примерка угла и размера: классы у логотипа на открытом слайде */
    const tryCorner = (pos?: string, size?: string) => {
      const el2 = h.stage().querySelector<HTMLElement>('.slide.on > .corner-logo');
      if (!el2) return;
      el2.classList.remove('at-tl', 'at-tr', 'at-bl', 'at-br', 'size-s', 'size-l');
      el2.classList.add(`at-${pos ?? corner().pos ?? 'tr'}`);
      const sz = size ?? corner().size;
      if (sz) el2.classList.add(`size-${sz}`);
    };
    el.addEventListener('pointerover', (e) => {
      const t = (e.target as Element).closest<HTMLElement>('[data-k], [data-pos], [data-size], [data-mark]');
      const k = t?.dataset.k;
      if (k === 'logo') tryPlate({ '--lp-bg': pal.bg, '--lp-bd': pal.border, '--lp-glow': pal.glow });
      else if (k === 'theme') tryPlate({});
      else if (t?.dataset.pos) tryCorner(t.dataset.pos);
      else if (t?.dataset.size !== undefined) tryCorner(undefined, t.dataset.size);
      else if (t?.dataset.mark !== undefined) tryMark(t.dataset.mark);
    });
    el.addEventListener('pointerleave', () => { tryPlate(null); tryCorner(); tryMark(); });
    new MutationObserver((_m, o) => { if (!el.isConnected) { tryPlate(null); tryCorner(); tryMark(); o.disconnect(); } }).observe(document.body, { childList: true });
  };

  const cmds: Record<string, Command> = {
    'design.themes': { run: gallery },
    'design.palettes': { run: palettes },
    'design.font.head': { run: () => pickFont('head') },
    'design.font.body': { run: () => pickFont('font') },
    'design.bg': { run: () => themed('design.bg', 'bg', Object.entries(THEME_BGS).map(([k, b]) => [k, b.name] as [string, string]), 'dots', () => '', 'bgs') },
    'design.cards': { run: () => themed('design.cards', 'cards', Object.entries(CARD_STYLES).map(([k, c]) => [k, c.name] as [string, string]), 'soft', () => card, 'cards') },
    'design.radius': {
      run: () => options('design.radius', RADII, typeof theme().radius === 'number' ? theme().radius! : 1,
        (v) => ({ ...theme(), radius: v }), () => card, (v) => patch({ radius: v === 1 ? undefined : v }), 'radii'),
    },
    // Логотипа нет — кнопка его добавляет (файл картинки), есть — плашка, цвет, угол и размер
    'design.logo': { run: () => (deck.brand?.logo ? void logoMenu() : ed.pickImage(['brand', 'logo'])) },
    'design.backdrop': { run: () => backdropMenu(), active: () => isBackdrop(theme().backdrop) || isBackdrop(darkLook().backdrop) },
    'design.mode.auto': { run: () => setMode(null), active: () => !themeMode(deck.theme) },
    'design.mode.light': { run: () => setMode('light'), active: () => themeMode(deck.theme) === 'light' },
    'design.mode.dark': { run: () => setMode('dark'), active: () => themeMode(deck.theme) === 'dark' },
  };
  // Темы по имени: плитки на ленте и палитра команд (Ctrl+K)
  for (const p of THEME_PRESETS) cmds[`design.preset.${p.id}`] = { run: () => void applyPreset(p), active: () => currentPreset(deck) === p.id };
  cmds['design.theme.save'] = { run: () => { const at = anchor('design.themes'); if (at) saveTheme(at); }, enabled: () => hasThemeLook(deck.theme) };
  cmds['design.theme.load'] = { run: loadTheme };
  return cmds;
}

/** Логотип, под который сейчас подбираются цвета плашки (чтобы не подбирать дважды) */
let replating = '';

/** Состояние вкладки: плитки тем (в текущем виде слайдов) и названия шрифтов на кнопках */
let stripKey = '';
export function syncDesignTab(h: DesignHost): void {
  const strip = document.getElementById('st-dz-strip');
  if (!strip) return;
  const cur = currentPreset(h.deck);
  const file = fileTheme(h.deck);
  const key = `${currentTheme()}|${cur}|${myVersion}|${file ? JSON.stringify(file.theme) : ''}`;
  if (key !== stripKey) {
    stripKey = key;
    const mine = listMyThemes();
    registerMyFonts(mine);
    // Свои темы — первыми: ими пользуются чаще
    // Тема исходного файла (импорт из PowerPoint) — самой первой: к ней возвращаются
    strip.innerHTML = (file ? miniTile(file, cur) : '') + mine.map((m) => miniTile(asPreset(m), cur)).join('') + THEME_PRESETS.map((p) => miniTile(p, cur)).join('');
  }
  const t = h.deck.theme ?? {};
  const label = (cmd: string, name: string | undefined, none: string) => {
    const b = document.querySelector<HTMLElement>(`.st-ribbon [data-cmd="${cmd}"] b:not(.st-caret)`);
    if (!b) return;
    b.textContent = name || none;
    b.style.fontFamily = name ? fontStack(name) : '';
  };
  label('design.font.head', t.head, t.font ? 'Как у текста' : 'Обычный');
  label('design.font.body', t.font, 'Обычный');
  // Сменили логотип, а плашка была в его цветах — цвета подбираются заново по новому файлу
  const plate = h.deck.brand?.plate;
  const logo = h.deck.brand?.logo;
  if (plate?.from === 'logo' && logo && plate.src !== logo && replating !== logo) {
    replating = logo;
    void logoColors(logo).then((pal) => {
      if (h.deck.brand?.logo !== logo) return;
      h.editor.commit((d) => { if (d.brand?.plate) d.brand.plate = { from: 'logo', src: logo, ...pal }; }, { rebuild: true, merge: 'logo-plate' });
    }).catch(() => { /* остаются цвета темы */ });
  }
}

/** Плитки тем на ленте: наведение — примерка на слайде, щелчок — тема */
export function bindDesignStrip(h: DesignHost, cmds: Record<string, Command>): void {
  const strip = document.getElementById('st-dz-strip');
  if (!strip) return;
  strip.addEventListener('pointerover', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.st-dz-mini');
    const p = b ? findTheme(h.deck, b.dataset.themeId) : null;
    if (p) tryTheme(h.deck, h.stage(), p.theme);
  });
  strip.addEventListener('pointerleave', () => tryTheme(h.deck, h.stage(), null));
  strip.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.st-dz-mini');
    const id = b?.dataset.themeId;
    if (!id) return;
    if (cmds[`design.preset.${id}`]) cmds[`design.preset.${id}`].run();
    else applyById?.(id);
  });
  // Колесо мыши листает ряд тем вбок
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
}
