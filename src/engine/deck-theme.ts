/**
 * Оформление презентации целиком — тема (deck.theme): цвета слайдов для светлой и тёмной темы,
 * шрифт заголовков, фон, вид карточек и скругление углов. Всё — переменными CSS у слайдов этой
 * презентации (атрибут data-th): интерфейс программы остаётся в своих цветах.
 * Галерея тем студии записывает сюда готовые значения — собранный файл рисуется без неё.
 *
 * Переменные, которые читают стили слайдов:
 *   --bg --surf --alt --tx --tx2 --mu --bd --bd2  палитра (как в tokens.css)
 *   --ac … --ac-g, --on-ac                         акцент и цвет текста на нём
 *   --slide-bg                                     фон слайда (base.css)
 *   --font-head --hw --h-tt --h-ls --h-scale       заголовки: шрифт, насыщенность, регистр, интервал, размер
 *   --card-bg --card-bd --card-bw --card-sh        карточки и плашки
 *   --rk                                           множитель скругления углов
 */
import type { DeckTheme, ThemePalette } from '../types';
import { accentTokens, contrast, DEFAULT_ACCENT, HEX_RE, mix, SWATCHES } from './accent';
import { cssKey } from './deck-css';
import { fontNameOk } from './fonts';

export type SlideMode = 'light' | 'dark';

export const PALETTE_KEYS = ['bg', 'surf', 'alt', 'tx', 'tx2', 'mu', 'bd', 'bd2'] as const;
type FullPalette = Required<ThemePalette>;

/** Палитры по умолчанию — как в tokens.css */
const BASE: Record<SlideMode, FullPalette> = {
  light: { bg: '#F8FAFC', surf: '#FDFEFF', alt: '#F3F4F6', tx: '#111827', tx2: '#374151', mu: '#6B7280', bd: '#E5E7EB', bd2: '#D1D5DB' },
  dark: { bg: '#0F172A', surf: '#162033', alt: '#0B1220', tx: '#E6EBF3', tx2: '#CBD5E1', mu: '#94A3B8', bd: '#263449', bd2: '#334155' },
};

const isHex = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);

/**
 * Полная палитра из заданных цветов: без фона или текста — стандартная; недостающие оттенки
 * (подложки, подписи, линии) смешиваются из фона и текста
 */
export function fullPalette(p: ThemePalette | undefined, mode: SlideMode): FullPalette {
  if (!p || !isHex(p.bg) || !isHex(p.tx)) return BASE[mode];
  const { bg, tx } = p;
  const dark = mode === 'dark';
  const out: FullPalette = {
    bg: bg.toUpperCase(),
    tx: tx.toUpperCase(),
    surf: dark ? mix(bg, tx, 0.06) : mix(bg, '#FFFFFF', 0.75),
    alt: dark ? mix(bg, '#000000', 0.3) : mix(bg, tx, 0.04),
    tx2: mix(tx, bg, 0.2),
    mu: mix(tx, bg, 0.45),
    bd: mix(bg, tx, dark ? 0.14 : 0.1),
    bd2: mix(bg, tx, dark ? 0.21 : 0.17),
  };
  for (const k of PALETTE_KEYS) {
    const v = p[k];
    if (isHex(v)) out[k] = v.toUpperCase();
  }
  return out;
}

const cm = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const grid = (c: string, s: number) => `linear-gradient(${c} 1px, transparent 1px) 0 0 / ${s}px ${s}px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / ${s}px ${s}px`;
/** Зерно бумаги: шум SVG (тёмный на светлом фоне, светлый на тёмном) */
const grain = (dark: boolean) => `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>`
  + `<feColorMatrix values='0 0 0 0 ${dark ? 1 : 0} 0 0 0 0 ${dark ? 1 : 0} 0 0 0 0 ${dark ? 1 : 0} 0 0 0 ${dark ? 0.07 : 0.11} 0'/></filter>`
  + `<rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}")`;

