import { SHAPE_COLORS } from '../components/shape/shape';
import { clone, getAt, setAt, type Path } from '../engine/data';
import { placeOf, type Place } from '../engine/render';
import type { Editor } from '../engine/editor/editor';
import { THEME_COLORS, type TextStyle } from '../engine/text-style';
import type { Block, Deck } from '../types';

/**
 * Разгруппировка: составной блок (карточка, панель, сетка, числа, импортированная вёрстка…)
 * становится отдельными свободными объектами на тех же местах — фигуры-подложки, тексты,
 * картинки и вложенные блоки. Вид берётся с отрисованного слайда: размеры, шрифт, цвета
 * (цвета темы остаются цветами темы).
 */

/** Блоки с живой графикой и сложной геометрией не раскладываются: их вид не из текстов и подложек. */
const WHOLE = new Set(['math', 'line-chart', 'bars', 'donut', 'hbars', 'gauge', 'rings', 'columns', 'lines', 'uptime', 'network', 'hub', 'system', 'pipeline', 'timeline', 'progress', 'sliders',
  'image', 'tile', 'embed', 'live', 'spacer', 'text', 'note', 'list', 'table', 'link-card', 'link-buttons', 'link-plate', 'space-sky']);

export function canUngroup(type: string, el: HTMLElement | null): boolean {
  if (!el || WHOLE.has(type)) return false;
  // Вёрстка с рисунками SVG, canvas, видео: такие части не переносятся отдельными объектами
  if (type === 'html' && el.querySelector('svg:not([data-edit-img] svg):not([data-edit-img]), canvas, video, iframe')) return false;
  return true;
}

interface Host {
  deck: Deck;
  stage: HTMLElement;
  editor: Editor;
}

type Rgb = [number, number, number, number];

