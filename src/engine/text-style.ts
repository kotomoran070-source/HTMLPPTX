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
  if (Number.isFinite(size) && size >= 6 && size <= 300) out.push(`font-size:${size}px`);
  const color = colorCss(s.color);
  if (color) out.push(`color:${color}`, `fill:${color}`);
  if (s.align && ALIGN.has(s.align)) out.push(`text-align:${s.align}`);
  if (s.font && FONTS[s.font]) out.push(`font-family:${FONTS[s.font].css}`);
  return out.join(';');
}
