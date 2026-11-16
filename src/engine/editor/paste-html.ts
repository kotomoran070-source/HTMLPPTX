/**
 * Вставка текста из Word, браузера, почты (text/html буфера) — в разметку текста Slideria. Три режима
 * (как «Параметры вставки» PowerPoint, кнопка — paste-options.ts):
 *   theme  — «Использовать тему»: жирный, курсив, подчёркивание, ссылки, списки и абзацы; цвета и шрифты — темы;
 *   source — «Сохранить исходное форматирование»: ещё цвета, размеры и шрифты — но так, чтобы слайд остался
 *            читаемым и в светлой, и в тёмной теме (см. paintOf, sizeOf, fontOf);
 *   text   — «Только текст»: без оформления, строки — как есть.
 * Никогда не переносится: фон и подсветка, интервалы и отступы, стили страницы, картинки, скрытый текст.
 *
 * Разбор — в документе без окна (DOMParser): ничего не грузится и не исполняется; на выходе — только свои
 * элементы, которые понимает serialize.ts (toMarkup): b, i, u, a, span.md-c, span.md-li, span.md-gap, br.
 */
import { safeUrl } from '../html';
import { formatSpanAttrs, spanCss, type SpanAttrs } from '../span-attrs';
import { toMarkup } from './serialize';

export type PasteMode = 'theme' | 'source' | 'text';

export interface PasteOpts {
  /** Шрифт есть в презентации: только такой сохраняется при «исходном форматировании» */
  fontOk?: (name: string) => boolean;
}

interface Style { b?: boolean; i?: boolean; u?: boolean; color?: string; size?: number; font?: string; href?: string; inLink?: boolean }
interface Run extends Style { text: string }
interface Line { kind: 'p' | 'li' | 'gap'; num?: boolean; runs: Run[] }

/** Больше не переносится: столько же, сколько у вставки простым текстом */
const MAX_CHARS = 5000;
const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'IMG', 'SVG', 'IFRAME', 'OBJECT', 'EMBED',
  'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'CANVAS', 'VIDEO', 'AUDIO', 'PICTURE', 'MATH']);
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'SECTION',
  'ARTICLE', 'HEADER', 'FOOTER', 'DL', 'DT', 'DD', 'FIGCAPTION', 'ADDRESS', 'MAIN', 'NAV', 'ASIDE']);
/** Размер заголовка, если у него нет своего (Word держит его в стилях документа): % от основного текста */
const HEADING_SIZE: Record<string, number> = { H1: 160, H2: 140, H3: 120 };

/** Свойство из style="…": последнее объявление */
function prop(style: string, name: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'gi');
  let m: RegExpExecArray | null;
  let out: string | null = null;
  while ((m = re.exec(style))) out = m[1].trim();
  return out;
}

/** Размер шрифта в px: pt, px, em и % — от окружающего */
function sizePx(v: string, parent: number | undefined): number | undefined {
  const m = /^([\d.]+)\s*(pt|px|em|rem|%)$/i.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'pt') return (n * 4) / 3;
  if (unit === 'px') return n;
  if (unit === 'rem') return n * 16;
  const base = parent ?? 16;
  return unit === '%' ? (base * n) / 100 : base * n;
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', navy: '#000080',
  maroon: '#800000', purple: '#800080', teal: '#008080', gray: '#808080', grey: '#808080', orange: '#ffa500', yellow: '#ffff00' };