function parseRgb(c: string): Rgb | null {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(/[,\s/]+/).filter(Boolean);
  return [Number(r), Number(g), Number(b), Number(a)];
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Цвет → имя цвета темы, если совпадает с ним, иначе #RRGGBB. */
function palette(stage: HTMLElement, names: Record<string, { css: string }>): (c: string) => string | null {
  const probe = document.createElement('i');
  probe.style.display = 'none';
  stage.appendChild(probe);
  const known = Object.entries(names).map(([k, v]) => {
    probe.style.color = v.css;
    return [k, parseRgb(getComputedStyle(probe).color)] as const;
  });
  probe.remove();
  return (c) => {
    const rgb = parseRgb(c);
    if (!rgb || rgb[3] < 0.05) return null;
    const hit = known.find(([, k]) => k && Math.abs(k[0] - rgb[0]) + Math.abs(k[1] - rgb[1]) + Math.abs(k[2] - rgb[2]) < 4);
    return hit ? hit[0] : hex(rgb);
  };
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Видимые границы элемента по сторонам (толщина в CSS-пикселях элемента) */
function borders(cs: CSSStyleDeclaration): { side: typeof SIDES[number]; w: number; color: string }[] {
  return SIDES.map((side) => ({
    side,
    w: parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0,
    color: cs.getPropertyValue(`border-${side}-color`),
    style: cs.getPropertyValue(`border-${side}-style`),
  })).filter((b) => b.w > 0.2 && b.style !== 'none' && b.style !== 'hidden' && (parseRgb(b.color)?.[3] ?? 0) > 0.05);
}

/** Рамка со всех сторон одинаковая — обводка фигуры; иначе стороны становятся линиями */
function uniformBorder(cs: CSSStyleDeclaration): boolean {
  const b = borders(cs);
  return b.length === 4 && b.every((x) => Math.abs(x.w - b[0].w) < 0.5 && x.color === b[0].color);
}

/** Подложка: фон, тень или рамка со всех сторон */
const visible = (cs: CSSStyleDeclaration) => {
  const bg = parseRgb(cs.backgroundColor);
  return (bg && bg[3] > 0.05) || cs.boxShadow !== 'none' || uniformBorder(cs);
};

export function ungroup(host: Host, slide: number, sel: { block: Path; free: Path | null }): boolean {
  const { deck, stage, editor } = host;
  const key = JSON.stringify(sel.block);
  const root = [...stage.querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === key);
  const blk = getAt(deck, sel.block) as Block | undefined;
  if (!root || !blk) return false;
  if (blk.type === 'group' && sel.free) return splitGroup(host, slide, sel.free, blk);
  if (!canUngroup(blk.type, root)) {
    editor.toast('Этот блок не разгруппировывается: он рисуется целиком (график, схема, картинка)', 3500);
    return false;
  }
  const textColor = palette(stage, THEME_COLORS);
  const fillColor = palette(stage, SHAPE_COLORS);
  const box = (r: DOMRect) => {
    const a = editor.toSlide(r.left, r.top);
    const z = editor.toSlide(r.right, r.bottom);
    const f = (n: number) => Math.round(n * 10) / 10;
    return { x: f(a.x), y: f(a.y), w: f(z.x - a.x), h: f(z.y - a.y) };
  };
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    const a = editor.toSlide(r.left, r.top);
    const z = editor.toSlide(r.right, r.bottom);
    const f = (n: number) => Math.round(n * 10) / 10;
    return { x: f(a.x), y: f(a.y), w: f(z.x - a.x), h: f(z.y - a.y) };
  };

  /**
   * Сколько пикселей слайда в одном CSS-пикселе элемента: импортированная вёрстка
   * нарисована крупнее и уменьшена (scale), встроенные блоки — 1.
   */
  const unit = (el: HTMLElement) => {
    const w = el.offsetWidth || (el as unknown as SVGGraphicsElement).getBBox?.().width || 0;
    return w ? rect(el).w / w : 1;
  };

  /** Оформление текста с отрисованного элемента. */
  const textStyle = (el: HTMLElement): TextStyle => {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const st: TextStyle = { size: Math.max(6, Math.round(size * unit(el) * 10) / 10) };
    const color = textColor(cs.color);
    if (color) st.color = color;
    const align = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'right' : undefined;
    if (align) st.align = align;
    const weight = parseInt(cs.fontWeight, 10);
    if (weight && weight !== 400) st.weight = weight;
    if (cs.textTransform === 'uppercase') st.upper = true;
    const ls = parseFloat(cs.letterSpacing);
    if (Number.isFinite(ls) && ls) st.spacing = Math.round((ls / size) * 1000) / 1000;
    const lh = parseFloat(cs.lineHeight);
    if (Number.isFinite(lh)) st.leading = Math.round((lh / size) * 100) / 100;
    // Шрифт — по первому в списке: системный остаётся шрифтом темы
    const first = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    if (/^(georgia|times|pt serif|serif)/.test(first)) st.font = 'serif';
    else if (/mono|consolas|menlo/.test(first)) st.font = 'mono';
    return st;
  };

  const shapeOf = (el: HTMLElement, text?: { value: string; st: TextStyle }): Block => {
    const cs = getComputedStyle(el);
    const r = rect(el);
    const k = unit(el);
    const radius = (parseFloat(cs.borderTopLeftRadius) || 0) * k;
    const b: Block = { type: 'shape', kind: cs.borderTopLeftRadius.endsWith('%') ? 'ellipse' : radius >= r.h / 2 - 1 ? 'pill' : 'rect', place: r };
    const fill = fillColor(seen(cs.backgroundColor, el));
    b.fill = fill ?? 'none';
    if (b.kind === 'rect' && radius) b.radius = Math.round(radius);
    const bw = uniformBorder(cs) ? parseFloat(cs.borderTopWidth) * k : 0;
    if (bw > 0) {
      b.width = Math.round(bw * 10) / 10;
      b.stroke = fillColor(seen(cs.borderTopColor, el)) ?? 'border';
    }
    // Тень: лёгкая или заметная — по размытию
    if (cs.boxShadow !== 'none') {
      const blur = Math.max(0, ...[...cs.boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)].map((m) => Number(m[3])));
      b.shadow = blur * k > 10 ? 'md' : 'sm';
    }
    if (text) {
      b.text = text.value;
      // У фигуры текст по умолчанию жирный: насыщенность — всегда как на слайде
      b.styles = { text: { ...text.st, weight: text.st.weight ?? 400 } };
    }
    return b;
  };

  /**
   * Полупрозрачный цвет (светлые разделители, тонированные подложки) — как его видно на слайде:
   * смешанный с фоном под элементом. Иначе rgba(…, .08) превращается в сплошной тёмный.
   */
  const seen = (c: string, el: HTMLElement): string => {
    const rgb = parseRgb(c);
    if (!rgb || rgb[3] >= 0.99 || rgb[3] < 0.05) return c;
    let under: Rgb = [255, 255, 255, 1];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const b = parseRgb(getComputedStyle(p).backgroundColor);
      if (b && b[3] > 0.9) { under = b; break; }
    }
    const a = rgb[3];
    return `rgb(${[0, 1, 2].map((i) => Math.round(rgb[i] * a + under[i] * (1 - a))).join(', ')})`;
  };

  /** Стороны рамки, которые не стали обводкой фигуры (разделители строк и столбцов), — линиями */
  const sideLines = (el: HTMLElement, cs: CSSStyleDeclaration): Block[] => {
    if (uniformBorder(cs)) return [];
    const r = rect(el);
    const k = unit(el);
    return borders(cs).map((s) => {
      const w = Math.max(0.5, Math.round(s.w * k * 10) / 10);
      const across = s.side === 'top' || s.side === 'bottom';
      const len = across ? r.w : r.h;
      // Линия рисуется посередине рамки высотой 12 px; вертикальная — повёрнута на 90°
      const cx = s.side === 'left' ? r.x + w / 2 : s.side === 'right' ? r.x + r.w - w / 2 : r.x + r.w / 2;
      const cy = s.side === 'top' ? r.y + w / 2 : s.side === 'bottom' ? r.y + r.h - w / 2 : r.y + r.h / 2;
      const b: Block = { type: 'shape', kind: 'line', stroke: fillColor(seen(s.color, el)) ?? 'border', width: w, place: { x: r1(cx - len / 2), y: r1(cy - 6), w: r1(len), h: 12 } };
      if (!across) b.rotate = 90;
      return b;
    });
  };

  /**
   * Место надписи — там, где текст нарисован, а не рамка элемента: без внутренних отступов ячейки.
   * Сверху — с поправкой на межстрочный интервал: надпись сама добавит его над первой строкой.
   */
  const textPlace = (el: HTMLElement, st: TextStyle): Place => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const all = rg.getBoundingClientRect();
    const first = rg.getClientRects()[0];
    if (!all.width || !first) {
      const r = rect(el);
      return { x: r.x, y: r.y, w: Math.ceil(r.w * 1.03 + 3) };
    }
    const r = box(all);
    const line = box(first).h;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    const half = Number.isFinite(lh) ? Math.max(0, (lh * unit(el) - line) / 2) : 0;
    // Выравнивание по центру или вправо: рамка надписи шире текста, текст остаётся на своём месте
    const w = Math.ceil(r.w * 1.03 + 3);
    const x = st.align === 'center' ? r.x - (w - r.w) / 2 : st.align === 'right' ? r.x - (w - r.w) : r.x;
    return { x: r1(x), y: r1(r.y - half), w };
  };

  /** Текст стоит посередине подложки (чип, кнопка) — тогда это фигура с текстом */
  const centered = (el: HTMLElement): boolean => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const t = rg.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (!t.width) return true;
    const l = t.left - e.left;
    const rt = e.right - t.right;
    return Math.abs(l - rt) <= Math.max(3, e.width * 0.04);
  };

  /** Текст элемента: на подложке по центру — фигура с текстом; иначе подложка отдельно, надпись отдельно */
  const textParts = (el: HTMLElement, cs: CSSStyleDeclaration, value: string, st: TextStyle, markdown: string): Block[] => {
    const out: Block[] = [];
    const bg = el !== root && visible(cs);
    if (bg && centered(el)) out.push(shapeOf(el, { value: markdown, st }));
    else {
      if (bg) out.push(shapeOf(el));
      out.push({ type: 'text', text: markdown, place: textPlace(el, st), styles: { text: st } });
    }
    if (el !== root) out.push(...sideLines(el, cs));
    return value ? out : [];
  };

  const valueOf = (el: HTMLElement): string | null => {
    let path: Path;
    try { path = JSON.parse(el.getAttribute('data-edit') ?? ''); } catch { return null; }
    const v = getAt(deck, path);
    if (v === undefined || v === null) return null;
    let s = String(v);
    const suffix = el.getAttribute('data-suffix');
    if (suffix && s.endsWith(suffix)) s = s.slice(0, -suffix.length).trimEnd();
    return s.trim() ? s : null;
  };

  const parts: Block[] = [];
  const walk = (el: HTMLElement) => {
    if (el !== root && el.hasAttribute('data-block')) {
      // Вложенный блок (карточка сетки, график в карточке) переносится целиком
      const path = JSON.parse(el.getAttribute('data-block')!) as Path;
      const inner = JSON.parse(JSON.stringify(getAt(deck, path))) as Block & { cols?: unknown; rows?: unknown };
      delete inner.cols;
      delete inner.rows;
      parts.push({ ...inner, place: rect(el) });
      return;
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (el.hasAttribute('data-edit') && !(el instanceof SVGElement)) {
      const value = valueOf(el);
      if (value === null) return;
      parts.push(...textParts(el, cs, value, textStyle(el), value));
      return;
    }
    if (el.hasAttribute('data-edit-img')) {
      let path: Path | null = null;
      try { path = JSON.parse(el.getAttribute('data-edit-img')!); } catch { /* нет пути */ }
      const src = path ? getAt(deck, path) : null;
      const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
      if (typeof src === 'string' && src && img) {
        parts.push({ type: 'image', src, place: rect(img), ...(getComputedStyle(img).objectFit === 'contain' ? { fit: 'contain' } : {}) });
      }
      return;
    }
    // Оформительский текст без поля в данных (стрелка ↑, кавычка «“»): переносится как есть
    const literal = !el.children.length && !(el instanceof SVGElement) ? (el.textContent ?? '').trim() : '';
    if (literal) {
      parts.push(...textParts(el, cs, literal, textStyle(el), literal.replace(/([\\*_[\]{])/g, '\\$1')));
      return;
    }
    if (visible(cs) && el.getBoundingClientRect().width > 1) parts.push(shapeOf(el));
    if (el !== root && el.getBoundingClientRect().width > 1) parts.push(...sideLines(el, cs));
    for (const c of el.children) walk(c as HTMLElement);
  };
  walk(root);

  if (!parts.length) {
    editor.toast('Внутри нет частей, которые можно сделать отдельными', 2500);
    return false;
  }
  // Появление исходного блока переходит ко всем частям
  const fx = sel.free ? (getAt(deck, sel.free) as Block) : null;
  if (fx?.enter) parts.forEach((p) => { p.enter = fx.enter; if (fx.delay) p.delay = fx.delay; });

  let from = 0;
  const ok = editor.commit((d) => {
    const s = d.slides[slide];
    s.free = Array.isArray(s.free) ? s.free : [];
    if (sel.free) {
      from = Number(sel.free[3]);
      s.free.splice(from, 1, ...parts);
    } else {
      // Блок уходит из раскладки, части встают поверх на те же места
      const last = sel.block[sel.block.length - 1];
      const parent = getAt(d, sel.block.slice(0, -1));
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else setAt(d, sel.block, undefined);
      from = s.free.length;
      s.free.push(...parts);
    }
  }, { rebuild: true });
  if (!ok) return false;
  editor.selectMany(slide, parts.map((_p, k) => from + k));
  editor.toast(`Разгруппировано: ${objects(parts.length)}. Вернуть: Ctrl+Z`, 3000);
  return true;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Группа → её объекты снова отдельные, на тех же местах и того же размера, что сейчас на слайде. */
function splitGroup(host: Host, slide: number, freePath: Path, g: Block): boolean {
  const { editor } = host;
  const gp = placeOf(g);
  const items = (Array.isArray(g.items) ? g.items : []) as Block[];
  if (!items.length) return false;
  const base = g.base as { w?: number; h?: number } | undefined;
  const bw = Number(base?.w) || gp.w;
  const bh = Number(base?.h) || gp.h || 1;
  const sx = gp.w / bw;
  const sy = (gp.h ?? bh) / bh;
  const parts = items.map((it) => {
    const c = clone(it) as Block;
    const pl = placeOf(c);
    const place: Place = { x: r1(gp.x + pl.x * sx), y: r1(gp.y + pl.y * sy), w: r1(pl.w * sx) };
    if (pl.h) place.h = r1(pl.h * sy);
    c.place = place;
    return c;
  });
  const from = Number(freePath[3]);
  const ok = editor.commit((d) => { d.slides[slide].free!.splice(from, 1, ...parts); }, { rebuild: true });
  if (!ok) return false;
  editor.selectMany(slide, parts.map((_p, k) => from + k));
  editor.toast(`Группа разобрана: ${objects(parts.length)}. Вернуть: Ctrl+Z`, 2500);
  return true;
}

/** Выделенные свободные объекты → одна группа: двигаются, выравниваются и растягиваются вместе. */
export function groupObjects(host: Host, slide: number, paths: Path[]): boolean {
  const { deck, stage, editor } = host;
  if (paths.length < 2) return false;
  const sorted = [...paths].sort((a, b) => Number(a[3]) - Number(b[3]));
  const items = sorted.map((p) => {
    const b = clone(getAt(deck, p)) as Block;
    const pl = placeOf(b);
    let h = pl.h;
    if (!h) {
      // Высота по содержимому: берётся с отрисованного слайда
      const el = [...stage.querySelectorAll<HTMLElement>('.slide.on [data-free]')].find((x) => x.getAttribute('data-free') === JSON.stringify(p));
      if (el) {
        const r = el.getBoundingClientRect();
        h = editor.toSlide(r.left, r.bottom).y - editor.toSlide(r.left, r.top).y;
      }
    }
    return { b, pl, h: h ?? 40 };
  });
  const x0 = Math.min(...items.map((i) => i.pl.x));
  const y0 = Math.min(...items.map((i) => i.pl.y));
  const w = r1(Math.max(...items.map((i) => i.pl.x + i.pl.w)) - x0);
  const h = r1(Math.max(...items.map((i) => i.pl.y + i.h)) - y0);
  const group: Block = {
    type: 'group',
    items: items.map(({ b, pl }) => ({ ...b, place: { x: r1(pl.x - x0), y: r1(pl.y - y0), w: pl.w, ...(pl.h ? { h: pl.h } : {}) } })),
    base: { w, h },
    place: { x: x0, y: y0, w, h },
  };
  // Появление группы — как у первого появляющегося объекта; у самих объектов оно сохраняется до разгруппировки
  const fx = items.map((i) => i.b).filter((b) => b.enter).sort((a, b) => (Number(a.delay) || 0) - (Number(b.delay) || 0))[0];
  if (fx) {
    group.enter = fx.enter;
    if (fx.delay) group.delay = fx.delay;
  }
  let at = 0;
  const ok = editor.commit((d) => {
    const list = d.slides[slide].free!;
    [...sorted].reverse().forEach((p) => list.splice(Number(p[3]), 1));
    // Группа встаёт на место самого верхнего объекта
    at = Number(sorted[sorted.length - 1][3]) - (sorted.length - 1);
    list.splice(at, 0, group);
  }, { rebuild: true });
  if (!ok) return false;
  editor.selectFree(slide, at);
  editor.toast('Сгруппировано. Разгруппировать: Ctrl+Shift+G', 2500);
  return true;
}

/** 1 объект, 2 объекта, 5 объектов */
function objects(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'объект' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'объекта' : 'объектов';
  return `${n} ${w}`;
}
