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

/** Точка градиента акцента между акцентом и вторым цветом: цвет и место, 1–99 % (theme.accentMid) */
export interface AccentStop { c: string; at: number }
/** Конец градиента акцента: второй цвет и точки между ним и акцентом */
export interface AccentTail { to: string | null; mid: AccentStop[] }

/** Промежуточные точки градиента в порядке: #RRGGBB, место 1–99 %, по возрастанию, не больше четырёх */
export function accentMid(v: unknown): AccentStop[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is AccentStop => !!x && typeof x.c === 'string' && HEX_RE.test(x.c) && Number.isFinite(Number(x.at)))
    .map((x) => ({ c: x.c.toUpperCase(), at: Math.max(1, Math.min(99, Math.round(Number(x.at)))) }))
    .sort((a, b) => a.at - b.at).slice(0, 4);
}

/** Второй цвет и промежуточные точки темы или слайда (theme.accent2, theme.accentMid) — для accentTokens и др. */
export function accentTail(theme: unknown): AccentTail {
  const t = theme as { accent2?: unknown; accentMid?: unknown } | undefined;
  const to = typeof t?.accent2 === 'string' && HEX_RE.test(t.accent2) ? t.accent2 : null;
  return { to, mid: to ? accentMid(t?.accentMid) : [] };
}
/** Второй цвет: строкой (как раньше) или вместе с точками */
const tailOf = (v: unknown): AccentTail => {
  if (v && typeof v === 'object') return accentTail({ accent2: (v as AccentTail).to, accentMid: (v as AccentTail).mid });
  return { to: typeof v === 'string' && HEX_RE.test(v) ? v : null, mid: [] };
};

/**
 * Оттенки акцента для светлой и тёмной темы. bg — фон слайдов темы презентации: бледная
 * подложка акцента (--acs) смешивается с ним, а не со стандартным фоном. accent2 — второй цвет
 * (строкой) или второй цвет с промежуточными точками (AccentTail)
 */
export function accentTokens(accent: string, accent2?: string | AccentTail | null, bg?: { light?: string; dark?: string }): { light: Record<string, string>; dark: Record<string, string> } {
  const tail = tailOf(accent2);
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
  const two = tail.to ?? accent;
  light['--ac2'] = hex(parse(two));
  dark['--ac2'] = mix(two, '#FFFFFF', 0.12);
  // Точки градиента: --ac-stops — для своих направлений (linear-gradient(90deg, var(--ac-stops))),
  // --ac-loop — туда и обратно, для переливания по кругу
  for (const [t, dk] of [[light, false], [dark, true]] as const) {
    const mid = tail.mid.map((m) => ({ c: dk ? mix(m.c, '#FFFFFF', 0.12) : m.c, at: m.at }));
    t['--ac-stops'] = [t['--ac'], ...mid.map((m) => `${m.c} ${m.at}%`), t['--ac2']].join(', ');
    t['--ac-loop'] = [t['--ac'], ...mid.map((m) => `${m.c} ${m.at / 2}%`), `${t['--ac2']} 50%`, ...[...mid].reverse().map((m) => `${m.c} ${100 - m.at / 2}%`), t['--ac']].join(', ');
    t['--ac-g'] = `linear-gradient(135deg, ${t['--ac-stops']})`;
  }
  return { light, dark };
}

