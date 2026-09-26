/**
 * Привязка цветов к теме. В импортированной вёрстке цвета записаны прямо: color: rgb(17, 24, 39).
 * Такие цвета не меняются ни с тёмной темой, ни со сменой акцентного цвета. Здесь каждый цвет,
 * совпадающий с цветом темы (или очень близкий к нему), заменяется ссылкой: color: var(--tx).
 *
 * Что к чему привязывается, зависит от свойства: цвет текста — к цветам текста, фон — к фонам,
 * рамка — к рамкам. Так тёмная шапка таблицы (фон #111827) не станет светлой, хотя цвет
 * совпадает с цветом текста. Цвета без пары (красный «Высокий») и полупрозрачные остаются.
 * Слайды с тёмным фоном (задуманные тёмными) не трогаются: они тёмные в обеих темах.
 */
import { parse, type HTMLElement } from 'node-html-parser';
import { accentTokens } from '../src/engine/accent';

type RGB = [number, number, number];
type Role = 'text' | 'bg' | 'border' | 'any';

/** Цвета светлой темы (src/styles/tokens.css) */
const BASE: Record<string, string> = {
  bg: '#F8FAFC', surf: '#FDFEFF', alt: '#F3F4F6', tx: '#111827', tx2: '#374151', mu: '#6B7280',
  bd: '#E5E7EB', bd2: '#D1D5DB', ac: '#2563EB', ach: '#1D4ED8', acs: '#EFF6FF', acb: '#93C5FD',
};
const ROLES: Record<Exclude<Role, 'any'>, string[]> = {
  text: ['tx', 'tx2', 'mu', 'ac', 'ach'],
  // bd, bd2 — линии-разделители и дорожки прогресса обычно рисуют фоном
  bg: ['bg', 'surf', 'alt', 'acs', 'ac', 'ach', 'bd', 'bd2'],
  border: ['bd', 'bd2', 'acb', 'ac', 'ach'],
};
/** Для смесей: бледный текст — смесь с фоном, бледная рамка — тоже */
const PAIR_EXTRA: Record<Exclude<Role, 'any'>, string[]> = { text: ['bg'], bg: [], border: ['bg', 'surf'] };
/** Насколько смесь может отличаться от исходного цвета */
const MIX_NEAR = 9;
/** Имена цветов темы в разметке текста: {accent|…} */
const MARKUP_NAME: Record<string, string> = { ac: 'accent', ach: 'accent2', tx: 'text', tx2: 'text2', mu: 'muted' };
/** Насколько цвет может отличаться от цвета темы (расстояние в RGB): #E2E8F0 → --bd, #64748B → --mu */
const NEAR = 16;
const DEFAULT_ACCENT = '#2563EB';

const COLOR_RE = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi;
const DECL_RE = /([a-z-]+)(\s*:\s*)([^;{}]+)/gi;

function rgbOf(c: string): { rgb: RGB; alpha: number } | null {
  const s = c.trim().toLowerCase();
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
    if (!/^[0-9a-f]{6}$/.test(h)) return null;
    const n = parseInt(h, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: a };
}

const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function hsl([r, g, b]: RGB): { s: number; l: number } {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
  return { s, l };
}

function roleOf(prop: string): Role | null {
  const p = prop.toLowerCase();
  if (p === 'color' || p === 'caret-color' || p === 'text-decoration-color' || p === '-webkit-text-fill-color') return 'text';
  if (p === 'background' || p === 'background-color' || p === 'background-image') return 'bg';
  if (p.startsWith('border') || p.startsWith('outline') || p === 'column-rule' || p === 'column-rule-color') return 'border';
  if (p === 'fill' || p === 'stroke' || p === 'stop-color' || p === 'flood-color' || p === 'lighting-color') return 'any';
  return null;
}

export interface BindReport {
  /** Сколько цветов привязано к теме */
  bound: number;
  /** Цвета, которые остались как есть (без пары в теме): цвет → сколько раз */
  kept: Record<string, number>;
  /** Номера слайдов (с 1), оставленных тёмными */
  darkSlides: number[];
  /** Акцентный цвет макета, если он не стандартный синий */
  accent?: string;
}

