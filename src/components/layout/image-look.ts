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
  /** Цвет (фильтр, как LUT): ключ из IMAGE_FILTERS — gray, sepia, film, duo… */
  filter?: string;
}

export const IMAGE_SHADOWS: Record<string, { name: string; css: string }> = {
  sm: { name: 'Лёгкая', css: '0 2px 8px rgba(15, 23, 42, .14)' },
  md: { name: 'Заметная', css: '0 10px 28px rgba(15, 23, 42, .20)' },
  lg: { name: 'Глубокая', css: '0 22px 50px rgba(15, 23, 42, .30)' },
};

/**
 * Цветовые фильтры — как LUT: цепочка CSS-фильтров и, у части, тонировка поверх снимка
 * (цвет и режим наложения). Тонировка цветом акцента следует за темой и акцентом презентации.
 * В PPTX всё это запекается в картинку так же, как видно на слайде.
 */
export interface ImageFilter {
  name: string;
  /** Раздел галереи */
  group: 'base' | 'mood' | 'theme';
  css: string;
  tint?: { color: string; blend: 'color' | 'soft-light' | 'multiply' | 'screen' | 'overlay'; opacity: number };
}

export const IMAGE_FILTER_GROUPS: Record<ImageFilter['group'], string> = { base: 'Основные', mood: 'Настроение', theme: 'В цветах темы' };

export const IMAGE_FILTERS: Record<string, ImageFilter> = {
  gray: { name: 'Чёрно-белый', group: 'base', css: 'grayscale(1)' },
  sepia: { name: 'Сепия', group: 'base', css: 'sepia(.85)' },
  muted: { name: 'Приглушённый', group: 'base', css: 'saturate(.45) contrast(.92) brightness(1.04)' },
  vivid: { name: 'Насыщенный', group: 'base', css: 'saturate(1.45) contrast(1.06)' },
  light: { name: 'Светлее', group: 'base', css: 'brightness(1.18) contrast(.9)' },
  dark: { name: 'Темнее', group: 'base', css: 'brightness(.78) contrast(1.05)' },
  warm: { name: 'Тёплый', group: 'mood', css: 'sepia(.2) saturate(1.2) brightness(1.03)', tint: { color: '#F59E0B', blend: 'soft-light', opacity: 0.3 } },
  cool: { name: 'Холодный', group: 'mood', css: 'saturate(.95) contrast(1.04) brightness(1.02)', tint: { color: '#3B82F6', blend: 'soft-light', opacity: 0.35 } },
  film: { name: 'Плёнка', group: 'mood', css: 'contrast(.88) brightness(1.07) saturate(.8) sepia(.15)' },
  punch: { name: 'Сочный', group: 'mood', css: 'contrast(1.2) saturate(1.35) brightness(1.02)' },
  cinema: { name: 'Кино', group: 'mood', css: 'contrast(1.12) saturate(1.05) brightness(.97)', tint: { color: '#0E7490', blend: 'soft-light', opacity: 0.32 } },
  dusk: { name: 'Сумерки', group: 'mood', css: 'brightness(.9) contrast(1.08) saturate(1.1)', tint: { color: '#7C3AED', blend: 'soft-light', opacity: 0.38 } },
  noir: { name: 'Нуар', group: 'mood', css: 'grayscale(1) contrast(1.4) brightness(.9)' },
  tone: { name: 'Тон акцента', group: 'theme', css: 'saturate(.9)', tint: { color: 'var(--ac)', blend: 'soft-light', opacity: 0.55 } },
  duo: { name: 'Дуотон акцента', group: 'theme', css: 'grayscale(1) contrast(1.1)', tint: { color: 'var(--ac)', blend: 'color', opacity: 0.85 } },
  duo2: { name: 'Два акцента', group: 'theme', css: 'grayscale(1) contrast(1.1)', tint: { color: 'linear-gradient(135deg, var(--ac), var(--ac2, var(--ac)))', blend: 'color', opacity: 0.85 } },
  haze: { name: 'Дымка акцента', group: 'theme', css: 'contrast(.9) brightness(1.08) saturate(.7)', tint: { color: 'var(--ac)', blend: 'screen', opacity: 0.28 } },
};

/** CSS фильтра: для снимка (img) и для рамки (тонировка — через ::after, см. layout.css) */
export function filterCss(key: unknown): { img: string; box: string; tint: boolean } {
  const f = typeof key === 'string' ? IMAGE_FILTERS[key] : undefined;
  if (!f) return { img: '', box: '', tint: false };
  const box = f.tint ? `--tint:${f.tint.color};--tint-blend:${f.tint.blend};--tint-op:${f.tint.opacity}` : '';
  return { img: `filter:${f.css}`, box, tint: !!f.tint };
}

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
export function imageLookCss(p: ImageLook): { box: string; img: string; fx: boolean; cls: string } {
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
  const fl = filterCss(p.filter);
  if (fl.img) img.push(fl.img);
  if (fl.box) box.push(fl.box);
  // Снимок в паспарту скруглён в тон рамке
  if (mat) img.push(`border-radius:${p.radius === 'circle' ? '50%' : `${Math.max(0, (r ? parseFloat(r) : 12) - mat)}px`}`);
  const fx = box.length + img.length > 0;
  return { box: box.join(';'), img: img.join(';'), fx, cls: `${fx ? ' img-fx' : ''}${fl.tint ? ' img-tint' : ''}` };
}
