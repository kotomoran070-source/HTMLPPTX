/**
 * Диаграмма из текста: последовательность (кто кому что передаёт), блок-схема и схема состояний.
 * Текст — в поле code (как писать — parse.ts), вид — kind. Рисуется в цветах темы и масштабируется
 * вместе с объектом. Сообщения и узлы появляются по очереди; под мышью — подсветка пути.
 */
import { defineBlock } from '../../engine/component';
import { esc, styleAttr } from '../../engine/html';
import type { Block } from '../../types';
import { icon } from '../icons';
import { layoutFlow, type FlowLayout } from './layout';
import { parseFlow, parseSequence, type Sequence } from './parse';
import './diagram.css';

export interface DiagramProps extends Block {
  /** sequence — последовательность (по умолчанию), flow — блок-схема, state — состояния */
  kind?: 'sequence' | 'flow' | 'state';
  /** Текст диаграммы — строками (см. parse.ts) */
  code?: string;
  /** Раскладка схемы: down — сверху вниз, right — слева направо */
  dir?: 'down' | 'right';
}

const r = (v: number) => Math.round(v * 100) / 100;
/** Текст подписи: **жирный** и переносы — как в остальных подписях, без разметки блоков */
const txt = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\\n/g, '<br>');

// ---------------- последовательность ----------------

/** Наконечник стрелки — SVG (уходит в PowerPoint картинкой; треугольник рамкой CSS туда не попадает) */
const HEAD = '<svg class="sq-head" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0 10 5 0 10z"/></svg>';

function sequenceHtml(sq: Sequence): string {
  const n = Math.max(1, sq.participants.length);
  const c = (k: number) => r(((k + 0.5) / n) * 100);
  const heads = sq.participants.map((p, k) =>
    `<div class="sq-p${p.actor ? ' actor' : ''}" style="--k:${k}">${p.actor ? `<i class="sq-man">${icon('users')}</i>` : ''}<span>${txt(p.name)}</span></div>`).join('');
  const lifelines = sq.participants.map((_p, k) => `<i class="sq-life" style="left:${c(k)}%;--k:${k}"></i>`).join('');
  let k = 0;
  const rows = sq.steps.map((s) => {
    const d = k++;
    if (s.kind === 'div') return `<div class="sq-div" style="--k:${d}"><span>${txt(s.text)}</span></div>`;
    if (s.kind === 'note') {
      const lo = Math.min(...s.over);
      const hi = Math.max(...s.over);
      // Над одним участником — шириной в его колонку, над несколькими — от первого до последнего
      const left = r((lo / n) * 100 + 100 / n * 0.1);
      const width = r(((hi - lo + 1) / n) * 100 - 100 / n * 0.2);
      return `<div class="sq-row" style="--k:${d}"><div class="sq-note" style="left:${left}%;width:${width}%">${txt(s.text)}</div></div>`;
    }
    const num = sq.numbered ? `<b class="sq-num">${s.n}</b>` : '';
    if (s.from === s.to) {
      return `<div class="sq-row self" style="--k:${d}"><div class="sq-self${s.dashed ? ' dashed' : ''}" style="left:${c(s.from)}%">${num}<span class="sq-lbl">${txt(s.text)}</span><i class="sq-loop">${HEAD}</i></div></div>`;
    }
    const a = Math.min(c(s.from), c(s.to));
    const w = r(Math.abs(c(s.to) - c(s.from)));
    const dir = s.to > s.from ? 'r' : 'l';
    return `<div class="sq-row" style="--k:${d}"><div class="sq-msg ${dir}${s.dashed ? ' dashed' : ''}" style="left:${a}%;width:${w}%">`
      + `<span class="sq-lbl">${num}${txt(s.text)}</span><i class="sq-line">${HEAD}</i></div></div>`;
  }).join('');
  return `<div class="dgm dgm-seq" style="--n:${n}"><div class="sq-heads">${heads}</div><div class="sq-body">${lifelines}${rows}</div></div>`;
}

// ---------------- блок-схема и состояния ----------------

