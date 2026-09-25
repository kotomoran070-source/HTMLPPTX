/**
 * Связанная подсветка: элементы с одинаковым data-k подсвечиваются вместе.
 * data-h="a b c" — какие ключи подсветить при наведении на этот элемент (по умолчанию его data-k).
 */
export function linkHighlight(root: HTMLElement): () => void {
  const els = [...root.querySelectorAll<HTMLElement | SVGElement>('[data-k]')];
  const set = (keys: string[] | null) => {
    els.forEach((e) => e.classList.toggle('hl', !!keys && keys.includes(e.dataset.k!)));
  };
  const off: (() => void)[] = [];
  els.forEach((e) => {
    const on = () => set((e.dataset.h ?? e.dataset.k!).split(/\s+/));
    const clear = () => set(null);
    for (const ev of ['mouseenter', 'focus']) e.addEventListener(ev, on);
    for (const ev of ['mouseleave', 'blur']) e.addEventListener(ev, clear);
    off.push(() => {
      for (const ev of ['mouseenter', 'focus']) e.removeEventListener(ev, on);
      for (const ev of ['mouseleave', 'blur']) e.removeEventListener(ev, clear);
    });
  });
  return () => off.forEach((f) => f());
}