/** Тон, насыщенность и светлота (HSL, все от 0 до 1) */
function toHsl(c: string): RGB {
  const [r, g, b] = parse(c).map((v) => v / 255);
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  const d = hi - lo;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl([h, s, l]: RGB): string {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  return hex([0, 8, 4].map((n) => (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255) as RGB);
}

/**
 * Ближайший цвет того же тона, у которого яркость (после how — так цвет попадёт на экран) в пределах
 * lo…hi: светлота меняется ровно настолько, насколько нужно. Яркость растёт вместе со светлотой — поиск делением пополам
 */
function fitLuminance(c: string, lo: number, hi: number, how: (c: string) => string = (x) => x): string {
  const [h, s, l] = toHsl(c);
  const at = (v: number) => luminance(how(fromHsl([h, s, v])));
  const y = at(l);
  if (y >= lo && y <= hi) return hex(parse(c));
  let [a, b] = y > hi ? [0, l] : [l, 1];
  for (let n = 0; n < 24; n++) {
    const m = (a + b) / 2;
    if (y > hi ? at(m) <= hi : at(m) < lo) a = m; else b = m;
  }
  return fromHsl([h, s, y > hi ? a : b]);
}

/**
 * Цвет интерфейса не ломает интерфейс: белый текст на кнопках цвета акцента и подписи, значки, рамки
 * цветом акцента на фоне панелей видны (контраст не меньше 3 : 1, как для крупного текста и значков
 * по WCAG). Слишком светлый цвет становится темнее, в тёмной теме слишком тёмный — светлее; тон тот же.
 */
const UI_CONTRAST = 3;
/** Самая большая яркость: белый текст на кнопке цвета акцента */
const UI_HI = (1 + 0.05) / UI_CONTRAST - 0.05;
/** Самая малая яркость в тёмной теме: акцент на панели (--surf тёмной темы) */
const UI_LO_DARK = UI_CONTRAST * (luminance('#162033') + 0.05) - 0.05;
/** В тёмной теме на экране акцент чуть светлее (как в accentTokens) */
const darkShown = (c: string) => mix(c, '#FFFFFF', 0.12);

/** Цвет, который интерфейс возьмёт за свой акцент в светлой или тёмной теме */
export function uiSafeAccent(c: string, mode: 'light' | 'dark'): string {
  return mode === 'dark' ? fitLuminance(c, UI_LO_DARK, UI_HI, darkShown) : fitLuminance(c, 0, UI_HI);
}

/** Токены акцента для самой страницы (лента, кнопки, панели): как accentTokens, но читаемые в обеих темах */
export function uiAccentTokens(accent: string, accent2?: string | AccentTail | null): { light: Record<string, string>; dark: Record<string, string> } {
  const tail = tailOf(accent2);
  const side = (mode: 'light' | 'dark') => {
    const fit = (c: string) => uiSafeAccent(c, mode);
    return accentTokens(fit(accent), { to: tail.to && fit(tail.to), mid: tail.mid.map((m) => ({ c: fit(m.c), at: m.at })) })[mode];
  };
  return { light: side('light'), dark: side('dark') };
}

const block = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

/** Вид слайда: постоянный (data-mode у слайда или выше) или как тема интерфейса */
export function shownMode(el: Element): 'light' | 'dark' {
  const m = el.closest('[data-mode]')?.getAttribute('data-mode');
  if (m === 'light' || m === 'dark') return m;
  const a = document.documentElement.getAttribute('data-theme');
  if (a === 'light' || a === 'dark') return a;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Переменные прямо на одном элементе (style) — показ цвета или темы на открытом слайде. Через общий
 * <style> браузер пересчитывал бы всю страницу (миниатюры, ленту) на каждое движение палитры,
 * а так — только этот слайд. set(null) — показ снят
 */
export function inlineVars() {
  let shown: { el: HTMLElement; keys: string[] } | null = null;
  return (el: HTMLElement | null, vars: Record<string, string> | null, important = false) => {
    if (shown && (shown.el !== el || !vars)) {
      for (const k of shown.keys) shown.el.style.removeProperty(k);
      shown = null;
    }
    if (!el || !vars) return;
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v, important ? 'important' : '');
    shown = { el, keys: Object.keys(vars) };
  };
}
const accentShown = inlineVars();

/**
 * Показ цвета, пока тянут палитру: новые токены только у открытого слайда в stage — остальная
 * страница (миниатюры, лента) не пересчитывает стили на каждое движение. null — показ закончен.
 */
export function previewAccent(accent: string | null, stage?: HTMLElement, accent2?: string | AccentTail | null, own = false): void {
  const slide = accent && HEX_RE.test(accent) ? stage?.querySelector<HTMLElement>('.slide.on') ?? null : null;
  // Цвет презентации не трогает слайд со своими цветами; own — показ своего цвета этого слайда
  if (!slide || (!own && slide.hasAttribute('data-accent'))) return accentShown(null, null);
  accentShown(slide, accentTokens(accent!, accent2)[shownMode(slide)]);
}

/** Был тихий показ: следующее обычное применение оповестит вставки, даже если стиль уже тот же */
let quietShown = false;

/**
 * Плитки панелей студии с фонами и блоками темы (фоны слайда, анимированные фоны, библиотека
 * блоков и её крупное превью): цвета презентации, а светлый или тёмный вид — как у интерфейса,
 * даже если у темы вид постоянный. Иначе светлые плитки выделялись бы в тёмном интерфейсе
 * (и наоборот), а светлый текст тёмной темы ложился бы на светлую плитку
 */
export const PANEL_SWATCHES = '.st-bgs, .st-bdstrip, .st-lib-prev, .st-peek-frame';
/**
 * Где цвета презентации, а не интерфейса: слайды, миниатюры (и превью блоков) и образцы цветов
 * в панелях студии — палитры фигур и текста, стили фигур и таблиц, плитки фонов и блоков.
 * Новая палитра с цветами темы — добавьте её класс сюда (или дайте ей класс deck-colors).
 */
export const SWATCHES = `.deck-colors, .st-psw, .st-pmore, .st-stile, .st-ttile, .st-rb-sw, .edcolors, ${PANEL_SWATCHES}`;
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
  const a2 = tailOf(accent2);
  if (!a && !a2.to && !ui) {
    el?.remove();
    notify(!!before);
    return;
  }
  const deck = accentTokens(a ?? DEFAULT_ACCENT, a2);
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
  }
  // Стиль всегда последним в <head>, чтобы перекрыть базовые токены; уже последний — не трогаем:
  // перестановка стиля заставляет браузер пересчитать всю страницу
  const tail = document.getElementById(SLIDE_ID);
  if (!(el.parentNode === document.head && (el === document.head.lastElementChild || (el.nextElementSibling === tail && tail === document.head.lastElementChild)))) document.head.appendChild(el);
  // Страница — в читаемом варианте цвета (uiAccentTokens). Цвет презентации слишком светлый или тёмный для
  // интерфейса — у страницы читаемый вариант, а слайды, миниатюры и образцы — в настоящем цвете
  const face = ui ? uiAccentTokens(ui) : uiAccentTokens(a ?? DEFAULT_ACCENT, a2);
  if (ui || JSON.stringify(face) !== JSON.stringify(deck)) {
    el.textContent = themed(':root', face.light, face.dark) + `@layer slideria-deck{${themed(DECK_SCOPE, deck.light, deck.dark)}}`;
  } else {
    el.textContent = themed(':root', deck.light, deck.dark);
  }
  // Свои цвета слайдов — после цветов презентации (и выше по точности селектора)
  const own = document.getElementById(SLIDE_ID);
  if (own && own !== document.head.lastElementChild) document.head.appendChild(own);
  notify(el.textContent !== before);
}

