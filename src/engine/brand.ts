/**
 * Знак Slideria: «S» из двух штрихов — текущий слайд и следующий, полупрозрачный, который выезжает за ним.
 * Рисуется цветом текста (currentColor), поэтому подходит и на акцентную плитку, и на светлую кнопку.
 */
const GLYPH = `<path d="M20.5 3.5H8.25a4.25 4.25 0 0 0 0 8.5" fill="none" stroke="currentColor" stroke-width="2.8"/>`
  + `<circle cx="20.5" cy="3.5" r="1.4" fill="currentColor"/>`
  + `<g opacity=".55"><path d="M8.25 12h7.5a4.25 4.25 0 0 1 0 8.5H3.5" fill="none" stroke="currentColor" stroke-width="2.8"/>`
  + `<circle cx="3.5" cy="20.5" r="1.4" fill="currentColor"/></g>`;

/** Знак для разметки: <svg class="brand-mark"> */
export function brandMark(cls = 'brand-mark'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPH}</svg>`;
}

/** Иконка вкладки: знак на синей плитке (в иконке нет переменных темы — цвета постоянные) */
export const BRAND_FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
  + `<stop offset="0" stop-color="#5B8DEF"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient></defs>`
  + `<rect width="32" height="32" rx="8" fill="url(#g)"/><g transform="translate(5 5) scale(.9167)" color="#fff">${GLYPH}</g></svg>`,
)}`;

/** Иконка вкладки: логотип презентации, а без него — знак Slideria */
export function updateFavicon(url: string | undefined): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  // Без логотипа презентации — знак Slideria
  url ||= BRAND_FAVICON;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.href !== url) link.href = url;
}
