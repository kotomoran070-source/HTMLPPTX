/**
 * Превращение формулы (шаги morph): одинаковые знаки — те же буквы, числа, скобки — перелетают
 * со старых мест на новые, лишние тают, новые проявляются. Как «Морф» между слайдами, только
 * внутри одной формулы.
 */
const LEAF = 'mi, mn, mo, mtext, ms';
const EASE = 'cubic-bezier(.45, 0, .2, 1)';

interface Tok { e: HTMLElement; t: string; r: DOMRect }

/** Знаки формулы: самые мелкие части с текстом */
function tokens(root: HTMLElement): Tok[] {
  return [...root.querySelectorAll<HTMLElement>(LEAF)]
    .filter((e) => !e.querySelector(LEAF) && (e.textContent ?? '').trim())
    .map((e) => ({ e, t: e.textContent!.trim(), r: e.getBoundingClientRect() }));
}

/** Прошлое превращение — сразу в конец (щёлкнули, не дождавшись) */
export function settleSteps(block: HTMLElement): void {
  block.querySelectorAll<HTMLElement>('.math-step').forEach((s) => {
    s.getAnimations({ subtree: true }).forEach((a) => a.finish());
    s.classList.remove('leaving');
    s.querySelectorAll<HTMLElement>('[data-ms-hide]').forEach((e) => {
      e.style.opacity = '';
      e.removeAttribute('data-ms-hide');
    });
  });
}

export function morphMath(from: HTMLElement, to: HTMLElement, ms = 700): void {
  const A = tokens(from);
  from.classList.remove('on');
  to.classList.add('on');
  const B = tokens(to);
  // Масштаб сцены: сдвиги пишутся в пикселях формулы, а меряются на экране
  const k = to.getBoundingClientRect().width / (to.offsetWidth || 1) || 1;

  // Пары по одинаковому тексту: сначала дальше по порядку, потом любой свободный
  const used = new Set<number>();
  const pairs: [Tok, Tok][] = [];
  const fresh: Tok[] = [];
  let last = -1;
  for (const b of B) {
    let j = A.findIndex((a, i) => i > last && !used.has(i) && a.t === b.t);
    if (j < 0) j = A.findIndex((a, i) => !used.has(i) && a.t === b.t);
    if (j < 0) {
      fresh.push(b);
      continue;
    }
    used.add(j);
    last = j;
    pairs.push([A[j], b]);
  }

  from.classList.add('leaving');
  A.forEach((a, i) => {
    a.e.setAttribute('data-ms-hide', '');
    if (used.has(i)) a.e.style.opacity = '0';
    else a.e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.45, easing: 'ease-out', fill: 'forwards' });
  });
  for (const [a, b] of pairs) {
    const dx = (a.r.left - b.r.left) / k;
    const dy = (a.r.top - b.r.top) / k;
    const s = b.r.height > 0 ? a.r.height / b.r.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(s - 1) < 0.01) continue;
    b.e.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: '0 0' },
      { transform: 'none', transformOrigin: '0 0' },
    ], { duration: ms, easing: EASE });
  }
  for (const b of fresh) b.e.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' });
  window.setTimeout(() => {
    if (!from.classList.contains('leaving')) return;
    from.classList.remove('leaving');
    from.querySelectorAll<HTMLElement>('[data-ms-hide]').forEach((e) => {
      e.getAnimations().forEach((x) => x.cancel());
      e.style.opacity = '';
      e.removeAttribute('data-ms-hide');
    });
  }, ms + 40);
}