/** Фоны слайдов: из цветов темы, поэтому одинаково хороши в любой палитре */
export const THEME_BGS: Record<string, { name: string; css: (dark: boolean) => string }> = {
  dots: { name: 'Точки', css: () => 'radial-gradient(var(--bd) 1px, transparent 1px) 0 0 / 26px 26px, var(--bg)' },
  plain: { name: 'Ровный', css: () => 'var(--bg)' },
  grid: { name: 'Сетка', css: (d) => `${grid(cm('var(--bd)', d ? 80 : 70), 40)}, var(--bg)` },
  glow: {
    name: 'Сияние',
    css: (d) => `radial-gradient(70% 90% at 0% 0%, ${cm('var(--ac)', d ? 26 : 16)}, transparent 70%), `
      + `radial-gradient(60% 80% at 100% 100%, ${cm('var(--ac2)', d ? 22 : 13)}, transparent 70%), var(--bg)`,
  },
  mesh: {
    name: 'Акварель',
    css: (d) => `radial-gradient(42% 58% at 6% 10%, ${cm('var(--ac)', d ? 30 : 22)}, transparent 72%), `
      + `radial-gradient(40% 55% at 94% 14%, ${cm('var(--ac2)', d ? 26 : 20)}, transparent 72%), `
      + `radial-gradient(55% 60% at 72% 104%, ${cm('color-mix(in oklch, var(--ac), var(--ac2))', d ? 24 : 18)}, transparent 72%), var(--bg)`,
  },
  paper: { name: 'Бумага', css: (d) => `${grain(d)}, var(--bg)` },
  notebook: {
    name: 'Тетрадь',
    // Поля тетради — красной линией; на тёмной (школьная доска) — без неё
    css: (d) => `${d ? '' : `linear-gradient(90deg, transparent 0 92px, ${cm('#EF4444', 45)} 92px 94px, transparent 94px), `}`
      + `${grid(d ? 'rgba(255, 255, 255, .07)' : cm('var(--ac)', 14), 28)}, var(--bg)`,
  },
  band: { name: 'Полоса', css: () => 'linear-gradient(90deg, var(--ac), var(--ac2)) 0 0 / 100% 10px no-repeat, var(--bg)' },
  arc: {
    name: 'Дуги',
    css: (d) => `radial-gradient(circle at 100% 100%, ${cm('var(--ac)', d ? 18 : 14)} 0 24%, transparent 24.3%), `
      + `radial-gradient(circle at 100% 100%, ${cm('var(--ac2)', d ? 13 : 10)} 0 36%, transparent 36.3%), `
      + `radial-gradient(circle at 100% 100%, ${cm('var(--ac)', d ? 8 : 6)} 0 50%, transparent 50.3%), var(--bg)`,
  },
  spot: { name: 'Свет', css: (d) => `radial-gradient(70% 70% at 50% -10%, ${cm('var(--ac)', d ? 22 : 12)}, transparent 70%), var(--bg)` },
  neon: {
    name: 'Неон',
    css: (d) => `radial-gradient(90% 60% at 50% 115%, ${cm('var(--ac)', d ? 34 : 18)}, transparent 70%), `
      + `radial-gradient(45% 50% at 95% 0%, ${cm('var(--ac2)', d ? 24 : 14)}, transparent 70%), `
      + `${grid(cm('var(--ac)', d ? 13 : 9), 48)}, var(--bg)`,
  },
  halftone: { name: 'Растр', css: (d) => `radial-gradient(${cm('var(--tx)', d ? 16 : 13)} 1.6px, transparent 2px) 0 0 / 22px 22px, var(--bg)` },
};

/**
 * Вид карточек и плашек (карточка, блоки схем, вопросы, таблицы): фон, рамка и тень.
 * «Мягкие» — как без темы: у каждого блока свои значения по умолчанию
 */
export const CARD_STYLES: Record<string, { name: string; vars: (dark: boolean) => Record<string, string> }> = {
  soft: { name: 'Мягкие', vars: () => ({}) },
  flat: { name: 'Плоские', vars: () => ({ '--card-bg': 'var(--alt)', '--card-bd': 'transparent', '--card-sh': 'none' }) },
  outline: { name: 'Контур', vars: () => ({ '--card-bg': 'transparent', '--card-bd': 'var(--bd2)', '--card-bw': '1.5px', '--card-sh': 'none' }) },
  raised: {
    name: 'Парящие',
    vars: (d) => ({
      '--card-bd': 'transparent',
      '--card-sh': d ? '0 18px 40px -14px rgba(0, 0, 0, .65), 0 2px 6px rgba(0, 0, 0, .3)'
        : '0 18px 40px -16px color-mix(in srgb, var(--tx) 24%, transparent), 0 2px 6px color-mix(in srgb, var(--tx) 6%, transparent)',
    }),
  },
  glass: {
    name: 'Стекло',
    vars: (d) => ({
      '--card-bg': cm('var(--surf)', d ? 55 : 68),
      '--card-bd': cm(d ? '#FFFFFF' : 'var(--tx)', d ? 13 : 9),
      '--card-sh': `inset 0 1px 0 ${cm('#FFFFFF', d ? 10 : 70)}, 0 14px 34px -16px rgba(0, 0, 0, ${d ? 0.6 : 0.2})`,
    }),
  },
  poster: { name: 'Плакат', vars: () => ({ '--card-bg': 'var(--surf)', '--card-bd': 'var(--tx)', '--card-bw': '2px', '--card-sh': '5px 5px 0 var(--tx)' }) },
};

