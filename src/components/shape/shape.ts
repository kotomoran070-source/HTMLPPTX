import { defineBlock } from '../../engine/component';
import { styleAttr, t } from '../../engine/html';
import { GRADIENTS, gradColor, gradientCss, gradientOn, isGradient, type ShapeGradient } from '../../engine/gradients';
import { ea } from '../../engine/marks';
import { BOX_SHADOWS, boxFxCss, dropFxCss, type BoxFx } from '../../engine/box-fx';
import type { Block } from '../../types';
import { boundsOf, PRESET_KINDS, presetGeometry } from './kinds';
import './shape.css';

export { PRESET_KINDS, presetGeometry, presetGlyph } from './kinds';

/** Затенённые части (крышка цилиндра): заливка с наложенным чёрным или белым, как в PowerPoint */
const SHADE = { darken: 'rgba(0, 0, 0, .4)', darkenLess: 'rgba(0, 0, 0, .2)', lighten: 'rgba(255, 255, 255, .4)', lightenLess: 'rgba(255, 255, 255, .2)' } as const;

/** Маска слоя: контуры в SVG, растянутом на весь слой */
function maskOf(box: string, body: string): string {
  return `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="none">${body}</svg>`)}')`;
}

/** Тени фигуры и рисунка: лёгкая, заметная, глубокая (подкрутка и свечение — box-fx.ts) */
export const SHADOWS = BOX_SHADOWS;

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

export { GRADIENTS, gradientCss, gradientOn, isGradient, sameGradient, type ShapeGradient } from '../../engine/gradients';

/** Стандартные цвета: те же, что у текста */
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

