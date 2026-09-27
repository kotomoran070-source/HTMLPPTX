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

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function shapeColor(c: unknown): string | null {
  if (c === 'none') return 'transparent';
  if (typeof c !== 'string') return null;
  return SHAPE_COLORS[c]?.css ?? (HEX.test(c) ? c : null);
}

/** Цвет текста поверх заливки: светлый на тёмном и наоборот. */
function onColor(fill: unknown): string {
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
  /** Заливка: surface, alt, soft, accent, text, border, muted, none или #RRGGBB */
  fill?: string;
  /** Рамка (у линии и стрелки — их цвет) */
  stroke?: string;
  /** Толщина рамки или линии, px */
  width?: number;
  /** Скругление углов, px (у round по умолчанию 16) */
  radius?: number;
  /** Тень: true или md — заметная, sm — лёгкая */
  shadow?: boolean | 'sm' | 'md';
  /** Поворот, градусы (линию и стрелку можно повернуть в любую сторону) */
  rotate?: number;
  /** Текст внутри фигуры */
  text?: string;
}

/** Фигура: прямоугольник, скруглённый, капсула, овал, линия, стрелка; с текстом внутри или без. */
defineBlock<ShapeProps>('shape', {
  render(p) {
    const kind = p.kind ?? 'round';
    const w = Number.isFinite(Number(p.width)) ? Math.max(0, Math.min(40, Number(p.width))) : kind === 'line' || kind === 'arrow' ? 3 : 0;
    const rot = Number(p.rotate) ? `transform:rotate(${Number(p.rotate)}deg)` : '';
    if (kind === 'line' || kind === 'arrow') {
      const color = shapeColor(p.stroke ?? p.fill) ?? 'var(--ac)';
      const head = Math.round(w * 2.2 + 6);
      return `<div class="shape shape-line"${styleAttr(`--c:${color};--w:${w}px`, rot, p.style)} aria-hidden="true"><i class="shape-bar"></i>`
        + (kind === 'arrow' ? `<i class="shape-head" style="--h:${head}px"></i>` : '') + `</div>`;
    }
    const fill = shapeColor(p.fill) ?? 'var(--acs)';
    const stroke = w ? shapeColor(p.stroke) ?? 'var(--acb)' : '';
    const radius = kind === 'ellipse' ? '50%' : kind === 'pill' ? '9999px' : kind === 'rect' ? `${Number(p.radius) || 0}px` : `${Number.isFinite(Number(p.radius)) ? Number(p.radius) : 16}px`;
    const css = [
      `background:${fill}`, `border-radius:${radius}`, `color:${onColor(p.fill ?? 'soft')}`,
      stroke ? `border:${w}px solid ${stroke}` : '',
      p.shadow ? `box-shadow:var(--shadow-${p.shadow === 'sm' ? 'sm' : 'md'})` : '',
      rot,
    ].filter(Boolean).join(';');
    return `<div class="shape shape-${kind}"${styleAttr(css, p.style)}>`
      + (p.text ? `<div class="shape-t"${ea(p, 'text')}>${t(p.text)}</div>` : '')
      + `</div>`;
  },
});
