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
  const ld = Number(s.leading);
  if (Number.isFinite(ld) && ld >= 0.8 && ld <= 3) out.push(`line-height:${ld}`);
  return out.join(';');
}