export interface ShapeProps extends Block, Omit<BoxFx, 'shadow'> {
  /**
   * rect — прямоугольник, round — скруглённый, pill — капсула, ellipse — круг/овал, line — линия, arrow — стрелка;
   * фигуры PowerPoint — ключи PRESET_KINDS: diamond, triangle, star, block-arrow, callout, cylinder…
   */
  kind?: string;
  /** Заливка: surface, alt, soft, accent, text, border, muted, gradient, none или #RRGGBB */
  fill?: string;
  /** Свой градиент при fill: gradient (без него — градиент акцента) */
  gradient?: ShapeGradient;
  /** Рамка (у линии и стрелки — их цвет); gradient — градиентом strokeGradient */
  stroke?: string;
  /** Градиент контура при stroke: gradient (без него — градиент акцента) */
  strokeGradient?: ShapeGradient;
  /** Толщина рамки или линии, px */
  width?: number;
  /** Штрих рамки или линии: dash — пунктир, dot — точки */
  dash?: 'dash' | 'dot';
  /** Скругление углов, px (у round по умолчанию 16) */
  radius?: number;
  /** Тень — те же три, что у рисунка: лёгкая, заметная, глубокая (true — заметная); подкрутка и свечение — BoxFx */
  shadow?: boolean | 'sm' | 'md' | 'lg';
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
defineBlock<ShapeProps>('shape', { render: shapeHtml });

/**
 * Фигуру PowerPoint тянут за ручку рамки: заливка и контур — заново под новый размер, до записи в данные.
 * Без этого слои с масками растягивались вместе с запасом под контур — контур толстел и уходил внутрь заливки
 */
export function refitPreset(root: HTMLElement, p: ShapeProps, w: number, h: number): void {
  const el = root.querySelector<HTMLElement>('.shape-p');
  if (!el || !PRESET_KINDS[p.kind ?? '']) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = shapeHtml({ ...p, place: { ...(p as { place?: object }).place, w, h } } as ShapeProps);
  const fresh = [...(tmp.firstElementChild?.querySelectorAll(':scope > i') ?? [])];
  el.querySelectorAll(':scope > i').forEach((i) => i.remove());
  el.prepend(...fresh);
}

function shapeHtml(p: ShapeProps): string {
  const kind = p.kind ?? 'round';
  const w = Number.isFinite(Number(p.width)) ? Math.max(0, Math.min(40, Number(p.width))) : kind === 'line' || kind === 'arrow' ? 3 : 0;
  const rot = Number(p.rotate) ? `transform:rotate(${Number(p.rotate)}deg)` : '';
  const op = Number(p.opacity);
  const opacity = Number.isFinite(op) && op >= 0.1 && op < 1 ? `opacity:${op}` : '';
  const dash = p.dash === 'dash' || p.dash === 'dot' ? p.dash : '';
  const sg = p.stroke === 'gradient';
  if (kind === 'line' || kind === 'arrow') {
    // Градиент линии идёт вдоль неё; наконечник — цветом конца
    const lg = sg ? (isGradient(p.strokeGradient) ? p.strokeGradient : GRADIENTS[0].g) : null;
    const color = lg ? gradColor(lg.to) : shapeColor(p.stroke ?? p.fill) ?? 'var(--ac)';
    const head = Math.round(w * 2.2 + 6);
    // У линии — только свечение (неоновая линия): тень ей не даётся
    const glow = dropFxCss({ glow: p.glow, glowSize: p.glowSize, glowOpacity: p.glowOpacity });
    return `<div class="shape shape-line${dash ? ` shape-${dash}` : ''}${lg ? ' shape-lg' : ''}"${styleAttr(`--c:${color};--w:${w}px`, lg && `--sg:${gradientCss({ from: lg.from, to: lg.to, angle: 90 })}`, rot, opacity, glow && `filter:${glow}`, p.style)} aria-hidden="true"><i class="shape-bar"></i>`
      + (kind === 'arrow' ? `<i class="shape-head" style="--h:${head}px"></i>` : '') + `</div>`;
  }
  const fill = p.fill === 'gradient' ? gradientCss(p.gradient) : shapeFill(p.fill) ?? 'var(--acs)';
  if (PRESET_KINDS[kind]) return presetShape(p, kind, fill, w, sg, dash, [rot, opacity]);
  const stroke = w && !sg ? shapeColor(p.stroke) ?? 'var(--acb)' : '';
  // Градиентный контур — кольцом поверх краёв (рамка CSS градиентом не красится)
  const ring = w && sg ? `--sg:${gradientCss(p.strokeGradient)};--sw:${w}px` : '';
  const fx = boxFxCss(p);
  const radius = kind === 'ellipse' ? '50%' : kind === 'pill' ? '9999px' : kind === 'rect' ? `${Number(p.radius) || 0}px` : `${Number.isFinite(Number(p.radius)) ? Number(p.radius) : 16}px`;
  const css = [
    `background:${fill}`, `border-radius:${radius}`, `color:${p.fill === 'gradient' ? gradientOn(p.gradient) : onColor(p.fill ?? 'soft')}`,
    stroke ? `border:${w}px ${dash ? (dash === 'dot' ? 'dotted' : 'dashed') : 'solid'} ${stroke}` : '',
    fx ? `box-shadow:${fx}` : '',
    ring, rot, opacity,
  ].filter(Boolean).join(';');
  const v = p.valign === 'top' || p.valign === 'bottom' ? ` v-${p.valign}` : '';
  // Градиент акцента (от акцента ко второму цвету) переливается вместе с темой (theme.accentFlow)
  const duo = p.fill === 'gradient' && isGradient(p.gradient) && p.gradient.from === 'accent' && p.gradient.to === 'accent2';
  return `<div class="shape shape-${kind}${v}${ring ? ' shape-gs' : ''}${duo ? ' shape-duo' : ''}"${styleAttr(css, p.style)}>`
    + (p.text ? `<div class="shape-t"${ea(p, 'text')}>${t(p.text)}</div>` : '')
    + `</div>`;
}

/**
 * Фигура PowerPoint: заливка и контур — слои с маской по контуру фигуры (градиенты и цвета темы — как у остальных
 * фигур), затенённые части — своим слоем, тень — по контуру. Контур считается под размер объекта (place)
 */
function presetShape(p: ShapeProps, kind: string, fill: string, w: number, sg: boolean, dash: string, extra: string[]): string {
  const pl = (p as { place?: { w?: unknown; h?: unknown } }).place;
  const [dw, dh] = PRESET_KINDS[kind].size;
  const W = Math.max(8, Math.round(Number(pl?.w) || dw));
  const H = Math.max(8, Math.round(Number(pl?.h) || (W * dh) / dw));
  const paths = presetGeometry(kind, W, H);
  const fills = paths.filter((g) => g.fill && !g.shade).map((g) => `<path d="${g.d}"/>`).join('');
  const shades = paths.filter((g) => g.fill && g.shade);
  const lines = paths.filter((g) => g.stroke).map((g) => `<path d="${g.d}"/>`).join('');
  // Слой — по границам контура (хвост выноски выходит за рамку фигуры), у контура — с запасом под толщину и углы
  const [x0, y0, x1, y1] = boundsOf(paths, W, H);
  const layer = (pad: number) => ({
    box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`,
    at: `inset:${y0 - pad}px ${W - x1 - pad}px ${H - y1 - pad}px ${x0 - pad}px`,
  });
  const lf = layer(0);
  let layers = fill !== 'transparent' && fills ? `<i class="shape-f" style="${lf.at};--m:${maskOf(lf.box, fills)}"></i>` : '';
  if (fill !== 'transparent') {
    for (const g of shades) layers += `<i class="shape-f" style="${lf.at};--m:${maskOf(lf.box, `<path d="${g.d}"/>`)};--sh:${SHADE[g.shade!]}"></i>`;
  }
  if (w && lines) {
    const lo = layer(Math.ceil(w * 2 + 1));
    const pattern = dash === 'dash' ? ` stroke-dasharray="${w * 3} ${w * 2}"` : dash === 'dot' ? ` stroke-dasharray="0 ${w * 2}" stroke-linecap="round"` : '';
    const body = `<g fill="none" stroke="#000" stroke-width="${w}" stroke-linejoin="miter" stroke-miterlimit="4"${pattern}>${lines}</g>`;
    const color = sg ? gradientCss(p.strokeGradient) : shapeColor(p.stroke) ?? 'var(--acb)';
    layers += `<i class="shape-o" data-w="${w}"${dash ? ` data-dash="${dash}"` : ''} style="${lo.at};--m:${maskOf(lo.box, body)};background:${color}"></i>`;
  }
  const drop = dropFxCss(p);
  const css = [
    `--sf:${fill}`, `color:${p.fill === 'gradient' ? gradientOn(p.gradient) : onColor(p.fill ?? 'soft')}`,
    drop ? `filter:${drop}` : '', ...extra,
  ].filter(Boolean).join(';');
  const v = p.valign === 'top' || p.valign === 'bottom' ? ` v-${p.valign}` : '';
  return `<div class="shape shape-p shape-${kind}${v}" data-prst="${PRESET_KINDS[kind].prst}"${styleAttr(css, p.style)}>${layers}`
    + (p.text ? `<div class="shape-t"${ea(p, 'text')}>${t(p.text)}</div>` : '')
    + `</div>`;
}
