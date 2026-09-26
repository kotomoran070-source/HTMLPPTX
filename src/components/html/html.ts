import { ACCENT_EVENT } from '../../engine/accent';
import { defineBlock } from '../../engine/component';
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
  images?: (ImageFrame & { src?: string })[];
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

function addStyle(el: Element, css: string): void {
  if (!css) return;
  const cur = el.getAttribute('style') ?? '';
  el.setAttribute('style', cur && !cur.trim().endsWith(';') ? `${cur};${css}` : cur + css);
}

defineBlock<HtmlProps>('html', {
  render(p) {
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
      const src = item && typeof item === 'object' ? item.src : undefined;
      if (src) img.setAttribute('src', src);
      else img.classList.add('html-empty');
      if (item && typeof item === 'object' && (item.fit || item.position || item.zoom)) addStyle(img, frameCss(item, 'contain'));
      // Как eimg(): картинку можно заменить, убрать, вписать или кадрировать
      const ip = item && typeof item === 'object' ? pathOf(item) : undefined;
      if (ip) {
        img.setAttribute('data-edit-img', JSON.stringify([...ip, 'src']));
        img.setAttribute('data-img-owner', JSON.stringify(ip));
        img.setAttribute('data-img-kind', 'photo');
      }
    });
    const box = document.createElement('div');
    box.append(f);
    return `<div class="html-block"><div class="html-inner" style="zoom:${scale}">${box.innerHTML}</div></div>`;
  },
});

/**
 * «Живая» вставка: отдельный HTML-документ (анимация, интерактив) в изолированном iframe.
 * Пока слайд не открыт, а также в миниатюрах и при печати, видна картинка-заставка.
 *   src: ./assets/embed-….htm    poster: ./assets/embed-….png
 */
interface EmbedProps extends Block {
  src?: string;
  poster?: string;
  /** Вставка берёт цвета темы: получает их при показе и перезапускается при смене темы */
  theme?: boolean;
}

/** Цвета темы, которые передаются во вставку */
const TOKENS = ['--bg', '--surf', '--alt', '--tx', '--tx2', '--mu', '--bd', '--bd2', '--ac', '--ach', '--acs', '--acb', '--on-ac', '--font'];

/** Документ вставки с текущими цветами темы: :root:root сильнее :root самой вставки. */
function withTheme(html: string): string {
  const cs = getComputedStyle(document.documentElement);
  const vars = TOKENS.map((t) => `${t}:${cs.getPropertyValue(t).trim()}`).join(';');
  const style = `<style id="htmlpptx-theme">:root:root{${vars};color-scheme:${cs.colorScheme || 'light'}}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + style) : style + html;
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
    return `<div class="embed${p.theme ? ' themed' : ''}">${poster}</div>`;
  },
  mount(el, p, ctx) {
    if (!p.src) return;
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
      load(p.src!).then((html) => {
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
      load(p.src!).then((html) => {
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