export class ThemeBinder {
  private tokens: [string, RGB][];
  readonly report: BindReport = { bound: 0, kept: {}, darkSlides: [] };

  constructor(accent = DEFAULT_ACCENT) {
    const t = { ...BASE };
    if (accent.toUpperCase() !== DEFAULT_ACCENT) {
      const a = accentTokens(accent).light;
      t.ac = a['--ac'];
      t.ach = a['--ach'];
      t.acs = a['--acs'];
      t.acb = a['--acb'];
      this.report.accent = accent.toUpperCase();
    }
    this.tokens = Object.entries(t).map(([k, v]) => [k, rgbOf(v)!.rgb]);
  }

  /** Цвет темы для цвета и роли (или null). */
  token(color: string, role: Role): string | null {
    const c = rgbOf(color);
    if (!c || c.alpha < 1) return null;
    const allowed = role === 'any' ? null : new Set(ROLES[role]);
    let best: string | null = null;
    let bestD = NEAR + 1;
    for (const [name, rgb] of this.tokens) {
      if (allowed && !allowed.has(name)) continue;
      const d = dist(c.rgb, rgb);
      if (d < bestD) {
        best = name;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Цвет между двумя цветами темы: #4B5563 ≈ 60% --tx2 + 40% --mu. В тёмной теме смесь
   * тех же двух цветов даёт такой же «промежуточный» оттенок.
   */
  mix(color: string, role: Role): { a: string; b: string; p: number } | null {
    const c = rgbOf(color);
    if (!c || c.alpha < 1) return null;
    const names = role === 'any' ? this.tokens.map(([n]) => n) : [...ROLES[role], ...PAIR_EXTRA[role]];
    const list = this.tokens.filter(([n]) => names.includes(n));
    let best: { a: string; b: string; p: number; r: number } | null = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [an, a] = list[i];
        const [bn, b] = list[j];
        const ab = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const len = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
        if (!len) continue;
        const p = ((c.rgb[0] - b[0]) * ab[0] + (c.rgb[1] - b[1]) * ab[1] + (c.rgb[2] - b[2]) * ab[2]) / len;
        if (p < 0.05 || p > 0.95) continue;
        const r = dist(c.rgb, [b[0] + ab[0] * p, b[1] + ab[1] * p, b[2] + ab[2] * p]);
        if (r <= MIX_NEAR && (!best || r < best.r)) best = { a: an, b: bn, p, r };
      }
    }
    return best ? { a: best.a, b: best.b, p: best.p } : null;
  }

  private keep(color: string): void {
    const c = rgbOf(color);
    if (!c || c.alpha < 1) return;
    const key = '#' + c.rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    this.report.kept[key] = (this.report.kept[key] ?? 0) + 1;
  }

  /** Значение CSS-свойства: цвета → var(--…). fallback — оставить исходный цвет запасным (для вставок). */
  value(prop: string, value: string, fallback: boolean): string {
    const role = roleOf(prop);
    if (!role) return value;
    // Цвета внутри var(…) уже привязаны: не трогаем
    const masked: string[] = [];
    const v = value.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, (m) => `\u0000${masked.push(m) - 1}\u0000`);
    const ref = (tok: string, c: string) => (fallback ? `var(--${tok}, ${c})` : `var(--${tok})`);
    const out = v.replace(COLOR_RE, (c) => {
      const tok = this.token(c, role);
      if (tok) {
        this.report.bound++;
        return ref(tok, c);
      }
      const m = this.mix(c, role);
      if (m) {
        this.report.bound++;
        return `color-mix(in srgb, ${ref(m.a, c)} ${Math.round(m.p * 100)}%, ${ref(m.b, c)})`;
      }
      this.keep(c);
      return c;
    });
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => masked[Number(i)]);
  }

  /** Объявления CSS (атрибут style или таблица стилей). */
  css(text: string, fallback = false): string {
    return text.replace(DECL_RE, (_m: string, prop: string, sep: string, value: string) => `${prop}${sep}${this.value(prop, value, fallback)}`);
  }

  /** Номера текстов (data-t), лежащих внутри блоков с «своим» фоном: их цвет не трогаем */
  fixedTexts = new Set<number>();

  /**
   * Фрагмент HTML: атрибуты style, SVG-атрибуты fill/stroke, вложенные <style>.
   * Блок, фон которого остался своим (тёмная карточка, картинка, градиент), не перекрашивается
   * вместе со всем содержимым: иначе текст посветлеет в тёмной теме, а карточка нет.
   */
  html(fragment: string, fallback = false): string {
    const root = parse(fragment, { comment: false, blockTextElements: { style: true, script: true } });
    let changed = false;
    const visit = (el: HTMLElement, fixed: boolean) => {
      if (el.tagName === 'STYLE') {
        const next = this.css(el.text, fallback);
        if (next !== el.text) {
          el.set_content(next);
          changed = true;
        }
        return;
      }
      if (el.tagName === 'SCRIPT') return;
      const t = el.getAttribute('data-t');
      if (fixed && t !== undefined && /^\d+$/.test(t)) this.fixedTexts.add(Number(t));
      let own = fixed;
      // Подложка QR-кода остаётся светлой: инвертированный код не читается
      const qr = el.childNodes.some((c) => c.nodeType === 1 && isQr(c as HTMLElement));
      if (qr) own = true;
      if (!fixed && !qr && el.tagName) {
        const st = el.getAttribute('style');
        let style = st ?? '';
        if (st) style = this.css(st, fallback);
        // SVG: fill="#2563EB" не принимает var() — дописываем свойство в style, оно сильнее атрибута
        for (const a of ['fill', 'stroke', 'stop-color']) {
          const v = el.getAttribute(a);
          if (!v || new RegExp(`(^|;)\\s*${a}\\s*:`).test(style)) continue;
          const bound = this.value(a, v, fallback);
          if (bound !== v) style = style ? `${style.replace(/;?\s*$/, ';')} ${a}: ${bound}` : `${a}: ${bound}`;
        }
        if (style !== (st ?? '')) {
          el.setAttribute('style', style);
          changed = true;
        }
        own = ownBackground(style);
      }
      for (const c of el.childNodes) if (c.nodeType === 1) visit(c as HTMLElement, own);
    };
    for (const c of root.childNodes) if (c.nodeType === 1) visit(c as HTMLElement, false);
    return changed ? root.toString() : fragment;
  }

  /** Цвет в разметке текста: {#2563eb|слово} → {accent|слово}. */
  markup(text: string): string {
    return text.replace(/(^|[^\\])\{(#[0-9a-f]{3,8})\|/gi, (m, pre: string, c: string) => {
      const tok = this.token(c, 'text');
      const name = tok ? MARKUP_NAME[tok] : undefined;
      if (!name) {
        this.keep(c);
        return m;
      }
      this.report.bound++;
      return `${pre}{${name}|`;
    });
  }
}

