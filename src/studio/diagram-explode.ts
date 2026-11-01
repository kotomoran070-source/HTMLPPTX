/**
 * «Разобрать» диаграмму из текста (components/diagram) на обычные объекты слайда — по тому, как она
 * нарисована. Блок-схема и состояния: узлы — фигурами с текстом, стрелки — соединителями (следуют за
 * фигурами, подписи и пунктир сохраняются). Последовательность: участники — фигурами, линии жизни —
 * пунктиром, сообщения — стрелками с подписями, заметки и разделы — плашками
 */
import { parseFlow } from '../components/diagram/parse';
import type { TextStyle } from '../engine/text-style';
import type { Block } from '../types';

type Box = { x: number; y: number; w: number; h: number };

export interface Kit {
  /** Рамка элемента в пикселях слайда */
  rect(el: Element): Box;
  /** Оформление текста с отрисованного элемента: размер, цвет темы, насыщенность… */
  textStyle(el: HTMLElement): TextStyle;
  /** Цвет с отрисованного элемента: цвет темы по имени, иначе #RRGGBB */
  color(c: string, el: HTMLElement): string | null;
  /** Имена объектов, уже занятые на слайде */
  used: Set<unknown>;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Текст как в данных: служебные знаки разметки — буквально */
const lit = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/([\\*_[\]{])/g, '\\$1');
/** Текст подписи без номера сообщения */
const ownText = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.sq-num').forEach((x) => x.remove());
  return c.textContent ?? '';
};

/** Любой цвет CSS (color-mix, oklab…) → rgba(): так его понимает подбор цвета темы */
function rgbOf(c: string): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) return c;
  g.fillStyle = c;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${gr}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
}

/** Внутренний отступ текста — как у исходного элемента (у фигуры свой, крупнее: подпись переносилась бы) */
function padOf(el: HTMLElement, r: Box): string {
  const k = r.w / (el.offsetWidth || r.w);
  return `padding:0 ${Math.round((parseFloat(getComputedStyle(el).paddingLeft) || 0) * k * 0.8)}px`;
}

export function diagramParts(root: HTMLElement, kit: Kit, src: { code?: unknown; kind?: unknown; dir?: unknown } = {}): Block[] {
  const flow = root.querySelector<HTMLElement>('.dgm-flow');
  if (flow) {
    const dir = parseFlow(String(src.code ?? ''), src.kind === 'state' ? 'state' : 'flow', src.dir as never).dir;
    return flowParts(flow, kit, dir === 'right');
  }
  const seq = root.querySelector<HTMLElement>('.dgm-seq');
  return seq ? sequenceParts(seq, kit) : [];
}

/** Фигура с текстом: шрифт — как на слайде, по умолчанию у фигуры текст жирный — насыщенность всегда своя */
const withText = (b: Block, text: string, st: TextStyle, pad = 'padding:0'): Block => {
  if (!text.trim()) return b;
  b.text = lit(text);
  b.styles = { text: { ...st, weight: st.weight ?? 400 } };
  b.style = pad;
  return b;
};

