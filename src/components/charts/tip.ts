/**
 * Подсказка графиков: элемент с data-tip под мышью — сразу табличка рядом с курсором (title браузера
 * появляется с задержкой и не везде). Одна на страницу, в показе и в правке
 */
let box: HTMLDivElement | null = null;

function tipBox(): HTMLDivElement {
  if (box?.isConnected) return box;
  box = document.createElement('div');
  box.className = 'ch-tip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.appendChild(box);
  return box;
}

/**
 * Подсказки графиков — один обработчик на страницу (без mount у компонента: графики с формулами
 * пересчитываются заменой разметки, а mount это отключает). Ставится один раз при загрузке модуля
 */
let installed = false;
export function installChartTips(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  let cur: Element | null = null;
  const hide = () => { cur?.classList.remove('tip-on'); cur = null; if (box) box.hidden = true; };
  document.addEventListener('pointermove', (e) => {
    const t = (e.target as Element | null)?.closest?.('.line-chart [data-tip], .dg [data-tip]');
    if (!t) { if (cur) hide(); return; }
    const b = tipBox();
    if (t !== cur) {
      cur?.classList.remove('tip-on');
      cur = t;
      t.classList.add('tip-on');
      b.textContent = t.getAttribute('data-tip');
    }
    b.hidden = false;
    // Над курсором; у верхнего края — под ним; не выходит за края окна
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    b.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, e.clientX - w / 2))}px`;
    b.style.top = `${e.clientY - h - 14 < 6 ? e.clientY + 18 : e.clientY - h - 14}px`;
  }, { passive: true });
  document.addEventListener('pointerleave', hide);
  addEventListener('blur', hide);
}
