// @name Один переход для всех слайдов
// @description Одинаковый переход между слайдами во всей презентации
// @param transition: choice(fade=Растворение, push=Сдвиг, wipe=Шторка, zoom=Приближение, morph=Морф, none=Без перехода) = fade — Переход
// @param ms: number = 600 — Длительность, мс
export default async function ({ deck, apply, params, log }) {
  const ms = Math.max(100, Math.min(3000, Math.round(Number(params.ms) || 600)));
  apply(deck.slides.map((_s, i) => ({ op: 'slide.set', slide: i + 1, set: { transition: params.transition, transitionMs: ms } })));
  log(`Переход у ${deck.slides.length} слайдов`);
}
