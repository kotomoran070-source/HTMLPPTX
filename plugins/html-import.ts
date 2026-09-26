/**
 * Импорт «своего» HTML: файл по правилам docs/HTML.md.
 *
 *   <html data-accent="#2563EB">                  — акцентный цвет (необязательно)
 *   <style> … </style>                            — стили всей презентации (классы, анимации)
 *   <section class="slide" data-id="…" data-notes="…"> … </section>   — слайд 1280×720
 *     обычная вёрстка → блок html во всю площадь слайда (тексты и картинки правятся);
 *     элемент с data-x, data-y, data-w [data-h] → свободный объект (двигается мышью);
 *     <iframe srcdoc="…" data-x…> → «живая» вставка.
 * Цвета — через переменные темы (var(--ac), var(--tx)…), тогда работает тёмная тема и акцент.
 */
import { parse, type HTMLElement as El, type Node } from 'node-html-parser';
import { cleanTree, EFFECTS, firstText, hex, plain, styleOf, textOf } from './design-import';

type Deck = { title: string; lang?: string; source?: string; theme?: { accent?: string }; css?: string; slides: Record<string, unknown>[] };
type Block = Record<string, unknown>;

const SLIDE_RE = /<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b/i;

/** Файл по правилам: есть <section class="slide">. */
export function isSlidesHtml(html: string): boolean {
  return SLIDE_RE.test(html);
}

/** Строчные элементы, которые остаются внутри текста как оформление (**жирный**, ссылка, цвет). */
const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'A', 'FONT', 'SPAN']);
/** Внутрь этих элементов за текстами не заходим */
const OPAQUE = new Set(['SVG', 'IMG', 'IFRAME', 'VIDEO', 'AUDIO', 'CANVAS', 'STYLE', 'SCRIPT', 'TEMPLATE', 'PICTURE', 'OBJECT', 'MATH', 'SELECT', 'TEXTAREA', 'INPUT']);
/** Оформление, которое разметка текста умеет сохранить */
const SIMPLE_STYLE = /^\s*((color|font-weight|font-style|text-decoration)\s*:[^;]*;?\s*)*$/i;

function simpleInline(el: El): boolean {
  if (!INLINE.has(el.tagName)) return false;
  if (el.tagName === 'SPAN' || el.tagName === 'FONT') {
    if (el.getAttribute('class')) return false;
    if (!SIMPLE_STYLE.test(el.getAttribute('style') ?? '')) return false;
  }
  if (el.tagName === 'A' && el.getAttribute('class')) return false;
  return el.childNodes.every((c) => c.nodeType === 3 || (c.nodeType === 1 && simpleInline(c as El)));
}

/** Элемент — один текст: внутри только слова и простое оформление. */
function isLeaf(el: El): boolean {
  if (OPAQUE.has(el.tagName) || !el.text.trim()) return false;
  return el.childNodes.every((c) => c.nodeType === 3 || c.nodeType === 8 || (c.nodeType === 1 && simpleInline(c as El)));
}

/**
 * Находит тексты и картинки внутри вёрстки: тексты → texts (с разметкой), содержимое
 * элемента заменяется меткой data-t; картинки → images, у <img> метка data-i.
 * Свободный текст между блоками оборачивается в <span>, чтобы его тоже можно было править.
 */
export function extractContent(root: El, warn: (s: string) => void): { texts: string[]; images: Record<string, unknown>[] } {
  const texts: string[] = [];
  const images: Record<string, unknown>[] = [];
  const mark = (el: El) => {
    texts.push(textOf(el));
    el.set_content('');
    el.setAttribute('data-t', String(texts.length - 1));
  };
  const walk = (el: El) => {
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      if (/^https?:/i.test(src)) warn(`картинка по ссылке ${src.slice(0, 60)} — без интернета не покажется`);
      else if (src && !src.startsWith('data:')) warn(`картинка «${src.slice(0, 60)}» не встроена в файл — замените её после импорта`);
      images.push(src ? { src } : {});
      el.removeAttribute('src');
      el.setAttribute('data-i', String(images.length - 1));
      return;
    }
    if (OPAQUE.has(el.tagName)) return;
    if (el !== root && isLeaf(el)) return mark(el);
    for (const c of [...el.childNodes] as Node[]) {
      if (c.nodeType === 3 && c.text.trim()) {
        // Слова прямо внутри блока, рядом с другими элементами
        const span = parse(`<span data-t="${texts.length}"></span>`).firstChild as El;
        texts.push(textOf(parse(`<span>${c.toString()}</span>`).firstChild as El));
        el.exchangeChild(c, span);
      } else if (c.nodeType === 1) {
        walk(c as El);
      }
    }
  };
  if (isLeaf(root)) {
    // Весь блок — один текст: метка на внутреннем span, у корня остаются его стили
    const inner = parse(`<span>${root.innerHTML}</span>`).firstChild as El;
    root.set_content('');
    root.appendChild(inner);
    mark(inner);
  } else {
    walk(root);
  }
  return { texts, images };
}

