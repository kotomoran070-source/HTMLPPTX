/**
 * Тень и свечение фигуры и рисунка — как «Эффекты» панели «Формат» в PowerPoint. Тень — готовая
 * (лёгкая, заметная, глубокая) и подкрутка поверх неё: цвет, плотность, размытие, расстояние, направление.
 * Свечение — мягкий ореол цвета по краю: цвет, размер, яркость. Размеры — в пикселях слайда.
 */
import { GRADIENT_ROLES, GRADIENTS, gradColor } from './gradients';

export interface BoxFx {
  /** Тень: sm — лёгкая, md — заметная, lg — глубокая (true — заметная) */
  shadow?: boolean | string;
  /** Цвет тени: роль темы (accent, text…) или #RRGGBB; по умолчанию — тёмно-синий */
  shadowColor?: string;
  /** Плотность тени, 0–1 */
  shadowOpacity?: number;
  /** Размытие и расстояние тени, px */
  shadowBlur?: number;
  shadowDist?: number;
  /** Куда падает тень, градусы: 90 — вниз, 0 — вправо */
  shadowAngle?: number;
  /** Свечение: цвет — роль темы или #RRGGBB */
  glow?: string;
  /** Размер свечения, px */
  glowSize?: number;
  /** Яркость свечения, 0.1–1 */
  glowOpacity?: number;
}

export interface BoxShadow { name: string; color: string; opacity: number; blur: number; dist: number; angle: number }

/** Готовые тени: с ленты; ручки в «Свойствах» подкручивают выбранную */
export const BOX_SHADOWS: Record<string, BoxShadow> = {
  sm: { name: 'Лёгкая', color: '#0F172A', opacity: 0.14, blur: 8, dist: 2, angle: 90 },
  md: { name: 'Заметная', color: '#0F172A', opacity: 0.2, blur: 28, dist: 10, angle: 90 },
  lg: { name: 'Глубокая', color: '#0F172A', opacity: 0.3, blur: 50, dist: 22, angle: 90 },
};

/** Свечение по умолчанию: размер, px, и яркость */
export const BOX_GLOW = { size: 18, opacity: 0.7 };

