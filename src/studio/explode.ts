import { getAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Block, Deck, SlideData } from '../types';
import { deckWithEffect, findEntrance, type UserEffect } from './templates';

/**
 * «Разобрать на объекты»: слайд встроенного шаблона (обложка, финал, космос, обычный) становится
 * холстом, а его части — свободными объектами на тех же местах, их можно двигать и масштабировать.
 *
 * Вид и анимации шаблона сохраняются: каждая часть — вёрстка с теми же классами, обёрнутая в
 * невидимый «слайд шаблона» (display: contents), поэтому его стили продолжают действовать.
 * Тексты остаются полями (правятся на слайде). Фон шаблона — фоном холста, декор (кольца,
 * луч, звёздное небо) — вёрсткой во весь слайд под объектами. Появление по словам, которое
 * пропадает, когда заголовок становится обычным текстом, переходит к объекту целиком.
 */

interface Host {
  deck: Deck;
  stage: HTMLElement;
  editor: Editor;
}

const TEMPLATES = new Set(['content', 'cover', 'finale', 'space']);
/** Части с логикой (ссылка → QR, кнопки): не делятся и становятся живыми блоками */
const LIVE = '.sp-card, .sp-row, .sp-panel, .plate';

export function canExplode(slide: SlideData | undefined): boolean {
  return !!slide && TEMPLATES.has(slide.template ?? 'content') && !slide.live;
}

/** Поля слайда, которые остаются после разбора: всё остальное — у объектов */
const KEEP = ['id', 'label', 'notes', 'transition', 'transitionMs', 'backdrop', 'free'];

