/**
 * Шаги внутри слайда (как анимации «по щелчку» в PowerPoint): «Далее» сначала открывает
 * следующий шаг, и только потом листает. Блок с шагами регистрирует здесь, как их считать
 * и показывать (формула по шагам — components/math). Обычно шаги блока идут подряд: первый блок
 * до конца, потом следующий; блок со своими местами в очереди (keys) — вперемешку с другими
 * (объект появился на 1-м щелчке, исчез на 4-м). Свои места у разных блоков совпали — это один щелчок
 * («вместе с предыдущим»: два объекта появляются разом).
 */
export interface Stepper {
  /** Корень блока с шагами */
  sel: string;
  /** Сколько состояний у блока (1 — шагов нет) */
  count(el: HTMLElement): number;
  /** Номера щелчков шагов блока (по возрастанию, count-1 штук; равные у разных блоков — один щелчок); нет — все подряд на месте блока */
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

interface StepBlock { el: HTMLElement; s: Stepper; n: number; keys: number[]; own: boolean }

/** Блоки слайда с шагами и места их шагов в очереди */
function blocks(slide: HTMLElement): StepBlock[] {
  const out: StepBlock[] = [];
  const all = [...slide.querySelectorAll<HTMLElement>('*')];
  for (const s of steppers) {
    slide.querySelectorAll<HTMLElement>(s.sel).forEach((el) => {
      const n = s.count(el);
      if (n <= 1) return;
      const own = s.keys?.(el);
      const mine = !!own && own.length === n - 1;
      out.push({ el, s, n, keys: mine ? own : Array<number>(n - 1).fill(keyOf(el, all.indexOf(el))), own: mine });
    });
  }
  return out;
}

/**
 * Щелчки слайда по очереди: какие блоки делают шаг на каждом (при равных местах — по порядку блоков, внутри
 * блока — по своему). Своё место, общее у нескольких шагов (номер щелчка), — один щелчок на всех
 */
function sequence(bs: StepBlock[]): number[][] {
  const flat = bs.flatMap((b, bi) => b.keys.map((key, j) => ({ bi, key, j, own: b.own })))
    .sort((a, b) => a.key - b.key || a.bi - b.bi || a.j - b.j);
  const out: number[][] = [];
  flat.forEach((x, n) => {
    const p = flat[n - 1];
    if (p && x.own && p.own && p.key === x.key) out[out.length - 1].push(x.bi);
    else out.push([x.bi]);
  });
  return out;
}

/** Всего шагов (щелчков) на слайде */
export function stepTotal(slide: HTMLElement): number {
  return sequence(blocks(slide)).length;
}

/** Показать первые k шагов слайда; блок, у которого состояние сменилось, анимируется */
export function applySteps(slide: HTMLElement, k: number, animate: boolean): void {
  const bs = blocks(slide);
  const own = bs.map(() => 0);
  sequence(bs).slice(0, Math.max(0, k)).forEach((step) => step.forEach((bi) => own[bi]++));
  bs.forEach((b, bi) => {
    const was = Number(b.el.dataset.step ?? b.n - 1);
    b.el.dataset.step = String(own[bi]);
    b.s.set(b.el, own[bi], animate && was !== own[bi], was);
  });
}

/** Шаги объекта по щелчку из разметки (render: data-acts="in:0 item:1 emph:2 out:3" — номера щелчков) */
function actsOf(el: HTMLElement): { kind: string; n: number }[] {
  return (el.dataset.acts ?? '').split(' ').map((x) => x.split(':')).filter((x) => x.length === 2).map(([kind, n]) => ({ kind, n: Number(n) }));
}

/** Пункты объекта для появления по пунктам: строки списка или пункты «- » в тексте */
const parts = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('li, .md-li')];

/**
 * Объект с шагами по щелчку: появление (до него скрыт; по пунктам — сначала первый пункт), следующие пункты,
 * выделение (стойкое — держится до возврата), исчезновение — каждое на своём щелчке. Вперёд — с анимацией
 * своих шагов; назад или скачком — сразу в нужном виде
 */
defineStepper({
  sel: ':scope > .free[data-acts]',
  count: (el) => actsOf(el).length + 1,
  keys: (el) => actsOf(el).map((a) => a.n),
  set(el, k, animate, from) {
    const acts = actsOf(el);
    const state = (upto: number) => {
      let shown = !acts.some((a) => a.kind === 'in');
      let items = 0;
      let emph = false;
      for (const a of acts.slice(0, upto)) {
        if (a.kind === 'in') { shown = true; items = 1; } else if (a.kind === 'out') shown = false;
        else if (a.kind === 'item') items++;
        else if (a.kind === 'emph') emph = true;
      }
      return { shown, items, emph };
    };
    const now = state(k);
    el.classList.remove('trig-in', 'trig-play', 'click-out');
    el.classList.toggle('click-hid', !now.shown);
    el.classList.toggle('emph-on', now.emph);
    const list = acts.some((a) => a.kind === 'item') ? parts(el) : [];
    list.forEach((p, i) => { p.classList.remove('item-in'); p.classList.toggle('item-hid', i >= now.items); });
    const fresh = animate && k > from ? acts.slice(from, k) : [];
    if (!fresh.length) return;
    void el.offsetWidth;
    if (fresh.some((a) => a.kind === 'in')) el.classList.add('trig-in');
    else if (fresh.some((a) => a.kind === 'item')) list.slice(state(from).items, now.items).forEach((p) => p.classList.add('item-in'));
    if (fresh.some((a) => a.kind === 'emph')) el.classList.add('trig-play');
    // Исчезает своим эффектом и остаётся скрытым (конец анимации держится)
    if (fresh.filter((a) => a.kind === 'in' || a.kind === 'out').pop()?.kind === 'out') {
      el.classList.remove('click-hid');
      el.classList.add('click-out');
    }
  },
});