/** Поля тени и свечения: их переносит формат по образцу и стирает «Сбросить» */
export const BOX_FX_KEYS = ['shadow', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowDist', 'shadowAngle', 'glow', 'glowSize', 'glowOpacity'] as const;
/** Подкрутка тени: готовая тень с ленты начинает с чистого листа */
export const SHADOW_TUNE = ['shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowDist', 'shadowAngle'] as const;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Цвет эффекта: роль темы или #RRGGBB */
export const boxFxColor = (c: unknown): string | null => (typeof c === 'string' ? GRADIENT_ROLES[c] ?? (HEX.test(c) ? c : null) : null);

const num = (v: unknown, def: number, lo: number, hi: number) => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Тень с подкруткой поверх готовой; нет тени — null */
export function boxShadowOf(p: BoxFx): BoxShadow | null {
  if (!p.shadow) return null;
  const base = (typeof p.shadow === 'string' && BOX_SHADOWS[p.shadow]) || BOX_SHADOWS.md;
  return {
    name: base.name,
    color: boxFxColor(p.shadowColor) ? p.shadowColor! : base.color,
    opacity: num(p.shadowOpacity, base.opacity, 0, 1),
    blur: num(p.shadowBlur, base.blur, 0, 200),
    dist: num(p.shadowDist, base.dist, 0, 200),
    angle: num(p.shadowAngle, base.angle, -360, 360),
  };
}

/** Свечение; нет — null */
export function boxGlowOf(p: BoxFx): { color: string; size: number; opacity: number } | null {
  if (!boxFxColor(p.glow)) return null;
  return { color: p.glow!, size: num(p.glowSize, BOX_GLOW.size, 1, 120), opacity: num(p.glowOpacity, BOX_GLOW.opacity, 0.05, 1) };
}

/** Цвет с непрозрачностью: #RRGGBB — через rgba, цвета темы — через color-mix */
function alpha(c: string, a: number): string {
  const css = boxFxColor(c) ?? '#0F172A';
  if (HEX.test(css)) {
    const h = css.length === 4 ? css.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : css;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${r2(a)})`;
  }
  return a >= 0.999 ? css : `color-mix(in srgb, ${css} ${Math.round(a * 100)}%, transparent)`;
}

/**
 * Слои: сначала свечение (поверх тени), потом тень. У box-shadow свечение — с разливом (так его узнаёт
 * экспорт в PPTX), у drop-shadow разлива нет — свечение двумя слоями без сдвига
 */
function layers(p: BoxFx, drop: boolean): string[] {
  const out: string[] = [];
  const g = boxGlowOf(p);
  if (g) {
    if (drop) out.push(`0px 0px ${r2(g.size * 0.35)}px ${alpha(g.color, g.opacity)}`, `0px 0px ${r2(g.size * 0.8)}px ${alpha(g.color, g.opacity * 0.85)}`);
    else out.push(`0px 0px ${r2(g.size)}px ${r2(g.size * 0.3)}px ${alpha(g.color, g.opacity)}`);
  }
  const s = boxShadowOf(p);
  if (s) {
    const rad = (s.angle * Math.PI) / 180;
    out.push(`${r2(s.dist * Math.cos(rad))}px ${r2(s.dist * Math.sin(rad))}px ${r2(s.blur)}px ${alpha(s.color, s.opacity)}`);
  }
  return out;
}

/** box-shadow фигуры и рамки рисунка; пусто — эффектов нет */
export const boxFxCss = (p: BoxFx): string => layers(p, false).join(', ');

/** filter у фигуры по контуру (ромб, звезда, линия): тень и свечение повторяют форму */
export const dropFxCss = (p: BoxFx): string => layers(p, true).map((l) => `drop-shadow(${l})`).join(' ');

// ---------------- бегущий свет и матовое стекло (только у фигуры) ----------------

/**
 * Эффекты фигуры сверх PowerPoint: «Бегущий свет» — по краю бежит свет (цвета темы, готовый градиент или свой
 * цвет), «Матовое стекло» — полупрозрачная заливка размывает то, что под фигурой. Прямоугольник, скруглённый,
 * капсула, овал; у фигур PowerPoint и линий их нет
 */
export interface ShapeFx {
  /** Бегущий свет: theme — цвета темы, id готового градиента (gradients.ts) или #RRGGBB */
  flow?: string;
  /** Скорость света, 0,25–3 (1 — круг за 5 с) */
  flowSpeed?: number;
  /** Толщина светящегося края, px */
  flowWidth?: number;
  /** Матовое стекло */
  glass?: boolean;
  /** Размытие под стеклом, px */
  glassBlur?: number;
  /** Плотность заливки стекла, 0,1–0,9 */
  glassOpacity?: number;
}

export const FLOW_KEYS = ['flow', 'flowSpeed', 'flowWidth'] as const;
export const GLASS_KEYS = ['glass', 'glassBlur', 'glassOpacity'] as const;
export const SHAPE_FX_KEYS = [...FLOW_KEYS, ...GLASS_KEYS] as const;
/** По умолчанию: толщина края, px; размытие, px; плотность стекла */
export const FLOW_DEF = { width: 3 };
export const GLASS_DEF = { blur: 22, opacity: 0.6 };

/** Цвета света: цвета темы и яркие готовые градиенты (бледные «Мягкий» и «Туман» не светятся) */
export const FLOW_COLORS: [string, string][] = [['theme', 'Цвета темы'],
  ...GRADIENTS.filter((g) => !['duo', 'glow', 'soft', 'mist'].includes(g.id)).map((g): [string, string] => [g.id, g.name])];

/** Два цвета бегущего света; не свет — null */
export function flowColors(v: unknown): [string, string] | null {
  if (v === 'theme') return ['var(--ac)', 'var(--ac2)'];
  if (typeof v !== 'string') return null;
  if (HEX.test(v)) return [v, v];
  const g = GRADIENTS.find((x) => x.id === v);
  return g ? [gradColor(g.g.from), gradColor(g.g.to)] : null;
}

/** Образец цвета света для ленты и «Свойств»: полоса от первого цвета ко второму */
export const flowSwatch = (v: string): string => {
  const c = flowColors(v);
  return c ? `linear-gradient(135deg, ${c[0]}, ${c[1]})` : 'var(--ac)';
};

/** Числа эффектов в пределах; без своих — по умолчанию */
export const flowOf = (p: ShapeFx) => ({ speed: num(p.flowSpeed, 1, 0.25, 3), width: num(p.flowWidth, FLOW_DEF.width, 1, 12) });
export const glassOf = (p: ShapeFx) => ({ blur: num(p.glassBlur, GLASS_DEF.blur, 0, 60), opacity: num(p.glassOpacity, GLASS_DEF.opacity, 0.1, 0.9) });
