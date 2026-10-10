import { defineBlock } from '../../engine/component';
import type { Block } from '../../types';
import { esc, styleAttr } from '../../engine/html';
import { mathTex, stepLines } from '../../engine/math-input';
import { defineStepper } from '../../engine/steps';
import { shapeColor } from '../shape/shape';
import { morphMath, settleSteps } from './morph-math';
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
  /**
   * При показе по щелчку: lines — строки столбика по одной, morph — превращение: каждая строка —
   * формула целиком, одинаковые части перелетают на новые места
   */
  steps?: 'lines' | 'morph';
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

/** \hl{…} — выделить цветом (в простой записи [[…]]) */
const MACROS: Record<string, string> = { '\\hl': '\\class{hl}{#1}' };

/** LaTeX → MathML; ошибка в записи — исходник на месте формулы, с подсказкой */
export function mathml(tex: string, src: string): string {
  if (!tex.trim()) return '<span class="math-empty">Формула</span>';
  if (!temml) return `<span class="math-wait">${esc(src)}</span>`;
  try {
    return temml.renderToString(tex, { displayMode: true, throwOnError: true, macros: { ...MACROS }, trust: (c: { command?: string; class?: string }) => c.command === '\\class' && c.class === 'hl' });
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
    // По шагам: без щелчков (студия, миниатюры, PDF, PPTX) видно всё — у превращения последний шаг
    const lines = p.steps === 'morph' && temml ? stepLines(src) : [];
    const steps = p.steps === 'lines' || lines.length > 1 ? ` data-steps="${p.steps}"` : '';
    const body = lines.length > 1
      ? `<div class="math-steps">${lines.map((l, k) => `<div class="math-step${k === lines.length - 1 ? ' on' : ''}">${mathml(mathTex(l, ctx.vars ?? {}), l)}</div>`).join('')}</div>`
      : mathml(tex, src);
    return `<div class="${cls}"${wait}${steps}${styleAttr(`--math-size:${size}px`, color ? `--math-color:${color}` : '', p.style)}>${body}</div>`;
  },
});

/** Строки столбика (верхняя таблица формулы) */
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(':scope > math > mtable > mtr')];
const stepEls = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(':scope > .math-steps > .math-step')];
const EASE = 'cubic-bezier(.2, .7, .2, 1)';

// Формула по шагам: «Далее» при показе открывает следующую строку или следующее превращение
defineStepper({
  sel: '.math-block[data-steps]',
  count: (el) => (el.dataset.steps === 'morph' ? stepEls(el).length : rows(el).length),
  set(el, k, animate) {
    if (el.dataset.steps === 'morph') {
      const all = stepEls(el);
      settleSteps(el);
      const from = all.find((x) => x.classList.contains('on'));
      const to = all[k];
      if (!to || from === to) return;
      if (animate && from) return morphMath(from, to);
      all.forEach((x) => x.classList.toggle('on', x === to));
      return;
    }
    rows(el).forEach((r, j) => {
      const was = r.classList.contains('ms-off');
      r.classList.toggle('ms-off', j > k);
      // Новая строка выплывает снизу
      if (animate && was && j <= k) {
        [...r.children].forEach((td) => (td as HTMLElement).animate([{ opacity: 0, transform: 'translateY(.35em)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: EASE }));
      }
    });
  },
});
