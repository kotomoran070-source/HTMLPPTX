import { ACCENT_EVENT } from '../../engine/accent';
import { icon } from '../icons';
import { defineBlock } from '../../engine/component';
import { NS_RE } from '../../engine/deck-css';
import { onThemeChange } from '../../engine/theme';
import { esc, t } from '../../engine/html';
import { fieldStyle, frameCss, pathOf, type ImageFrame } from '../../engine/marks';
import type { Block } from '../../types';
import './html.css';

/**
 * Готовая вёрстка (обычно из импорта Claude Design). Разметка хранится как есть, а тексты
 * и картинки вынесены в отдельные поля, чтобы их правил режим правки:
 *   html: <div style="…"><div data-t="0" style="font-size:69px"></div><img data-i="0"></div>
 *   texts: [Заголовок]                    — содержимое элементов data-t (с разметкой **…**)
 *   images: [{ src: ./assets/logo.svg }]  — картинки элементов data-i (и кадр: fit, zoom)
 *   scale: 0.6667                         — пиксели вёрстки → пиксели слайда (1920 → 1280)
 * Оформление текста из режима правки — в styles, по номеру текста: styles: { "0": { size: 72 } }.
 */
interface HtmlProps extends Block {
  html?: string;
  texts?: unknown[];
  /** Вставлено из другой презентации: пространство её стилей в deck.scoped */
  ns?: string;
  images?: (ImageFrame & { src?: string; brand?: boolean })[];
  scale?: number;
}

const UNSAFE_ATTR = /^on|^srcdoc$|^formaction$/i;

/** Разбор без исполнения: <template> не запускает скрипты и не грузит картинки. */
function fragment(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const f = tpl.content;
  f.querySelectorAll('script,iframe,object,embed,link,meta,base,form').forEach((x) => x.remove());
  f.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (UNSAFE_ATTR.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return f;
}

/**
 * SVG-определения (градиенты, узоры, фильтры) получают свои id в каждой копии слайда:
 * миниатюры и превью с теми же id иначе перехватывают ссылки url(#…) живого слайда.
 */
function uniqueDefs(f: DocumentFragment, suffix: string): void {
  const ids = new Set([...f.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean));
  if (!ids.size) return;
  const all = [...f.querySelectorAll('*')];
  const used = new Set<string>();
  for (const el of all) {
    for (const a of el.attributes) {
      for (const m of a.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) if (ids.has(m[1])) used.add(m[1]);
      if (/^(href|xlink:href)$/i.test(a.name) && a.value.startsWith('#') && ids.has(a.value.slice(1))) used.add(a.value.slice(1));
    }
  }
  if (!used.size) return;
  const to = (id: string) => (used.has(id) ? `${id}-${suffix}` : id);
  for (const el of all) {
    if (el.id && used.has(el.id)) el.id = to(el.id);
    for (const a of [...el.attributes]) {
      let v = a.value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (m, q: string, id: string) => (used.has(id) ? `url(${q}#${to(id)}${q})` : m));
      if (/^(href|xlink:href)$/i.test(a.name) && v.startsWith('#')) v = `#${to(v.slice(1))}`;
      if (v !== a.value) el.setAttribute(a.name, v);
    }
  }
}

function addStyle(el: Element, css: string): void {
  if (!css) return;
  const cur = el.getAttribute('style') ?? '';
  el.setAttribute('style', cur && !cur.trim().endsWith(';') ? `${cur};${css}` : cur + css);
}

/**
 * Связанная подсветка без скриптов из файла: наведение на элемент с data-k (или data-h —
 * список ключей через пробел) даёт класс hl всем элементам слайда с этими ключами.
 * Так устроены схемы в артефактах этого проекта; как выглядит hl, задают стили презентации.
 */
