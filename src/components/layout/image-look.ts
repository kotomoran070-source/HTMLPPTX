import { shapeColor } from '../shape/shape';

/**
 * Оформление картинки, как «Формат рисунка» в PowerPoint: контур, тень, скругление, паспарту,
 * прозрачность и цветовой фильтр. Всё — поля блока image, общие с фигурой, где смысл тот же.
 */
export interface ImageLook {
  /** Цвет контура: роль темы (accent, line, text…) или #RRGGBB */
  stroke?: string;
  /** Толщина контура, px */
  width?: number;
  /** Штрих контура: dash — пунктир, dot — точки */
  dash?: 'dash' | 'dot';
  /** Скругление углов, px; circle — круг или овал. По умолчанию 12 */
  radius?: number | 'circle';
  /** Тень: sm — лёгкая, md — заметная, lg — глубокая */
  shadow?: 'sm' | 'md' | 'lg';
  /** Паспарту: поле цвета карточки вокруг снимка, px */
  mat?: number;
  /** Непрозрачность, от 0.1 до 1 */
  opacity?: number;
  /** Цвет: gray — чёрно-белый, sepia — сепия, muted — приглушённый, vivid — насыщенный, light — светлее, dark — темнее */
  filter?: 'gray' | 'sepia' | 'muted' | 'vivid' | 'light' | 'dark';
}

export const IMAGE_SHADOWS: Record<string, { name: string; css: string }> = {
  sm: { name: 'Лёгкая', css: '0 2px 8px rgba(15, 23, 42, .14)' },
  md: { name: 'Заметная', css: '0 10px 28px rgba(15, 23, 42, .20)' },
  lg: { name: 'Глубокая', css: '0 22px 50px rgba(15, 23, 42, .30)' },
};

export const IMAGE_FILTERS: Record<string, { name: string; css: string }> = {
  gray: { name: 'Чёрно-белый', css: 'grayscale(1)' },
  sepia: { name: 'Сепия', css: 'sepia(.85)' },
  muted: { name: 'Приглушённый', css: 'saturate(.45) contrast(.92) brightness(1.04)' },
  vivid: { name: 'Насыщенный', css: 'saturate(1.45) contrast(1.06)' },
  light: { name: 'Светлее', css: 'brightness(1.18) contrast(.9)' },
  dark: { name: 'Темнее', css: 'brightness(.78) contrast(1.05)' },
};

/** Поля оформления: их стирает «Сбросить оформление» и переносит формат по образцу */
export const IMAGE_LOOK_KEYS = ['stroke', 'width', 'dash', 'radius', 'shadow', 'mat', 'opacity', 'filter'] as const;

/** Готовые стили галереи; «Обычный» — без полей оформления */
export const IMAGE_STYLES: { id: string; name: string; props: ImageLook }[] = [
  { id: 'plain', name: 'Обычный', props: {} },
  { id: 'square', name: 'Прямые углы', props: { radius: 0 } },
  { id: 'thin', name: 'Тонкая рамка', props: { stroke: 'line', width: 1 } },
  { id: 'accent', name: 'Акцентная рамка', props: { stroke: 'accent', width: 3 } },
  { id: 'shadow', name: 'С тенью', props: { shadow: 'md' } },
  { id: 'photo', name: 'Фотография', props: { mat: 10, radius: 6, shadow: 'md' } },
  { id: 'soft', name: 'Мягкий', props: { radius: 28, shadow: 'sm' } },
  { id: 'circle', name: 'Круг', props: { radius: 'circle' } },
];

/** CSS рамки картинки (box), самой картинки (img) и признак явного оформления (для экспорта в PPTX) */
export function imageLookCss(p: ImageLook): { box: string; img: string; fx: boolean } {
  const box: string[] = [];
  const w = Math.max(0, Math.min(40, Number(p.width) || 0));
  const stroke = w ? shapeColor(p.stroke) ?? 'var(--bd2)' : '';
  if (stroke) box.push(`border:${w}px ${p.dash === 'dot' ? 'dotted' : p.dash === 'dash' ? 'dashed' : 'solid'} ${stroke}`);
  const r = p.radius === 'circle' ? '50%' : Number.isFinite(Number(p.radius)) && p.radius !== undefined ? `${Math.max(0, Math.min(400, Number(p.radius)))}px` : '';
  if (r) box.push(`border-radius:${r}`);
  if (p.shadow && IMAGE_SHADOWS[p.shadow]) box.push(`box-shadow:${IMAGE_SHADOWS[p.shadow].css}`);
  const mat = Math.max(0, Math.min(80, Number(p.mat) || 0));
  if (mat) box.push(`--mat:${mat}px`, 'background:var(--surf)');
  const op = Number(p.opacity);
  if (Number.isFinite(op) && op >= 0.1 && op < 1) box.push(`opacity:${op}`);
  const img: string[] = [];
  if (p.filter && IMAGE_FILTERS[p.filter]) img.push(`filter:${IMAGE_FILTERS[p.filter].css}`);
  // Снимок в паспарту скруглён в тон рамке
  if (mat) img.push(`border-radius:${p.radius === 'circle' ? '50%' : `${Math.max(0, (r ? parseFloat(r) : 12) - mat)}px`}`);
  return { box: box.join(';'), img: img.join(';'), fx: box.length + img.length > 0 };
}