/** Цвет CSS → #rrggbb; полупрозрачный и непонятный — null */
function hexOf(v: string): string | null {
  const c = v.trim().toLowerCase();
  if (NAMED[c]) return NAMED[c];
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return '#' + [...m[1]].map((x) => x + x).join('');
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(c);
  if (m) return `#${m[1]}`;
  const r = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(c);
  if (!r) return null;
  const a = r[4] === undefined ? 1 : r[4].endsWith('%') ? Number(r[4].slice(0, -1)) / 100 : Number(r[4]);
  if (a < 0.6) return null;
  return '#' + [r[1], r[2], r[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
}

const lum = (hex: string) => {
  const ch = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** Фоны слайдов: светлый и тёмный (tokens.css) */
const LIGHT_BG = lum('#ffffff');
const DARK_BG = lum('#0f172a');

/**
 * Цвет куска при «исходном форматировании»: чёрный, белый и серые по краям (цвет «по умолчанию» Word и сайтов) —
 * цвет текста темы (нет своего); цвет, который читается на светлом и на тёмном слайде, — как есть;
 * яркий, но не читаемый на одном из фонов, — акцент темы
 */
function paintOf(css: string | undefined): string | undefined {
  if (!css) return undefined;
  const hex = hexOf(css);
  if (!hex) return undefined;
  const l = lum(hex);
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  if (chroma < 0.12 && (l < 0.05 || l > 0.6)) return undefined;
  if (contrast(l, LIGHT_BG) >= 3 && contrast(l, DARK_BG) >= 3) return hex;
  return chroma >= 0.25 ? 'accent' : undefined;
}

/** Размер куска, % от основного текста: 75–200, шагом 5; почти как основной — без своего */
function sizeOf(px: number | undefined, base: number): number | undefined {
  if (!px || !base) return undefined;
  const k = Math.round(((px / base) * 100) / 5) * 5;
  if (Math.abs(k - 100) < 8) return undefined;
  return Math.max(75, Math.min(200, k));
}

/** Шрифт куска: моноширинный — общий mono, свой — только если он есть в презентации */
function fontOf(css: string | undefined, o: PasteOpts): string | undefined {
  if (!css) return undefined;
  const names = css.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (names.some((n) => /^(monospace|consolas|courier( new)?|menlo|monaco|ui-monospace|sf mono|jetbrains mono|cascadia (code|mono)|source code pro)$/i.test(n))) return 'mono';
  const own = names.find((n) => o.fontOk?.(n));
  return own;
}

/** Разбор HTML буфера в строки с кусками текста и их оформлением */
function parse(html: string): { lines: Line[]; base: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const word = /urn:schemas-microsoft-com:office|class=["']?Mso/i.test(html);
  // Основной размер Word — в стилях документа (p.MsoNormal); у сайтов браузер вписывает размеры в style
  const wordBase = word ? sizePx(/MsoNormal[^{]*\{[^}]*font-size:\s*([\d.]+pt)/i.exec(html)?.[1] ?? '11pt', undefined) : undefined;
  const lines: Line[] = [];
  let cur: Line = { kind: 'p', runs: [] };
  let chars = 0;
  const end = (force = false) => {
    if (cur.runs.length || force) lines.push(cur);
    cur = { kind: 'p', runs: [] };
  };
  const walk = (node: Node, st: Style, defaultSize: number | undefined) => {
    if (chars > MAX_CHARS) return;
    if (node.nodeType === Node.TEXT_NODE) {
      let text = (node.textContent ?? '').replace(/[ \t\r\n\f]+/g, ' ');
      if (!cur.runs.length) text = text.replace(/^ +/, '');
      if (!text) return;
      chars += text.length;
      const last = cur.runs[cur.runs.length - 1];
      const run: Run = { ...st, size: st.size ?? defaultSize, text };
      if (last && same(last, run)) last.text += text;
      else cur.runs.push(run);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) || el.hidden) return;
    const style = el.getAttribute('style') ?? '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return;
    if (tag === 'BR') return end(true);
    // Word: значок пункта списка — отдельный кусок «mso-list:Ignore»; по нему видно нумерацию
    if (/mso-list\s*:\s*ignore/i.test(style)) {
      if (/^\s*[\dIVXivx]+[.)]/.test(el.textContent ?? '')) cur.num = true;
      return;
    }
    const s: Style = { ...st };
    const weight = prop(style, 'font-weight');
    if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag)) s.b = true;
    if (weight) s.b = /bold|[6-9]00/.test(weight);
    const fstyle = prop(style, 'font-style');
    if (tag === 'I' || tag === 'EM') s.i = true;
    if (fstyle) s.i = /italic|oblique/.test(fstyle);
    const deco = prop(style, 'text-decoration') ?? prop(style, 'text-decoration-line');
    if (tag === 'U' && !s.inLink) s.u = true;
    if (deco && !s.inLink) s.u = /underline/.test(deco);
    if (tag === 'A') {
      const href = safeUrl(el.getAttribute('href') ?? '');
      if (href && /^(https?:|mailto:|tel:)/i.test(href)) s.href = href;
      s.inLink = true;
      s.u = false;
    }
    const color = prop(style, 'color');
    if (color && !s.inLink) s.color = color;
    const fsize = prop(style, 'font-size');
    const px = fsize ? sizePx(fsize, s.size ?? defaultSize) : undefined;
    if (px) s.size = px;
    else if (HEADING_SIZE[tag] && s.size === undefined) s.size = ((wordBase ?? 16) * HEADING_SIZE[tag]) / 100;
    const family = prop(style, 'font-family');
    if (family) s.font = family;
    const isBlock = BLOCK.has(tag);
    const wordItem = word && tag === 'P' && /mso-list/i.test(style);
    if (isBlock) {
      end();
      if (tag === 'LI' || wordItem) cur = { kind: 'li', num: tag === 'LI' && el.parentElement?.tagName === 'OL', runs: [] };
    }
    if (tag === 'TD' || tag === 'TH') {
      if (cur.runs.length) cur.runs.push({ text: '  ' });
    }
    for (const c of el.childNodes) walk(c, s, defaultSize);
    if (isBlock) {
      end();
      // Абзацы сайта отделены промежутком; у Word промежутки — пустыми абзацами
      if (!word && /^(P|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag)) lines.push({ kind: 'gap', runs: [] });
    }
  };
  for (const c of doc.body.childNodes) walk(c, {}, wordBase);
  end();
  // Пустые строки — промежутки; подряд — один; в начале и в конце — нет
  const out: Line[] = [];
  for (const l of lines) {
    const empty = !l.runs.some((r) => r.text.trim());
    const line: Line = empty ? { kind: 'gap', runs: [] } : l;
    if (line.kind === 'gap' && (!out.length || out[out.length - 1].kind === 'gap')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1].kind === 'gap') out.pop();
  for (const l of out) {
    const first = l.runs[0];
    if (first) first.text = first.text.replace(/^\s+/, '');
    const last = l.runs[l.runs.length - 1];
    if (last) last.text = last.text.replace(/\s+$/, '');
  }
  // Основной размер — у большей части текста
  const weightBySize = new Map<number, number>();
  // Ключ — с сотыми: 11 pt — это 14,67 px, округление до целых исказило бы доли (16 pt к 11 — 145 %, а не 140)
  const key = (px: number) => Math.round(px * 100) / 100;
  for (const l of out) for (const r of l.runs) if (r.size) weightBySize.set(key(r.size), (weightBySize.get(key(r.size)) ?? 0) + r.text.length);
  const base = [...weightBySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? wordBase ?? 16;
  return { lines: out, base };
}

const same = (a: Style, b: Style) => a.b === b.b && a.i === b.i && a.u === b.u && a.color === b.color && a.size === b.size && a.font === b.font && a.href === b.href;

/** Строки простого текста: «Только текст» */
function plainLines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.replace(/\r/g, '').slice(0, MAX_CHARS).split('\n')) {
    const t = raw.replace(/\s+$/, '');
    if (!t.trim()) {
      if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap', runs: [] });
      continue;
    }
    out.push({ kind: 'p', runs: [{ text: t }] });
  }
  while (out.length && out[out.length - 1].kind === 'gap') out.pop();
  return out;
}

