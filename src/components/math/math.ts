import { defineBlock } from '../../engine/component';
import type { Block } from '../../types';
import { esc, styleAttr } from '../../engine/html';
import { mathTex } from '../../engine/math-input';
import { shapeColor } from '../shape/shape';
import './math.css';

/**
 * Формула: простая запись («x^2 + 1/2») или LaTeX → MathML, который браузер рисует сам
 * (Chrome, Edge, Firefox, Safari): текст формулы чёткий при любом масштабе, выделяется и ищется.
 * Живые числа {{x}} берутся из ползунков слайда и пересчитываются при движении.
 */
export interface MathProps extends Block {
  /** Исходник: простая запись или LaTeX (есть «\» — LaTeX) */
  tex?: string;
  /** Размер, px (по умолчанию 40) */
  size?: number;
  align?: 'left' | 'center' | 'right';
  /** classic — шрифт формул компьютера, как в PowerPoint (Cambria Math); иначе — современный Fira Math */
  font?: 'classic';
  /** Цвет: роль темы (accent, muted…) или #RRGGBB; по умолчанию — цвет текста */
  color?: string;
}

type Temml = typeof import('temml').default;
let temml: Temml | null = null;
let loading: Promise<Temml | null> | null = null;

/**
 * Набор формул (Temml и шрифт формул): грузится один раз, до показа презентации с формулами.
 * Формулы, нарисованные раньше, дорисовываются, как только он готов.
 */
export function loadMath(): Promise<Temml | null> {
  if (!__HAS_MATH__) return Promise.resolve(null);
  loading ??= import('./runtime').then(async (m) => {
    await m.mathFont();
    temml = m.temml;
    document.querySelectorAll<HTMLElement>('[data-math-wait]').forEach((el) => {
      el.removeAttribute('data-math-wait');
      el.innerHTML = mathml(el.dataset.tex ?? '', el.dataset.src ?? '');
    });
    return temml;
  });
  return loading;
}

/** Есть ли в презентации формулы: тогда набор грузится до первой отрисовки */
export const usesMath = (data: unknown): boolean => JSON.stringify(data ?? null).includes('"type":"math"');

/** LaTeX → MathML; ошибка в записи — исходник на месте формулы, с подсказкой */
export function mathml(tex: string, src: string): string {
  if (!tex.trim()) return '<span class="math-empty">Формула</span>';
  if (!temml) return `<span class="math-wait">${esc(src)}</span>`;
  try {
    return temml.renderToString(tex, { displayMode: true, throwOnError: true, trust: false });
  } catch (e) {
    const msg = String((e as Error).message ?? e).replace(/^Temml parse error:\s*/i, '');
    return `<span class="math-err" title="${esc(`Не получается разобрать: ${msg}`)}">${esc(src)}</span>`;
  }
}

defineBlock<MathProps>('math', {
  render(p, ctx) {
    const src = String(p.tex ?? '');
    const tex = mathTex(src, ctx.vars ?? {});
    const size = Number(p.size) > 0 ? Math.min(400, Number(p.size)) : 40;
    const color = shapeColor(p.color);
    const cls = ['math-block', p.align === 'left' || p.align === 'right' ? `at-${p.align}` : '', p.font === 'classic' ? 'classic' : ''].filter(Boolean).join(' ');
    const wait = !temml && __HAS_MATH__ ? ` data-math-wait data-tex="${esc(tex)}" data-src="${esc(src)}"` : '';
    if (wait) void loadMath();
    return `<div class="${cls}"${wait}${styleAttr(`--math-size:${size}px`, color ? `--math-color:${color}` : '', p.style)}>${mathml(tex, src)}</div>`;
  },
});