/**
 * Координаты свободного объекта: data-x, data-y, data-w [data-h] или
 * style="position: absolute; left: 960px; top: 560px; width: 240px [; height]".
 * Из style координаты убираются: их задаёт сам свободный объект.
 */
function placeOf(el: El): Record<string, number> | null {
  if (el.hasAttribute('data-x') && el.hasAttribute('data-y')) {
    const place: Record<string, number> = { x: num(el.getAttribute('data-x')) ?? 0, y: num(el.getAttribute('data-y')) ?? 0, w: num(el.getAttribute('data-w')) ?? 400 };
    const h = num(el.getAttribute('data-h'));
    if (h) place.h = h;
    return place;
  }
  const st = styleOf(el);
  if (st.position !== 'absolute' || !/px$/.test(st.left ?? '') || !/px$/.test(st.top ?? '')) return null;
  const place: Record<string, number> = { x: num(st.left) ?? 0, y: num(st.top) ?? 0, w: /px$/.test(st.width ?? '') ? num(st.width)! : 400 };
  if (/px$/.test(st.height ?? '')) place.h = num(st.height)!;
  for (const k of ['position', 'left', 'top', 'width', 'height', 'right', 'bottom']) delete st[k];
  const rest = Object.entries(st).map(([k, v]) => `${k}: ${v}`).join('; ');
  if (rest) el.setAttribute('style', rest);
  else el.removeAttribute('style');
  return place;
}

const num = (v: string | undefined) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined;
};

function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Блок html из элемента (или корня слайда). */
function htmlBlock(el: El, warn: (s: string) => void): Block | null {
  const { texts, images } = extractContent(el, warn);
  cleanTree(el, true);
  const html = el.toString().trim();
  if (!html) return null;
  const b: Block = { type: 'html', html };
  if (texts.length) b.texts = texts;
  if (images.length) b.images = images;
  return b;
}

export interface SlidesHtmlResult {
  deck: Deck;
  warnings: string[];
}

