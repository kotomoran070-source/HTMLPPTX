/**
 * Ползунки интерфейса: заливка дорожки до значения (переменная --p) — для оформления в
 * editor.css. Значение меняется при движении и при перестройке панелей (новые ползунки).
 */
const RANGE = 'input[type="range"]';

function fill(el: HTMLInputElement): void {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const p = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--p', `${Math.max(0, Math.min(100, p))}%`);
}

let on = false;
export function initRangeFill(): void {
  if (on || typeof document === 'undefined') return;
  on = true;
  const scan = (root: ParentNode) => root.querySelectorAll<HTMLInputElement>(RANGE).forEach(fill);
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches?.(RANGE)) fill(t);
  }, true);
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n instanceof HTMLInputElement && n.type === 'range') fill(n);
        else if (n instanceof Element && n.querySelector(RANGE)) scan(n);
      }
      // Значение задали из кода (fill() панели) — атрибут value
      if (m.type === 'attributes' && m.target instanceof HTMLInputElement && m.target.type === 'range') fill(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'min', 'max'] });
  scan(document);
  // Значение, выставленное свойством .value, событий не даёт — подхватываем при наведении и фокусе
  document.addEventListener('pointerover', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches?.(RANGE)) fill(t);
  }, true);
}
