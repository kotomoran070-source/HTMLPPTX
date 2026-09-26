/**
 * Импорт HTML-презентации, экспортированной из Claude Design (и похожих редакторов слайдов):
 *   <section class="deck-slide"> … <div class="deck-scaler"><div style="width:1920px;height:1080px">
 *     <div data-frame-id="…" style="position:absolute;left;top;width;height"> — рамки
 *   <script type="application/json" id="deck-motion"> — фон, порядок появления, «живые» вставки.
 *
 * Каждая рамка становится свободным объектом слайда:
 *   - вёрстка с текстами и картинками → блок html: разметка остаётся как была, а тексты и
 *     картинки вынесены в texts и images — их правит обычный режим правки;
 *   - «живая» вставка (анимация в iframe) → блок embed: документ вставки и картинка-заставка.
 */
import { parse, type HTMLElement as El, type Node } from 'node-html-parser';
import { escapeText, wrapColor } from '../src/engine/editor/serialize';

type Deck = { title: string; source?: string; slides: Slide[] };
type Slide = Record<string, unknown>;
type Block = Record<string, unknown>;

interface Motion {
  w?: number;
  h?: number;
  buildMs?: number;
  slides?: {
    bg?: string;
    steps?: { events?: { id: string; dir: string; effect: string }[] }[];
    embeds?: { id: string; srcdoc?: string }[];
  }[];
}

const SLIDE_W = 1280;
const EFFECTS = new Set(['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop']);

/** Файл похож на экспорт Claude Design: слайды-секции с рамками. */
export function isDesignExport(html: string): boolean {
  return /class="deck-slide"/.test(html) && /data-frame-id=/.test(html);
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function styleOf(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (el.getAttribute('style') ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

const px = (v: string | undefined) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : undefined;
};

function hex(c: string): string | null {
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(s)) return s;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(s);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
}

function wrap(mark: string, inner: string): string {
  if (!inner.trim()) return inner;
  const lead = /^\s*/.exec(inner)![0];
  const tail = /\s*$/.exec(inner)![0];
  return `${lead}${mark}${inner.trim()}${mark}${tail}`;
}

/** Содержимое текстового элемента → строка с разметкой движка. */
function markup(node: Node): string {
  if (node.nodeType === 3) return escapeText(node.text.replace(/\u00a0/g, ' '));
  if (node.nodeType !== 1) return '';
  const el = node as El;
  const tag = el.tagName;
  if (tag === 'BR') return '\n';
  const inner = () => el.childNodes.map(markup).join('');
  if (tag === 'A') {
    const href = el.getAttribute('href') ?? '';
    const text = inner();
    return /^(https?:|mailto:|tel:)/i.test(href) && text.trim() ? `[${text.trim()}](${href})` : text;
  }
  const st = styleOf(el);
  let s = inner();
  const color = el.getAttribute('color') ?? st.color;
  const c = color ? hex(color) : null;
  if (c) s = wrapColor(c, s);
  if (tag === 'U' || /underline/.test(st['text-decoration'] ?? '')) s = wrap('__', s);
  if (tag === 'I' || tag === 'EM' || st['font-style'] === 'italic') s = wrap('*', s);
  if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(st['font-weight'] ?? '')) s = wrap('**', s);
  if (tag === 'DIV' || tag === 'P') s = `\n${s}\n`;
  return s;
}

function textOf(el: El): string {
  return el.childNodes.map(markup).join('')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
    // Строка текста, похожая на пункт списка, остаётся обычной строкой
    .split('\n').map((l) => l.replace(/^([-•])(\s)/, '\\$1$2')).join('\n');
}

/** Автоподгонка размера текста в Claude Design не используется: размер пишем прямо. */
function plainStyle(css: string): string {
  const fit = /--fit-size:\s*calc\(\s*([\d.]+px)\s*\*\s*var\(--fit,\s*1\)\s*\)\s*;?/.exec(css);
  if (!fit) return css;
  return css.replace(fit[0], '')
    .replace(/font-size:\s*var\(--fit-size\)/, `font-size: ${fit[1]}`)
    .replace(/overflow-y:\s*var\(--fit-clip,\s*visible\)\s*;?/, '')
    .replace(/;\s*;/g, ';').trim();
}

/** Служебные атрибуты редактора-источника и всё исполняемое убираем. */
function cleanTree(root: El): void {
  root.querySelectorAll('script, iframe, object, embed, link, meta').forEach((x) => x.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const st = el.getAttribute('style');
    if (st) el.setAttribute('style', plainStyle(st));
    for (const name of Object.keys(el.attributes)) {
      const n = name.toLowerCase();
      if (n === 'data-t' || n === 'data-i') continue;
      if (n.startsWith('on') || n.startsWith('data-') || n === 'draggable' || n === 'contenteditable') el.removeAttribute(name);
      else if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(el.getAttribute(name) ?? '')) el.removeAttribute(name);
    }
  }
}