const linked = new WeakSet<HTMLElement>();
function linkHighlight(slide: HTMLElement): () => void {
  if (linked.has(slide) || !slide.querySelector('[data-k]')) return () => {};
  linked.add(slide);
  const items = () => [...slide.querySelectorAll<HTMLElement>('[data-k]')];
  const set = (keys: string[]) => items().forEach((e) => e.classList.toggle('hl', keys.includes(e.dataset.k ?? '')));
  const over = (e: Event) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-k],[data-h]');
    if (!t || !slide.contains(t) || document.body.classList.contains('editing')) return;
    set((t.dataset.h ?? t.dataset.k ?? '').split(/\s+/).filter(Boolean));
  };
  const out = (e: MouseEvent) => {
    const t = (e.target as Element).closest('[data-k],[data-h]');
    const to = (e.relatedTarget as Element | null)?.closest?.('[data-k],[data-h]');
    if (t && t !== to) set([]);
  };
  slide.addEventListener('mouseover', over);
  slide.addEventListener('mouseout', out);
  slide.addEventListener('focusin', over);
  slide.addEventListener('focusout', () => set([]));
  return () => {
    linked.delete(slide);
    slide.removeEventListener('mouseover', over);
    slide.removeEventListener('mouseout', out);
  };
}

/**
 * Подгонка текста (как в Claude Design): длинное слово, которое не помещается в блок при другом
 * системном шрифте («Bootloader» в узкой плашке), не рвётся посередине — шрифт чуть уменьшается.
 * Только на показанном слайде: у скрытого нет размеров.
 */
function fitWords(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-edit], [data-text]').forEach((el) => {
    if (el.dataset.fit || el.classList.contains('ed-active')) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || !el.clientWidth || !(el.textContent ?? '').trim()) return;
    el.dataset.fit = '1';
    const orig = parseFloat(cs.fontSize);
    const prevWrap = el.style.overflowWrap;
    el.style.overflowWrap = 'normal';
    let size = orig;
    while (el.scrollWidth > el.clientWidth + 2 && size > orig * 0.72) {
      size -= Math.max(0.5, orig * 0.03);
      el.style.fontSize = `${size}px`;
    }
    if (el.scrollWidth > el.clientWidth + 2) {
      // Не помещается и мельче — пусть переносится, как раньше
      el.style.fontSize = '';
      el.style.overflowWrap = prevWrap;
    }
    // Текст перенёсся на лишнюю строку, а высота его места ограничена (соседи наезжают)
    // Лишняя строка — это переполнение больше чем на полстроки (выносные элементы букв не в счёт)
    const extra = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
      return el.clientHeight > 0 && el.scrollHeight > el.clientHeight + lh * 0.5;
    };
    let h = parseFloat(el.style.fontSize) || orig;
    while (extra() && h > orig * 0.72) {
      h -= Math.max(0.5, orig * 0.03);
      el.style.fontSize = `${h}px`;
    }
  });
}

/**
 * Блок с заданной высотой, содержимое которого перестало помещаться (другой шрифт — заголовок
 * перенёсся на вторую строку): весь блок чуть уменьшается, но не больше чем на 15%.
 */
function fitBlock(block: HTMLElement): void {
  const inner = block.querySelector<HTMLElement>(':scope > .html-inner');
  const free = block.parentElement;
  if (!inner || block.dataset.fit || !free?.classList.contains('free') || free.classList.contains('auto-h')) return;
  block.dataset.fit = '1';
  const base = parseFloat(inner.style.zoom) || 1;
  // Нижний край содержимого ниже рамки блока (все потомки: переполнение бывает внутри вложенных блоков)
  const over = () => Math.max(0, ...[...inner.querySelectorAll<HTMLElement>('*')].map((k) => k.getBoundingClientRect().bottom))
    > block.getBoundingClientRect().bottom + 1;
  let f = 1;
  while (over() && f > 0.85) {
    f -= 0.02;
    inner.style.zoom = String(base * f);
  }
}

/** Подгонка текста импортированной вёрстки под рамку — и для неподвижной копии слайда (экспорт) */
export function fitHtml(block: HTMLElement): void {
  fitWords(block);
  fitBlock(block);
}

