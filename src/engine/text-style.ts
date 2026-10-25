import { fontNameOk, fontStack } from './fonts';
import { textGradientCss } from './gradients';
/**
 * Оформление отдельного текстового поля. Хранится рядом с полем:
 *   title: Итоги
 *   styles:
 *     title: { size: 52, color: "#1D4ED8", align: center, font: serif }
 */
export interface TextStyle {
  /** Размер шрифта в пикселях слайда (слайд — 1280×720) */
  size?: number;
  /** Цвет: #RRGGBB, имя из палитры (accent, text, muted) или градиент всего текста (g:sunset, g:#F97316,#7C3AED) */
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  font?: string;
  /** Наибольшая ширина поля в пикселях слайда: текст переносится раньше */
  width?: number;
  /** Насыщенность шрифта: 400 — обычный, 700 — жирный */
  weight?: number;
  /** Заглавными буквами */
  upper?: boolean;
  /** Межбуквенный интервал, em */
  spacing?: number;
  /** Межстрочный интервал (множитель) */
  leading?: number;
  /** Отступ между абзацами (пустая строка в тексте), px; без него — в строку */
  gap?: number;
  /**
   * Маркер пунктов списка: dot (по умолчанию), dash, check, arrow, square, num, paren, alpha —
   * или свой: символ, эмодзи или короткий текст; # в нём — номер пункта («Шаг #:», «[#]»)
   */
  list?: string;
  /** Цвет маркера: #RRGGBB или цвет темы (accent, text…); без поля — акцент */
  listColor?: string;
  /** Маркер-картинка: файл в assets/ (вместо символа) */
  listImage?: string;
  // Оформление всего поля с вкладки «Надпись» (части текста — разметкой: **жирный**, *курсив*, __подчёркнутый__)
  italic?: boolean;
  underline?: boolean;
  /** Тень букв: TEXT_SHADOWS (soft, lift, hard, extrude, retro) */
  shadow?: string;
  /** Свечение вокруг букв: цвет темы или #RRGGBB */
  glow?: string;
  /** Контур букв, px, и его цвет (без цвета — акцент) */
  outline?: number;
  outlineColor?: string;
  /** Только контур: буквы без заливки */
  hollow?: boolean;
  /** Плашка под текстом: цвет темы, soft (светлый акцент) или #RRGGBB */
  plate?: string;
  /** Непрозрачность текста, 0.1–1 */
  opacity?: number;
}

/**
 * Тени букв — в em, растут вместе с текстом. Объёмная и ретро — в цвете акцента: меняются с темой.
 * У градиентного и контурного текста тень рисуется фильтром: text-shadow просвечивал бы сквозь буквы
 */
export const TEXT_SHADOWS: Record<string, { name: string; css: string }> = {
  soft: { name: 'Мягкая', css: '0 .04em .14em rgb(15 23 42 / .35)' },
  lift: { name: 'Парящая', css: '0 .1em .3em rgb(15 23 42 / .42)' },
  hard: { name: 'Чёткая', css: '.05em .06em 0 rgb(15 23 42 / .5)' },
  extrude: {
    name: 'Объёмная',
    css: [1, 2, 3, 4, 5, 6].map((i) => `${(i * 0.016).toFixed(3)}em ${(i * 0.016).toFixed(3)}em 0 color-mix(in srgb, var(--ac) ${70 - i * 4}%, #000)`).join(', '),
  },
  retro: { name: 'Ретро', css: '.06em .06em 0 var(--ac)' },
};

/** Цвета эффектов (плашка, контур, свечение): цвета темы и ещё светлый акцент и цвет фона карточек */
const FX_COLORS: Record<string, string> = { soft: 'var(--acs)', surface: 'var(--surf)' };
export const fxColor = (c: unknown): string | null => (typeof c === 'string' && FX_COLORS[c] ? FX_COLORS[c] : colorCss(c));

/**
 * Маркеры списка: подпись для меню и переменные для .md-li::before (layout.css).
 * Нумерация — счётчиком CSS: пункты нумеруются по порядку внутри текста
 */
export const LIST_MARKERS: Record<string, { name: string; sample: string; css: string }> = {
  dot: { name: 'Точка', sample: '•', css: '' },
  square: { name: 'Квадрат', sample: '▪', css: '--li-r:1.5px' },
  dash: { name: 'Тире', sample: '–', css: '--li-mark:"–";--li-w:auto;--li-h:auto;--li-bg:none;--li-top:0' },
  check: { name: 'Галочка', sample: '✓', css: '--li-mark:"✓";--li-w:auto;--li-h:auto;--li-bg:none;--li-top:0;--li-pad:1.3em' },
  arrow: { name: 'Стрелка', sample: '→', css: '--li-mark:"→";--li-w:auto;--li-h:auto;--li-bg:none;--li-top:0;--li-pad:1.35em' },
  num: { name: 'Нумерация 1.', sample: '1.', css: '--li-mark:counter(md-li) ".";--li-w:auto;--li-h:auto;--li-bg:none;--li-top:0;--li-pad:1.7em;--li-left:0' },
  paren: { name: 'Нумерация 1)', sample: '1)', css: '--li-mark:counter(md-li) ")";--li-w:auto;--li-h:auto;--li-bg:none;--li-top:0;--li-pad:1.7em;--li-left:0' },
  alpha: { name: 'Буквы а)', sample: 'а)', css: '--li-mark:counter(md-li, cyrillic-lower) ")";--li-w:auto;--li-h:auto;--li-bg:none;--li-top:0;--li-pad:1.7em;--li-left:0' },
};

