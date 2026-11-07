/**
 * Страница готова. До этого с первого кадра виден каркас страницы (index.html, #boot): очертания студии или
 * страницы выбора в цветах темы — вместо пустого фона, пока грузится код и данные. Готова — каркас
 * растворяется поверх настоящей страницы, а программа (desktop/main.mjs) убирает свою заставку.
 * Вызывать один раз, когда страница нарисована целиком (студия построена, видимые миниатюры на месте);
 * повторные вызовы ничего не делают.
 */
import { initTitlebar } from './titlebar';

let done = false;

export function bootDone(): void {
  if (done) return;
  done = true;
  const el = document.getElementById('boot');
  if (el) {
    // Растворение начинается, когда настоящая страница уже нарисована под каркасом
    requestAnimationFrame(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    });
  }
  // Программа: шапка страницы — заголовок окна (engine/titlebar.ts)
  initTitlebar();
  (window as { slideriaApp?: { ready?(): void } }).slideriaApp?.ready?.();
}