/** Ломаная со скруглёнными изломами: на промежуточных точках — плавный поворот */
function path(pts: [number, number][]): string {
  if (pts.length < 3) return `M${pts.map((p) => `${r(p[0])} ${r(p[1])}`).join('L')}`;
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`;
  for (let k = 1; k < pts.length - 1; k++) {
    const [p, q, s] = [pts[k - 1], pts[k], pts[k + 1]];
    const m1 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const m2 = [(q[0] + s[0]) / 2, (q[1] + s[1]) / 2];
    d += `L${r(m1[0])} ${r(m1[1])}Q${r(q[0])} ${r(q[1])} ${r(m2[0])} ${r(m2[1])}`;
  }
  const z = pts[pts.length - 1];
  return `${d}L${r(z[0])} ${r(z[1])}`;
}

/** Ромб и «данные» — многоугольником SVG: рамкой CSS их не нарисовать, а псевдоэлементы не уходят в PowerPoint */
const SHAPES: Partial<Record<string, string>> = { diamond: '50,1 99,50 50,99 1,50', data: '12,1 99,1 88,99 1,99' };

export function flowHtml(lay: FlowLayout, uid: string, kind: 'flow' | 'state', boxH = 0): string {
  const PAD = 14;
  const W = lay.w + PAD * 2;
  const H = lay.h + PAD * 2;
  const X = (v: number) => r(((v + PAD) / W) * 100);
  const Y = (v: number) => r(((v + PAD) / H) * 100);
  const edges = lay.edges.map((e, k) => {
    const pts = e.points.map((p) => [p[0] + PAD, p[1] + PAD] as [number, number]);
    return `<path class="fl-e${e.dashed ? ' dashed' : ''}" d="${path(pts)}" marker-end="url(#${uid}h)" data-from="${esc(e.from)}" data-to="${esc(e.to)}" style="--k:${k}"/>`;
  }).join('');
  const labels = lay.edges.map((e, k) => (e.label && e.text
    ? `<span class="fl-l" style="left:${X(e.label[0])}%;top:${Y(e.label[1])}%;--k:${k}" data-from="${esc(e.from)}" data-to="${esc(e.to)}">${txt(e.text)}</span>` : '')).join('');
  const nodes = lay.nodes.map((n, k) =>
    `<div class="fl-n ${n.shape}" data-id="${esc(n.id)}" style="left:${X(n.x)}%;top:${Y(n.y)}%;width:${r((n.w / W) * 100)}%;height:${r((n.h / H) * 100)}%;--k:${k}">`
    + (SHAPES[n.shape] ? `<svg class="fl-sh" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="${SHAPES[n.shape]}"/></svg>` : '')
    + (n.shape === 'dot' ? '' : `<span>${txt(n.text)}</span>`) + `</div>`).join('');
  // Размер букв — от ширины блока (cqw): диаграмма масштабируется целиком, как картинка
  // Не крупнее 1,2 от естественного размера: широкий объект не раздувает маленькую схему;
  // у объекта с заданной высотой — ещё и вписана в неё
  const cap = Math.round(Math.min(W * 1.2, boxH > 40 ? (boxH * W) / H : Infinity));
  return `<div class="dgm-fit" style="max-width:${cap}px"><div class="dgm dgm-flow ${kind}" style="aspect-ratio:${W} / ${H};--fw:${W}">`
    + `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="${uid}h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 9 5 0 9z"/></marker></defs>${edges}</svg>`
    + `${nodes}${labels}</div></div>`;
}

defineBlock<DiagramProps>('diagram', {
  render(p, ctx) {
    const kind = p.kind === 'flow' || p.kind === 'state' ? p.kind : 'sequence';
    if (!String(p.code ?? '').trim()) return `<div class="block-error">diagram: напишите текст диаграммы в поле code</div>`;
    if (kind === 'sequence') {
      const sq = parseSequence(p.code);
      if (!sq.participants.length) return `<div class="block-error">diagram: нет ни одного сообщения — пишите «Клиент -> Сервер: запрос»</div>`;
      return `<div class="dgm-wrap r"${styleAttr(p.style)}>${sequenceHtml(sq)}</div>`;
    }
    const flow = parseFlow(p.code, kind, p.dir);
    if (!flow.nodes.length) return `<div class="block-error">diagram: нет ни одного узла — пишите «[Начало] -> [Шаг]»</div>`;
    const h = Number((p as { place?: { h?: unknown } }).place?.h) || 0;
    return `<div class="dgm-wrap r"${styleAttr(p.style)}>${flowHtml(layoutFlow(flow), ctx.uid('dg'), kind, h)}</div>`;
  },
  mount(el) {
    // Узел под мышью — с его стрелками и соседями, остальное бледнее
    const over = (e: Event) => {
      const flow = el.querySelector<HTMLElement>('.dgm-flow');
      if (!flow) return;
      const n = (e.target as Element).closest<HTMLElement>('.fl-n');
      const id = n?.dataset.id;
      flow.classList.toggle('hl', !!id);
      flow.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
      if (!id) return;
      n!.classList.add('hl');
      flow.querySelectorAll<HTMLElement | SVGElement>('[data-from]').forEach((x) => {
        const on = x.dataset.from === id || x.dataset.to === id;
        x.classList.toggle('hl', on);
        if (on) flow.querySelector(`.fl-n[data-id="${CSS.escape(x.dataset.from === id ? x.dataset.to! : x.dataset.from!)}"]`)?.classList.add('hl');
      });
    };
    const leave = () => { const f = el.querySelector('.dgm-flow'); f?.classList.remove('hl'); f?.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl')); };
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointerover', over); el.removeEventListener('pointerleave', leave); };
  },
});
