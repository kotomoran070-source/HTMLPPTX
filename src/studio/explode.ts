import { W } from '../engine/deck-view';
import { getAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Block, Deck, SlideData } from '../types';
import { THEME_COLORS, type TextStyle } from '../engine/text-style';
import { deckWithEffect, findEntrance, type UserEffect } from './templates';

/**
 * «Разобрать на объекты»: слайд встроенного шаблона (обложка, финал, космос, обычный) становится
 * холстом, а его части — свободными объектами на тех же местах, их можно двигать и масштабировать.
 *
 * Простой текст шаблона (заголовок, абзац, подзаголовок) становится надписью: её вид — шрифт, размер, цвет,
 * насыщенность, регистр, интервалы — переносится в стили надписи, и к ней применимы эффекты текста.
 * Остальное (градиентный текст, плашки, тени, части с картинками) — вёрстка с теми же классами, обёрнутая в
 * невидимый «слайд шаблона» (display: contents), поэтому его стили продолжают действовать.
 * Тексты остаются полями (правятся на слайде). Свой фон шаблона (у «Космоса») — фоном холста; фон темы и живой фон остаются как были, декор (кольца,
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

/** Шрифт для сравнения: без кавычек и пробелов */
const family = (f: string) => f.replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();
/** rgb(…) → #RRGGBB; полупрозрачный — undefined (в стиль надписи не переносится) */
function hex(c: string): string | undefined {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c);
  if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return undefined;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function canExplode(slide: SlideData | undefined): boolean {
  return !!slide && TEMPLATES.has(slide.template ?? 'content') && !slide.live;
}

/**
 * Поля слайда, которые остаются после разбора: имя, заметки, скрытие, ползунки, свои цвета, переход с направлением,
 * анимированный фон с заметностью, скоростью и ответом на мышь. Всё остальное — у объектов
 */
const KEEP = [
  'id', 'label', 'notes', 'notesEdited', 'hidden', 'after', 'repeat', 'vars', 'recolor', 'theme', 'transition', 'transitionMs', 'transitionDir',
  'backdrop', 'backdropOpacity', 'backdropSpeed', 'backdropTouch', 'free',
];

