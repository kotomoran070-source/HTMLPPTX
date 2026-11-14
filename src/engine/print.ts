import { embedHtml, fitHtml, hasEmbed } from '../components/html/html';
import type { Block, Deck } from '../types';
import type { Path } from './data';
import { getAt } from './data';
import { staticSlide } from './deck-view';
import { SLIDE_H, widthOf } from './slide-size';

/**
 * Печать и «Сохранить как PDF»: отдельная страница на каждый слайд, слайд в конечном виде.
 * Живая сцена для печати не годится: шаги показа скрыты, анимации не доиграны.
 */
let deckEl: HTMLElement | null = null;

/** Копия слайдов: все, кроме скрытых (печать), или только перечисленные (снимок для агента) — шириной width */
function build(deck: Deck, only?: number[], width = widthOf(deck)): HTMLElement {
  deckEl?.remove();
  const root = document.createElement('div');
  root.className = 'print-deck';
  // Размер слайда этой презентации: страница печати и PDF — такого же размера
  const sw = widthOf(deck);
  root.style.setProperty('--sw', `${sw}px`);
  root.style.setProperty('--sar', `${sw} / ${SLIDE_H}`);
  let page = document.getElementById('print-page-size');
  if (!page) {
    page = document.createElement('style');
    page.id = 'print-page-size';
    document.head.append(page);
  }
  page.textContent = `@page { size: ${sw}px ${SLIDE_H}px; margin: 0; } @media print { html, body { width: ${sw}px; } }`;
  // Скрытый слайд в PDF не попадает
  const list = only ?? deck.slides.flatMap((s, i) => (s.hidden === true ? [] : [i]));
  for (const i of list) {
    const page = document.createElement('div');
    page.className = 'print-page';
    page.appendChild(staticSlide(deck, i, width));
    root.appendChild(page);
  }
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
      const snap = await snapshot(await embedHtml(p, false, el), { w, h }, { still: true });
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

/** Окно печати, когда копия слайдов готова. В приложении Slideria — сразу файл PDF (см. desktop/main.mjs) */
export async function printDeck(deck: Deck): Promise<void> {
  const root = build(deck);
  await ready(root, deck);
  const app = (window as { slideriaApp?: { pdf?(name: string): Promise<string | null> } }).slideriaApp;
  if (app?.pdf) {
    const file = await app.pdf(deck.title ?? '').catch(() => null);
    deckEl?.remove();
    deckEl = null;
    // Редактору, который попросил PDF: готово (или не сохранили)
    tellOpener({ kind: 'pdf', file, done: true });
    // Окно открыто только ради PDF («Экспорт → PDF» в редакторе) — закрывается само
    if (window.name.startsWith('htmlpptx-print-')) window.close();
    return;
  }
  tellOpener({ kind: 'pdf', open: true });
  window.addEventListener('afterprint', () => tellOpener({ kind: 'pdf', done: true }), { once: true });
  window.print();
}

/**
 * Снимок для агента (MCP view_slides, server/shot.ts): ?shot=3,5 — эти слайды (номера с 1) в конечном виде, как
 * при печати, по одному на экране шириной w (?w=, по умолчанию — ширина слайда). Снимающий ждёт data-shot="ready" у <html>
 * и показывает слайды по очереди: slideriaShot.show(k) — k-й из перечисленных, ответ — когда он нарисован
 */
export async function shotDeck(deck: Deck, list: number[], width: number): Promise<void> {
  const html = document.documentElement;
  html.classList.add('shot');
  try {
    const root = build(deck, list.filter((i) => i >= 0 && i < deck.slides.length), width);
    await ready(root, deck);
    const pages = [...root.children] as HTMLElement[];
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    (window as { slideriaShot?: unknown }).slideriaShot = {
      count: pages.length,
      async show(k: number) {
        pages.forEach((p, n) => { p.hidden = n !== k; });
        await frame();
        return true;
      },
    };
    pages.forEach((p, n) => { p.hidden = n !== 0; });
    await frame();
    html.dataset.shot = 'ready';
  } catch (e) {
    html.dataset.shot = `error: ${(e as Error).message}`;
  }
}

/** Сообщение окну редактора об экспорте (оно показывает, что файл готов) */
function tellOpener(detail: Record<string, unknown>): void {
  try {
    (window.opener as Window | null)?.postMessage({ type: 'slideria-export', ...detail }, location.origin);
  } catch { /* редактор закрыт */ }
}