/** Разметка → простой текст (для названия слайда). */
function plain(s: string): string {
  return s.replace(/\{(#[0-9a-f]{3,8}|[a-z0-9]+)\|/gi, '').replace(/\\(.)/g, '$1').replace(/[*_{}]/g, '');
}

function firstText(el: El | null | undefined): string {
  return (el?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Экспорт Claude Design → данные презентации (картинки пока как data:, их заберёт AssetStore). */
export function fromDesign(html: string): Deck {
  const doc = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
  let motion: Motion = {};
  const m = doc.querySelector('script#deck-motion');
  if (m) {
    try { motion = JSON.parse(m.text) as Motion; } catch { /* без анимаций */ }
  }
  const sections = doc.querySelectorAll('section.deck-slide');
  if (!sections.length) throw new Error('В файле не найдены слайды');
  const title = firstText(doc.querySelector('title')) || 'Импортированная презентация';

  const slides = sections.map((sec, si): Slide => {
    const canvas = sec.querySelector('.deck-scaler > div') ?? sec;
    const cs = styleOf(canvas);
    const w = px(cs.width) ?? motion.w ?? 1920;
    const k = SLIDE_W / w;
    const info = motion.slides?.[si] ?? {};
    const embeds = new Map((info.embeds ?? []).map((e) => [e.id, e.srcdoc ?? ''] as const));
    // Порядок появления: шаг, на котором рамка появляется, и эффект
    const enter = new Map<string, { step: number; effect: string }>();
    (info.steps ?? []).forEach((st, i) => st.events?.forEach((ev) => {
      if (ev.dir === 'in' && !enter.has(ev.id)) enter.set(ev.id, { step: i, effect: ev.effect });
    }));
    const buildMs = motion.buildMs ?? 380;
    let heading = '';

    const free = canvas.childNodes.filter((n): n is El => n.nodeType === 1 && (n as El).hasAttribute('data-frame-id')).map((frame): Block | null => {
      const id = frame.getAttribute('data-frame-id')!;
      const fs = styleOf(frame);
      const x = px(fs.left) ?? 0;
      const y = px(fs.top) ?? 0;
      const fw = px(fs.width) ?? w;
      const fh = px(fs.height);
      const place: Record<string, number> = { x: round(x * k), y: round(y * k), w: round(fw * k) };
      if (fh) place.h = round(fh * k);
      let block: Block;
      const poster = frame.querySelector('img[alt="web embed"]');
      if (embeds.has(id) || (poster && frame.querySelectorAll('img').length === 1 && !frame.querySelector('[data-text-path]'))) {
        block = { type: 'embed' };
        const doc = embeds.get(id);
        if (doc) block.src = `data:text/html;base64,${Buffer.from(doc, 'utf8').toString('base64')}`;
        const p = poster?.getAttribute('src');
        if (p) block.poster = p;
        if (!block.src && !block.poster) return null;
      } else {
        const texts: string[] = [];
        const images: Record<string, unknown>[] = [];
        const root = parse(frame.innerHTML, { comment: false });
        root.querySelectorAll('[data-text-path]').forEach((el) => {
          if (!heading && el.getAttribute('role') === 'heading') heading = firstText(el);
          texts.push(textOf(el));
          el.set_content('');
          el.setAttribute('data-t', String(texts.length - 1));
        });
        root.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') ?? '';
          images.push(src ? { src } : {});
          img.removeAttribute('src');
          img.setAttribute('data-i', String(images.length - 1));
        });
        cleanTree(root);
        const markupHtml = root.innerHTML.trim();
        if (!markupHtml) return null;
        block = { type: 'html', scale: round(k, 4), html: markupHtml };
        if (texts.length) block.texts = texts;
        if (images.length) block.images = images;
      }
      block.place = place;
      const e = enter.get(id);
      if (e) {
        block.enter = EFFECTS.has(e.effect) ? e.effect : 'fade';
        const delay = Math.max(0, e.step - 1) * buildMs;
        if (delay) block.delay = delay;
      }
      return block;
    }).filter((b): b is Block => b !== null);

    if (!heading) {
      const t = free.find((b) => Array.isArray(b.texts) && b.texts.length);
      heading = t ? plain(String((t.texts as string[])[0])).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    }
    const slide: Slide = { id: `s${si + 1}`, template: 'canvas' };
    if (heading) slide.label = heading;
    const bg = info.bg ?? cs.background ?? cs['background-color'];
    if (bg) slide.bg = hex(bg) ?? bg;
    slide.free = free;
    return slide;
  });

  return { title, source: 'Claude Design', slides };
}