export function fromSlidesHtml(source: string): SlidesHtmlResult {
  const doc = parse(source, { comment: false, blockTextElements: { script: true, style: true, noscript: true } });
  const warnings: string[] = [];
  const htmlEl = doc.querySelector('html');
  const title = firstText(doc.querySelector('title')) || 'Презентация';
  const deck: Deck = { title, slides: [] };
  const lang = htmlEl?.getAttribute('lang');
  if (lang && lang !== 'ru') deck.lang = lang;
  const accent = htmlEl?.getAttribute('data-accent') ?? doc.querySelector('meta[name="htmlpptx-accent"]')?.getAttribute('content');
  // Стандартный синий не записываем: он и так по умолчанию
  if (accent && /^#[0-9a-f]{6}$/i.test(accent.trim()) && accent.trim().toUpperCase() !== '#2563EB') deck.theme = { accent: accent.trim().toUpperCase() };

  // Стили презентации: всё, кроме внешних подключений
  // <style data-preview> — только для просмотра файла в браузере, в проект не переносится
  const css = doc.querySelectorAll('style').filter((s) => !s.hasAttribute('data-preview')).map((s) => s.text).join('\n');
  if (css.trim()) {
    if (/@import|url\(\s*["']?https?:/i.test(css)) warnings.push('стили подключают внешние файлы или шрифты (@import, url(https://…)) — без интернета они не загрузятся');
    // Цвета темы даёт проект: их объявления (для предпросмотра файла в браузере) не переносим
    const tokens = /(^|[;{\s])--(bg|surf|alt|tx|tx2|mu|bd|bd2|ac|ach|acs|acb|on-ac|hl-sub)\s*:[^;}]*;?/g;
    deck.css = dedent(css.replace(/@import[^;]*;/gi, '').replace(tokens, '$1').replace(/[^{}]*\{\s*\}/g, ''));
  }
  if (doc.querySelector('link[rel~="stylesheet"]')) warnings.push('внешние таблицы стилей (<link rel="stylesheet">) не переносятся: стили нужно писать в <style>');
  const scripts = doc.querySelectorAll('script').length;
  if (scripts) warnings.push(`скрипты (${scripts}) не переносятся: анимации — через CSS (@keyframes) или «живую» вставку <iframe srcdoc>`);

  const sections = doc.querySelectorAll('section').filter((s) => /\bslide\b/.test(s.getAttribute('class') ?? '') && !s.parentNode?.closest?.('section'));
  if (!sections.length) throw new Error('В файле нет слайдов: каждый слайд — <section class="slide">…</section>');
  const ids = new Set<string>();

  sections.forEach((sec, i) => {
    const warn = (s: string) => warnings.push(`слайд ${i + 1}: ${s}`);
    let id = slugId(sec.getAttribute('data-id') ?? '') || `s${i + 1}`;
    while (ids.has(id)) id += '-2';
    ids.add(id);
    const slide: Record<string, unknown> = { id, template: 'canvas' };

    const aside = sec.querySelectorAll('aside').find((a) => /\bnotes\b/.test(a.getAttribute('class') ?? ''));
    const notes = sec.getAttribute('data-notes') ?? aside?.text;
    aside?.remove();
    const heading = sec.querySelector('h1, h2, h3');
    const label = sec.getAttribute('data-label') ?? (heading ? plain(firstText(heading)) : '');
    if (label) slide.label = label;

    // Фон слайда: из style секции или data-bg
    const st = styleOf(sec);
    const bg = sec.getAttribute('data-bg') ?? st['background-color'] ?? st.background;
    if (bg) {
      slide.bg = hex(bg) ?? bg.trim();
      delete st['background-color'];
      delete st.background;
    }

    // Свободные объекты: прямые потомки с координатами
    const free: Block[] = [];
    for (const child of sec.childNodes.filter((n): n is El => n.nodeType === 1)) {
      const place = placeOf(child);
      if (!place) continue;
      const enter = child.getAttribute('data-enter');
      const delay = num(child.getAttribute('data-delay'));
      for (const a of ['data-x', 'data-y', 'data-w', 'data-h', 'data-enter', 'data-delay']) child.removeAttribute(a);
      child.remove();
      let block: Block | null;
      if (child.tagName === 'IFRAME') {
        const srcdoc = child.getAttribute('srcdoc');
        if (!srcdoc) {
          warn('<iframe> без srcdoc пропущен: вставка должна быть внутри файла');
          continue;
        }
        // Вставка по правилам берёт цвета темы (var(--ac) и др.)
        block = { type: 'embed', src: `data:text/html;base64,${Buffer.from(srcdoc, 'utf8').toString('base64')}`, theme: true };
        const poster = child.getAttribute('data-poster');
        if (poster) block.poster = poster;
      } else {
        block = htmlBlock(child, warn);
      }
      if (!block) continue;
      block.place = place;
      if (enter && EFFECTS.has(enter)) block.enter = enter;
      if (enter && delay) block.delay = delay;
      free.push(block);
    }

    // Остальное — вёрстка слайда: корень во всю площадь, со стилями и классами секции
    const rest = sec.innerHTML.trim();
    if (rest) {
      const cls = (sec.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && c !== 'slide');
      const styleText = Object.entries(st).map(([k, v]) => `${k}: ${v}`).join('; ');
      const root = parse(`<section class="${['slide-root', ...cls].join(' ')}"${styleText ? ` style="${styleText.replace(/"/g, '&quot;')}"` : ''}>${rest}</section>`).firstChild as El;
      if (root.querySelector('iframe')) warn('<iframe> внутри вёрстки удалён: «живой» вставке нужны data-x, data-y, data-w');
      const body = htmlBlock(root, warn);
      if (body) slide.body = body;
    }
    if (free.length) slide.free = free;
    if (notes && notes.trim()) slide.notes = notes.trim().replace(/[ \t]+/g, ' ');
    deck.slides.push(slide);
  });

  const outside = doc.querySelector('body')?.childNodes.filter((n) => {
    if (n.nodeType === 3) return !!n.text.trim();
    if (n.nodeType !== 1) return false;
    const el = n as El;
    return !['SECTION', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) && !el.querySelector('section.slide') && !!el.text.trim();
  }).length;
  if (outside) warnings.push('содержимое вне <section class="slide"> пропущено');

  // Порядок полей в deck.yaml: сначала общее, потом слайды
  const { slides, ...head } = deck;
  return { deck: { ...head, slides }, warnings };
}

/** Убирает общий отступ и пустые строки, оставшиеся после чистки. */
function dedent(css: string): string {
  const lines = css.split('\n').map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, a) => l || (i > 0 && a[i - 1] && !a[i - 1].endsWith('{')));
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join('\n').trim();
}