export function explodeSlide(host: Host, index: number): boolean {
  const { deck, stage, editor } = host;
  const data = deck.slides[index];
  const slide = stage.querySelector<HTMLElement>(':scope > .slide.on');
  if (!canExplode(data) || !slide) return false;
  const sr = slide.getBoundingClientRect();
  const k = W / sr.width;
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    const f = (n: number) => Math.round(n * 10) / 10;
    return { x: f((r.left - sr.left) * k), y: f((r.top - sr.top) * k), w: f(r.width * k), h: f(r.height * k) };
  };
  const tplClass = [...slide.classList].filter((c) => !['slide', 'on', 'out', 'static', 'has-backdrop'].includes(c)).join(' ');
  const editable = (el: Element) => el.matches('[data-edit],[data-edit-img],[data-block]') || !!el.querySelector('[data-edit],[data-edit-img],[data-block]');
  const shown = (el: Element) => {
    // Анимированный фон слайд рисует сам (поле backdrop остаётся): копия была бы пустым холстом поверх живого
    if (el.classList.contains('free') || el.classList.contains('backdrop')) return false;
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
  type Found = NonNullable<ReturnType<typeof findEntrance>>;
  /** Появление по словам: слова уходят вместе с разметкой поля — появление переходит к объекту целиком */
  const wordFx = (el: Element): Found | null => {
    for (const f of [el, ...el.querySelectorAll('[data-edit]')].filter((x) => x.hasAttribute('data-edit'))) {
      for (const child of f.children) {
        const found = findEntrance(child as HTMLElement);
        if (found) return found;
      }
    }
    return null;
  };
  /**
   * Появление объекта: слов; у надписи (классов шаблона у неё нет) — и своё; иначе — контейнера, из которого
   * часть вынута (ряд кнопок). Одинаковое у нескольких частей — один общий эффект
   */
  const withEntrance = (b: Block, el: Element, plain: boolean): Block => {
    const found = wordFx(el) ?? (plain ? findEntrance(el as HTMLElement, true) : null)
      ?? (findEntrance(el as HTMLElement, true) ? null : inherited.get(el) ?? null);
    if (!found) return b;
    const key = `${found.keyframes.cssText}|${found.ms}|${found.ease}`;
    let id = shared.get(key);
    if (!id) {
      id = `ufx-${Math.random().toString(36).slice(2, 9)}`;
      shared.set(key, id);
      effects.push({ id, name: 'Появление из шаблона', css: found.keyframes.cssText.replace(/^@(-webkit-)?keyframes\s+[^\s{]+/, `@keyframes ${id}`), ms: found.ms, ease: found.ease, created: Date.now() });
    }
    b.enter = id;
    if (found.delay > 0) b.delay = Math.round(found.delay);
    return b;
  };
  /**
   * Простой текст шаблона — надписью: одно поле, без картинок и украшений (градиент букв, тень, плашка,
   * значок перед текстом), шрифт — тот, что надпись получит и так. Иначе — null, часть станет вёрсткой
   */
  const asText = (outer: Element, box: { x: number; y: number; w: number; h: number }): Block | null => {
    // Обёртка ровно вокруг поля (строка заголовка обычного слайда) без своей подложки — само поле; ширина —
    // обёртки без её полей (заголовок в строке сжат по тексту, а правка его удлинит)
    let el = outer;
    while (!el.hasAttribute('data-edit') && el.children.length === 1 && !boxed(el) && (el.textContent ?? '').trim() === (el.children[0].textContent ?? '').trim()) el = el.children[0];
    let place = box;
    if (el !== outer) {
      const ocs = getComputedStyle(outer);
      place = rect(el);
      // Поля обёртки — в пикселях вёрстки, а они и есть пиксели слайда (слайд свёрстан на свою ширину W)
      place.w = Math.max(place.w, box.x + box.w - (parseFloat(ocs.paddingRight) || 0) - place.x);
    }
    if (!el.hasAttribute('data-edit') || el.querySelector('[data-edit],[data-edit-img],[data-block],img,svg,canvas,video,iframe')) return null;
    let path: Path;
    try { path = JSON.parse(el.getAttribute('data-edit')!) as Path; } catch { return null; }
    const v = getAt(deck, path);
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const cs = getComputedStyle(el);
    const decorated = (pe: string) => !/^(none|normal|""|'')$/.test(getComputedStyle(el, pe).content);
    if (boxed(el) || cs.textShadow !== 'none' || cs.backgroundClip === 'text' || /(^|\s)text/.test(cs.getPropertyValue('-webkit-background-clip'))
      || /rgba\([^)]*,\s*0\)|transparent/.test(cs.getPropertyValue('-webkit-text-fill-color')) || decorated('::before') || decorated('::after')
      || (cs.transform !== 'none' && !/^matrix\(1, 0, 0, 1,/.test(cs.transform))) return null;
    const pr = probes();
    const px = parseFloat(cs.fontSize);
    if (!(px > 0)) return null;
    // Крупный текст надписи пишется шрифтом заголовков и с поправкой размера темы (text-style.ts)
    const head = px / pr.hScale >= 28;
    const size = Math.round((head ? px / pr.hScale : px) * 10) / 10;
    if (family(cs.fontFamily) !== (head ? pr.headFont : pr.bodyFont)) return null;
    const st: TextStyle = { size };
    const color = cs.color === pr.color ? null : pr.colors.get(cs.color) ?? hex(cs.color);
    if (color === undefined) return null;
    if (color) st.color = color;
    const wt = parseInt(cs.fontWeight, 10);
    if (wt && wt !== pr.weight) st.weight = wt;
    if (cs.fontStyle === 'italic') st.italic = true;
    if (cs.textTransform === 'uppercase') st.upper = true;
    const ls = parseFloat(cs.letterSpacing);
    if (Number.isFinite(ls) && Math.abs(ls / px) >= 0.001) st.spacing = Math.round((ls / px) * 1000) / 1000;
    const lh = parseFloat(cs.lineHeight);
    if (Number.isFinite(lh) && Math.abs(lh / px - pr.leading) > 0.02) st.leading = Math.round((lh / px) * 100) / 100;
    if (cs.textAlign === 'center' || cs.textAlign === 'right' || cs.textAlign === 'justify') st.align = cs.textAlign;
    // Высота — по тексту (правка дописывает строки); ширина — с запасом на округление, чтобы строки не переносились иначе
    return { type: 'text', text: String(v), styles: { text: st }, place: { x: place.x, y: place.y, w: Math.min(W - place.x, Math.round(place.w + 4)) } };
  };
  /** Как на этом слайде выглядит обычная надпись и цвета темы — один раз за разбор */
  let probed: { color: string; weight: number; leading: number; bodyFont: string; headFont: string; hScale: number; colors: Map<string, string> } | null = null;
  const probes = () => {
    if (probed) return probed;
    const box = document.createElement('div');
    box.className = 'free';
    box.style.cssText = 'position:absolute;left:0;top:0;width:400px;visibility:hidden;pointer-events:none';
    const names = Object.keys(THEME_COLORS);
    box.innerHTML = `<p>x</p><p style="font-family:var(--font-head)">x</p>${names.map((n) => `<span style="color:${THEME_COLORS[n].css}">x</span>`).join('')}`;
    slide.appendChild(box);
    const [p, h, ...spans] = [...box.children].map((x) => getComputedStyle(x));
    const colors = new Map<string, string>();
    // Совпали два цвета темы — берётся первый по списку (акцент раньше текста)
    spans.forEach((x, i) => { if (!colors.has(x.color)) colors.set(x.color, names[i]); });
    const pxp = parseFloat(p.fontSize);
    const lh = parseFloat(p.lineHeight);
    probed = {
      color: p.color, weight: parseInt(p.fontWeight, 10) || 400, leading: Number.isFinite(lh) && pxp ? lh / pxp : 1.5,
      bodyFont: family(p.fontFamily), headFont: family(h.fontFamily),
      hScale: parseFloat(getComputedStyle(slide).getPropertyValue('--h-scale')) || 1, colors,
    };
    box.remove();
    return probed;
  };
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
    const text = asText(el, place);
    if (text) return withEntrance(text, el, true);
    const clone = el.cloneNode(true) as HTMLElement;
    const texts: unknown[] = [];
    const images: ({ src: string; srcDark?: string } | { brand: true })[] = [];
    // Поля текста → тексты вёрстки; их внутренняя разметка (слова заголовка) уходит
    const cloneEdits = [clone, ...clone.querySelectorAll('[data-edit]')].filter((x) => x.hasAttribute('data-edit'));
    cloneEdits.forEach((c) => {
      let path: Path | null = null;
      try { path = JSON.parse(c.getAttribute('data-edit')!); } catch { /* нет пути */ }
      const v = path ? getAt(deck, path) : c.textContent;
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
    // Плашка логотипа: растёт вместе с объектом целиком и без искажений пропорций
    const isLogo = el.classList.contains('logo');
    if (isLogo) clone.style.height = '100%';
    const b: Block = { type: 'html', scale: 1, html: wrap(el, clone.outerHTML), place };
    if (isLogo) b.keepRatio = true;
    if (texts.length) b.texts = texts;
    if (images.length) b.images = images;
    // Своё появление вёрстка сохраняет классами шаблона; пропадает только появление слов и контейнера
    return withEntrance(b, el, false);
  };
  const objects = parts.map(toBlock).filter((b): b is Block => !!b);

  // ---------- фон ----------
  // Свой фон холста — только если у шаблона фон свой (у «Космоса»): фон темы у холста и так есть, а записанный
  // своим он закрыл бы анимированный фон слайда и перестал бы меняться вместе с темой
  const bgOf = (el: Element) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundImage !== 'none' ? cs.backgroundImage : '', cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : ''].filter(Boolean).join(', ');
  };
  const probe = slide.cloneNode(false) as HTMLElement;
  probe.removeAttribute('id');
  probe.className = 'slide canvas-slide';
  slide.after(probe);
  const plain = bgOf(probe);
  probe.remove();
  const own = bgOf(slide);
  const bg = own !== plain ? own : '';
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
  editor.toast(`Слайд разобран: ${objects.length} ${objects.length % 10 === 1 && objects.length % 100 !== 11 ? 'объект' : objects.length % 10 >= 2 && objects.length % 10 <= 4 && (objects.length % 100 < 12 || objects.length % 100 > 14) ? 'объекта' : 'объектов'}. Вернуть — Ctrl+Z`, 3500);
  return true;
}