/** Переменные, которые тема задаёт не всегда: без значения — «как без темы» (initial) */
const OPTIONAL = ['--font-head', '--hw', '--h-tt', '--h-ls', '--h-scale', '--card-bg', '--card-bd', '--card-bw', '--card-sh'];

/** Цвет текста на акцентной заливке: белый, если читается, иначе самый тёмный цвет палитры */
function onAccent(ac: string, p: FullPalette): string {
  if (contrast(ac, '#FFFFFF') >= 3) return '#FFFFFF';
  const dark = contrast(p.tx, '#FFFFFF') > contrast(p.bg, '#FFFFFF') ? p.tx : p.bg;
  return contrast(ac, dark) >= contrast(ac, '#0B1020') ? dark : '#0B1020';
}

/** Все переменные темы для светлого или тёмного вида слайдов */
export function themeVars(t: DeckTheme, mode: SlideMode): Record<string, string> {
  const dark = mode === 'dark';
  const pal = fullPalette(t[mode], mode);
  const v: Record<string, string> = {};
  for (const k of PALETTE_KEYS) v[`--${k}`] = pal[k];
  v['--shadow-sm'] = dark ? '0 1px 2px rgba(0, 0, 0, .3)' : '0 1px 2px rgba(15, 23, 42, .06)';
  v['--shadow-md'] = dark ? '0 8px 24px rgba(0, 0, 0, .35)' : '0 8px 24px rgba(15, 23, 42, .10)';
  // Плашка под логотипом — в тон теме: на светлых слайдах цвет карточек, на тёмных — светлый тон
  // текста темы (белая плашка нужна, чтобы любой логотип читался, но не чисто-белая)
  v['--logo-bg'] = dark ? mix(pal.tx, '#FFFFFF', 0.4) : pal.surf;
  if (dark) v['--logo-bg-dk'] = pal.alt;
  const ac = accentTokens(isHex(t.accent) ? t.accent : DEFAULT_ACCENT, isHex(t.accent2) ? t.accent2 : null, { [mode]: pal.bg })[mode];
  Object.assign(v, ac);
  v['--on-ac'] = onAccent(ac['--ac'], pal);
  v['--slide-bg'] = (THEME_BGS[String(t.bg)] ?? THEME_BGS.dots).css(dark);
  const r = Number(t.radius);
  v['--rk'] = String(Number.isFinite(r) && t.radius !== undefined ? Math.max(0, Math.min(2.5, Math.round(r * 100) / 100)) : 1);
  for (const k of OPTIONAL) v[k] = 'initial';
  Object.assign(v, (CARD_STYLES[String(t.cards)] ?? CARD_STYLES.soft).vars(dark));
  if (fontNameOk(t.head)) v['--font-head'] = `"${t.head.trim()}", var(--font)`;
  const hw = Number(t.headWeight);
  if (Number.isFinite(hw) && hw >= 100 && hw <= 900) v['--hw'] = String(Math.round(hw / 50) * 50);
  if (t.headCase === 'upper') v['--h-tt'] = 'uppercase';
  const ls = Number(t.headSpacing);
  if (Number.isFinite(ls) && t.headSpacing !== undefined && Math.abs(ls) <= 0.2) v['--h-ls'] = `${Math.round(ls * 1000) / 1000}em`;
  const hs = Number(t.headScale);
  if (Number.isFinite(hs) && t.headScale !== undefined && hs !== 1) v['--h-scale'] = String(Math.max(0.7, Math.min(1.3, Math.round(hs * 100) / 100)));
  v['color-scheme'] = mode;
  return v;
}

/** Есть ли у презентации тема (а не только акцент и шрифт, как раньше) */
export function hasThemeLook(theme: unknown): theme is DeckTheme {
  if (!theme || typeof theme !== 'object') return false;
  const t = theme as DeckTheme;
  return !!(t.preset || t.mode || t.light || t.dark || t.bg || t.cards || t.radius !== undefined || t.head || t.headWeight || t.headCase || t.headSpacing !== undefined || t.headScale !== undefined);
}