defineBlock<HtmlProps>('html', {
  mount(el, _p, ctx) {
    const off = linkHighlight(ctx.slide);
    const run = () => {
      if (!ctx.slide.classList.contains('on')) return;
      const go = () => { fitWords(el); fitBlock(el); };
      if (document.fonts?.status === 'loaded') go();
      else document.fonts?.ready.then(go);
    };
    const mo = new MutationObserver(run);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    run();
    return () => {
      off();
      mo.disconnect();
    };
  },
  render(p, ctx) {
    const scale = Number(p.scale) > 0 && Number(p.scale) <= 4 ? Number(p.scale) : 1;
    const f = fragment(String(p.html ?? ''));
    const texts = Array.isArray(p.texts) ? p.texts : [];
    const images = Array.isArray(p.images) ? p.images : [];
    const path = pathOf(p);
    const tp = pathOf(p.texts);
    f.querySelectorAll('[data-t]').forEach((el) => {
      const i = Number(el.getAttribute('data-t'));
      el.removeAttribute('data-t');
      el.innerHTML = t(texts[i]);
      addStyle(el, fieldStyle(p, i));
      // Как ea(): путь к тексту и владелец оформления (сам блок, поле — номер текста)
      if (tp && path) {
        el.setAttribute('data-edit', JSON.stringify([...tp, i]));
        el.setAttribute('data-ed-style', JSON.stringify(path));
      }
    });
    f.querySelectorAll('img[data-i]').forEach((img) => {
      const i = Number(img.getAttribute('data-i'));
      img.removeAttribute('data-i');
      const item = images[i];
      // brand: true — логотип презентации (после разбора шаблона): меняется вместе с ним
      const src = item && typeof item === 'object' ? (item.brand ? ctx.logo : item.src) : undefined;
      if (src) img.setAttribute('src', src);
      else img.classList.add('html-empty');
      if (item && typeof item === 'object' && item.brand && !item.src) {
        // Замена такой картинки — замена логотипа презентации, как на исходном слайде
        img.setAttribute('data-edit-img', JSON.stringify(['brand', 'logo']));
        img.setAttribute('data-img-kind', 'logo');
        return;
      }
      if (item && typeof item === 'object' && (item.fit || item.position || item.zoom)) addStyle(img, frameCss(item, 'contain'));
      // Как eimg(): картинку можно заменить, убрать, вписать или кадрировать
      const ip = item && typeof item === 'object' ? pathOf(item) : undefined;
      if (ip) {
        img.setAttribute('data-edit-img', JSON.stringify([...ip, 'src']));
        img.setAttribute('data-img-owner', JSON.stringify(ip));
        img.setAttribute('data-img-kind', 'photo');
      }
    });
    uniqueDefs(f, ctx.uid('d'));
    const box = document.createElement('div');
    box.append(f);
    // Вёрстка из другой презентации: свои стили (deck.scoped[ns]), чужие её не задевают
    const ns = typeof p.ns === 'string' && NS_RE.test(p.ns) ? ` xp-scoped ${p.ns}` : '';
    return `<div class="html-block${ns}"><div class="html-inner" style="zoom:${scale}">${box.innerHTML}</div></div>`;
  },
});

/**
 * «Живая» вставка: отдельный HTML-документ (анимация, интерактив) в изолированном iframe.
 * Пока слайд не открыт, а также в миниатюрах и при печати, видна картинка-заставка.
 *   src: ./assets/embed-….htm    poster: ./assets/embed-….png
 */
interface EmbedProps extends Block {
  src?: string;
  /** Код вставки прямо в данных: HTML, CSS и JavaScript (вместо файла src) */
  code?: string;
  poster?: string;
  /** Вставка берёт цвета темы: получает их при показе и перезапускается при смене темы */
  theme?: boolean;
  /** Вставка отвечает на мышь при показе (курсор, щелчки); в редакторе — нет, чтобы её можно было выделить */
  interactive?: boolean;
}

/** Цвета темы, которые передаются во вставку */
const TOKENS = ['--bg', '--surf', '--alt', '--tx', '--tx2', '--mu', '--bd', '--bd2', '--ac', '--ac2', '--ach', '--acs', '--acb', '--on-ac', '--font'];