function isQr(el: HTMLElement): boolean {
  if (el.tagName !== 'IMG' && el.tagName !== 'SVG' && el.tagName !== 'CANVAS') return false;
  const hint = `${el.getAttribute('alt') ?? ''} ${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  return /(^|[^a-z])qr/i.test(hint);
}

/** У блока свой фон, не привязанный к теме: картинка, градиент или цвет. */
function ownBackground(style: string): boolean {
  for (const m of style.matchAll(/(?:^|;)\s*(background(?:-color|-image)?)\s*:\s*([^;]+)/gi)) {
    const v = m[2].replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, '');
    if (/url\(/i.test(v)) return true;
    for (const c of v.matchAll(COLOR_RE)) {
      const x = rgbOf(c[0]);
      if (x && x.alpha >= 0.5) return true;
    }
  }
  return false;
}

/** Слайд задуман тёмным: фон тёмный в светлой теме. */
export function isDarkBg(bg: unknown): boolean {
  if (typeof bg !== 'string') return false;
  // У слоёного фона основной цвет — последний: «radial-gradient(…) 0 0/26px 26px, #F8FAFC»
  const all = [...bg.replace(/var\([^()]*\)/g, '').matchAll(COLOR_RE)].map((m) => rgbOf(m[0])).filter((c) => c && c.alpha >= 0.5);
  const c = all[all.length - 1];
  return !!c && luminance(c.rgb) < 0.2;
}

/**
 * Акцентный цвет макета: самый частый насыщенный цвет средней яркости.
 * Возвращает его, если он заметно отличается от стандартного синего.
 */
export function guessAccent(texts: string[]): string | undefined {
  const count = new Map<string, number>();
  for (const t of texts) {
    for (const m of t.matchAll(COLOR_RE)) {
      const c = rgbOf(m[0]);
      if (!c || c.alpha < 1) continue;
      const { s, l } = hsl(c.rgb);
      if (s < 0.45 || l < 0.28 || l > 0.68) continue;
      const key = '#' + c.rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 3) return undefined;
  return dist(rgbOf(top[0])!.rgb, rgbOf(DEFAULT_ACCENT)!.rgb) <= NEAR ? undefined : top[0];
}

type Deck = { theme?: { accent?: string }; css?: string; slides?: Record<string, unknown>[] };
type Block = Record<string, unknown>;

export interface EmbedIO {
  /** Текст документа вставки по src (data: или ./assets/…) */
  read(src: string): string | null;
  /** Записать новый текст; вернуть src, который положить в блок */
  write(src: string, text: string): string;
}

/** Все блоки слайда: body и free, с вложенными (card.body, grid.items…). */
function blocksOf(v: unknown, out: Block[] = []): Block[] {
  if (Array.isArray(v)) v.forEach((x) => blocksOf(x, out));
  else if (v && typeof v === 'object') {
    const b = v as Block;
    if (typeof b.type === 'string') out.push(b);
    for (const [k, x] of Object.entries(b)) if (k !== 'texts' && k !== 'images' && typeof x === 'object') blocksOf(x, out);
  }
  return out;
}

/** Привязывает цвета всей презентации к теме (меняет deck на месте). */
export function bindDeck(deck: Deck, io: EmbedIO): BindReport {
  // Акцент: берём из theme.accent или угадываем по вёрстке
  let accent = deck.theme?.accent;
  if (!accent) {
    const texts: string[] = [];
    for (const s of deck.slides ?? []) {
      if (isDarkBg(s.bg)) continue;
      for (const b of blocksOf([s.body, s.free])) if (typeof b.html === 'string') texts.push(b.html);
    }
    if (deck.css) texts.push(deck.css);
    accent = guessAccent(texts);
    if (accent) deck.theme = { ...(deck.theme ?? {}), accent };
  }
  const binder = new ThemeBinder(accent);
  if (typeof deck.css === 'string') deck.css = binder.css(deck.css);
  (deck.slides ?? []).forEach((s, i) => {
    if (isDarkBg(s.bg)) {
      binder.report.darkSlides.push(i + 1);
      return;
    }
    // Фон слайда: цвет или слои (сетка точек поверх цвета) — цвета внутри тоже к теме
    if (typeof s.bg === 'string') s.bg = binder.value('background', s.bg, false);
    for (const b of blocksOf([s.body, s.free])) {
      if (b.type === 'html') {
        binder.fixedTexts.clear();
        if (typeof b.html === 'string') b.html = binder.html(b.html);
        if (Array.isArray(b.texts)) b.texts = b.texts.map((t, k) => (typeof t === 'string' && !binder.fixedTexts.has(k) ? binder.markup(t) : t));
      } else if (b.type === 'embed' && typeof b.src === 'string') {
        const doc = io.read(b.src);
        if (doc == null) continue;
        const next = binder.html(doc, true);
        if (next !== doc) b.src = io.write(b.src, next);
        // Вставка получает текущие цвета темы при каждом показе (см. компонент embed)
        b.theme = true;
      }
    }
  });
  return binder.report;
}

/** Документ вставки из data: URL и обратно. */
export function readDataUrl(src: string): string | null {
  const m = /^data:text\/html(?:;charset=[\w-]+)?(;base64)?,([\s\S]*)$/i.exec(src);
  if (!m) return null;
  try {
    return m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2]);
  } catch {
    return null;
  }
}

export function toDataUrl(text: string): string {
  return `data:text/html;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
}
