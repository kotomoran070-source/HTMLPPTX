import { defineBlock } from '../../engine/component';
import { styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import './shape.css';

/**
 * Цвета фигур по ролям темы: подстраиваются под тёмную тему и акцентный цвет.
 * Кроме имён можно писать #RRGGBB — тогда цвет постоянный.
 */
export const SHAPE_COLORS: Record<string, { name: string; css: string; on: string }> = {
  surface: { name: 'Карточка', css: 'var(--surf)', on: 'var(--tx)' },
  bg: { name: 'Фон слайда', css: 'var(--bg)', on: 'var(--tx)' },
  alt: { name: 'Второй фон', css: 'var(--alt)', on: 'var(--tx)' },
  soft: { name: 'Светлый акцент', css: 'var(--acs)', on: 'var(--ach)' },
  accent: { name: 'Акцент', css: 'var(--ac)', on: 'var(--on-ac)' },
  text: { name: 'Цвет текста', css: 'var(--tx)', on: 'var(--bg)' },
  line: { name: 'Линия', css: 'var(--bd)', on: 'var(--tx)' },
  border: { name: 'Рамка', css: 'var(--bd2)', on: 'var(--tx)' },
  muted: { name: 'Приглушённый', css: 'var(--mu)', on: 'var(--bg)' },
};

/** Заливка-градиент от акцентного цвета: только для заливки, не для контура */
export const SHAPE_GRADIENT = { name: 'Градиент акцента', css: 'linear-gradient(135deg, color-mix(in srgb, var(--ac) 72%, #fff), color-mix(in srgb, var(--ac) 78%, #000))', on: 'var(--on-ac)' };

/** Постоянные цвета: те же, что у текста */
export const SHAPE_SWATCHES = ['#111827', '#64748B', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#2563EB', '#7C3AED', '#DB2777'];

/**
 * Готовые стили — сочетания заливки, контура и тени, как «Стили фигур» в PowerPoint.
 * line — цвет, который стиль даёт линии и стрелке.
 */
export const SHAPE_STYLES: { id: string; name: string; props: Partial<ShapeProps>; line: string }[] = [
  { id: 'soft', name: 'Мягкий', props: { fill: 'soft' }, line: 'accent' },
  { id: 'accent', name: 'Акцент', props: { fill: 'accent' }, line: 'accent' },
  { id: 'gradient', name: 'Градиент', props: { fill: 'gradient', shadow: 'sm' }, line: 'accent' },
  { id: 'dark', name: 'Тёмный', props: { fill: 'text' }, line: 'text' },
  { id: 'card', name: 'Карточка', props: { fill: 'surface', stroke: 'line', width: 1, shadow: 'sm' }, line: 'border' },
  { id: 'outline', name: 'Контур', props: { fill: 'none', stroke: 'accent', width: 2 }, line: 'accent' },
  { id: 'subtle', name: 'Спокойный', props: { fill: 'alt', stroke: 'line', width: 1 }, line: 'muted' },
  { id: 'dashed', name: 'Пунктир', props: { fill: 'none', stroke: 'border', width: 2, dash: 'dash' }, line: 'border' },
];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function shapeColor(c: unknown): string | null {
  if (c === 'none') return 'transparent';
  if (typeof c !== 'string') return null;
  return SHAPE_COLORS[c]?.css ?? (HEX.test(c) ? c : null);
}

/** CSS заливки: цвет, «нет» или градиент акцента. */
export function shapeFill(c: unknown): string | null {
  return c === 'gradient' ? SHAPE_GRADIENT.css : shapeColor(c);
}

/** Цвет текста поверх заливки: светлый на тёмном и наоборот. */
function onColor(fill: unknown): string {
  if (fill === 'gradient') return SHAPE_GRADIENT.on;
  if (typeof fill === 'string' && SHAPE_COLORS[fill]) return SHAPE_COLORS[fill].on;
  if (typeof fill === 'string' && HEX.test(fill)) {
    const h = fill.length === 4 ? fill.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : fill;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111827' : '#FFFFFF';
  }
  return 'var(--tx)';
}

export interface ShapeProps extends Block {
  /** rect — прямоугольник, round — скруглённый, pill — капсула, ellipse — круг/овал, line — линия, arrow — стрелка */
  kind?: 'rect' | 'round' | 'pill' | 'ellipse' | 'line' | 'arrow';
  /** Заливка: surface, alt, soft, accent, text, border, muted, gradient, none или #RRGGBB */
  fill?: string;
  /** Рамка (у линии и стрелки — их цвет) */
  stroke?: string;
  /** Толщина рамки или линии, px */
  width?: number;
  /** Штрих рамки или линии: dash — пунктир, dot — точки */
  dash?: 'dash' | 'dot';
  /** Скругление углов, px (у round по умолчанию 16) */
  radius?: number;
  /** Тень: true или md — заметная, sm — лёгкая */
  shadow?: boolean | 'sm' | 'md';
  /** Непрозрачность, от 0.1 до 1 */
  opacity?: number;
  /** Поворот, градусы (линию и стрелку можно повернуть в любую сторону) */
  rotate?: number;
  /** Текст внутри фигуры */
  text?: string;
  /** Текст по вертикали: top, middle (по умолчанию), bottom */
  valign?: 'top' | 'middle' | 'bottom';
}

/** Фигура: прямоугольник, скруглённый, капсула, овал, линия, стрелка; с текстом внутри или без. */
defineBlock<ShapeProps>('shape', {
  render(p) {
    const kind = p.kind ?? 'round';
    const w = Number.isFinite(Number(p.width)) ? Math.max(0, Math.min(40, Number(p.width))) : kind === 'line' || kind === 'arrow' ? 3 : 0;
    const rot = Number(p.rotate) ? `transform:rotate(${Number(p.rotate)}deg)` : '';
    const op = Number(p.opacity);
    const opacity = Number.isFinite(op) && op >= 0.1 && op < 1 ? `opacity:${op}` : '';
    const dash = p.dash === 'dash' || p.dash === 'dot' ? p.dash : '';
    if (kind === 'line' || kind === 'arrow') {
      const color = shapeColor(p.stroke ?? p.fill) ?? 'var(--ac)';
      const head = Math.round(w * 2.2 + 6);
      return `<div class="shape shape-line${dash ? ` shape-${dash}` : ''}"${styleAttr(`--c:${color};--w:${w}px`, rot, opacity, p.style)} aria-hidden="true"><i class="shape-bar"></i>`
        + (kind === 'arrow' ? `<i class="shape-head" style="--h:${head}px"></i>` : '') + `</div>`;
    }
    const fill = shapeFill(p.fill) ?? 'var(--acs)';
    const stroke = w ? shapeColor(p.stroke) ?? 'var(--acb)' : '';
    const radius = kind === 'ellipse' ? '50%' : kind === 'pill' ? '9999px' : kind === 'rect' ? `${Number(p.radius) || 0}px` : `${Number.isFinite(Number(p.radius)) ? Number(p.radius) : 16}px`;
    const css = [
      `background:${fill}`, `border-radius:${radius}`, `color:${onColor(p.fill ?? 'soft')}`,
      stroke ? `border:${w}px ${dash ? (dash === 'dot' ? 'dotted' : 'dashed') : 'solid'} ${stroke}` : '',
      p.shadow ? `box-shadow:var(--shadow-${p.shadow === 'sm' ? 'sm' : 'md'})` : '',
      rot, opacity,
    ].filter(Boolean).join(';');
    const v = p.valign === 'top' || p.valign === 'bottom' ? ` v-${p.valign}` : '';
    return `<div class="shape shape-${kind}${v}"${styleAttr(css, p.style)}>`
      + (p.text ? `<div class="shape-t"${ea(p, 'text')}>${t(p.text)}</div>` : '')
      + `</div>`;
  },
});
