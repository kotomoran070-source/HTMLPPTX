import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { parseDocument, type Document } from 'yaml';
import { icon } from '../components/icons';
import { blockName } from '../engine/editor/block-edit';
import { esc } from '../engine/html';

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
}

/** Поля, в которых не бывает блоков: их не обходим */
const SKIP = new Set(['styles', 'place', 'base']);

/** Все блоки слайда по порядку: раскладка, свободные объекты, вложенные карточки и группы. */
export function collectNodes(slide: unknown): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (v: unknown, path: Seg[], depth: number) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...path, i], depth));
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const isBlock = path.length > 0 && typeof o.type === 'string';
    if (isBlock) out.push({ path, type: o.type as string, label: snippet(o), depth });
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
    if (typeof v === 'string' && v.trim()) {
      return v.replace(/\{[^|}]*\|([^}]*)\}/g, '$1').replace(/[*_`[\]#]/g, '').replace(/\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
    }
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

const SECTION: Record<string, string> = { body: 'Раскладка', free: 'Свободные объекты' };

export function treeHtml(nodes: TreeNode[]): string {
  if (!nodes.length) return '<p class="st-tree-empty">На слайде нет блоков: только поля шаблона</p>';
  let section = '';
  return nodes.map((n, k) => {
    const top = String(n.path[0]);
    const head = top !== section ? `<div class="st-tree-sec">${esc(SECTION[top] ?? top)}</div>` : '';
    section = top;
    return head + `<button type="button" class="st-tree-node" role="treeitem" data-k="${k}" style="--d:${n.depth}" title="${esc(pathLabel(n.path))}">`
      + `<b>${blockName(n.type)}</b>${n.label ? `<span>${esc(n.label)}</span>` : ''}<code>${esc(pathLabel(n.path))}</code></button>`;
  }).join('');
}

// ---------------- подсветка строк в коде ----------------

export const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setHighlight)) continue;
      if (!e.value) return Decoration.none;
      const doc = tr.state.doc;
      const a = doc.lineAt(Math.min(e.value.from, doc.length)).number;
      const b = doc.lineAt(Math.min(Math.max(e.value.from, e.value.to - 1), doc.length)).number;
      const lines: Range<Decoration>[] = [];
      for (let n = a; n <= b; n++) lines.push(Decoration.line({ class: 'cm-st-hl' }).range(doc.line(n).from));
      deco = Decoration.set(lines);
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
