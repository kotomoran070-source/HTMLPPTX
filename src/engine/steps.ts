/**
 * Шаги внутри слайда (как анимации «по щелчку» в PowerPoint): «Далее» сначала открывает
 * следующий шаг, и только потом листает. Блок с шагами регистрирует здесь, как их считать
 * и показывать (формула по шагам — components/math). Обычно шаги блока идут подряд: первый блок
 * до конца, потом следующий; блок со своими местами в очереди (keys) — вперемешку с другими
 * (объект появился на 1-м щелчке, исчез на 4-м).
 */
export interface Stepper {
  /** Корень блока с шагами */
  sel: string;
  /** Сколько состояний у блока (1 — шагов нет) */
  count(el: HTMLElement): number;
  /** Места шагов блока в очереди слайда (по возрастанию, count-1 штук); нет — все подряд на месте блока */
  keys?(el: HTMLElement): number[];
  /** Показать состояние k (0 … count-1); animate — переход по щелчку, иначе сразу; from — состояние до этого */
  set(el: HTMLElement, k: number, animate: boolean, from: number): void;
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

interface StepBlock { el: HTMLElement; s: Stepper; n: number; keys: number[] }

/** Блоки слайда с шагами и места их шагов в очереди */
function blocks(slide: HTMLElement): StepBlock[] {
  const out: StepBlock[] = [];
  const all = [...slide.querySelectorAll<HTMLElement>('*')];
  for (const s of steppers) {
    slide.querySelectorAll<HTMLElement>(s.sel).forEach((el) => {
      const n = s.count(el);
      if (n <= 1) return;
      const own = s.keys?.(el);
      out.push({ el, s, n, keys: own && own.length === n - 1 ? own : Array<number>(n - 1).fill(keyOf(el, all.indexOf(el))) });
    });
  }
  return out;
}

/** Шаги слайда по очереди: какой блок делает каждый следующий шаг (при равных местах — по порядку блоков, внутри блока — по своему) */
function sequence(bs: StepBlock[]): number[] {
  return bs.flatMap((b, bi) => b.keys.map((key, j) => ({ bi, key, j })))
    .sort((a, b) => a.key - b.key || a.bi - b.bi || a.j - b.j)
    .map((x) => x.bi);
}

/** Всего шагов на слайде */
export function stepTotal(slide: HTMLElement): number {
  return blocks(slide).reduce((t, b) => t + b.n - 1, 0);
}

/** Показать первые k шагов слайда; блок, у которого состояние сменилось, анимируется */
export function applySteps(slide: HTMLElement, k: number, animate: boolean): void {
  const bs = blocks(slide);
  const own = bs.map(() => 0);
  sequence(bs).slice(0, Math.max(0, k)).forEach((bi) => own[bi]++);
  bs.forEach((b, bi) => {
    const was = Number(b.el.dataset.step ?? b.n - 1);
    b.el.dataset.step = String(own[bi]);
    b.s.set(b.el, own[bi], animate && was !== own[bi], was);
  });
}

/** Шаги объекта по щелчку из разметки (render: data-acts="in:0 emph:2 out:3") */
function actsOf(el: HTMLElement): { kind: string; n: number }[] {
  return (el.dataset.acts ?? '').split(' ').map((x) => x.split(':')).filter((x) => x.length === 2).map(([kind, n]) => ({ kind, n: Number(n) }));
}

/**
 * Объект с шагами по щелчку: появление (до него скрыт), выделение, исчезновение — каждое на своём
 * месте очереди. Вперёд на один шаг — с анимацией этого шага; назад или скачком — сразу в нужном виде
 */
defineStepper({
  sel: ':scope > .free[data-acts]',
  count: (el) => actsOf(el).length + 1,
  keys: (el) => actsOf(el).map((a) => a.n),
  set(el, k, animate, from) {
    const acts = actsOf(el);
    let shown = !acts.some((a) => a.kind === 'in');
    for (const a of acts.slice(0, k)) if (a.kind !== 'emph') shown = a.kind === 'in';
    const last = acts[k - 1]?.kind;
    el.classList.remove('trig-in', 'trig-play', 'click-out');
    el.classList.toggle('click-hid', !shown);
    if (!animate || k !== from + 1 || !last) return;
    void el.offsetWidth;
    if (last === 'in') el.classList.add('trig-in');
    else if (last === 'emph') el.classList.add('trig-play');
    else {
      // Исчезает своим эффектом и остаётся скрытым (конец анимации держится)
      el.classList.remove('click-hid');
      el.classList.add('click-out');
    }
  },
});
