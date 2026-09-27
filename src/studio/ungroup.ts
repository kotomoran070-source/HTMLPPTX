import { SHAPE_COLORS } from '../components/shape/shape';
import { getAt, setAt, type Path } from '../engine/data';
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
const WHOLE = new Set(['line-chart', 'bars', 'uptime', 'network', 'hub', 'system', 'pipeline', 'timeline', 'progress', 'sliders',
  'image', 'tile', 'embed', 'live', 'spacer', 'text', 'note', 'list', 'table']);

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

const visible = (cs: CSSStyleDeclaration) => {
  const bg = parseRgb(cs.backgroundColor);
  return (bg && bg[3] > 0.05) || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none';
};

export function ungroup(host: Host, slide: number, sel: { block: Path; free: Path | null }): boolean {
  const { deck, stage, editor } = host;
  const key = JSON.stringify(sel.block);
  const root = [...stage.querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === key);
  const blk = getAt(deck, sel.block) as Block | undefined;
  if (!root || !blk) return false;
  if (!canUngroup(blk.type, root)) {
    editor.toast('Этот блок не разгруппировывается: он рисуется целиком (график, схема, картинка)', 3500);
    return false;
  }
  const textColor = palette(stage, THEME_COLORS);
  const fillColor = palette(stage, SHAPE_COLORS);
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
    const fill = fillColor(cs.backgroundColor);
    b.fill = fill ?? 'none';
    if (b.kind === 'rect' && radius) b.radius = Math.round(radius);
    const bw = parseFloat(cs.borderTopWidth) * k;
    if (bw > 0) {
      b.width = Math.round(bw * 10) / 10;
      b.stroke = fillColor(cs.borderTopColor) ?? 'border';
    }
    // Тень: лёгкая или заметная — по размытию
    if (cs.boxShadow !== 'none') {
      const blur = Math.max(0, ...[...cs.boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)].map((m) => Number(m[3])));
      b.shadow = blur * k > 10 ? 'md' : 'sm';
    }
    if (text) {
      b.text = text.value;
      b.styles = { text: text.st };
    }
    return b;
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
      const st = textStyle(el);
      // Текст на своей подложке (чип, метка) — фигура с текстом
      if (el !== root && visible(cs)) parts.push(shapeOf(el, { value, st }));
      else {
        const r = rect(el);
        parts.push({ type: 'text', text: value, place: { x: r.x, y: r.y, w: Math.ceil(r.w * 1.03 + 3) }, styles: { text: st } });
      }
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
      const st = textStyle(el);
      if (el !== root && visible(cs)) parts.push(shapeOf(el, { value: literal, st }));
      else {
        const r = rect(el);
        parts.push({ type: 'text', text: literal.replace(/([\\*_[\]{])/g, '\\$1'), place: { x: r.x, y: r.y, w: Math.ceil(r.w * 1.03 + 3) }, styles: { text: st } });
      }
      return;
    }
    if (visible(cs) && el.getBoundingClientRect().width > 1) parts.push(shapeOf(el));
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
  editor.toast(`Разгруппировано: ${parts.length} ${parts.length % 10 === 1 && parts.length % 100 !== 11 ? 'объект' : 'объектов'}. Вернуть: Ctrl+Z`, 3000);
  return true;
}
