/**
 * Стрелки у числовых полей — в стиле программы, а не системные: одна пара на всю студию, встаёт
 * к правому краю поля под мышью или в фокусе. Щелчок — шаг, удержание — подряд; значение
 * меняется так же, как стрелками клавиатуры (min, max, step поля), и поле получает input и change.
 */
const UP = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 5l4-4 4 4"/></svg>';
const DOWN = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>';

/** Поля со своими кнопками (− +) — без стрелок */
const OWN = '.edsize input';

export function numberSteppers(): void {
  const box = document.createElement('div');
  box.className = 'st-numstep';
  box.hidden = true;
  // Щелчок по стрелкам не снимает выделение объекта на слайде (как по панелям студии)
  box.dataset.edKeep = '';
  box.innerHTML = `<button type="button" tabindex="-1" data-d="1" aria-label="Больше">${UP}</button><button type="button" tabindex="-1" data-d="-1" aria-label="Меньше">${DOWN}</button>`;
  document.body.append(box);
  let cur: HTMLInputElement | null = null;

  const fit = (el: Element | null): el is HTMLInputElement =>
    el instanceof HTMLInputElement && el.type === 'number' && !el.disabled && !el.readOnly && !el.matches(OWN);
  const place = (el: HTMLInputElement) => {
    cur = el;
    const r = el.getBoundingClientRect();
    if (!r.width) return hide(true);
    box.style.left = `${r.right - 17}px`;
    box.style.top = `${r.top + 2}px`;
    box.style.height = `${r.height - 4}px`;
    box.hidden = false;
  };
  const hide = (now = false) => {
    if (!now && (document.activeElement === cur || box.matches(':hover') || cur?.matches(':hover'))) return;
    box.hidden = true;
    cur = null;
  };

  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element).closest?.('input');
    if (fit(el)) place(el);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target === cur || box.contains(e.target as Node)) setTimeout(() => hide(), 0);
  });
  document.addEventListener('focusin', (e) => { if (fit(e.target as Element)) place(e.target as HTMLInputElement); });
  document.addEventListener('focusout', () => setTimeout(() => hide(), 0));
  // Панель прокрутили или окно изменилось — стрелки не висят в старом месте
  document.addEventListener('scroll', () => hide(true), true);
  addEventListener('resize', () => hide(true));

  const step = (d: number) => {
    if (!cur) return;
    if (d > 0) cur.stepUp(); else cur.stepDown();
    cur.dispatchEvent(new Event('input', { bubbles: true }));
    cur.dispatchEvent(new Event('change', { bubbles: true }));
  };
  box.addEventListener('pointerdown', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-d]');
    if (!b || !cur) return;
    // Фокус остаётся в поле: Enter и стрелки клавиатуры работают дальше
    e.preventDefault();
    const d = Number(b.dataset.d);
    step(d);
    let timer = window.setTimeout(function again() { step(d); timer = window.setTimeout(again, 60); }, 400);
    const stop = () => { clearTimeout(timer); removeEventListener('pointerup', stop); removeEventListener('pointercancel', stop); };
    addEventListener('pointerup', stop);
    addEventListener('pointercancel', stop);
  });
}
