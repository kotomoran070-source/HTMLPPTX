import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { parseDocument, type Document } from 'yaml';
import { icon } from '../components/icons';
import { blockName } from '../engine/editor/block-edit';
import { esc } from '../engine/html';
import { TEMPLATES } from './schema';

/**
 * Инспектор объектов для режима кода: дерево блоков слайда рядом с YAML.
 * Щелчок по узлу выделяет объект на слайде и показывает его строки в коде;
 * выделили объект на слайде — подсвечивается узел и его код; курсор в коде — объект под ним.
 */

type Seg = string | number;

export interface TreeNode {
  /** Путь внутри слайда: ['body', 0, 'items', 1] */
  path: Seg[];
  type: string;
  label: string;
  depth: number;
  /** block — блок; field — поле шаблона слайда; part — текст или картинка импортированной вёрстки */
  kind: 'block' | 'field' | 'part';
  /** Подпись вместо названия блока: «Заголовок», «Текст 3» */
  name?: string;
  /** Номер узла-блока, в котором лежит часть */
  parent?: number;
}

/** Поля шаблона, которые видны на слайде (не настройки вроде промежутка и варианта) */
const SHOWN = new Set(['text', 'textarea', 'url', 'group', 'rows']);

const clean = (v: string) => v.replace(/\{[^|}]*\|([^}]*)\}/g, '$1').replace(/[*_`[\]#]/g, '').replace(/\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);

/** Подпись поля шаблона: текст, адрес ссылки или число кнопок */
function fieldSnippet(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') return clean(String(v));
  if (Array.isArray(v)) return `${v.length} шт.`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return clean(String(o.url ?? o.text ?? o.title ?? ''));
  }
  return '';
}

/** Тексты и картинки импортированной вёрстки — узлами внутри её блока */
function htmlParts(o: Record<string, unknown>, path: Seg[], depth: number, parent: number): TreeNode[] {
  const out: TreeNode[] = [];
  if (Array.isArray(o.texts)) {
    o.texts.forEach((t, i) => out.push({ path: [...path, 'texts', i], type: 'text', kind: 'part', name: 'Текст', label: typeof t === 'string' || typeof t === 'number' ? clean(String(t)) : '', depth, parent }));
  }
  if (Array.isArray(o.images)) {
    o.images.forEach((m, i) => {
      const it = m && typeof m === 'object' ? m as { src?: unknown; brand?: unknown } : {};
      const src = typeof it.src === 'string' ? it.src : '';
      const label = it.brand ? 'логотип презентации' : src.startsWith('data:') ? 'встроенная' : src.split(/[/?#]/).filter(Boolean).pop() ?? '';
      out.push({ path: [...path, 'images', i], type: 'image', kind: 'part', name: 'Картинка', label, depth, parent });
    });
  }
  return out;
}

/** Поля, в которых не бывает блоков: их не обходим */
const SKIP = new Set(['styles', 'place', 'base']);

/** Поля шаблона, затем все блоки слайда по порядку: раскладка, свободные объекты, вложенные карточки и группы. */
export function collectNodes(slide: unknown): TreeNode[] {
  const out: TreeNode[] = [];
  const s = slide && typeof slide === 'object' ? slide as Record<string, unknown> : {};
  const tpl = typeof s.template === 'string' ? s.template : 'content';
  for (const f of TEMPLATES[tpl]?.fields ?? []) {
    const v = s[f.k];
    if (!SHOWN.has(f.type) || v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out.push({ path: [f.k], type: f.type, kind: 'field', name: f.label, label: fieldSnippet(v), depth: 0 });
  }
  const walk = (v: unknown, path: Seg[], depth: number) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...path, i], depth));
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const isBlock = path.length > 0 && typeof o.type === 'string';
    if (isBlock) {
      out.push({ path, type: o.type as string, kind: 'block', label: snippet(o), depth });
      if (o.type === 'html') {
        out.push(...htmlParts(o, path, depth + 1, out.length - 1));
        return;
      }
    }
    for (const [k, x] of Object.entries(o)) {
      if (!SKIP.has(k) && x && typeof x === 'object') walk(x, [...path, k], isBlock ? depth + 1 : depth);
    }
  };
  walk(slide, [], 0);
  return out;
}

/** Короткая подпись узла: первый текст блока без разметки. */
function snippet(o: Record<string, unknown>): string {
  for (const k of ['title', 'text', 'label', 'value', 'name', 'heading', 'caption']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return clean(v);
  }
  if (Array.isArray(o.header)) return o.header.filter((x) => typeof x === 'string').join(' · ').slice(0, 48);
  // Импортированная вёрстка: первые слова её текста, а если текста нет — картинка
  if (typeof o.html === 'string') {
    const text = o.html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 48);
    const alt = /<img[^>]*alt="([^"]+)"/i.exec(o.html)?.[1];
    return alt ? `картинка «${alt}»` : /<(img|svg)/i.test(o.html) ? 'картинка' : '';
  }
  return '';
}

/** Путь как в YAML: body[0].items[1] */
export function pathLabel(p: Seg[]): string {
  return p.map((s, k) => (typeof s === 'number' ? `[${s}]` : k ? `.${s}` : s)).join('');
}

const SECTION: Record<string, string> = { fields: 'Поля шаблона', body: 'Раскладка', free: 'Свободные объекты' };

/** open — блоки вёрстки, чьи части показаны */
export function treeHtml(nodes: TreeNode[], open: Set<number>): string {
  if (!nodes.length) return '<p class="st-tree-empty">На слайде нет объектов</p>';
  let section = '';
  const parts = new Set(nodes.map((n) => n.parent).filter((x) => x !== undefined));
  return nodes.map((n, k) => {
    const top = n.kind === 'field' ? 'fields' : String(n.path[0]);
    const head = top !== section ? `<div class="st-tree-sec">${esc(SECTION[top] ?? top)}</div>` : '';
    section = top;
    const name = n.name ? esc(n.name) : blockName(n.type);
    // Вёрстка с частями: стрелка показывает, раскрыта ли она (раскрывается выбором узла)
    const caret = parts.has(k) ? `<i class="st-tree-caret${open.has(k) ? ' open' : ''}" aria-hidden="true"></i>` : '';
    const hidden = n.parent !== undefined && !open.has(n.parent) ? ' hidden' : '';
    const expanded = parts.has(k) ? ` aria-expanded="${open.has(k)}"` : '';
    return head + `<button type="button" class="st-tree-node ${n.kind}" role="treeitem" data-k="${k}" style="--d:${n.depth}" title="${esc(pathLabel(n.path))}"${expanded}${hidden}>`
      + `${caret}<b>${name}</b>${n.label ? `<span>${esc(n.label)}</span>` : ''}<code>${esc(pathLabel(n.path))}</code></button>`;
  }).join('');
}

// ---------------- подсветка строк в коде ----------------

export interface Span { from: number; to: number }

/** Подсветка строк: один диапазон (объект в YAML) или несколько (правила CSS) */
export const setHighlight = StateEffect.define<Span | Span[] | null>();

export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setHighlight)) continue;
      if (!e.value) return Decoration.none;
      const doc = tr.state.doc;
      const seen = new Set<number>();
      const lines: Range<Decoration>[] = [];
      for (const r of Array.isArray(e.value) ? e.value : [e.value]) {
        const a = doc.lineAt(Math.min(r.from, doc.length)).number;
        const b = doc.lineAt(Math.min(Math.max(r.from, r.to - 1), doc.length)).number;
        for (let n = a; n <= b; n++) {
          if (seen.has(n)) continue;
          seen.add(n);
          lines.push(Decoration.line({ class: 'cm-st-hl' }).range(doc.line(n).from));
        }
      }
      deco = Decoration.set(lines, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Разбор текста кода с кэшем: диапазоны узлов по путям. */
export class YamlRanges {
  private text = '';
  private doc: Document | null = null;

  private parse(text: string): Document | null {
    if (text !== this.text) {
      this.text = text;
      try {
        const d = parseDocument(text);
        this.doc = d.errors.length ? null : d;
      } catch {
        this.doc = null;
      }
    }
    return this.doc;
  }

  range(text: string, path: Seg[]): { from: number; to: number } | null {
    const node = this.parse(text)?.getIn(path, true) as { range?: [number, number, number] } | undefined;
    return node?.range ? { from: node.range[0], to: node.range[1] } : null;
  }

  /** Самый глубокий узел, в чьих строках стоит курсор. */
  nodeAt(text: string, nodes: TreeNode[], pos: number): number {
    let best = -1;
    let size = Infinity;
    nodes.forEach((n, k) => {
      const r = this.range(text, n.path);
      if (r && pos >= r.from && pos <= r.to && r.to - r.from < size) {
        best = k;
        size = r.to - r.from;
      }
    });
    return best;
  }
}

export const treeToggleIcon = () => icon('up');

// ---------------- правила CSS выделенного объекта ----------------

export interface CssRule extends Span {
  /** Список селекторов правила как в тексте */
  sel: string;
}

/** Правила стилей с их местом в тексте; внутрь @media, @supports, @container и @layer заходим */
export function cssRules(text: string, base = 0, out: CssRule[] = []): CssRule[] {
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (!depth && start === i) start = end < 0 ? text.length : end + 2;
      i = end < 0 ? text.length : end + 1;
    } else if (c === '"' || c === "'") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '{') {
      if (!depth) open = i;
      depth++;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (!depth && open >= 0) {
        const head = text.slice(start, open);
        const lead = head.length - head.trimStart().length;
        const sel = head.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (/^@(media|supports|container|layer|document)\b/i.test(sel)) cssRules(text.slice(open + 1, i), base + open + 1, out);
        else if (sel && !sel.startsWith('@')) out.push({ sel, from: base + start + lead, to: base + i + 1 });
        start = i + 1;
        open = -1;
      }
    } else if (c === ';' && !depth) {
      start = i + 1;
    }
  }
  return out;
}

const STATE = new Set(['on', 'active', 'current', 'present', 'visible', 'show', 'shown', 'is-active']);
/** Встроенные блоки и части шаблона стили презентации не получают (как в deck-css.ts) */
const SHIELD = ':is([data-type]:not([data-type="html"]):not([data-type="embed"]):not([data-type="live"]), .tpl-part)';

/** Селектор из CSS презентации → как он действует на холсте; null — не про объекты (:root, body) */
function onCanvas(sel: string): string | null {
  if (/^(:root|html|body)(?![\w-])/i.test(sel)) return null;
  const s = sel
    .replace(/(?:section)?\.slide((?:\.[\w-]+)*)(?![\w-])/g, (_, rest: string) => `.slide-root${rest.split('.').filter((c) => c && !STATE.has(c)).map((c) => `.${c}`).join('')}`)
    // Псевдоэлементы и состояния под курсором: правило всё равно про этот элемент
    .replace(/::?(before|after|first-line|first-letter|placeholder|marker|selection|backdrop|file-selector-button)\b(\([^)]*\))?/gi, '')
    .replace(/::[\w-]+(\([^)]*\))?/g, '')
    .replace(/:(hover|focus|focus-visible|focus-within|active|visited|target|checked)\b/gi, '')
    .trim();
  // Правило «для всего подряд» (*, .slide *) — не про этот объект
  return s && !/(^|[\s>+~])\*$/.test(s) ? s : null;
}

/** Правила, которые задают вид элемента или того, что внутри него */
export function rulesFor(rules: CssRule[], el: Element): CssRule[] {
  return rules.filter((r) => r.sel.split(',').some((part) => {
    const s = onCanvas(part.trim());
    if (!s) return false;
    try {
      if (el.matches(s) && !el.closest(SHIELD)) return true;
      for (const x of el.querySelectorAll(s)) if (!x.closest(SHIELD)) return true;
    } catch { /* селектор, которого браузер не знает */ }
    return false;
  }));
}
