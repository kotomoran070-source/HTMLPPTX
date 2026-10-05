import { embedHtml, fitHtml, hasEmbed } from '../components/html/html';
import type { Block, Deck } from '../types';
import type { Path } from './data';
import { getAt } from './data';
import { staticSlide } from './deck-view';

/**
 * Печать и «Сохранить как PDF»: отдельная страница на каждый слайд, слайд в конечном виде.
 * Живая сцена для печати не годится: шаги показа скрыты, анимации не доиграны.
 */
let deckEl: HTMLElement | null = null;

function build(deck: Deck): HTMLElement {
  deckEl?.remove();
  const root = document.createElement('div');
  root.className = 'print-deck';
  deck.slides.forEach((s, i) => {
    // Скрытый слайд в PDF не попадает
    if (s.hidden === true) return;
    const page = document.createElement('div');
    page.className = 'print-page';
    page.appendChild(staticSlide(deck, i, 1280));
    root.appendChild(page);
  });
  document.body.appendChild(root);
  // Бесконечные анимации снимаются, остальные доматываются до конца
  for (const a of root.getAnimations({ subtree: true })) {
    try {
      if (a.effect?.getComputedTiming().iterations === Infinity) a.cancel();
      else a.finish();
    } catch { /* пропускаем */ }
  }
  root.querySelectorAll<HTMLElement>('[data-type="html"]').forEach(fitHtml);
  deckEl = root;
  return root;
}

/**
 * Живая вставка печатается снимком: документ отрабатывает в изолированной рамке,
 * снимок без скриптов ставится поверх заставки. Не вышло — остаётся заставка.
 */
async function embeds(root: HTMLElement, deck: Deck): Promise<void> {
  const els = [...root.querySelectorAll<HTMLElement>('[data-type="embed"][data-block]')];
  if (!els.length) return;
  const { snapshot } = await import('./import-ui');
  await Promise.all(els.map(async (el) => {
    try {
      const p = getAt(deck, JSON.parse(el.dataset.block!) as Path) as (Block & { src?: string; code?: string; theme?: boolean }) | undefined;
      if (!p || !hasEmbed(p)) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const snap = await snapshot(await embedHtml(p, false, el), { w, h });
      if (!snap) return;
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-same-origin');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;z-index:1';
      await new Promise((r) => { f.onload = r; f.srcdoc = snap; setTimeout(r, 4000); (el.querySelector('.embed') ?? el).append(f); });
      await f.contentDocument?.fonts?.ready;
    } catch { /* остаётся заставка */ }
  }));
}

/** Ждём картинки, шрифты и снимки вставок */
async function ready(root: HTMLElement, deck: Deck): Promise<void> {
  await embeds(root, deck);
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 4000); }))));
  await document.fonts.ready;
  root.querySelectorAll<HTMLElement>('[data-type="html"]').forEach(fitHtml);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** Ctrl+P в показе тоже печатает слайды, а не экран */
export function setupPrint(getDeck: () => Deck): void {
  window.addEventListener('beforeprint', () => {
    if (!deckEl) build(getDeck());
  });
  window.addEventListener('afterprint', () => {
    deckEl?.remove();
    deckEl = null;
  });
}

/** Окно печати, когда копия слайдов готова */
export async function printDeck(deck: Deck): Promise<void> {
  const root = build(deck);
  await ready(root, deck);
  window.print();
}
