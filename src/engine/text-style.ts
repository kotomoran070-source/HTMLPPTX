import { fontNameOk, fontStack } from './fonts';
/**
 * Оформление отдельного текстового поля. Хранится рядом с полем:
 *   title: Итоги
 *   styles:
 *     title: { size: 52, color: "#1D4ED8", align: center, font: serif }
 */
export interface TextStyle {
  /** Размер шрифта в пикселях слайда (слайд — 1280×720) */
  size?: number;
  /** Цвет: #RRGGBB или имя из палитры: accent, text, muted, white */
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
  /**
   * Маркер пунктов списка: dot (по умолчанию), dash, check, arrow, square, num, paren, alpha —
   * или свой: символ, эмодзи или короткий текст; # в нём — номер пункта («Шаг #:», «[#]»)
   */
  list?: string;
  /** Цвет маркера: #RRGGBB или цвет темы (accent, text…); без поля — акцент */
  listColor?: string;
}

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

/** Свой маркер: до 12 знаков, без кавычек, точки с запятой и обратной косой черты (они ломают CSS) */
export function customMarker(v: unknown): string | null {
  if (typeof v !== 'string' || LIST_MARKERS[v]) return null;
  const t = v.trim();
  return t && [...t].length <= 12 && !/["\\;\n\r]/.test(t) ? t : null;
}

/** Переменные маркера для .md-li (layout.css): вид списка и цвет */
export function listCss(list: unknown, color?: unknown): string {
  const out: string[] = [];
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
  if (color) out.push(`color:${color}`, `fill:${color}`);
  if (s.align && ALIGN.has(s.align)) out.push(`text-align:${s.align}`);
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
  const lc = listCss(s.list, s.listColor);
  if (lc) out.push(lc);
  const ld = Number(s.leading);
  if (Number.isFinite(ld) && ld >= 0.8 && ld <= 3) out.push(`line-height:${ld}`);
  return out.join(';');
}
