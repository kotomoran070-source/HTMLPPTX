/**
 * Вкладка «Дизайн»: оформление презентации целиком. Галерея тем (каждая — на одном и том же
 * слайде-образце), пары цветов, шрифты заголовков и текста, фон, карточки, углы и вид слайдов:
 * светлые, тёмные или как тема у зрителя. Наведение примеряет вариант на открытом слайде,
 * щелчок применяет его одним шагом (Ctrl+Z возвращает прежнее).
 */
import { icon } from '../components/icons';
import { previewAccent } from '../engine/accent';
import { replaceContents } from '../engine/data';
import { CARD_STYLES, hasThemeLook, previewTheme, THEME_BGS, themeMode, themeVars, type SlideMode } from '../engine/deck-theme';
import { reducedMotion, staticSlide } from '../engine/deck-view';
import type { Editor } from '../engine/editor/editor';
import { fontItems, fontPicker } from '../engine/editor/font-picker';
import { deckFonts, fontStack } from '../engine/fonts';
import { esc } from '../engine/html';
import { currentTheme } from '../engine/theme';
import type { Deck, DeckTheme } from '../types';
import { logoPlate } from '../engine/render';
import { logoColors } from './logo-colors';
import { showPopover } from './menu';
import { registerThemeFonts, SPECIMEN, THEME_FONTS, THEME_PRESETS, themeFont, type ThemePreset } from './theme-presets';

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
}

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
  ${group('Оформление', btn('design.bg', 'image', 'Фон', { big: true, menu: true, title: 'Фон слайдов' }) + btn('design.cards', 'frame', 'Карточки', { big: true, menu: true, title: 'Вид карточек, таблиц и плашек' }) + btn('design.radius', 'corner', 'Углы', { big: true, menu: true, title: 'Скругление углов карточек и картинок' }) + btn('design.logo', 'sparkle', 'Логотип', { big: true, menu: true, title: 'Плашка под логотипом: в цветах темы или в цветах самого логотипа' }))}
  ${group('Слайды', `<div class="st-rstack">${chk('design.mode.auto', 'Как у зрителя', 'Слайды светлые или тёмные — как тема у того, кто смотрит')}${chk('design.mode.light', 'Всегда светлые', 'Слайды светлые при любой теме у зрителя')}${chk('design.mode.dark', 'Всегда тёмные', 'Слайды тёмные при любой теме у зрителя')}</div>`)}