/** Постоянный вид слайдов темы или null — как тема у зрителя */
export function themeMode(theme: unknown): SlideMode | null {
  const m = (theme as DeckTheme | undefined)?.mode;
  return m === 'light' || m === 'dark' ? m : null;
}

const decl = (v: Record<string, string>, imp: boolean) => Object.entries(v).map(([k, x]) => `${k}:${x}${imp ? ' !important' : ''}`).join(';');

/**
 * CSS темы для селектора: светлый и тёмный вид (или один постоянный). extra — переменные сверху
 * (шрифт текста у показа темы); important — сильнее стилей без слоя (показ поверх шрифтов презентации)
 */
export function themeCss(t: DeckTheme, sel: string, extra: Record<string, string> = {}, important = false): string {
  const s = sel.includes(',') ? `:is(${sel})` : sel;
  const L = decl({ ...themeVars(t, 'light'), ...extra }, important);
  const D = decl({ ...themeVars(t, 'dark'), ...extra }, important);
  const m = themeMode(t);
  if (m) return `${s}{${m === 'dark' ? D : L}}`;
  return `${s}{${L}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ${s}{${D}}}:root[data-theme="dark"] ${s}{${D}}`;
}

/** Стили тем на странице: метка → <style>. Давно не нужные (цвет правили много раз) убираются */
const styles = new Map<string, HTMLStyleElement>();
const KEEP = 24;

/**
 * Подключает тему презентации и возвращает метку для её слайдов (data-th) или null, если темы
 * нет. У каждой презентации своя метка: на странице выбора и в галерее их несколько сразу
 */
export function applyDeckTheme(theme: unknown): string | null {
  if (!hasThemeLook(theme) || typeof document === 'undefined') return null;
  const css = themeCss(theme, '.slide[data-th="@"]');
  const key = cssKey(css);
  const had = styles.get(key);
  if (had?.isConnected) {
    styles.delete(key);
    styles.set(key, had);
    return key;
  }
  const el = document.createElement('style');
  el.id = `htmlpptx-theme-${key}`;
  el.textContent = `@layer slideria-theme{${css.replaceAll('data-th="@"', `data-th="${key}"`)}}`;
  document.head.appendChild(el);
  styles.set(key, el);
  for (const [k, s] of styles) {
    if (styles.size <= KEEP) break;
    if (k !== key && !document.querySelector(`[data-th="${k}"]`)) {
      s.remove();
      styles.delete(k);
    }
  }
  return key;
}

/** Шрифт текста для показа темы: свой шрифт темы или шрифт интерфейса */
function bodyFont(t: DeckTheme): Record<string, string> {
  const f = fontNameOk(t.font) ? `"${t.font.trim()}", var(--font-base, system-ui, sans-serif)` : 'var(--font-base, system-ui, sans-serif)';
  return { '--font': f, 'font-family': 'var(--font)' };
}

const SWATCH_ID = 'htmlpptx-theme-swatches';
/** Образцы цветов в панелях студии — в цветах темы открытой презентации */
export function applyThemeSwatches(theme: unknown): void {
  let el = document.getElementById(SWATCH_ID);
  if (!hasThemeLook(theme)) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = SWATCH_ID;
    document.head.appendChild(el);
  }
  const css = `@layer slideria-theme{${themeCss(theme, SWATCHES)}}`;
  if (el.textContent !== css) el.textContent = css;
}

const PREVIEW_ID = 'htmlpptx-theme-preview';
const PREVIEW_ATTR = 'data-th-preview';
/**
 * Примерка темы на открытом слайде (наведение на тему в галерее): только стили, слайд не
 * перерисовывается. null — примерка закончена. Без темы — показ стандартного вида
 */
export function previewTheme(theme: DeckTheme | null | undefined, stage?: HTMLElement): void {
  let el = document.getElementById(PREVIEW_ID);
  if (theme === null) {
    el?.remove();
    document.querySelectorAll(`[${PREVIEW_ATTR}]`).forEach((x) => x.removeAttribute(PREVIEW_ATTR));
    return;
  }
  stage?.setAttribute(PREVIEW_ATTR, '');
  if (!el) {
    el = document.createElement('style');
    el.id = PREVIEW_ID;
    document.head.appendChild(el);
  }
  const t: DeckTheme = theme ?? {};
  // Стандартный вид — тоже тема: с палитрой и фоном по умолчанию, поверх темы презентации
  el.textContent = `@layer slideria-preview{${themeCss(t, `[${PREVIEW_ATTR}] .slide.on`, bodyFont(t), true)}}`;
}