function flowParts(flow: HTMLElement, kit: Kit, across: boolean): Block[] {
  const state = flow.classList.contains('state');
  const ids = new Map<string, string>();
  const name = (): string => {
    let n = 1;
    while (kit.used.has(`node-${n}`)) n++;
    kit.used.add(`node-${n}`);
    return `node-${n}`;
  };
  const nodes: Block[] = [];
  const boxes = new Map<string, Box>();
  for (const n of flow.querySelectorAll<HTMLElement>(':scope > .fl-n')) {
    const id = n.dataset.id;
    if (!id) continue;
    const r = kit.rect(n);
    boxes.set(id, r);
    const span = n.querySelector<HTMLElement>(':scope > span');
    const st = span ? kit.textStyle(span) : {};
    const fs = Number(st.size) || 15;
    const line = { stroke: 'accent', width: 1.5 };
    const shape = ['round', 'circle', 'diamond', 'data', 'dot'].find((c) => n.classList.contains(c)) ?? 'rect';
    const look: Block = shape === 'diamond' ? { type: 'shape', kind: 'diamond', fill: 'soft', ...line }
      : shape === 'data' ? { type: 'shape', kind: 'parallelogram', fill: 'surface', ...line }
        : shape === 'circle' ? { type: 'shape', kind: 'ellipse', fill: 'soft', ...line }
          : shape === 'dot' ? { type: 'shape', kind: 'ellipse', fill: 'text' }
            : shape === 'round' ? { type: 'shape', kind: 'rect', radius: Math.round(Math.min(r.h / 2, fs * (state ? 0.9 : 1.4))), fill: state ? 'surface' : 'soft', ...line }
              : { type: 'shape', kind: 'rect', radius: Math.round(fs * 0.4), fill: 'surface', ...line };
    const obj = name();
    ids.set(id, obj);
    look.id = obj;
    // Без своего отступа фигуры: маленький кружок начала не растягивается в овал
    look.style = 'padding:0';
    look.place = { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) };
    nodes.push(span ? withText(look, span.textContent ?? '', st, shape === 'diamond' || shape === 'data' ? 'padding:0' : padOf(n, r)) : look);
  }
  // Стрелки — соединителями под узлами: подпись — по номеру стрелки (--k)
  const labels = new Map([...flow.querySelectorAll<HTMLElement>(':scope > .fl-l')].map((l) => [l.style.getPropertyValue('--k').trim(), l.textContent ?? '']));
  const conns: Block[] = [];
  const fr = kit.rect(flow);
  const c0 = across ? fr.y + fr.h / 2 : fr.x + fr.w / 2;
  flow.querySelectorAll<SVGPathElement>('path.fl-e').forEach((p) => {
    const from = ids.get(p.dataset.from ?? '');
    const to = ids.get(p.dataset.to ?? '');
    if (!from || !to || from === to) return;
    const c: Block = { type: 'connector', from, to, width: 2 };
    // Обратная стрелка (против хода схемы) — скобкой сбоку, а не поверх прямых стрелок
    const a = boxes.get(p.dataset.from!)!;
    const b = boxes.get(p.dataset.to!)!;
    const mid = (q: Box) => (across ? [q.x + q.w / 2, q.y + q.h / 2] : [q.y + q.h / 2, q.x + q.w / 2]);
    const [ma, sa] = mid(a);
    const [mb, sb] = mid(b);
    if (ma > mb + 1) {
      const out = (sa + sb) / 2 >= c0;
      c.fromSide = c.toSide = across ? (out ? 'bottom' : 'top') : (out ? 'right' : 'left');
    }
    if (p.classList.contains('dashed')) c.dash = 'dash';
    const text = labels.get(p.style.getPropertyValue('--k').trim());
    if (text?.trim()) c.text = lit(text);
    conns.push(c);
  });
  return [...conns, ...nodes];
}

