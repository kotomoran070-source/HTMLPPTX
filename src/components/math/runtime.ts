/**
 * Набор формул: Temml и шрифт формул Fira Math (src/fonts/math, OFL). Подключается по требованию
 * (math.ts → loadMath) и попадает в собранный файл, только если в презентации есть формулы.
 */
import temml from 'temml';
// Стили Temml: столбики по «=», зачёркивание, штрихи. Строкой — едут только вместе с набором формул
import temmlCss from 'temml/dist/Temml-Local.css?inline';
import fontUrl from '../../fonts/math/FiraMath.woff2?url';

export { temml };

/** Шрифт формул и стили Temml — на страницу; шрифт ждём, чтобы формулы не перерисовывались вторым шрифтом */
export async function mathFont(): Promise<void> {
  if (!document.getElementById('slideria-math-font')) {
    const el = document.createElement('style');
    el.id = 'slideria-math-font';
    el.textContent = `@font-face{font-family:"Fira Math";src:url("${fontUrl}") format("woff2");font-display:block}\n${temmlCss}`;
    document.head.appendChild(el);
  }
  await document.fonts?.load('40px "Fira Math"').catch(() => []);
}

let embedCss: Promise<string> | null = null;
/** @font-face шрифта формул с самим файлом внутри — для снимков формулы картинкой (PPTX) */
export function mathFontCss(): Promise<string> {
  embedCss ??= fetch(fontUrl).then((r) => r.blob()).then((b) => new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(`@font-face{font-family:"Fira Math";src:url("${String(fr.result)}") format("woff2")}`);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(b);
  }));
  return embedCss;
}
