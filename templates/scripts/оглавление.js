// @name Оглавление
// @description Слайд со списком разделов — заголовки слайдов по порядку
// @param title: text = "Содержание" — Заголовок слайда
// @param after: number = 1 — После какого слайда поставить
// @param hidden: bool = false — Со скрытыми слайдами
export default async function ({ outline, apply, params, log }) {
  const o = outline();
  const at = Math.min(Math.max(1, Math.round(Number(params.after) || 1)), o.slides.length);
  // Заголовки слайдов после места оглавления: без безымянных («Слайд 7») и, если не просили, без скрытых
  const items = o.slides
    .filter((s) => s.n > at && s.title && !/^Слайд \d+$/.test(s.title) && (params.hidden || !s.hidden))
    .map((s) => s.title);
  if (!items.length) throw new Error('После этого слайда нет слайдов с заголовками — оглавлению не из чего собраться');
  // Длинное — в две колонки
  const half = Math.ceil(items.length / 2);
  const body = items.length > 8
    ? [{ type: 'grid', columns: 2, items: [{ type: 'list', items: items.slice(0, half) }, { type: 'list', items: items.slice(half) }] }]
    : [{ type: 'list', items }];
  apply({ op: 'slide.add', at: at + 1, slide: { id: 'toc', title: params.title || 'Содержание', body } });
  log(`Оглавление: ${items.length} разделов, слайд ${at + 1}`);
}
