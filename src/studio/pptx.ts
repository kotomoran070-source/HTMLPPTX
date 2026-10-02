import type PptxGenJS from 'pptxgenjs';
import { getAt, type Path } from '../engine/data';
import { staticSlide } from '../engine/deck-view';
import type { Block, Deck } from '../types';
import { fitHtml, hasEmbed } from '../components/html/html';
import { embedShot } from '../engine/embed-shot';
import { resolve } from '../engine/formula';
import { Renderer, actionTarget } from '../engine/render';

/**
 * Экспорт в PowerPoint. Каждый слайд рисуется вне экрана в натуральную величину (1280×720 —
 * это широкий слайд PowerPoint 13,33″ × 7,5″, 96 px на дюйм), вёрстка обходится и становится
 * родными объектами: подложки — фигурами, тексты — надписями с оформлением, таблицы — таблицами,
 * графики — диаграммами, картинки — картинками, заметки — заметками докладчика.
 * Картинкой уходит только то, что так не передать: схемы, живые вставки, узорные фоны.
 */

type Slide = PptxGenJS.Slide;
type Pptx = PptxGenJS;

const PX = 96;
/** Язык текста: иначе PowerPoint проверяет русский текст как английский и подчёркивает каждое слово */
let LANG = 'ru-RU';
const inch = (px: number) => Math.round((px / PX) * 1000) / 1000;
const pt = (px: number) => Math.round(px * 0.75 * 10) / 10;

/** Блоки, которые передаются картинкой: схемы и вставки со своей графикой */
/** Блоки, которые уходят в PPTX картинкой целиком (редактор кода с подсветкой) */
const RASTER = new Set<string>(['sandbox']);
/** Строчные элементы: внутри них текст — одна надпись с разным оформлением кусков */
const INLINE = new Set(['inline', 'contents']);

interface Rgba { hex: string; a: number }

function rgba(c: string): Rgba | null {
  // color-mix() браузер отдаёт как color(srgb r g b / a) с долями от 0 до 1
  const s = /color\(srgb\s+([^)]+)\)/.exec(c);
  if (s) {
    const [r, g, b, a = '1'] = s[1].split(/[\s/]+/).filter(Boolean);
    return rgba(`rgba(${[r, g, b].map((v) => Number(v) * 255).join(',')},${a})`);
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(/[,\s/]+/).filter(Boolean);
  const alpha = a.endsWith('%') ? parseFloat(a) / 100 : Number(a);
  if (!(alpha > 0.02)) return null;
  const hex = [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join('').toUpperCase();
  return { hex, a: alpha };
}
const transparency = (a: number) => Math.round((1 - Math.min(1, a)) * 100);

/** Первый цвет градиента — для заливки сплошным цветом и текста с градиентом */
function gradientColor(img: string): Rgba | null {
  const m = /rgba?\([^)]+\)|color\(srgb[^)]+\)/.exec(img);
  return m ? rgba(m[0]) : null;
}

/** Внутри есть объёмная сцена: элемент с transform-style: preserve-3d */
function has3d(el: HTMLElement): boolean {
  for (const x of el.querySelectorAll<HTMLElement>('*')) if (getComputedStyle(x).transformStyle === 'preserve-3d') return true;
  return false;
}

/** Градиент, у которого все цвета одинаковые, — этот цвет; иначе null */
function flatGradient(img: string): Rgba | null {
  if (!/^linear-gradient\(/.test(img) || img.includes('url(')) return null;
  const colors = img.match(/rgba?\([^)]+\)/g);
  if (!colors || colors.length < 2 || colors.some((c) => c !== colors[0])) return null;
  return rgba(colors[0]);
}

function fontFace(family: string): string {
  const generic = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-[a-z-]+|cursive|fantasy|inherit)$/i;
  const list = family.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
  const real = list.find((f) => !generic.test(f));
  if (real) return real;
  if (/mono/i.test(family)) return 'Consolas';
  if (/serif/i.test(family) && !/sans-serif/i.test(family)) return 'Georgia';
  return 'Segoe UI';
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** Картинка → PNG нужного размера (SVG PowerPoint понимает не везде) */
async function imageToPng(src: string, w: number, h: number): Promise<string | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const ok = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
  if (!ok) return null;
  const k = 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, c.width, c.height);
  try {
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

async function imageData(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  try {
    const r = await fetch(src);
    if (!r.ok) return null;
    return await blobToDataUrl(await r.blob());
  } catch {
    return null;
  }
}

/** Свойства SVG, которые задаются стилями: копируются в атрибут style, чтобы картинка не зависела от страницы */
const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'stop-color', 'stop-opacity', 'visibility', 'display'];