function sequenceParts(seq: HTMLElement, kit: Kit): Block[] {
  const under: Block[] = [];
  const mid: Block[] = [];
  const top: Block[] = [];
  /** Линия от точки до точки: горизонтальная или вертикальная (повёрнутая на 90°) */
  const line = (x: number, y: number, len: number, vertical: boolean, extra: Partial<Block> = {}): Block => ({
    type: 'shape', kind: 'line', stroke: 'border', width: 2, ...extra,
    place: vertical ? { x: r1(x - len / 2), y: r1(y + len / 2 - 6), w: r1(len), h: 12 } : { x: r1(x), y: r1(y - 6), w: r1(len), h: 12 },
    ...(vertical ? { rotate: 90 } : {}),
  } as Block);
  /** Стрелка сообщения: вправо или влево (повёрнута на 180°) */
  const arrow = (x: number, y: number, len: number, left: boolean, dashed: boolean): Block => ({
    type: 'shape', kind: 'arrow', stroke: dashed ? 'muted' : 'accent', width: 2, ...(dashed ? { dash: 'dash' } : {}),
    place: { x: r1(x), y: r1(y - 8), w: r1(len), h: 16 }, ...(left ? { rotate: 180 } : {}),
  } as Block);
  /** Подпись сообщения и его номер */
  const caption = (lbl: HTMLElement | null, num: HTMLElement | null) => {
    if (num) {
      const r = kit.rect(num);
      top.push(withText({ type: 'shape', kind: 'pill', fill: 'accent', place: { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) } }, num.textContent ?? '', kit.textStyle(num)));

    }
    const text = lbl ? ownText(lbl).trim() : '';
    if (!lbl || !text) return;
    const r = kit.rect(lbl);
    const st = kit.textStyle(lbl);
    // Номер слева от текста: надпись — правее него
    const nr = num && lbl.contains(num) ? kit.rect(num) : null;
    const x0 = nr ? nr.x + nr.w + 4 : r.x;
    const w0 = r.x + r.w - x0;
    // С запасом по ширине: другой шрифт при выгрузке не переносит подпись на вторую строку
    const w = w0 * 1.1 + 8;
    top.push({ type: 'text', text: lit(text), place: { x: r1(x0 - (w - w0) / 2), y: r1(r.y), w: r1(w) }, styles: { text: { ...st, align: 'center' } } });
  };

  // Линии жизни — пунктиром на всю высоту
  for (const l of seq.querySelectorAll<HTMLElement>('.sq-life')) {
    const r = kit.rect(l);
    under.push(line(r.x + r.w / 2, r.y, r.h, true, { stroke: 'border', dash: 'dash' }));
  }
  for (const p of seq.querySelectorAll<HTMLElement>('.sq-p')) {
    const r = kit.rect(p);
    const span = p.querySelector<HTMLElement>(':scope > span');
    const b: Block = { type: 'shape', kind: 'rect', radius: 12, fill: p.classList.contains('actor') ? 'soft' : 'surface', stroke: 'accent', width: 1.5, shadow: 'sm', place: { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) } };
    mid.push(span ? withText(b, span.textContent ?? '', kit.textStyle(span), padOf(p, r)) : b);
  }
  // Сообщения — сверху вниз; самому себе — петля из двух линий и стрелки обратно к линии жизни
  for (const m of seq.querySelectorAll<HTMLElement>('.sq-msg, .sq-self')) {
    const dashed = m.classList.contains('dashed');
    if (m.classList.contains('sq-msg')) {
      const ln = m.querySelector<HTMLElement>('.sq-line');
      if (!ln) continue;
      const r = kit.rect(ln);
      mid.push(arrow(r.x, r.y + r.h / 2, r.w, m.classList.contains('l'), dashed));
    } else {
      const loop = m.querySelector<HTMLElement>('.sq-loop');
      if (!loop) continue;
      const r = kit.rect(loop);
      const look = { stroke: dashed ? 'muted' : 'accent', ...(dashed ? { dash: 'dash' } : {}) };
      mid.push(line(r.x, r.y + 1, r.w, false, look), line(r.x + r.w - 1, r.y, r.h, true, look), arrow(r.x, r.y + r.h - 1, r.w, true, dashed));
    }
    caption(m.querySelector('.sq-lbl'), m.querySelector('.sq-num'));
  }
  for (const n of seq.querySelectorAll<HTMLElement>('.sq-note')) {
    const r = kit.rect(n);
    const cs = getComputedStyle(n);
    // Заметка — своего жёлтого цвета, как на схеме в этой теме
    top.push(withText({ type: 'shape', kind: 'rect', radius: 8, fill: kit.color(rgbOf(cs.backgroundColor), n) ?? 'alt', stroke: kit.color(rgbOf(cs.borderTopColor), n) ?? 'border', width: 1,
      place: { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) } }, n.textContent ?? '', kit.textStyle(n), padOf(n, r)));
  }
  // Раздел: линия через всю схему и плашка с названием
  for (const d of seq.querySelectorAll<HTMLElement>('.sq-div')) {
    const r = kit.rect(d);
    under.push(line(r.x, r.y + r.h / 2, r.w, false, { width: 1 }));
    const span = d.querySelector<HTMLElement>(':scope > span');
    if (!span) continue;
    const sr = kit.rect(span);
    top.push(withText({ type: 'shape', kind: 'pill', fill: 'surface', stroke: 'border', width: 1, place: { x: r1(sr.x), y: r1(sr.y), w: r1(sr.w), h: r1(sr.h) } }, span.textContent ?? '', kit.textStyle(span), padOf(span, sr)));
  }
  return [...under, ...mid, ...top];
}