export function explodeSlide(host: Host, index: number): boolean {
  const { deck, stage, editor } = host;
  const data = deck.slides[index];
  const slide = stage.querySelector<HTMLElement>(':scope > .slide.on');
  if (!canExplode(data) || !slide) return false;
  const sr = slide.getBoundingClientRect();
  const k = 1280 / sr.width;
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    const f = (n: number) => Math.round(n * 10) / 10;
    return { x: f((r.left - sr.left) * k), y: f((r.top - sr.top) * k), w: f(r.width * k), h: f(r.height * k) };
  };
  const tplClass = [...slide.classList].filter((c) => !['slide', 'on', 'out', 'static'].includes(c)).join(' ');
  const editable = (el: Element) => el.matches('[data-edit],[data-edit-img],[data-block]') || !!el.querySelector('[data-edit],[data-edit-img],[data-block]');
  const shown = (el: Element) => {
    if (el.classList.contains('free')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const kids = (el: Element) => [...el.children].filter(shown);

  // ---------- что на что делится ----------
  const decor: Element[] = [];
  const parts: Element[] = [];
  const slideArea = sr.width * sr.height;
  const isDecor = (el: Element) => {
    if (editable(el)) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.pointerEvents === 'none' || el.getAttribute('aria-hidden') === 'true' || r.width * r.height >= slideArea * 0.5;
  };
  /** Контейнер без своей подложки с несколькими полями — делится на свои части */
  const boxed = (el: Element) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    return bg || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none';
  };
  const expand = (el: Element): Element[] => {
    if (el.matches('[data-edit],[data-edit-img],[data-block]') || el.matches('a,button') || boxed(el) || el.matches(LIVE)) return [el];
    const inner = kids(el);
    const withFields = inner.filter(editable);
    // Обёртка ровно вокруг одного блока — это сам блок
    if (inner.length === 1 && inner[0].hasAttribute('data-block')) return [inner[0]];
    if (inner.length > 1 && withFields.length > 1) {
      // Появление контейнера (ряд кнопок проявляется целиком) переходит к каждой его части
      const own = findEntrance(el as HTMLElement, true) ?? inherited.get(el);
      const out = inner.flatMap(expand);
      if (own) out.forEach((x) => { if (!inherited.has(x)) inherited.set(x, own); });
      return out;
    }
    return [el];
  };
  const inherited = new Map<Element, NonNullable<ReturnType<typeof findEntrance>>>();
  let level = kids(slide);
  level.filter(isDecor).forEach((d) => decor.push(d));
  level = level.filter((e) => !isDecor(e));
  // Спускаемся, пока содержимое — одна обёртка
  while (level.length === 1 && !level[0].matches('[data-edit],[data-block]') && !boxed(level[0]) && kids(level[0]).length) level = kids(level[0]);
  level.forEach((e) => parts.push(...expand(e)));
  if (!parts.length) {
    editor.toast('На слайде нет частей, которые можно сделать отдельными', 2500);
    return false;
  }

  // ---------- часть → объект ----------
  /** Цепочка обёрток от слайда до элемента: классы для селекторов шаблона, без своей раскладки */
  const wrap = (el: Element, html: string) => {
    let out = html;
    for (let a = el.parentElement; a && a !== slide; a = a.parentElement) {
      out = `<div class="${a.getAttribute('class') ?? ''}" style="display:contents">${out}</div>`;
    }
    return `<div class="tpl-part ${tplClass}" style="display:contents">${out}</div>`;
  };
  const effects: UserEffect[] = [];
  const shared = new Map<string, string>();
  const look = data.template === 'finale' ? 'fin' : data.layout === 'orbit' ? 'orbit' : 'space';
  const copy = <T>(v: T): T | undefined => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const toBlock = (el: Element): Block | null => {
    const place = rect(el);
    // Ссылка с QR и кнопки — живыми блоками: адрес правится, QR строится заново
    if (el.matches('.sp-card') && data.link) return { type: 'link-card', look, link: copy(data.link), place };
    if (el.matches('.sp-row') && Array.isArray(data.buttons)) return { type: 'link-buttons', look, buttons: copy(data.buttons), place };
    if (el.matches('.sp-panel, .plate')) return { type: 'link-plate', look, ...(data.link ? { link: copy(data.link) } : {}), ...(Array.isArray(data.buttons) ? { buttons: copy(data.buttons) } : {}), place };
    if (el.hasAttribute('data-block')) {
      // Встроенный блок (график, схема на обложке) — его данные как есть
      const path = JSON.parse(el.getAttribute('data-block')!) as Path;
      const b = JSON.parse(JSON.stringify(getAt(deck, path))) as Block & { cols?: unknown; rows?: unknown };
      delete b.cols;
      delete b.rows;
      return { ...b, place };
    }
    const clone = el.cloneNode(true) as HTMLElement;
    const texts: unknown[] = [];
    const images: ({ src: string; srcDark?: string } | { brand: true })[] = [];
    // Поля текста → тексты вёрстки; их внутренняя разметка (слова заголовка) уходит
    const origEdits = [el, ...el.querySelectorAll('[data-edit]')].filter((x) => x.hasAttribute('data-edit'));
    const cloneEdits = [clone, ...clone.querySelectorAll('[data-edit]')].filter((x) => x.hasAttribute('data-edit'));
    let lost: { found: NonNullable<ReturnType<typeof findEntrance>>; delay: number } | null = null;
    cloneEdits.forEach((c, i) => {
      const orig = origEdits[i];
      let path: Path | null = null;
      try { path = JSON.parse(c.getAttribute('data-edit')!); } catch { /* нет пути */ }
      const v = path ? getAt(deck, path) : c.textContent;
      // Появление слов пропадёт вместе с ними — забираем его для объекта целиком
      if (orig && orig.children.length && !lost) {
        for (const child of orig.children) {
          const found = findEntrance(child as HTMLElement);
          if (found) { lost = { found, delay: found.delay }; break; }
        }
      }
      c.setAttribute('data-t', String(texts.length));
      texts.push(typeof v === 'string' || typeof v === 'number' ? v : String(c.textContent ?? '').trim());
      c.innerHTML = '';
    });
    // Картинки → картинки вёрстки: адрес — полем, а не внутри разметки
    clone.querySelectorAll('img').forEach((img) => {
      // Картинка с вариантом для тёмной темы: основной адрес — светлый, тёмный — отдельным полем
      const src = img.getAttribute('data-src-light') ?? img.getAttribute('src');
      const srcDark = img.getAttribute('data-src-dark');
      if (!src) return;
      for (const a of ['src', 'data-src-light', 'data-src-dark']) img.removeAttribute(a);
      img.setAttribute('data-i', String(images.length));
      // Логотип презентации остаётся её логотипом: сменят — сменится и здесь
      images.push(img.getAttribute('data-edit-img') === JSON.stringify(['brand', 'logo']) ? { brand: true } : srcDark ? { src, srcDark } : { src });
    });
    // Служебные пометки редактора — не часть вёрстки
    [clone, ...clone.querySelectorAll('*')].forEach((x) => {
      for (const a of [...x.attributes]) if (/^data-(edit|ed-|img-|block|mount|free|part)/.test(a.name)) x.removeAttribute(a.name);
    });
    // Часть стоит сама по себе: без отступов и позиции внутри шаблона
    const cs = getComputedStyle(el);
    clone.style.margin = '0';
    clone.style.width = '100%';
    clone.style.boxSizing = 'border-box';
    if (cs.position === 'absolute' || cs.position === 'fixed') {
      clone.style.position = 'relative';
      clone.style.inset = 'auto';
      if (/^matrix\(1, 0, 0, 1,/.test(cs.transform)) clone.style.transform = 'none';
    }
    const b: Block = { type: 'html', scale: 1, html: wrap(el, clone.outerHTML), place };
    if (texts.length) b.texts = texts;
    if (images.length) b.images = images;
    // Появление контейнера, из которого часть вынута (ряд кнопок), — если своего нет
    const own = findEntrance(el as HTMLElement, true);
    const parent = inherited.get(el);
    if (!lost && !own && parent) lost = { found: parent, delay: parent.delay };
    if (lost) {
      const { found, delay } = lost as { found: NonNullable<ReturnType<typeof findEntrance>>; delay: number };
      // Одинаковое появление у нескольких частей — один общий эффект
      const key = `${found.keyframes.cssText}|${found.ms}|${found.ease}`;
      let id = shared.get(key);
      if (!id) {
        id = `ufx-${Math.random().toString(36).slice(2, 9)}`;
        shared.set(key, id);
        effects.push({ id, name: 'Появление из шаблона', css: found.keyframes.cssText.replace(/^@(-webkit-)?keyframes\s+[^\s{]+/, `@keyframes ${id}`), ms: found.ms, ease: found.ease, created: Date.now() });
      }
      b.enter = id;
      if (delay > 0) b.delay = Math.round(delay);
    }
    return b;
  };
  const objects = parts.map(toBlock).filter((b): b is Block => !!b);

  // ---------- фон ----------
  const cs = getComputedStyle(slide);
  const bgImage = cs.backgroundImage !== 'none' ? cs.backgroundImage : '';
  const bgColor = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : '';
  const bg = [bgImage, bgColor].filter(Boolean).join(', ');
  let body: Block | undefined;
  if (data.template === 'space') body = { type: 'space-sky', ...(data.layout === 'orbit' ? { layout: 'orbit' } : {}) };
  else if (decor.length) {
    body = { type: 'html', scale: 1, html: `<div class="tpl-part ${tplClass}" style="display:contents">${decor.map((d) => {
      const c = d.cloneNode(true) as Element;
      [c, ...c.querySelectorAll('*')].forEach((x) => { for (const a of [...x.attributes]) if (/^data-(edit|ed-|img-|block|mount)/.test(a.name)) x.removeAttribute(a.name); });
      return c.outerHTML;
    }).join('')}</div>` };
  }

  const label = data.label ?? data.title;
  const ok = editor.commit((d) => {
    effects.forEach((e) => deckWithEffect(d, e));
    const old = d.slides[index];
    const next: SlideData = { template: 'canvas' };
    for (const key of KEEP) if (old[key] !== undefined) next[key] = old[key];
    if (!next.label && typeof label === 'string') next.label = label;
    if (bg) next.bg = bg;
    if (body) next.body = body;
    // Уже свободные объекты слайда — поверх новых частей
    next.free = [...objects, ...((Array.isArray(old.free) ? old.free : []) as Block[])];
    d.slides[index] = next;
  }, { rebuild: true });
  if (!ok) return false;
  editor.toast(`Слайд разобран: ${objects.length} ${objects.length % 10 === 1 && objects.length % 100 !== 11 ? 'объект' : objects.length % 10 >= 2 && objects.length % 10 <= 4 && (objects.length % 100 < 12 || objects.length % 100 > 14) ? 'объекта' : 'объектов'}. Вернуть: Ctrl+Z`, 3500);
  return true;
}
