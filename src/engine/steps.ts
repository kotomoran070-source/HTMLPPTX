/**
 * Шаги внутри слайда (как анимации «по щелчку» в PowerPoint): «Далее» сначала открывает
 * следующий шаг, и только потом листает. Блок с шагами регистрирует здесь, как их считать
 * и показывать (формула по шагам — components/math). Шаги слайда считаются подряд по всем
 * таким блокам: первый блок до конца, потом следующий.
 */
export interface Stepper {
  /** Корень блока с шагами */
  sel: string;
  /** Сколько состояний у блока (1 — шагов нет) */
  count(el: HTMLElement): number;
  /** Показать состояние k (0 … count-1); animate — переход по щелчку, иначе сразу */
  set(el: HTMLElement, k: number, animate: boolean): void;
}

const steppers: Stepper[] = [];

export function defineStepper(s: Stepper): void {
  steppers.push(s);
}

/**
 * Очерёдность: сначала шаги того, что видно сразу (формула по шагам на слайде), потом объекты
 * «по щелчку» в своём порядке (data-click), а шаги формулы внутри такого объекта — сразу после его появления
 */
function keyOf(el: HTMLElement, dom: number): number {
  const click = el.closest<HTMLElement>('.free[data-click]');
  if (!click) return -1e6 + dom;
  return Number(click.dataset.click) + (click === el ? 0 : 0.5);
}

/** Блоки слайда с шагами — по очереди показа */
function blocks(slide: HTMLElement): { el: HTMLElement; s: Stepper; n: number }[] {
  const out: { el: HTMLElement; s: Stepper; n: number; key: number }[] = [];
  const all = [...slide.querySelectorAll<HTMLElement>('*')];
  for (const s of steppers) {
    slide.querySelectorAll<HTMLElement>(s.sel).forEach((el) => {
      const n = s.count(el);
      if (n > 1) out.push({ el, s, n, key: keyOf(el, all.indexOf(el)) });
    });
  }
  return out.sort((a, b) => a.key - b.key);
}

/** Всего шагов на слайде */
export function stepTotal(slide: HTMLElement): number {
  return blocks(slide).reduce((t, b) => t + b.n - 1, 0);
}

/** Показать первые k шагов слайда; changed — блок, у которого состояние сменилось (анимируется) */
export function applySteps(slide: HTMLElement, k: number, animate: boolean): void {
  let left = Math.max(0, k);
  for (const b of blocks(slide)) {
    const own = Math.min(b.n - 1, left);
    left -= own;
    const was = Number(b.el.dataset.step ?? b.n - 1);
    b.el.dataset.step = String(own);
    b.s.set(b.el, own, animate && was !== own);
  }
}

// Объект «по щелчку»: до своего шага скрыт, на шаге появляется своим эффектом (как кнопка «показать»)
defineStepper({
  sel: ':scope > .free[data-click]',
  count: () => 2,
  set(el, k, animate) {
    el.classList.toggle('click-hid', k === 0);
    el.classList.remove('trig-in');
    if (k === 1 && animate) {
      void el.offsetWidth;
      el.classList.add('trig-in');
    }
  },
});