const SLIDE_ID = 'htmlpptx-slide-accents';
const slideKeys = new Set<string>();
/**
 * Свои цвета слайда (slide.theme.accent / accent2 / accentMid): значение атрибута data-accent у слайда
 * («#4F46E5», «#4F46E5 #EC4899» или с точками «#4F46E5 #EC4899 #22D3EE@40»); null — у слайда цвета презентации. Правило для такого
 * сочетания создаётся один раз; образцы цветов в панелях берут цвета текущего слайда по
 * data-accent у студии.
 */
export function slideAccent(theme: unknown): string | null {
  const t = theme as { accent?: unknown; accent2?: unknown } | undefined;
  const a = typeof t?.accent === 'string' && HEX_RE.test(t.accent) ? t.accent.toUpperCase() : null;
  const tail = accentTail(t);
  const a2 = tail.to?.toUpperCase() ?? null;
  if (!a && !a2) return null;
  const key = a2 ? `${a ?? DEFAULT_ACCENT} ${a2}${tail.mid.map((m) => ` ${m.c}@${m.at}`).join('')}` : a!;
  if (!slideKeys.has(key) && typeof document !== 'undefined') {
    slideKeys.add(key);
    let el = document.getElementById(SLIDE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = SLIDE_ID;
      document.head.appendChild(el);
    }
    const { light, dark } = accentTokens(a ?? DEFAULT_ACCENT, tail);
    el.textContent += `@layer slideria-slide{${themed(`.slide[data-accent="${key}"], [data-accent="${key}"]:not(.slide) :is(${SWATCHES})`, light, dark)}}`;
  }
  return key;
}

/** Переливание градиента акцента: класс на <html>, анимация — в base.css */
export function applyAccentFlow(on: unknown): void {
  document.documentElement.classList.toggle('ac-flow', on === true);
}
