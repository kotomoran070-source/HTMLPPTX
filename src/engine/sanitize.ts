/**
 * Чужая разметка в слайде (HTML-блок, SVG-определения презентации): без скриптов, обработчиков и адресов,
 * которые что-то исполняют. Презентацию могли прислать — а страница студии и показа живёт на адресе программы,
 * со всем её API.
 *
 * Разбор — в инертном документе: картинки не грузятся, обработчики не срабатывают, пока разметка не чиста.
 * Чистка повторяется до неподвижной точки (разбор → чистка → строка → снова разбор): строка, которая
 * при повторном разборе превращается в другое дерево (mXSS: <math><mtext><table><mglyph><style>…),
 * иначе прошла бы проверку в одном виде, а на слайд попала в другом. Не успокоилась — не показывается.
 */

/** Элементы, которым в слайде не место: исполняют, грузят чужое, отправляют, меняют адрес страницы или разбор */
const DROP = 'script,iframe,frame,frameset,object,embed,applet,portal,fencedframe,link,meta,base,form,template,plaintext';
/** Атрибуты с адресом: в них — только безопасные схемы */
const URL_ATTR = /^(href|xlink:href|src|action|formaction|poster|background|data|ping|cite|codebase|longdesc|lowsrc|dynsrc)$/i;
/** Схемы, которые ничего не исполняют; data: — только картинки, видео и звук */
const SAFE_SCHEME = /^(https?|mailto|tel)$/i;
const SAFE_DATA = /^data:(image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)|video\/|audio\/)/i;
/** Анимация SVG, которая подменяет адрес или обработчик (<animate attributeName="href" values="javascript:…">) */
const SMIL = 'animate,set,animateMotion,animateTransform,animateColor';
const SMIL_TARGET = /^(xlink:)?href$|^on|^(src|action|formaction)$/i;

/** Адрес так, как его прочтёт браузер: без переводов строк и табуляций внутри, без управляющих символов по краям */
function urlOf(v: string): string {
  return v.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

/** Безопасный адрес: относительный, якорь или безопасная схема */
export function safeAttrUrl(value: string): boolean {
  const u = urlOf(value);
  const m = /^([a-z][a-z\d+.-]*):/i.exec(u);
  if (!m) return true;
  if (/^data$/i.test(m[1])) return SAFE_DATA.test(u);
  return SAFE_SCHEME.test(m[1]);
}

function cleanTree(root: ParentNode): void {
  root.querySelectorAll(DROP).forEach((x) => x.remove());
  root.querySelectorAll(SMIL).forEach((x) => {
    if (SMIL_TARGET.test(x.getAttribute('attributeName') ?? '')) x.remove();
  });
  root.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name;
      if (/^on/i.test(n) || /^(srcdoc|formaction)$/i.test(n) || (URL_ATTR.test(n) && !safeAttrUrl(a.value))) el.removeAttribute(n);
      // srcset: адреса через запятую — проверяется каждый
      else if (/^(srcset|imagesrcset)$/i.test(n) && a.value.split(',').some((part) => !safeAttrUrl(part.trim().split(/\s+/)[0] ?? ''))) el.removeAttribute(n);
    }
  });
}

let inert: Document | null = null;
/** Документ без окна: в нём ничего не грузится и не исполняется */
function inertDoc(): Document {
  return (inert ??= document.implementation.createHTMLDocument(''));
}

const PASSES = 4;
/** Разобранное раньше: одна и та же вёрстка рисуется на холсте, в миниатюрах и превью */
const cache = new Map<string, string>();
const CACHE_MAX = 300;

/**
 * Чистая разметка — строка, которая разбирается в то же самое дерево, что и проверено (внутри <div>, как на
 * слайде). Пустая строка — разметка не успокоилась за несколько разборов: нарочно запутана
 */
export function cleanHtml(html: string): string {
  const hit = cache.get(html);
  if (hit !== undefined) return hit;
  const box = inertDoc().createElement('div');
  let s = html;
  let out = '';
  let stable = false;
  for (let k = 0; k < PASSES; k++) {
    box.innerHTML = s;
    cleanTree(box);
    out = box.innerHTML;
    if (out === s) {
      stable = true;
      break;
    }
    s = out;
  }
  const result = stable ? out : '';
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(html, result);
  return result;
}

/**
 * Чистая разметка для правки перед выводом: элемент инертного документа с деревом внутри (картинки не грузятся,
 * пока его не вставили на страницу). После правки — снова cleanHtml(box.innerHTML) перед выводом
 */
export function cleanBox(html: string): HTMLElement {
  const box = inertDoc().createElement('div');
  box.innerHTML = cleanHtml(html);
  return box;
}
