import { icon } from '../icons';
import { ACCENT_EVENT } from '../../engine/accent';
import { defineBlock } from '../../engine/component';
import { esc } from '../../engine/html';
import { liveDocument } from '../../engine/live-slides';
import { currentTheme, onThemeChange } from '../../engine/theme';
import type { Block } from '../../types';
import './live.css';

/**
 * Живой слайд: исходный HTML-файл целиком, в изолированной рамке, показан только нужный слайд.
 * Работают все скрипты файла: наведение, параллакс, анимации. Слайд не правится на месте;
 * под рамкой лежит обычная копия слайда — она видна в миниатюрах, при печати и до загрузки.
 *   live: { src: ./assets/embed-….htm, index: 3, selector: "section.slide" }
 */
interface LiveProps extends Block {
  /** У слайда нет обычной копии (незнакомый формат): в миниатюрах — заглушка с названием */
  empty?: boolean;
  label?: string;
  src?: string;
  index?: number;
  selector?: string | null;
}

const TOKENS = ['--bg', '--surf', '--alt', '--tx', '--tx2', '--mu', '--bd', '--bd2', '--ac', '--ach', '--acs', '--acb', '--on-ac'];

function themeTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(t).trim()]));
}

const docs = new Map<string, Promise<string>>();
function load(url: string): Promise<string> {
  let p = docs.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
    p.catch(() => docs.delete(url));
    docs.set(url, p);
  }
  return p;
}

defineBlock<LiveProps>('live', {
  render(p) {
    const ph = p.empty ? `<div class="live-ph">${icon('play')}<b>${esc(p.label ?? '')}</b><span>Живой слайд</span></div>` : '';
    return `<div class="live">${ph}<div class="live-badge">${icon('play')}<span><b>Живой слайд</b> — как в исходном файле, со скриптами. На месте не правится.</span>`
      + `<button type="button" class="btn ghost small" data-unlive>Сделать редактируемым</button></div></div>`;
  },
  mount(el, p, ctx) {
    if (!p.src) return;
    const token = Math.random().toString(36).slice(2);
    let frame: HTMLIFrameElement | null = null;
    let timer = 0;

    const on = () => {
      clearTimeout(timer);
      if (frame) return;
      const f = document.createElement('iframe');
      f.className = 'live-frame';
      // Только скрипты: без доступа к странице проекта, формам и переходам
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('title', 'Живой слайд');
      frame = f;
      load(p.src!).then((html) => {
        if (frame !== f) return;
        f.srcdoc = liveDocument(html, {
          index: Number(p.index) || 0, selector: p.selector ?? null, token,
          theme: currentTheme(), tokens: themeTokens(),
        });
        f.addEventListener('load', () => setTimeout(() => f.classList.add('on'), 250), { once: true });
        el.append(f);
      }).catch(() => { /* остаётся обычная копия слайда */ });
    };
    const off = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        frame?.remove();
        frame = null;
      }, 800);
    };
    const sync = () => (ctx.slide.classList.contains('on') ? on() : off());

    // Клавиши из рамки — движку проекта (листание, обзор, тема…)
    const onMessage = (e: MessageEvent) => {
      if (!frame || e.source !== frame.contentWindow || e.data?.htmlpptxLive !== token || typeof e.data.key !== 'string') return;
      const d = e.data as { key: string; code?: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: d.key, code: d.code, shiftKey: !!d.shiftKey, altKey: !!d.altKey, ctrlKey: !!d.ctrlKey, metaKey: !!d.metaKey, bubbles: true, cancelable: true,
      }));
    };
    // Тема и акцент — в рамку, без перезагрузки
    const recolor = () => {
      frame?.contentWindow?.postMessage({ htmlpptxLive: token, theme: currentTheme(), tokens: themeTokens() }, '*');
    };
    const unlive = (e: Event) => {
      if (!(e.target as Element).closest('[data-unlive]')) return;
      e.preventDefault();
      e.stopPropagation();
      dispatchEvent(new CustomEvent('htmlpptx:unlive', { detail: { index: Number(ctx.slide.dataset.index) } }));
    };

    addEventListener('message', onMessage);
    const offTheme = onThemeChange(recolor);
    addEventListener(ACCENT_EVENT, recolor);
    el.addEventListener('click', unlive);
    const mo = new MutationObserver(sync);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => {
      removeEventListener('message', onMessage);
      offTheme();
      removeEventListener(ACCENT_EVENT, recolor);
      el.removeEventListener('click', unlive);
      mo.disconnect();
      clearTimeout(timer);
      frame?.remove();
      frame = null;
    };
  },
});