/** Объявления CSS «имя:значение;…» по одному — точка с запятой внутри url("…") не делит */
export function splitDecls(css: string): [string, string][] {
  return [...css.matchAll(/([\w-]+)\s*:\s*((?:url\("[^"]*"\)|"[^"]*"|[^;])+)/g)].map((m) => [m[1], m[2].trim()]);
}

/** Свой маркер: до 12 знаков, без кавычек, точки с запятой и обратной косой черты (они ломают CSS) */
export function customMarker(v: unknown): string | null {
  if (typeof v !== 'string' || LIST_MARKERS[v]) return null;
  const t = v.trim();
  return t && [...t].length <= 12 && !/["\\;\n\r]/.test(t) ? t : null;
}

/** Адрес картинки-маркера, безопасный внутри url("…") */
export function markerImage(v: unknown): string | null {
  return typeof v === 'string' && v && v.length < 2_000_000 && !/["\\\n\r]/.test(v) ? v : null;
}

/** Переменные маркера для .md-li (layout.css): вид списка, картинка и цвет */
export function listCss(list: unknown, color?: unknown, image?: unknown): string {
  const out: string[] = [];
  const img = markerImage(image);
  if (img) return `--li-mark:"";--li-bg:url("${img}") center / contain no-repeat;--li-w:.95em;--li-h:.95em;--li-top:.2em;--li-r:0;--li-left:0;--li-pad:1.45em`;
  const mk = typeof list === 'string' ? LIST_MARKERS[list] : undefined;
  if (mk?.css) out.push(mk.css);
  const own = mk ? null : customMarker(list);
  if (own) {
    // # — номер пункта: CSS-счётчик между кусками текста
    const content = own.split('#').map((x) => (x ? `"${x}"` : '')).join(' counter(md-li) ').trim();
    // Отступ текста — по длине маркера (эмодзи и номер шире буквы)
    const len = [...own.replace(/#/g, '00')].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 1.6 : 0.62), 0);
    out.push(`--li-mark:${content};--li-w:auto;--li-h:auto;--li-bg:none;--li-top:0;--li-left:0;--li-pad:${Math.max(1.3, Math.round((len + 0.45) * 100) / 100)}em`);
  }
  const c = colorCss(color);
  if (c) out.push(`--li-c:${c}`);
  return out.join(';');
}

export const FONTS: Record<string, { name: string; css: string }> = {
  sans: { name: 'Без засечек', css: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  serif: { name: 'С засечками', css: 'Georgia, "Times New Roman", "PT Serif", serif' },
  mono: { name: 'Моноширинный', css: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace' },
  rounded: { name: 'Округлый', css: 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif' },
};

/** Цвета темы: подстраиваются под светлую и тёмную тему */
export const THEME_COLORS: Record<string, { name: string; css: string }> = {
  accent: { name: 'Акцент', css: 'var(--ac)' },
  accent2: { name: 'Акцент тёмный', css: 'var(--ach)' },
  text: { name: 'Основной текст', css: 'var(--tx)' },
  text2: { name: 'Второстепенный', css: 'var(--tx2)' },
  muted: { name: 'Приглушённый', css: 'var(--mu)' },
};

export const SWATCHES = ['#111827', '#FFFFFF', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#2563EB', '#7C3AED', '#DB2777'];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ALIGN = new Set(['left', 'center', 'right', 'justify']);

export function colorCss(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  if (THEME_COLORS[c]) return THEME_COLORS[c].css;
  return HEX.test(c) ? c : null;
}

/** CSS для оформления; некорректные значения пропускаются. */
export function textStyleCss(st: unknown): string {
  if (!st || typeof st !== 'object') return '';
  const s = st as TextStyle;
  const out: string[] = [];
  const size = Number(s.size);
  // Крупный текст без своего шрифта пишется шрифтом заголовков темы — с его поправкой размера
  const head = size >= 28 && !(s.font && FONTS[s.font]) && !fontNameOk(s.font);
  // Крупный текст (заголовок) переносится ровными строками
  if (Number.isFinite(size) && size >= 6 && size <= 300) out.push(head ? `font-size:calc(${size}px * var(--h-scale, 1))` : `font-size:${size}px`, ...(size >= 28 ? ['text-wrap:balance'] : []));
  const color = colorCss(s.color);
  // Градиент всего текста: рамка по самому тексту (иначе градиент растянулся бы на всю ширину поля)
  const grad = !color && typeof s.color === 'string' && s.color.startsWith('g:') ? textGradientCss(s.color) : null;
  const plate = grad ? null : fxColor(s.plate);
  if (color) out.push(`color:${color}`, `fill:${color}`);
  if (grad) out.push(grad, 'background:var(--g)', '-webkit-background-clip:text', 'background-clip:text', '-webkit-text-fill-color:transparent');
  if (s.align && ALIGN.has(s.align)) out.push(`text-align:${s.align}`);
  if (grad || plate) {
    // По ширине текста, на своём месте строки: слева, по центру или справа
    out.push('width:fit-content', 'max-width:100%', 'flex:none', 'box-sizing:border-box');
    if (s.align === 'center') out.push('margin-left:auto', 'margin-right:auto');
    else if (s.align === 'right') out.push('margin-left:auto');
  }
  if (plate) out.push(`background:${plate}`, 'padding:.14em .5em .18em', 'border-radius:.3em');
  if (s.font && FONTS[s.font]) out.push(`font-family:${FONTS[s.font].css}`);
  // Свой шрифт презентации (fonts в deck.yaml) — по имени
  else if (fontNameOk(s.font)) out.push(`font-family:${fontStack(s.font)}`);
  // Крупный текст без своего шрифта — шрифтом заголовков темы (deck-theme.ts). Без запасного
  // значения: у презентации без шрифта заголовков текст наследует шрифт, как раньше
  else if (head && size <= 300) out.push('font-family:var(--font-head)');
  const w = Number(s.width);
  if (Number.isFinite(w) && w >= 40 && w <= 1280) out.push(`max-width:${Math.round(w)}px`);
  const wt = Number(s.weight);
  if (Number.isFinite(wt) && wt >= 100 && wt <= 900) out.push(`font-weight:${Math.round(wt / 50) * 50}`);
  if (s.upper === true) out.push('text-transform:uppercase');
  const sp = Number(s.spacing);
  if (Number.isFinite(sp) && sp !== 0 && Math.abs(sp) <= 1) out.push(`letter-spacing:${sp}em`);
  const lc = listCss(s.list, s.listColor, s.listImage);
  if (lc) out.push(lc);
  const ld = Number(s.leading);
  if (Number.isFinite(ld) && ld >= 0.8 && ld <= 3) out.push(`line-height:${ld}`);
  const gap = Number(s.gap);
  if (Number.isFinite(gap) && gap >= 0 && gap <= 200 && s.gap !== undefined) out.push(`--pgap:${gap}px`);
  if (s.italic === true) out.push('font-style:italic');
  if (s.underline === true) out.push('text-decoration:underline', 'text-underline-offset:.12em');
  out.push(...effectCss(s, !!grad));
  const op = Number(s.opacity);
  if (Number.isFinite(op) && op >= 0.1 && op < 1) out.push(`opacity:${op}`);
  return out.join(';');
}

/** Тень, свечение и контур букв; у градиентного и контурного текста тень и свечение — фильтром */
function effectCss(s: TextStyle, grad: boolean): string[] {
  const out: string[] = [];
  const hollow = s.hollow === true;
  const w = Number(s.outline);
  const width = Number.isFinite(w) && w > 0 ? Math.min(12, w) : hollow ? 2 : 0;
  if (width) {
    const c = fxColor(s.outlineColor) ?? (hollow ? colorCss(s.color) : null) ?? 'var(--ac)';
    // Контур под заливкой (paint-order): буквы не худеют; без заливки — виден целиком
    out.push(`-webkit-text-stroke:${hollow ? width : width * 2}px ${c}`, 'paint-order:stroke fill');
  }
  if (hollow) out.push('color:transparent', '-webkit-text-fill-color:transparent');
  const shadows: string[] = [];
  if (typeof s.shadow === 'string' && TEXT_SHADOWS[s.shadow]) shadows.push(TEXT_SHADOWS[s.shadow].css);
  const glow = fxColor(s.glow);
  if (glow) shadows.push(`0 0 .03em ${glow}`, `0 0 .12em ${glow}`, `0 0 .34em color-mix(in srgb, ${glow} 50%, transparent)`);
  if (!shadows.length) return out;
  if (grad || hollow) {
    // Фильтр понимает только по одной тени в drop-shadow: список — цепочкой
    const list = shadows.join(', ').split(/,(?![^(]*\))/).map((x) => x.trim());
    out.push(`filter:${list.map((x) => `drop-shadow(${x})`).join(' ')}`);
  } else out.push(`text-shadow:${shadows.join(', ')}`);
  return out;
}