async function svgToPng(svg: SVGSVGElement, w: number, h: number): Promise<string | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, k) => {
    const cs = getComputedStyle(el);
    const d = dst[k] as SVGElement;
    d.setAttribute('style', SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  // Значки из общего набора (<use href="#…">): символы копируются внутрь картинки
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const copied = new Set<string>();
  clone.querySelectorAll('use').forEach((u) => {
    const id = (u.getAttribute('href') ?? u.getAttribute('xlink:href') ?? '').replace(/^#/, '');
    const ref = id && !copied.has(id) ? document.getElementById(id) : null;
    if (!ref || svg.contains(ref)) return;
    copied.add(id);
    const c = ref.cloneNode(true) as Element;
    [c, ...c.querySelectorAll('*')].forEach((e, k) => {
      const src = k === 0 ? ref : ref.querySelectorAll('*')[k - 1];
      const cs = getComputedStyle(src);
      e.setAttribute('style', SVG_PROPS.filter((p) => !['display', 'visibility'].includes(p)).map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    });
    defs.appendChild(c);
  });
  if (defs.childNodes.length) clone.insertBefore(defs, clone.firstChild);
  // Картинки внутри SVG (<image href>) — встроенными данными: внешние ссылки картинка-SVG не грузит
  for (const im of clone.querySelectorAll('image')) {
    const href = im.getAttribute('href') ?? im.getAttribute('xlink:href');
    if (!href || href.startsWith('data:')) continue;
    const data = await imageData(new URL(href, location.href).href);
    if (data) im.setAttribute('href', data);
  }
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  return imageToPng(url, w, h);
}

interface Box { x: number; y: number; w: number; h: number }

export interface PptxProgress {
  (done: number, total: number): void;
}

export async function exportPptx(deck: Deck, progress?: PptxProgress): Promise<Blob> {
  const [{ default: Pptx }, { toPng }] = await Promise.all([import('pptxgenjs'), import('html-to-image')]);
  const pptx: Pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.title ?? '';
  const lang = String((deck as { lang?: unknown }).lang ?? 'ru');
  LANG = lang.includes('-') ? lang : lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`;

  // Слайды рисуются в светлой теме — так PowerPoint-файл выглядит привычно
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:720px;overflow:hidden;pointer-events:none';
  document.body.appendChild(host);

  try {
    for (let i = 0; i < deck.slides.length; i++) {
      progress?.(i, deck.slides.length);
      const box = staticSlide(deck, i, 1280);
      host.replaceChildren(box);
      await settle(box);
      const section = box.querySelector<HTMLElement>('.slide');
      const slide = pptx.addSlide();
      if (section) await new Converter(pptx, slide, section, deck, toPng).run();
      const notes = deck.slides[i].notes;
      if (typeof notes === 'string' && notes.trim()) slide.addNotes(notes);
    }
    progress?.(deck.slides.length, deck.slides.length);
    return await repair(await pptx.write({ outputType: 'blob' }) as Blob);
  } finally {
    host.remove();
    if (theme === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }
}

/** Ждём картинки, шрифты и два кадра: вёрстка должна устояться */
async function settle(box: HTMLElement): Promise<void> {
  // Слайд в конечном виде, как в миниатюрах (.static): то, что всё же анимируется, доматывается до конца
  await new Promise((r) => requestAnimationFrame(r));
  for (const a of box.getAnimations({ subtree: true })) {
    try {
      // Бесконечные (пульсация, мерцание) снимаются: элемент остаётся в обычном виде
      if (a.effect?.getComputedTiming().iterations === Infinity) a.cancel();
      else a.finish();
    } catch { /* анимация без конца — пропускаем */ }
  }
  const imgs = [...box.querySelectorAll('img')];
  await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 3000); }))));
  const videos = [...box.querySelectorAll('video')].filter((v) => !v.poster);
  await Promise.all(videos.map((v) => (v.readyState >= 2 ? null : new Promise((r) => { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 2000); }))));
  await document.fonts.ready;
  // Импортированная вёрстка подгоняет текст под рамку, как на живом слайде
  box.querySelectorAll<HTMLElement>('[data-type="html"]').forEach(fitHtml);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

type ToPng = (el: HTMLElement, o?: { pixelRatio?: number; skipFonts?: boolean; cacheBust?: boolean; width?: number; height?: number }) => Promise<string>;

class Converter {
  private origin: DOMRect;

  constructor(private pptx: Pptx, private slide: Slide, private section: HTMLElement, private deck: Deck, private toPng: ToPng) {
    this.origin = section.getBoundingClientRect();
  }

  private box(el: Element): Box {
    const r = el.getBoundingClientRect();
    return { x: r.left - this.origin.left, y: r.top - this.origin.top, w: r.width, h: r.height };
  }

  private pos(b: Box) {
    const c = this.turned(b.x + b.w / 2, b.y + b.h / 2);
    const r = this.spin(0);
    return { x: inch(c.x - b.w / 2), y: inch(c.y - b.h / 2), w: inch(Math.max(1, b.w)), h: inch(Math.max(1, b.h)), ...(r ? { rotate: r } : {}) };
  }

  /**
   * Повёрнутые свободные объекты (angle): их содержимое снимается без поворота,
   * а потом каждая фигура поворачивается вокруг центра объекта — как группа в PowerPoint.
   */
  private turns: { cx: number; cy: number; r: number }[] = [];

  /** Точка снятого без поворота содержимого → точка на слайде */
  private turned(x: number, y: number): { x: number; y: number } {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const t = this.turns[i];
      const a = (t.r * Math.PI) / 180;
      const dx = x - t.cx;
      const dy = y - t.cy;
      x = t.cx + dx * Math.cos(a) - dy * Math.sin(a);
      y = t.cy + dx * Math.sin(a) + dy * Math.cos(a);
    }
    return { x, y };
  }

  /** Собственный поворот фигуры плюс поворот объектов вокруг неё; 0 — без поворота */
  private spin(own: number): number {
    const r = ((Math.round(own + this.turns.reduce((s, t) => s + t.r, 0)) % 360) + 360) % 360;
    return r;
  }

  async run(): Promise<void> {
    const cs = getComputedStyle(this.section);
    const bg = rgba(cs.backgroundColor) ?? rgba(getComputedStyle(document.body).backgroundColor);
    this.slide.background = { color: bg?.hex ?? 'FFFFFF' };
    // Узорный фон (точки, градиенты) — картинкой под всем остальным
    if (cs.backgroundImage !== 'none') await this.backgroundPicture(this.section, { x: 0, y: 0, w: 1280, h: 720 });
    for (const c of this.section.children) await this.walk(c as HTMLElement, 1, 1);
  }

  /** Фон элемента без содержимого — картинкой (градиенты, узоры, анимированный фон) */
  private async backgroundPicture(el: HTMLElement, b: Box): Promise<void> {
    const cs = getComputedStyle(el);
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:0;top:0;width:${b.w}px;height:${b.h}px;background:${cs.background};border-radius:${cs.borderRadius}`;
    this.section.appendChild(d);
    try {
      const data = await this.toPng(d, { pixelRatio: 1.5, skipFonts: true });
      this.slide.addImage({ data, ...this.pos(b) });
    } catch { /* пропускаем узор */ }
    d.remove();
  }

  /**
   * Сколько пикселей слайда в одном CSS-пикселе элемента: импортированная вёрстка
   * нарисована под 1920 и уменьшена (scale) — её шрифты и отступы тоже уменьшаются.
   */
  private unit(el: Element, parent: number): number {
    const w = (el as HTMLElement).offsetWidth;
    if (!(el instanceof HTMLElement) || !w) return parent;
    const k = el.getBoundingClientRect().width / w;
    // Поворот меняет ширину рамки, а не масштаб
    return getComputedStyle(el).transform.startsWith('matrix(') && this.rotation(getComputedStyle(el)) ? parent : Math.round(k * 1000) / 1000 || parent;
  }

  private inAction = false;

  private async walk(el: HTMLElement, opacity: number, parentK: number): Promise<void> {
    const ang = el.classList.contains('free') || el.classList.contains('grp-item') ? parseFloat(el.style.rotate) || 0 : 0;
    if (ang) {
      el.style.rotate = '';
      const b = this.box(el);
      this.turns.push({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: ang });
      try { await this.walk(el, opacity, parentK); } finally {
        this.turns.pop();
        el.style.rotate = `${ang}deg`;
      }
      return;
    }
    // Кнопка с переходом или ссылкой: поверх объекта — прозрачная фигура с гиперссылкой,
    // щелчок по ней при показе в PowerPoint работает так же, как в браузере
    if (el.dataset.action && el.classList.contains('free') && !this.inAction) {
      this.inAction = true;
      try { await this.walk(el, opacity, parentK); } finally { this.inAction = false; }
      const to = actionTarget(el.dataset.action, this.deck, Number(this.section.dataset.index));
      const b = this.box(el);
      if (to) {
        this.slide.addShape(this.pptx.ShapeType.rect, {
          ...this.pos(b), fill: { color: 'FFFFFF', transparency: 100 }, line: { type: 'none' } as never,
          hyperlink: 'slide' in to ? { slide: to.slide + 1 } : { url: to.url },
        });
      }
      return;
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    // Обёртка без своей рамки (display: contents — части разобранного шаблона): только её дети
    if (cs.display === 'contents') {
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) this.looseText(n as Text, cs, opacity, parentK);
        else if (n.nodeType === Node.ELEMENT_NODE) await this.walk(n as HTMLElement, opacity, parentK);
      }
      return;
    }
    const op = opacity * Number(cs.opacity || 1);
    if (op < 0.03) return;
    const k = this.unit(el, parentK);
    const b = this.box(el);
    if (b.x > 1280 || b.y > 720 || b.x + b.w < 0 || b.y + b.h < 0) return;
    const type = el.dataset.type;
    const tag = el.tagName.toLowerCase();

    if (el.classList.contains('backdrop')) return this.backgroundPicture(el, b);
    if (type && RASTER.has(type)) return this.raster(el, b);
    if (type === 'table') return this.table(el, k);
    if (type === 'embed' && await this.embed(el, b)) return;
    // Вёрстка с объёмной сценой (CSS 3D): фигурами её не передать — картинкой, как на экране
    if (type === 'html' && has3d(el)) return this.raster(el, b);
    if (type === 'bars' || type === 'line-chart') {
      if (this.chart(el, type, b)) return;
      return this.raster(el, b);
    }
    if (type === 'shape' && el.querySelector(':scope > .shape-bar, :scope .shape-bar')) return this.line(el, cs, k);
    if (tag === 'img') return this.image(el as HTMLImageElement, b, cs);
    if (tag === 'svg') return this.svg(el as unknown as SVGSVGElement, b);
    if (tag === 'video') return this.video(el as HTMLVideoElement, b);
    if (tag === 'canvas') return this.canvas(el as HTMLCanvasElement, b);
    if (tag === 'iframe') return;

    await this.decoration(el, cs, b, op, k);
    if (this.isTextLeaf(el)) {
      this.text(el, cs, op, k);
      return;
    }
    // Текст рядом с блочными соседями: каждый кусок — своей надписью по месту
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) this.looseText(n as Text, cs, op, k);
      else if (n.nodeType === Node.ELEMENT_NODE) await this.walk(n as HTMLElement, op, k);
    }
  }

  // ---------------- подложки ----------------

  private async decoration(el: HTMLElement, cs: CSSStyleDeclaration, b: Box, op: number, k: number): Promise<void> {
    let fill = rgba(cs.backgroundColor);
    // Градиент из одного цвета (акцент без второго цвета) — обычная заливка: фигура остаётся редактируемой
    const flat = flatGradient(cs.backgroundImage);
    if (flat) fill = flat;
    const grad = !flat && cs.backgroundImage !== 'none' && /gradient|url\(/.test(cs.backgroundImage);
    // Текст с градиентом (background-clip: text) — не подложка
    const clipText = /text/.test(cs.getPropertyValue('background-clip') || cs.getPropertyValue('-webkit-background-clip'));
    if (grad && !clipText) {
      await this.backgroundPicture(el, b);
      fill = null;
    }
    const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => ({
      w: (parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0) * k,
      c: rgba(cs.getPropertyValue(`border-${s.toLowerCase()}-color`)),
      style: cs.getPropertyValue(`border-${s.toLowerCase()}-style`),
    }));
    const visible = sides.map((s) => s.w > 0.2 && !!s.c && s.style !== 'none' && s.style !== 'hidden');
    const uniform = visible.every(Boolean) && sides.every((s) => Math.abs(s.w - sides[0].w) < 0.5 && s.c!.hex === sides[0].c!.hex);
    const shadow = this.shadow(cs.boxShadow, k);
    if (clipText) fill = null;
    if (!fill && !uniform && !shadow && !visible.some(Boolean)) {
      // Градиентный контур без заливки: кольцо рисует ::before
      if (el.classList.contains('shape-gs')) await this.pseudo(el, b, op, k);
      return;
    }
    // Тень рамки картинки без заливки и контура уходит на саму картинку (у пустой фигуры тени не видно)
    if (!fill && !visible.some(Boolean) && el.classList.contains('imgbox')) return;

    const radius = (parseFloat(cs.borderTopLeftRadius) || 0) * k;
    const ellipse = cs.borderTopLeftRadius.endsWith('%') && parseFloat(cs.borderTopLeftRadius) >= 50;
    const rot = this.rotation(cs);
    const size = rot ? { w: el.offsetWidth * k, h: el.offsetHeight * k } : { w: b.w, h: b.h };
    let at = rot ? { x: b.x + b.w / 2 - size.w / 2, y: b.y + b.h / 2 - size.h / 2, ...size } : b;
    // Контур картинки: линия PowerPoint идёт по середине края, а рамка CSS — внутрь; сдвигаем, чтобы между контуром и снимком не было щели
    if (uniform && el.classList.contains('imgbox')) {
      const h = sides[0].w / 2;
      at = { x: at.x + h, y: at.y + h, w: at.w - 2 * h, h: at.h - 2 * h };
    }
    if (fill || uniform || shadow) {
      const dash = sides[0].style === 'dashed' ? 'dash' : sides[0].style === 'dotted' ? 'sysDot' : 'solid';
      this.slide.addShape(ellipse ? this.pptx.ShapeType.ellipse : radius > 0.5 ? this.pptx.ShapeType.roundRect : this.pptx.ShapeType.rect, {
        ...this.pos(at),
        fill: fill ? { color: fill.hex, transparency: transparency(fill.a * op) } : { type: 'none' } as never,
        line: uniform ? { color: sides[0].c!.hex, width: pt(sides[0].w), transparency: transparency(sides[0].c!.a * op), dashType: dash } : { type: 'none' } as never,
        rectRadius: radius > 0.5 && !ellipse ? cornerRadius(radius, at.w, at.h) : undefined,
        rotate: this.spin(rot) || undefined,
        shadow: shadow ?? undefined,
      });
    }
    // Линии с одной-двух сторон: разделители списков, подчёркивания
    if (!uniform) {
      const [t, r, bt, l] = visible;
      const line = (x: number, y: number, w: number, h: number, s: (typeof sides)[number]) => this.slide.addShape(this.pptx.ShapeType.line, {
        x: inch(x), y: inch(y), w: inch(w), h: inch(h), line: { color: s.c!.hex, width: pt(s.w), transparency: transparency(s.c!.a * op), dashType: s.style === 'dashed' ? 'dash' : s.style === 'dotted' ? 'sysDot' : 'solid' },
      });
      if (t) line(b.x, b.y + sides[0].w / 2, b.w, 0, sides[0]);
      if (bt) line(b.x, b.y + b.h - sides[2].w / 2, b.w, 0, sides[2]);
      if (l) line(b.x + sides[3].w / 2, b.y, 0, b.h, sides[3]);
      if (r) line(b.x + b.w - sides[1].w / 2, b.y, 0, b.h, sides[1]);
    }
    await this.pseudo(el, b, op, k);
  }

  /** Украшения из ::before / ::after с абсолютным положением: точки, полоски, метки */
  private async pseudo(el: HTMLElement, b: Box, op: number, k: number): Promise<void> {
    for (const which of ['::before', '::after'] as const) {
      const p = getComputedStyle(el, which);
      if (p.content === 'none' || p.content === 'normal' || p.display === 'none' || p.position !== 'absolute') continue;
      const fill = rgba(p.backgroundColor);
      const w = parseFloat(p.width) * k;
      const h = parseFloat(p.height) * k;
      const left = parseFloat(p.left) * k;
      const top = parseFloat(p.top) * k;
      if (!(w > 0) || !(h > 0) || !Number.isFinite(left) || !Number.isFinite(top)) continue;
      const bw = (parseFloat(p.borderTopWidth) || 0) * k;
      const bc = bw > 0 && p.borderTopStyle !== 'none' ? rgba(p.borderTopColor) : null;
      // Градиент или узор (свечение, луч) — картинкой того же размера
      if (p.backgroundImage !== 'none' && /gradient/.test(p.backgroundImage)) {
        const d = document.createElement('div');
        // Кольцо с маской (градиентный контур фигуры): размер с полями, маска вырезает середину
        const masked = (p.getPropertyValue('-webkit-mask-image') || p.getPropertyValue('mask-image') || 'none') !== 'none';
        const padX = masked ? (parseFloat(p.paddingLeft) || 0) + (parseFloat(p.paddingRight) || 0) : 0;
        const padY = masked ? (parseFloat(p.paddingTop) || 0) + (parseFloat(p.paddingBottom) || 0) : 0;
        const fw = parseFloat(p.width) + padX;
        const fh = parseFloat(p.height) + padY;
        const mask = masked ? `;box-sizing:border-box;padding:${p.padding};-webkit-mask-image:${p.getPropertyValue('-webkit-mask-image')};-webkit-mask-clip:${p.getPropertyValue('-webkit-mask-clip')};-webkit-mask-composite:${p.getPropertyValue('-webkit-mask-composite')};mask-composite:${p.getPropertyValue('mask-composite')}` : '';
        d.style.cssText = `position:absolute;left:0;top:0;width:${fw}px;height:${fh}px;background:${p.background};border-radius:${p.borderRadius};border:${p.border};opacity:${p.opacity};filter:${p.filter}${mask}`;
        this.section.appendChild(d);
        try {
          const data = await this.toPng(d, { pixelRatio: masked ? 2 : 1, skipFonts: true });
          this.slide.addImage({ data, x: inch(b.x + left), y: inch(b.y + top), w: inch(fw * k), h: inch(fh * k), transparency: transparency(op) });
        } catch { /* пропускаем */ }
        d.remove();
        continue;
      }
      if (!fill && !bc) continue;
      const radius = (parseFloat(p.borderTopLeftRadius) || 0) * k;
      const round = p.borderTopLeftRadius.endsWith('%') || radius >= Math.min(w, h) / 2 - 0.5;
      const ellipse = round && Math.abs(w - h) < 1;
      this.slide.addShape(ellipse ? this.pptx.ShapeType.ellipse : radius ? this.pptx.ShapeType.roundRect : this.pptx.ShapeType.rect, {
        x: inch(b.x + left), y: inch(b.y + top), w: inch(w), h: inch(h),
        fill: fill ? { color: fill.hex, transparency: transparency(fill.a * op) } : { type: 'none' } as never,
        line: bc ? { color: bc.hex, width: pt(bw), transparency: transparency(bc.a * op) } : { type: 'none' } as never,
        rectRadius: radius && !ellipse ? cornerRadius(radius, w, h) : undefined,
      });
    }
  }

  private shadow(css: string, k: number): PptxGenJS.ShadowProps | null {
    if (!css || css === 'none') return null;
    const first = css.split(/,(?![^(]*\))/)[0];
    const color = rgba(first);
    const nums = [...first.replace(/rgba?\([^)]*\)/, '').matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
    if (!color || nums.length < 3 || /inset/.test(first)) return null;
    const [dx, dy, blur] = nums.map((n) => n * k);
    return {
      type: 'outer', color: color.hex, opacity: Math.min(1, color.a * 1.4), blur: pt(blur),
      offset: pt(Math.hypot(dx, dy)), angle: Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360),
    };
  }

  private rotation(cs: CSSStyleDeclaration): number {
    const m = /matrix\(([^)]+)\)/.exec(cs.transform);
    if (!m) return 0;
    const [a, b] = m[1].split(',').map(Number);
    const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
    return Math.abs(deg) < 1 ? 0 : deg;
  }

  // ---------------- текст ----------------

  /** Весь текст элемента — строчные куски: одна надпись */
  private isTextLeaf(el: HTMLElement): boolean {
    let text = false;
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.textContent?.trim()) text = true;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const c = n as HTMLElement;
        const tag = c.tagName.toLowerCase();
        if (tag === 'br') continue;
        const cs = getComputedStyle(c);
        if (cs.display === 'none') continue;
        if (!INLINE.has(cs.display) || ['svg', 'img', 'video', 'canvas'].includes(tag)) return false;
        if (rgba(cs.backgroundColor) || parseFloat(cs.borderBottomWidth) > 0 && rgba(cs.borderBottomColor) && !/underline/.test(cs.textDecorationLine)) return false;
        if (!this.isTextLeaf(c) && c.children.length) return false;
        if (c.textContent?.trim()) text = true;
      }
    }
    return text;
  }

  private runs(el: HTMLElement, op: number, k: number): PptxGenJS.TextProps[] {
    const out: PptxGenJS.TextProps[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.textContent ?? '';
        const parent = node.parentElement!;
        const cs = getComputedStyle(parent);
        const pre = /pre/.test(cs.whiteSpace);
        let text = pre ? raw : raw.replace(/\s+/g, ' ');
        if (!text) return;
        if (cs.textTransform === 'uppercase') text = text.toUpperCase();
        let color = rgba(cs.color);
        if (!color || /text/.test(cs.getPropertyValue('-webkit-background-clip'))) color = gradientColor(cs.backgroundImage) ?? color;
        const size = parseFloat(cs.fontSize) * k;
        const ls = parseFloat(cs.letterSpacing) * k;
        out.push({
          text,
          options: {
            color: color?.hex, transparency: color ? transparency(color.a * op) : undefined,
            bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle === 'italic', underline: /underline/.test(cs.textDecorationLine) ? { style: 'sng' } : undefined,
            fontSize: pt(size), fontFace: fontFace(cs.fontFamily), lang: LANG,
            charSpacing: Number.isFinite(ls) && ls ? pt(ls) : undefined,
            hyperlink: parent.closest('a[href]') ? { url: (parent.closest('a[href]') as HTMLAnchorElement).href } : undefined,
          },
        });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const e = node as HTMLElement;
        if (e.tagName === 'BR') {
          if (out.length) out[out.length - 1].options = { ...out[out.length - 1].options, breakLine: true };
          return;
        }
        if (getComputedStyle(e).display === 'none') return;
        e.childNodes.forEach(walk);
      }
    };
    el.childNodes.forEach(walk);
    // Крайние пробелы — как в браузере, без них
    if (out.length) {
      out[0].text = out[0].text!.replace(/^\s+/, '');
      out[out.length - 1].text = out[out.length - 1].text!.replace(/\s+$/, '');
    }
    return out.filter((r) => r.text || r.options?.breakLine);
  }

  private text(el: HTMLElement, cs: CSSStyleDeclaration, op: number, k: number): void {
    const runs = this.runs(el, op, k);
    if (!runs.length) return;
    // Маркер из ::before в строке («•», «—», «✓»)
    const before = getComputedStyle(el, '::before');
    const mark = /^["'](.+)["']$/.exec(before.content)?.[1];
    if (mark && before.position !== 'absolute' && before.display !== 'none') {
      const c = rgba(before.color);
      runs.unshift({ text: `${mark} `, options: { ...runs[0].options, color: c?.hex ?? runs[0].options?.color, breakLine: false } });
    }
    const b = this.box(el);
    const pl = (parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)) * k;
    const pr = (parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)) * k;
    const ptop = (parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)) * k;
    const pb = (parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)) * k;
    const size = parseFloat(cs.fontSize) * k;
    const lh = (parseFloat(cs.lineHeight) || size / k * 1.25) * k;
    const align = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'right' : cs.textAlign === 'justify' ? 'justify' : 'left';
    // Одна строка — без переноса: у PowerPoint свои шрифты, и лишний перенос хуже сдвига на пиксель.
    // Несколько строк — с небольшим запасом по ширине.
    const contentH = b.h - ptop - pb;
    const single = this.lines(el) <= 1;
    const slack = single ? 0 : Math.min(12, Math.max(3, b.w * 0.04));
    const w = Math.max(4, b.w - pl - pr) + slack;
    const x = b.x + pl - (align === 'center' ? slack / 2 : align === 'right' ? slack : 0);
    const flexCenter = /flex|grid/.test(getComputedStyle(el.parentElement ?? el).display);
    this.slide.addText(runs, {
      ...this.pos({ x, y: b.y + ptop, w, h: Math.max(size * 1.2, contentH) }),
      margin: 0, valign: flexCenter && cs.alignItems === 'center' ? 'middle' : 'top', align, fit: 'none', wrap: !single,
      // Точный интервал в пунктах: не зависит от того, каким шрифтом PowerPoint заменит системный
      lineSpacing: Number.isFinite(lh) && lh > 0 ? pt(lh) : undefined,
      rotate: this.spin(this.rotation(cs)) || undefined,
    });
  }

  /** Сколько строк занимает текст элемента на экране */
  private lines(el: HTMLElement): number {
    // Только прямоугольники самого текста: рамки строчных элементов дали бы лишние «строки»
    const mids: number[] = [];
    const r = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 0.5) mids.push(q.top + q.height / 2);
    }
    mids.sort((a, b) => a - b);
    let count = 0;
    let last = -Infinity;
    for (const m of mids) {
      if (m - last > 4) count++;
      last = m;
    }
    return count;
  }

  /** Кусок текста между блоками: надпись по прямоугольнику самого текста */
  private looseText(n: Text, cs: CSSStyleDeclaration, op: number, k: number): void {
    const r = document.createRange();
    r.selectNodeContents(n);
    const rect = r.getBoundingClientRect();
    if (rect.width < 1) return;
    const color = rgba(cs.color);
    let text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (cs.textTransform === 'uppercase') text = text.toUpperCase();
    this.slide.addText(text, {
      x: inch(rect.left - this.origin.left), y: inch(rect.top - this.origin.top), w: inch(rect.width + 6), h: inch(rect.height),
      margin: 0, wrap: false, lang: LANG, fontSize: pt(parseFloat(cs.fontSize) * k), fontFace: fontFace(cs.fontFamily), bold: Number(cs.fontWeight) >= 600,
      color: color?.hex, transparency: color ? transparency(color.a * op) : undefined, valign: 'top', fit: 'none',
    });
  }

  // ---------------- картинки ----------------

  private async image(img: HTMLImageElement, b: Box, cs: CSSStyleDeclaration): Promise<void> {
    const src = img.currentSrc || img.src;
    if (!src) return;
    // GIF не запекаем в PNG: PowerPoint проигрывает его сам, анимация важнее скруглений и фильтров
    const gif = /^data:image\/gif[;,]|\.gif(?:[?#]|$)/i.test(src);
    const fx = !gif && img.parentElement?.classList.contains('img-fx') ? img.parentElement : null;
    if (fx && await this.imageFx(img, fx, cs)) return;
    const svg = /\.svg(\?|$)/i.test(src) || src.startsWith('data:image/svg');
    const data = svg ? await imageToPng(src, b.w, b.h) : await imageData(src);
    if (!data) return;
    const fit = cs.objectFit;
    const nw = img.naturalWidth || b.w;
    const nh = img.naturalHeight || b.h;
    if (!svg && (fit === 'cover' || fit === 'contain') && nw && nh) {
      // Размер исходника в дюймах в пропорции, а sizing вписывает или обрезает по рамке
      const k = fit === 'cover' ? Math.max(b.w / nw, b.h / nh) : Math.min(b.w / nw, b.h / nh);
      this.slide.addImage({ data, ...this.pos(b), w: inch(nw * k), h: inch(nh * k), sizing: { type: fit, w: inch(b.w), h: inch(b.h) } });
    } else {
      this.slide.addImage({ data, ...this.pos(b) });
    }
  }

  /**
   * Картинка с оформлением (скругление, круг, паспарту, цветовой фильтр): кадр, фильтр и форма
   * запекаются в PNG с прозрачными углами, тень рамки — тенью картинки. Контур и паспарту рисует рамка.
   */
  private async imageFx(img: HTMLImageElement, box: HTMLElement, cs: CSSStyleDeclaration): Promise<boolean> {
    const bcs = getComputedStyle(box);
    const br = box.getBoundingClientRect();
    const scale = box.offsetWidth ? br.width / box.offsetWidth : 1;
    const W = img.offsetWidth;
    const H = img.offsetHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!W || !H || !nw || !nh) return false;
    const src = new Image();
    src.crossOrigin = 'anonymous';
    if (!await new Promise<boolean>((res) => { src.onload = () => res(true); src.onerror = () => res(false); src.src = img.currentSrc || img.src; })) return false;
    const q = 2;
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale * q);
    c.height = Math.round(H * scale * q);
    const g = c.getContext('2d')!;
    g.scale(c.width / W, c.height / H);
    // Форма: у паспарту — скругление самого снимка, иначе — внутренний край рамки
    const bw = parseFloat(bcs.borderTopWidth) || 0;
    const rCss = img.style.borderRadius ? cs.borderTopLeftRadius : bcs.borderTopLeftRadius;
    g.beginPath();
    if (rCss.endsWith('%') && parseFloat(rCss) >= 50) g.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
    else g.roundRect(0, 0, W, H, Math.max(0, Math.min(W / 2, H / 2, (parseFloat(rCss) || 0) - (img.style.borderRadius ? 0 : bw))));
    g.clip();
    // Кадр: object-fit, object-position и увеличение, как на слайде
    const fit = cs.objectFit === 'contain' ? Math.min(W / nw, H / nh) : Math.max(W / nw, H / nh);
    const [px, py] = cs.objectPosition.split(' ').map((v, i) => (v.endsWith('%') ? parseFloat(v) / 100 : (parseFloat(v) || 0) / ((i ? H - nh * fit : W - nw * fit) || 1)));
    const zoom = /matrix\(([^,]+)/.exec(cs.transform)?.[1];
    const z = zoom ? parseFloat(zoom) || 1 : 1;
    const ox = W * (px ?? 0.5);
    const oy = H * (py ?? 0.5);
    const x0 = (W - nw * fit) * (px ?? 0.5);
    const y0 = (H - nh * fit) * (py ?? 0.5);
    g.filter = cs.filter && cs.filter !== 'none' ? cs.filter : 'none';
    g.drawImage(src, ox + (x0 - ox) * z, oy + (y0 - oy) * z, nw * fit * z, nh * fit * z);
    let data: string;
    try { data = c.toDataURL('image/png'); } catch { return false; }
    const at = { x: br.left - this.origin.left + (bw + img.offsetLeft) * scale, y: br.top - this.origin.top + (bw + img.offsetTop) * scale, w: W * scale, h: H * scale };
    const plain = !rgba(bcs.backgroundColor) && !bw;
    const shadow = plain ? this.shadow(bcs.boxShadow, scale) : null;
    const op = Number(bcs.opacity || 1);
    this.slide.addImage({ data, ...this.pos(at), shadow: shadow ?? undefined, transparency: op < 1 ? transparency(op) : undefined });
    return true;
  }

  private async svg(svg: SVGSVGElement, b: Box): Promise<void> {
    if (b.w < 1 || b.h < 1) return;
    const data = await svgToPng(svg, b.w, b.h);
    if (data) this.slide.addImage({ data, ...this.pos(b) });
  }

  private async video(v: HTMLVideoElement, b: Box): Promise<void> {
    let data: string | null = v.poster ? await imageData(v.poster) : null;
    if (!data && v.readyState >= 2) {
      const c = document.createElement('canvas');
      c.width = v.videoWidth || b.w;
      c.height = v.videoHeight || b.h;
      try {
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        data = c.toDataURL('image/jpeg', 0.9);
      } catch { /* кадр недоступен */ }
    }
    if (data) this.slide.addImage({ data, ...this.pos(b), sizing: { type: 'contain', w: inch(b.w), h: inch(b.h) } });
    else this.slide.addShape(this.pptx.ShapeType.rect, { ...this.pos(b), fill: { color: '000000' } });
  }

  private canvas(c: HTMLCanvasElement, b: Box): void {
    try {
      this.slide.addImage({ data: c.toDataURL('image/png'), ...this.pos(b) });
    } catch { /* пустой холст */ }
  }

  private async raster(el: HTMLElement, b: Box): Promise<void> {
    try {
      const data = await this.toPng(el, { pixelRatio: 2, skipFonts: true });
      this.slide.addImage({ data, ...this.pos(b) });
    } catch { /* не удалось — пропускаем */ }
  }

  private props(el: HTMLElement): Block | undefined {
    try {
      return getAt(this.deck, JSON.parse(el.dataset.block ?? '') as Path) as Block | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Живая вставка (HTML со скриптами): документ отрабатывает в изолированной рамке, его вид
   * снимается разметкой (холсты — картинками) и рисуется картинкой. Не вышло — остаётся заставка.
   */
  private async embed(el: HTMLElement, b: Box): Promise<boolean> {
    const p = this.props(el) as { src?: string; code?: string; theme?: boolean; interactive?: boolean; poster?: string } | undefined;
    if (!p || !hasEmbed(p)) return false;
    // Интерактивная сцена в движении не имеет «правильного» кадра: её кадр — заставка
    if (p.interactive && p.poster) {
      const src = el.querySelector<HTMLImageElement>('.embed-poster')?.src;
      const data = src ? await imageData(src) : null;
      if (!data) return false;
      this.slide.addImage({ data, ...this.pos(b) });
      return true;
    }
    const data = await embedShot(p, el.offsetWidth || Math.round(b.w), el.offsetHeight || Math.round(b.h));
    if (!data) return false;
    this.slide.addImage({ data, ...this.pos(b) });
    return true;
  }

  // ---------------- линии и стрелки ----------------

  private line(el: HTMLElement, cs: CSSStyleDeclaration, k: number): void {
    const bar = el.querySelector<HTMLElement>('.shape-bar')!;
    const bcs = getComputedStyle(bar);
    const color = rgba(bcs.backgroundColor) ?? gradientColor(bcs.backgroundImage) ?? { hex: '2563EB', a: 1 };
    const b = this.box(el);
    const len = el.offsetWidth * k;
    const rot = this.rotation(cs);
    const { x: cx, y: cy } = this.turned(b.x + b.w / 2, b.y + b.h / 2);
    const dash = el.classList.contains('shape-dash') ? 'dash' : el.classList.contains('shape-dot') ? 'sysDot' : 'solid';
    this.slide.addShape(this.pptx.ShapeType.line, {
      x: inch(cx - len / 2), y: inch(cy), w: inch(len), h: 0, rotate: this.spin(rot) || undefined,
      line: { color: color.hex, width: pt((bar.offsetHeight || 3) * k), dashType: dash, endArrowType: el.querySelector('.shape-head') ? 'triangle' : undefined },
    });
  }

  // ---------------- таблицы ----------------

  private async table(el: HTMLElement, k: number): Promise<void> {
    const table = el.querySelector('table');
    if (!table) return;
    const tb = this.box(table);
    const tcs = getComputedStyle(table);
    // Рамка-карточка таблицы: скругление и тень — фигурой под ней
    await this.decoration(table, tcs, tb, 1, k);
    const rows: PptxGenJS.TableRow[] = [];
    const heights: number[] = [];
    let widths: number[] = [];
    [...table.rows].forEach((tr, row) => {
      heights.push(tr.getBoundingClientRect().height);
      const tcs = getComputedStyle(tr);
      // Шапка градиентом (акцент с градиентом) — в таблице PowerPoint её первым цветом
      const trBg = rgba(tcs.backgroundColor) ?? (/gradient/.test(tcs.backgroundImage) ? flatGradient(tcs.backgroundImage) ?? gradientColor(tcs.backgroundImage) : null);
      if (row === 0) widths = [...tr.cells].map((c) => c.getBoundingClientRect().width);
      rows.push([...tr.cells].map((cell) => {
        const cs = getComputedStyle(cell);
        const fill = rgba(cs.backgroundColor) ?? trBg;
        const color = rgba(cs.color);
        const side = (s: string): PptxGenJS.BorderProps => {
          const w = (parseFloat(cs.getPropertyValue(`border-${s}-width`)) || 0) * k;
          const c = rgba(cs.getPropertyValue(`border-${s}-color`));
          return w > 0 && c && cs.getPropertyValue(`border-${s}-style`) !== 'none' ? { type: 'solid', pt: pt(w), color: c.hex } : { type: 'none' };
        };
        // Переносы строк внутри ячейки (задача и результат) сохраняются
        let text = (cell as HTMLElement).innerText.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
        if (cs.textTransform === 'uppercase') text = text.toUpperCase();
        // Оформление внутри ячейки (жирная строка задачи, цветная метка) — фрагментами, как в надписях
        const rich = (cell as HTMLElement).querySelector('b, i, u, .md-c, br, .tbl-badge') ? this.runs(cell as HTMLElement, 1, k) : null;
        // Метка: цветная точка — знаком «●» того же цвета
        const dot = (cell as HTMLElement).querySelector<HTMLElement>('.tbl-badge > i');
        const dc = dot ? rgba(getComputedStyle(dot).backgroundColor) : null;
        if (rich?.length && dc) rich.unshift({ text: '● ', options: { ...rich[0].options, color: dc.hex, bold: false } });
        return {
          text: rich?.length ? rich : text,
          options: {
            fill: fill ? { color: fill.hex, transparency: transparency(fill.a) } : undefined,
            color: color?.hex, bold: Number(cs.fontWeight) >= 600, fontSize: pt(parseFloat(cs.fontSize) * k), fontFace: fontFace(cs.fontFamily), lang: LANG,
            align: cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left', valign: 'middle',
            margin: [pt(parseFloat(cs.paddingTop) * k), pt(parseFloat(cs.paddingRight) * k), pt(parseFloat(cs.paddingBottom) * k), pt(parseFloat(cs.paddingLeft) * k)],
            border: [side('top'), side('right'), side('bottom'), side('left')],
          },
        };
      }));
    });
    this.slide.addTable(rows, { x: inch(tb.x), y: inch(tb.y), w: inch(tb.w), colW: widths.map(inch), rowH: heights.map(inch) });
    // Строка итога под таблицей — подложкой и текстом, как на слайде
    const foot = el.querySelector<HTMLElement>(':scope > .tbl-foot');
    if (foot) await this.walk(foot, 1, k);
  }

  // ---------------- графики ----------------

  /** Столбцы и линия — настоящие диаграммы PowerPoint: их можно править там */
  private chart(el: HTMLElement, type: string, b: Box): boolean {
    let path: Path;
    try { path = JSON.parse(el.dataset.block ?? ''); } catch { return false; }
    let p = getAt(this.deck, path) as Block | undefined;
    // Значения с формулами («=v*2») — по начальным положениям ползунков слайда
    const si = Number(path[1]);
    const sl = path[0] === 'slides' ? this.deck.slides[si] : undefined;
    if (p && sl) p = resolve(p, new Renderer(this.deck).slideVars(sl, si));
    const values = Array.isArray(p?.values) ? (p.values as unknown[]).map(Number).filter(Number.isFinite) : [];
    if (!p || values.length < 2) return false;
    const accent = rgba(getComputedColor(this.section, 'var(--ac)'))?.hex ?? '2563EB';
    const muted = rgba(getComputedColor(this.section, 'var(--mu)'))?.hex ?? '64748B';
    const labels = Array.isArray(p.labels) ? (p.labels as unknown[]).map(String) : values.map((_v, k) => String(k + 1));
    const common = {
      ...this.pos(b), showLegend: false, catAxisLabelColor: muted, valAxisLabelColor: muted, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
      catAxisLineShow: false, valAxisLineShow: false, valGridLine: { color: 'E2E8F0', size: 0.5 }, catGridLine: { style: 'none' as const },
    };
    if (type === 'bars') {
      const hi = p.highlight === false ? -1 : Number.isInteger(p.highlight) ? Number(p.highlight) : values.length - 1;
      // Выделенный столбец — отдельный ряд того же места: другой цвет, как на слайде
      const base = values.map((v, k) => (k === hi ? 0 : v));
      const top = values.map((v, k) => (k === hi ? v : 0));
      this.slide.addChart(this.pptx.ChartType.bar, [{ name: 'Значения', labels, values: base }, { name: 'Выделено', labels, values: top }], {
        // Ряды наложены друг на друга (overlap 100): так над столбцом можно подписать значение
        ...common, barDir: 'col', barGrouping: 'clustered', barOverlapPct: 100, barGapWidthPct: 60, chartColors: [lighten(accent, 0.55), accent],
        showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '#,##0.##;;;', dataLabelColor: '334155', dataLabelFontSize: 10,
        valAxisHidden: true, valGridLine: { style: 'none' },
      });
    } else {
      const lab = values.map((_v, k) => (k === 0 ? String(p.start ?? '') : k === values.length - 1 ? String(p.end ?? '') : ''));
      this.slide.addChart(this.pptx.ChartType.line, [{ name: 'Значения', labels: lab, values }], {
        ...common, lineSmooth: true, lineSize: 2, lineDataSymbol: 'none', chartColors: [accent],
      });
    }
    return true;
  }
}

/** Вычисленный цвет CSS-выражения (var(--ac)) на элементе */
function getComputedColor(el: HTMLElement, css: string): string {
  const probe = document.createElement('i');
  probe.style.cssText = `display:none;color:${css}`;
  el.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

/**
 * Скругление углов для PowerPoint: не больше половины меньшей стороны с запасом на округление —
 * иначе параметр фигуры выходит за допустимые 50 000 и PowerPoint не открывает слайд.
 */
function cornerRadius(r: number, w: number, h: number): number {
  return Math.floor((Math.min(r, (Math.min(w, h) / 2) * 0.98) / PX) * 1000) / 1000;
}

/**
 * Поправки к файлу pptxgenjs, без которых PowerPoint для компьютера файл не открывает
 * (просмотрщики и веб-версия прощают):
 *  - список мастеров заметок должен идти сразу за списком мастеров слайдов;
 *  - у абзаца одно свойство абзаца (a:pPr) — первым, а не перед каждым куском текста.
 */
async function repair(blob: Blob): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(blob);
  const pres = zip.file('ppt/presentation.xml');
  if (pres) {
    let x = await pres.async('string');
    const notes = /<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/.exec(x)?.[0];
    if (notes) {
      x = x.replace(notes, '').replace('</p:sldMasterIdLst>', `</p:sldMasterIdLst>${notes}`);
      zip.file('ppt/presentation.xml', x);
    }
  }
  const pPr = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g;
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const x = await zip.file(name)!.async('string');
    const fixed = x.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_m, inner: string) => {
      let first = true;
      return `<a:p>${inner.replace(pPr, (p) => {
        if (first && inner.startsWith(p)) {
          first = false;
          return p;
        }
        return '';
      })}</a:p>`;
    });
    if (fixed !== x) zip.file(name, fixed);
  }
  // Упаковка как у самого PowerPoint: настольная версия строже веб-версии
  const out = new JSZip();
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const names = new Set(files.map((f) => f.name));
  let types = await zip.file('[Content_Types].xml')!.async('string');
  // Типы только для частей, которые есть в файле
  types = types
    .replace(/<Override PartName="\/([^"]+)"[^>]*\/>/g, (m, part: string) => (names.has(part) ? m : ''))
    .replace('<Default Extension="jpg" ContentType="image/jpg"/>', '<Default Extension="jpg" ContentType="image/jpeg"/>');
  out.file('[Content_Types].xml', types);
  for (const f of files) {
    if (f.name === '[Content_Types].xml') continue;
    let data: string | Uint8Array = await f.async(/\.(xml|rels)$/.test(f.name) ? 'string' : 'uint8array');
    // Фон слайда: PowerPoint всегда пишет список эффектов после заливки
    if (typeof data === 'string' && /^ppt\/slides\/slide\d+\.xml$/.test(f.name)) data = data.replace(/<\/p:bgPr>/g, (m) => '<a:effectLst/>' + m).replace(/<a:effectLst\/><a:effectLst\/>/g, '<a:effectLst/>');
    out.file(f.name, data, { createFolders: false });
  }
  return out.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
}

function lighten(hex: string, k: number): string {
  const n = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return n.map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}