/** Строки → элементы, которые понимает serialize.ts (и которые так же выглядят в правке) */
function build(doc: Document, lines: Line[], mode: PasteMode, base: number, o: PasteOpts): HTMLElement {
  const box = doc.createElement('div');
  const runNode = (r: Run): Node => {
    let n: Node = doc.createTextNode(r.text);
    if (mode === 'source') {
      const a: SpanAttrs = {};
      const paint = paintOf(r.color);
      if (paint) a.paint = paint;
      const size = sizeOf(r.size, base);
      if (size) a.size = size;
      const font = fontOf(r.font, o);
      if (font) a.font = font;
      const attrs = formatSpanAttrs(a);
      if (attrs) {
        const span = doc.createElement('span');
        span.className = 'md-c';
        span.dataset.c = attrs;
        span.setAttribute('style', spanCss(a));
        span.appendChild(n);
        n = span;
      }
    }
    for (const [on, tag] of [[r.u, 'u'], [r.i, 'i'], [r.b, 'b']] as const) {
      if (!on) continue;
      const w = doc.createElement(tag);
      w.appendChild(n);
      n = w;
    }
    if (r.href) {
      const a = doc.createElement('a');
      a.className = 'md-a';
      a.href = r.href;
      a.appendChild(n);
      n = a;
    }
    return n;
  };
  let prevBlock = true;
  for (const l of lines) {
    if (l.kind === 'gap') {
      const gap = doc.createElement('span');
      gap.className = 'md-gap';
      gap.textContent = '​';
      box.appendChild(gap);
      prevBlock = true;
    } else if (l.kind === 'li') {
      const li = doc.createElement('span');
      li.className = 'md-li';
      if (l.num) li.dataset.li = 'num';
      for (const r of l.runs) li.appendChild(runNode(r));
      box.appendChild(li);
      prevBlock = true;
    } else {
      if (!prevBlock) box.appendChild(doc.createElement('br'));
      for (const r of l.runs) box.appendChild(runNode(r));
      prevBlock = false;
    }
  }
  return box;
}

let inert: Document | null = null;
const inertDoc = () => (inert ??= document.implementation.createHTMLDocument(''));

/** Элементы вставки: для правки на месте (вставка внутрь набранного текста) */
export function pasteHtml(html: string, plain: string, mode: PasteMode, o: PasteOpts = {}): string {
  return pasteBox(html, plain, mode, o).innerHTML;
}

/** Разметка текста вставки: для новой надписи на слайде */
export function pasteMarkup(html: string, plain: string, mode: PasteMode, o: PasteOpts = {}): string {
  return toMarkup(pasteBox(html, plain, mode, o));
}

function pasteBox(html: string, plain: string, mode: PasteMode, o: PasteOpts): HTMLElement {
  if (mode === 'text' || !html.trim()) return build(inertDoc(), plainLines(plain), 'text', 16, o);
  const { lines, base } = parse(html);
  return build(inertDoc(), lines.length ? lines : plainLines(plain), mode, base, o);
}