/**
 * Документ вставки с цветами темы: :root:root сильнее :root самой вставки.
 * light — цвета светлой темы, какая бы ни была включена (заставка снимается в светлой:
 * в тёмной теме её яркости переворачиваются, см. html.css).
 */
export function withTheme(html: string, light = false): string {
  const root = document.documentElement;
  const was = root.getAttribute('data-theme');
  if (light && was !== 'light') root.setAttribute('data-theme', 'light');
  const cs = getComputedStyle(root);
  const vars = TOKENS.map((t) => `${t}:${cs.getPropertyValue(t).trim()}`).join(';');
  const scheme = cs.colorScheme || 'light';
  if (light && was !== 'light') {
    if (was === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', was);
  }
  const style = `<style id="htmlpptx-theme">:root:root{${vars};color-scheme:${scheme}}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + style) : style + html;
}

/** Код вставки: из поля code (вставлен в студии) или из файла src */
export function embedSource(p: { src?: string; code?: string }): Promise<string> {
  if (typeof p.code === 'string' && p.code.trim()) return Promise.resolve(p.code);
  if (!p.src) return Promise.reject(new Error('нет src'));
  return load(p.src);
}

/** Есть ли у вставки что показывать */
export const hasEmbed = (p: { src?: string; code?: string }): boolean => !!p.src || (typeof p.code === 'string' && !!p.code.trim());

/** Документ живой вставки таким, каким его видит рамка на слайде (для экспорта) */
export function embedHtml(p: { src?: string; code?: string; theme?: boolean }, light = false): Promise<string> {
  return embedSource(p).then((html) => (p.theme ? withTheme(html, light) : html));
}

const docs = new Map<string, Promise<string>>();
const load = (url: string) => {
  let p = docs.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
    p.catch(() => docs.delete(url));
    docs.set(url, p);
  }
  return p;
};

defineBlock<EmbedProps>('embed', {
  render(p) {
    const poster = p.poster ? `<img class="embed-poster" src="${esc(p.poster)}" alt="">` : '';
    // Пустая вставка видна в редакторе: её можно выделить и открыть «Код вставки»
    const empty = !poster && !hasEmbed(p) ? `<div class="embed-ph">${icon('terminal')}<span>Живая вставка</span></div>` : '';
    return `<div class="embed${p.theme ? ' themed' : ''}${p.interactive ? ' interactive' : ''}">${poster}${empty}</div>`;
  },
  mount(el, p, ctx) {
    if (!hasEmbed(p)) return;
    let frame: HTMLIFrameElement | null = null;
    let timer = 0;
    const on = () => {
      clearTimeout(timer);
      if (frame) return;
      const f = document.createElement('iframe');
      f.className = 'embed-frame';
      // Только скрипты: без доступа к странице, формам, всплывающим окнам и переходам
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('tabindex', '-1');
      f.setAttribute('aria-hidden', 'true');
      f.loading = 'eager';
      frame = f;
      embedSource(p).then((html) => {
        if (frame !== f) return;
        f.srcdoc = p.theme ? withTheme(html) : html;
        f.addEventListener('load', () => f.classList.add('on'), { once: true });
        el.append(f);
      }).catch(() => { /* остаётся заставка */ });
    };
    // Сменилась тема или акцент — вставка перезапускается с новыми цветами
    const recolor = () => {
      if (!p.theme || !frame) return;
      const f = frame;
      embedSource(p).then((html) => {
        if (frame === f) f.srcdoc = withTheme(html);
      }).catch(() => {});
    };
    const offTheme = onThemeChange(recolor);
    addEventListener(ACCENT_EVENT, recolor);
    const off = () => {
      clearTimeout(timer);
      // Небольшая задержка: при перелистывании туда-обратно анимация не начинается заново
      timer = window.setTimeout(() => {
        frame?.remove();
        frame = null;
      }, 800);
    };
    const sync = () => (ctx.slide.classList.contains('on') ? on() : off());
    const mo = new MutationObserver(sync);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => {
      offTheme();
      removeEventListener(ACCENT_EVENT, recolor);
      mo.disconnect();
      clearTimeout(timer);
      frame?.remove();
      frame = null;
    };
  },
});
