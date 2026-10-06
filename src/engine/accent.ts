/**
 * Акцентный цвет презентации: theme.accent в deck.yaml.
 * Из одного цвета строятся все оттенки для светлой и тёмной темы.
 */
const ID = 'htmlpptx-accent';
/** Событие окна: акцентный цвет изменился (для «живых» вставок) */
export const ACCENT_EVENT = 'htmlpptx:accent';
export const HEX_RE = /^#[0-9a-f]{6}$/i;

type RGB = [number, number, number];

function parse(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Смешивает цвет a с цветом b: amount = доля b. */
export function mix(a: string, b: string, amount: number): string {
  const x = parse(a);
  const y = parse(b);
  return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as RGB);
}

/** Относительная яркость цвета (WCAG): 0 — чёрный, 1 — белый */
export function luminance(c: string): number {
  const [r, g, b] = parse(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух цветов (WCAG): от 1 до 21 */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Стандартный акцент (как --ac в tokens.css): от него строится градиент, если задан только второй цвет */
export const DEFAULT_ACCENT = '#2563EB';

/**
 * Оттенки акцента для светлой и тёмной темы. bg — фон слайдов темы презентации: бледная
 * подложка акцента (--acs) смешивается с ним, а не со стандартным фоном
 */
export function accentTokens(accent: string, accent2?: string | null, bg?: { light?: string; dark?: string }): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {
    '--ac': hex(parse(accent)),
    '--ach': mix(accent, '#000000', 0.18),
    '--acs': mix(accent, bg?.light ?? '#FFFFFF', 0.92),
    '--acb': mix(accent, '#FFFFFF', 0.55),
  };
  const dark: Record<string, string> = {
    '--ac': mix(accent, '#FFFFFF', 0.12),
    '--ach': mix(accent, '#FFFFFF', 0.55),
    '--acs': mix(accent, bg?.dark ?? '#0F172A', 0.75),
    '--acb': hex(parse(accent)),
  };
  // Второй цвет и градиент — явно: так они верны и там, где токены переопределены не на :root
  const two = accent2 && HEX_RE.test(accent2) ? accent2 : accent;
  light['--ac2'] = hex(parse(two));
  dark['--ac2'] = mix(two, '#FFFFFF', 0.12);
  for (const t of [light, dark]) t['--ac-g'] = `linear-gradient(135deg, ${t['--ac']}, ${t['--ac2']})`;
  return { light, dark };
}

const block = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

const PREVIEW_ID = 'htmlpptx-accent-preview';
const PREVIEW_ATTR = 'data-accent-preview';

/**
 * Показ цвета, пока тянут палитру: новые токены только у открытого слайда в stage — остальная
 * страница (миниатюры, лента) не пересчитывает стили на каждое движение. null — показ закончен.
 */
export function previewAccent(accent: string | null, stage?: HTMLElement, accent2?: string | null, own = false): void {
  let el = document.getElementById(PREVIEW_ID);
  if (!accent || !HEX_RE.test(accent)) {
    el?.remove();
    document.querySelectorAll(`[${PREVIEW_ATTR}]`).forEach((x) => x.removeAttribute(PREVIEW_ATTR));
    return;
  }
  stage?.setAttribute(PREVIEW_ATTR, '');
  if (!el) {
    el = document.createElement('style');
    el.id = PREVIEW_ID;
  }
  document.head.appendChild(el);
  const { light, dark } = accentTokens(accent, accent2);
  // Цвет презентации не трогает слайд со своими цветами; own — показ своего цвета этого слайда
  const sel = `[${PREVIEW_ATTR}] .slide.on${own ? '' : ':not([data-accent])'}`;
  el.textContent = `@layer slideria-preview{${themed(sel, light, dark)}}`;
}

/** Был тихий показ: следующее обычное применение оповестит вставки, даже если стиль уже тот же */
let quietShown = false;

/**
 * Где цвета презентации, а не интерфейса: слайды, миниатюры (и превью блоков) и образцы цветов
 * в панелях студии — палитры фигур и текста, фоны слайда, стили фигур и таблиц.
 * Новая палитра с цветами темы — добавьте её класс сюда (или дайте ей класс deck-colors).
 */
export const SWATCHES = '.deck-colors, .st-psw, .st-pmore, .st-stile, .st-ttile, .st-rb-sw, .st-bgs, .edcolors';
const DECK_SCOPE = `.slide, .thumb-stage, ${SWATCHES}`;

/**
 * Правила для светлой и тёмной темы: sel — селектор (или список) элементов, где действуют цвета.
 * Слайды презентации с постоянной темой (theme.mode — атрибут data-mode у слайда) берут свой
 * набор, какая бы тема ни была у интерфейса.
 *
 * Цвета презентации разложены по слоям CSS (порядок — в tokens.css): цвета презентации
 * (slideria-deck) < тема презентации (slideria-theme) < свои цвета слайда (slideria-slide) <
 * показ, пока тянут палитру или наводят на тему (slideria-preview).
 */
export function themed(sel: string, light: Record<string, string>, dark: Record<string, string>): string {
  // Сама страница (:root) — условия темы на ней же, а не «внутри» неё
  if (sel === ':root') {
    return `:root{${block(light)}}`
      + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${block(dark)}}}`
      + `:root[data-theme="dark"]{${block(dark)}}`;
  }
  const all = `:is(${sel})`;
  return `${all}{${block(light)}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ${all}{${block(dark)}}}`
    + `:root[data-theme="dark"] ${all}{${block(dark)}}`
    // Та же точность, что у правил выше, и позже их — постоянная тема слайда сильнее темы интерфейса
    + `:root ${all}:is([data-mode="light"], [data-mode="light"] *){${block(light)}}`
    + `:root ${all}:is([data-mode="dark"], [data-mode="dark"] *){${block(dark)}}`;
}

const UI_KEY = 'slideria-ui-accent';
/** Свой цвет интерфейса (студия, окна докладчика, выбор презентаций) или null — как у презентации */
export function uiAccent(): string | null {
  try {
    const v = localStorage.getItem(UI_KEY);
    return v && HEX_RE.test(v) ? v : null;
  } catch { return null; }
}
/** Последний цвет презентации — чтобы перекрасить интерфейс без него */
let deckColors: [unknown, unknown] = [null, null];
/** Включить свой цвет интерфейса (hex) или вернуть «как у презентации» (null) */
export function setUiAccent(color: string | null): void {
  try {
    if (color && HEX_RE.test(color)) localStorage.setItem(UI_KEY, color);
    else localStorage.removeItem(UI_KEY);
  } catch { /* нет доступа: до перезагрузки */ }
  applyAccent(deckColors[0], deckColors[1], false, color && HEX_RE.test(color) ? color : null);
}

/**
 * Применяет цвета презентации (акцент и второй цвет градиента); без цветов — стандартная палитра.
 * Интерфейс по умолчанию в тех же цветах; со своим цветом интерфейса (uiAccent) цвета презентации
 * действуют только на слайдах, миниатюрах и образцах цветов, а страница — в цвете интерфейса.
 * quiet — только перекрасить (пока тянут палитру): вставки и холсты не перезапускаются.
 */
export function applyAccent(accent: unknown, accent2?: unknown, quiet = false, ui: string | null = uiAccent()): void {
  deckColors = [accent, accent2];
  let el = document.getElementById(ID);
  const before = el?.textContent ?? '';
  const notify = (changed: boolean) => {
    if (quiet) quietShown = true;
    else if (changed || quietShown) {
      quietShown = false;
      dispatchEvent(new Event(ACCENT_EVENT));
    }
  };
  const a = typeof accent === 'string' && HEX_RE.test(accent) ? accent : null;
  const a2 = typeof accent2 === 'string' && HEX_RE.test(accent2) ? accent2 : null;
  if (!a && !a2 && !ui) {
    el?.remove();
    notify(!!before);
    return;
  }
  const deck = accentTokens(a ?? DEFAULT_ACCENT, a2);
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
  }
  // Стиль всегда последним в <head>, чтобы перекрыть базовые токены
  document.head.appendChild(el);
  if (ui) {
    const own = accentTokens(ui);
    el.textContent = themed(':root', own.light, own.dark) + `@layer slideria-deck{${themed(DECK_SCOPE, deck.light, deck.dark)}}`;
  } else {
    el.textContent = themed(':root', deck.light, deck.dark);
  }
  // Свои цвета слайдов — после цветов презентации (и выше по точности селектора)
  const own = document.getElementById(SLIDE_ID);
  if (own) document.head.appendChild(own);
  notify(el.textContent !== before);
}

const SLIDE_ID = 'htmlpptx-slide-accents';
const slideKeys = new Set<string>();
/**
 * Свои цвета слайда (slide.theme.accent / accent2): значение атрибута data-accent у слайда
 * («#4F46E5» или «#4F46E5 #EC4899»); null — у слайда цвета презентации. Правило для такого
 * сочетания создаётся один раз; образцы цветов в панелях берут цвета текущего слайда по
 * data-accent у студии.
 */
export function slideAccent(theme: unknown): string | null {
  const t = theme as { accent?: unknown; accent2?: unknown } | undefined;
  const a = typeof t?.accent === 'string' && HEX_RE.test(t.accent) ? t.accent.toUpperCase() : null;
  const a2 = typeof t?.accent2 === 'string' && HEX_RE.test(t.accent2) ? t.accent2.toUpperCase() : null;
  if (!a && !a2) return null;
  const key = a2 ? `${a ?? DEFAULT_ACCENT} ${a2}` : a!;
  if (!slideKeys.has(key) && typeof document !== 'undefined') {
    slideKeys.add(key);
    let el = document.getElementById(SLIDE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = SLIDE_ID;
      document.head.appendChild(el);
    }
    const { light, dark } = accentTokens(a ?? DEFAULT_ACCENT, a2);
    el.textContent += `@layer slideria-slide{${themed(`.slide[data-accent="${key}"], [data-accent="${key}"]:not(.slide) :is(${SWATCHES})`, light, dark)}}`;
  }
  return key;
}

/** Переливание градиента акцента: класс на <html>, анимация — в base.css */
export function applyAccentFlow(on: unknown): void {
  document.documentElement.classList.toggle('ac-flow', on === true);
}
