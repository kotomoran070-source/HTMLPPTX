/**
 * Раскрытие по щелчку, как в «Вопрос — ответ» (faq) и у карточки с «Раскрывать по щелчку» (card reveal): щелчок или
 * Enter и пробел по заголовку (head) раскрывают и прячут его пункт (item, класс open). В правке не раскрывает —
 * там всё и так видно и правится
 */
export function bindDisclosure(el: HTMLElement, head: string, item: string): () => void {
  const toggle = (q: HTMLElement) => {
    if (document.body.classList.contains('editing') && !document.body.classList.contains('st-previewing')) return;
    const it = q.closest(item);
    const open = !it?.classList.contains('open');
    it?.classList.toggle('open', open);
    q.setAttribute('aria-expanded', String(open));
  };
  const onClick = (e: Event) => {
    const q = (e.target as Element).closest<HTMLElement>(head);
    if (q && el.contains(q)) toggle(q);
  };
  const onKey = (e: KeyboardEvent) => {
    const q = (e.target as Element).closest<HTMLElement>(head);
    if (q && el.contains(q) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(q); }
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); };
}