</div>`;
}

/** Вид слайдов, которые видно сейчас: постоянный у темы или как у интерфейса */
const shownMode = (t: DeckTheme | undefined): SlideMode => themeMode(t) ?? currentTheme();

const decl = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');

/** Переменные темы для плитки (образец без слайда) */
function tileStyle(t: DeckTheme): string {
  const v = themeVars(t, shownMode(t));
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
  return `<button type="button" class="st-dz-mini${p.id === cur ? ' active' : ''}" data-theme-id="${p.id}" title="${esc(p.name)}" aria-label="${esc(p.name)}">`
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

/** Скругление углов: множитель и название */
const RADII: [number, string][] = [[0, 'Прямые'], [0.5, 'Небольшие'], [1, 'Обычные'], [1.5, 'Мягкие'], [2, 'Круглые']];

export function designCommands(h: DesignHost): Record<string, Command> {
  const { deck, editor: ed } = h;
  registerThemeFonts();
  // Шрифты тем — в списках шрифтов редактора (копируются в презентацию при выборе)
  ed.themeFonts = { names: Object.keys(THEME_FONTS), get: themeFont };
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

  const applyPreset = async (p: ThemePreset) => {
    previewTheme(null);
    const add = p.id === 'standard' ? [] : await fontsFor([p.theme.font, p.theme.head]);
    if (!add) return;
    smoothly(() => ed.commit((d) => {
      putTheme(d, p.id === 'standard' ? null : { preset: p.id, ...structuredClone(p.theme) });
      if (add.length) d.fonts = [...(Array.isArray(d.fonts) ? d.fonts : []), ...add];
      dropUnusedThemeFonts(d);
    }, { rebuild: true }));
    ed.toast(p.id === 'standard' ? 'Стандартное оформление' : `Тема «${p.name}». Вернуть прежнюю: Ctrl+Z`, 2200);
  };

  /** Примерка при наведении: на открытом слайде, пока указатель над вариантом */
  const tryOn = (t: DeckTheme | null) => previewTheme(t, h.stage());

  /** Наведение и уход с вариантов всплывающей панели: примерка темы */
  const hoverTry = (el: HTMLElement, sel: string, make: (b: HTMLElement) => DeckTheme | null) => {
    el.addEventListener('pointerover', (e) => {
      const b = (e.target as Element).closest<HTMLElement>(sel);
      if (b) tryOn(make(b));
    });
    el.addEventListener('pointerleave', () => previewTheme(null));
    // Панель закрылась (выбор, Esc, щелчок мимо) — примерка заканчивается
    new MutationObserver((_m, o) => {
      if (!el.isConnected) { previewTheme(null); o.disconnect(); }
    }).observe(document.body, { childList: true });
  };

  // ---------- галерея тем ----------
  const gallery = () => {
    const at = anchor('design.themes');
    if (!at) return;
    const cur = currentPreset(deck);
    const html = `<div class="st-dz-gal" role="listbox" aria-label="Темы">${THEME_PRESETS.map((p) => {
      const m = themeMode(p.theme);
      return `<button type="button" class="st-dz-tile${p.id === cur ? ' active' : ''}" data-theme-id="${p.id}" role="option" aria-selected="${p.id === cur}">`
        + `<span class="st-dz-shot"></span><span class="st-dz-name">${esc(p.name)}${m ? `<i title="${m === 'dark' ? 'Тёмные слайды' : 'Светлые слайды'}">${icon(m === 'dark' ? 'moon' : 'sun')}</i>` : ''}</span></button>`;
    }).join('')}</div>`;
    const el = showPopover(at, html, (b) => {
      const p = THEME_PRESETS.find((x) => x.id === b.dataset.themeId);
      return p ? { run: () => void applyPreset(p) } : null;
    }, 'st-dz-galpop');
    // Справа: открытый слайд в середине окна остаётся на виду — на нём примеряется тема
    el.style.left = `${Math.max(8, innerWidth - el.offsetWidth - 12)}px`;
    el.querySelectorAll<HTMLElement>('.st-dz-tile').forEach((b) => {
      const p = THEME_PRESETS.find((x) => x.id === b.dataset.themeId)!;
      b.querySelector('.st-dz-shot')!.appendChild(staticSlide(specimenDeck(p.theme), 0, 284));
    });
    hoverTry(el, '.st-dz-tile', (b) => THEME_PRESETS.find((x) => x.id === b.dataset.themeId)?.theme ?? null);
  };

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
    fontPicker().toggle(at, () => fontItems([first], ed.fontChoices(), fontStack), theme()[key] ?? '', (name) => void setFont(key, name));
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

  // ---------- фон, карточки, углы ----------
  /** Всплывающая панель вариантов: образцы в цветах темы, наведение — примерка, щелчок — выбор */
  const options = <T>(cmd: string, items: [T, string][], cur: T, make: (v: T) => DeckTheme, sample: (v: T) => string, apply: (v: T) => void, cls: string) => {
    const at = anchor(cmd);
    if (!at) return;
    const html = `<div class="st-dz-opts ${cls}">${items.map(([v, name], k) =>
      `<button type="button" class="st-dz-opt${v === cur ? ' active' : ''}" data-k="${k}"><span class="st-dz-opt-in" style="${esc(tileStyle(make(v)))}">${sample(v)}</span><small>${esc(name)}</small></button>`).join('')}</div>`;
    const el = showPopover(at, html, (b) => {
      const it = items[Number(b.dataset.k)];
      return it ? { run: () => apply(it[0]) } : null;
    });
    hoverTry(el, '.st-dz-opt', (b) => {
      const it = items[Number(b.dataset.k)];
      return it ? make(it[0]) : null;
    });
  };
  const card = '<i class="st-dz-card"><b></b><b></b></i>';

  const setMode = (m: SlideMode | null) => smoothly(() => patch({ mode: m ?? undefined }));

  // ---------- плашка логотипа ----------
  const setPlate = (plate: NonNullable<Deck['brand']>['plate'] | null) => ed.commit((d) => {
    if (!d.brand) return;
    if (plate) d.brand.plate = plate;
    else delete d.brand.plate;
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
    if (!logo) return ed.toast('У презентации нет логотипа: добавьте его на титульном слайде', 3500);
    let pal: Awaited<ReturnType<typeof logoColors>>;
    try { pal = await logoColors(logo); } catch (e) { return ed.toast(`Не удалось прочитать логотип: ${(e as Error).message}`, 4000, true); }
    const fromLogo = deck.brand?.plate?.from === 'logo';
    // Образцы — тем же логотипом на фоне слайда темы; у «из темы» — переменные темы, у «из логотипа» — свои
    const sample = (vars: string) => `<span class="st-dz-opt-in" style="${esc(`${tileStyle(theme())};${vars}`)}"><i class="st-dz-plate"><img src="${esc(logo)}" alt=""></i></span>`;
    const logoVars = `--lp-bg:${pal.bg};--lp-bd:${pal.border};--lp-glow:${pal.glow}`;
    const el = showPopover(at, `<div class="st-dz-opts radii">`
      + `<button type="button" class="st-dz-opt${fromLogo ? '' : ' active'}" data-k="theme">${sample('')}<small>Из темы</small></button>`
      + `<button type="button" class="st-dz-opt${fromLogo ? ' active' : ''}" data-k="logo">${sample(logoVars)}<small>Из логотипа</small></button></div>`
      // Угол и размер на обычных слайдах
      + `<div class="st-dz-corners">${CORNER_POS.map(([v, l]) => `<button type="button" class="st-dz-corner${(corner().pos ?? 'tr') === v ? ' active' : ''}" data-pos="${v}" title="${l}" aria-label="${l}"><i class="at-${v}"></i></button>`).join('')}`
      + `<span class="st-dz-sep"></span>${CORNER_SIZE.map(([v, l]) => `<button type="button" class="st-dz-corner${(corner().size ?? '') === v ? ' active' : ''}" data-size="${v}" title="${l}" aria-label="${l}"><i class="at-tr size-${v || 'm'}"></i></button>`).join('')}</div>`, (b) => {
      if (b.dataset.k === 'theme') return { run: () => setPlate(null) };
      if (b.dataset.k === 'logo') return { run: () => setPlate({ from: 'logo', src: logo, ...pal }) };
      if (b.dataset.pos) return { run: () => setCorner({ pos: b.dataset.pos }) };
      if (b.dataset.size !== undefined) return { run: () => setCorner({ size: b.dataset.size }) };
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
      const t = (e.target as Element).closest<HTMLElement>('[data-k], [data-pos], [data-size]');
      const k = t?.dataset.k;
      if (k === 'logo') tryPlate({ '--lp-bg': pal.bg, '--lp-bd': pal.border, '--lp-glow': pal.glow });
      else if (k === 'theme') tryPlate({});
      else if (t?.dataset.pos) tryCorner(t.dataset.pos);
      else if (t?.dataset.size !== undefined) tryCorner(undefined, t.dataset.size);
    });
    el.addEventListener('pointerleave', () => { tryPlate(null); tryCorner(); });
    new MutationObserver((_m, o) => { if (!el.isConnected) { tryPlate(null); tryCorner(); o.disconnect(); } }).observe(document.body, { childList: true });
  };

  const cmds: Record<string, Command> = {
    'design.themes': { run: gallery },
    'design.palettes': { run: palettes },
    'design.font.head': { run: () => pickFont('head') },
    'design.font.body': { run: () => pickFont('font') },
    'design.bg': {
      run: () => options('design.bg', Object.entries(THEME_BGS).map(([k, b]) => [k, b.name] as [string, string]), theme().bg ?? 'dots',
        (v) => ({ ...theme(), bg: v }), () => '', (v) => patch({ bg: v }), 'bgs'),
    },
    'design.cards': {
      run: () => options('design.cards', Object.entries(CARD_STYLES).map(([k, c]) => [k, c.name] as [string, string]), theme().cards ?? 'soft',
        (v) => ({ ...theme(), cards: v }), () => card, (v) => patch({ cards: v === 'soft' ? undefined : v }), 'cards'),
    },
    'design.radius': {
      run: () => options('design.radius', RADII, typeof theme().radius === 'number' ? theme().radius! : 1,
        (v) => ({ ...theme(), radius: v }), () => card, (v) => patch({ radius: v === 1 ? undefined : v }), 'radii'),
    },
    'design.logo': { run: () => void logoMenu(), enabled: () => !!deck.brand?.logo },
    'design.mode.auto': { run: () => setMode(null), active: () => !themeMode(deck.theme) },
    'design.mode.light': { run: () => setMode('light'), active: () => themeMode(deck.theme) === 'light' },
    'design.mode.dark': { run: () => setMode('dark'), active: () => themeMode(deck.theme) === 'dark' },
  };
  // Темы по имени: плитки на ленте и палитра команд (Ctrl+K)
  for (const p of THEME_PRESETS) cmds[`design.preset.${p.id}`] = { run: () => void applyPreset(p), active: () => currentPreset(deck) === p.id };
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
  const key = `${currentTheme()}|${cur}`;
  if (key !== stripKey) {
    stripKey = key;
    strip.innerHTML = THEME_PRESETS.map((p) => miniTile(p, cur)).join('');
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
    const p = b ? THEME_PRESETS.find((x) => x.id === b.dataset.themeId) : null;
    if (p) previewTheme(p.theme, h.stage());
  });
  strip.addEventListener('pointerleave', () => previewTheme(null));
  strip.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.st-dz-mini');
    const p = b ? THEME_PRESETS.find((x) => x.id === b.dataset.themeId) : null;
    if (p) cmds[`design.preset.${p.id}`]?.run();
  });
  // Колесо мыши листает ряд тем вбок
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
}
