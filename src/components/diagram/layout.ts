/**
 * Раскладка блок-схемы по слоям (как у Graphviz dot, упрощённо): циклы разворачиваются, узлы — по рангам
 * (длиннейший путь от начала), длинные стрелки идут через промежуточные точки, порядок в слое —
 * по средним соседей (меньше пересечений), место в слое — ближе к соседям без наложений.
 * Всё в пикселях «как нарисовано»: вёрстка потом масштабирует диаграмму целиком
 */
import type { Flow, FlowNode, Shape } from './parse';

export interface Size { w: number; h: number }
export interface PlacedNode extends FlowNode { x: number; y: number; w: number; h: number }
export interface PlacedEdge { from: string; to: string; text: string; dashed: boolean; points: [number, number][]; label: [number, number] | null; back: boolean }
export interface FlowLayout { nodes: PlacedNode[]; edges: PlacedEdge[]; w: number; h: number }

/** Размер узла по тексту (оценка ширины букв): текст переносится на ширине до maxW */
export function measure(text: string, shape: Shape, font = 15, maxW = 190): Size {
  if (shape === 'dot') return { w: 22, h: 22 };
  const words = text.split(/\s+/).filter(Boolean);
  // Кириллица и полужирный — шире латиницы: оценка с запасом, иначе текст вылезает из рамки
  const cw = font * 0.62;
  const lines: number[] = [];
  let cur = 0;
  for (const w of words) {
    const len = w.length * cw;
    if (cur && cur + cw + len > maxW) { lines.push(cur); cur = len; } else cur = cur ? cur + cw + len : len;
  }
  lines.push(cur);
  const tw = Math.min(maxW, Math.max(...lines, font * 2));
  const th = lines.length * font * 1.3;
  let w = tw + 34;
  let h = th + 24;
  if (shape === 'diamond') { w = w * 1.45 + 10; h = Math.max(h * 1.6, w * 0.55); }
  if (shape === 'circle') { const d = Math.max(w, h) + 6; w = d; h = d; }
  if (shape === 'data') w += 20;
  return { w: Math.round(w), h: Math.round(h) };
}

interface V { id: string; dummy: boolean; w: number; h: number; rank: number; order: number; x: number; y: number }

export function layoutFlow(flow: Flow, size: (n: FlowNode) => Size = (n) => measure(n.text, n.shape)): FlowLayout {
  const right = flow.dir === 'right';
  // Для «вправо» считаем как «вниз» с перевёрнутыми размерами, в конце меняем оси
  const sz = (n: FlowNode) => { const s = size(n); return right ? { w: s.h, h: s.w } : s; };
  const V = new Map<string, V>();
  flow.nodes.forEach((n) => { const s = sz(n); V.set(n.id, { id: n.id, dummy: false, w: s.w, h: s.h, rank: 0, order: 0, x: 0, y: 0 }); });
  const edges = flow.edges.filter((e) => V.has(e.from) && V.has(e.to));

  // 1. Циклы: обратные рёбра (к узлу на стеке обхода) разворачиваем на время раскладки
  const back = new Set<number>();
  const state = new Map<string, 0 | 1 | 2>();
  const out = (id: string) => edges.map((e, i) => [e, i] as const).filter(([e]) => e.from === id);
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const [e, i] of out(id)) {
      if (e.from === e.to) continue;
      const s = state.get(e.to) ?? 0;
      if (s === 1) back.add(i);
      else if (s === 0) dfs(e.to);
    }
    state.set(id, 2);
  };
  const incoming = new Set(edges.map((e) => e.to));
  // Сначала — от узлов без входящих (начало), потом остальные
  for (const n of [...flow.nodes.filter((x) => !incoming.has(x.id)), ...flow.nodes]) if (!state.get(n.id)) dfs(n.id);
  const dag = edges.map((e, i) => (back.has(i) ? { ...e, from: e.to, to: e.from, i } : { ...e, i })).filter((e) => e.from !== e.to);

  // 2. Ранги: длиннейший путь от начала (Кан)
  const indeg = new Map<string, number>([...V.keys()].map((k) => [k, 0]));
  dag.forEach((e) => indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1));
  const queue = [...V.keys()].filter((k) => !indeg.get(k));
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of dag.filter((x) => x.from === id)) {
      V.get(e.to)!.rank = Math.max(V.get(e.to)!.rank, V.get(id)!.rank + 1);
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (!indeg.get(e.to)) queue.push(e.to);
    }
  }

  // 3. Длинные рёбра — через промежуточные точки в каждом слое
  const chains = new Map<number, string[]>();
  const links: [string, string][] = [];
  let dn = 0;
  for (const e of dag) {
    const a = V.get(e.from)!;
    const b = V.get(e.to)!;
    const chain = [e.from];
    for (let r = a.rank + 1; r < b.rank; r++) {
      const id = `~${dn++}`;
      V.set(id, { id, dummy: true, w: 2, h: 2, rank: r, order: 0, x: 0, y: 0 });
      chain.push(id);
    }
    chain.push(e.to);
    for (let k = 0; k + 1 < chain.length; k++) links.push([chain[k], chain[k + 1]]);
    chains.set(e.i, chain);
  }
  const ranks = Math.max(0, ...[...V.values()].map((v) => v.rank)) + 1;
  const layers: V[][] = Array.from({ length: ranks }, () => []);
  // Порядок появления в тексте — начальный порядок в слое
  [...V.values()].forEach((v) => layers[v.rank].push(v));
  layers.forEach((l) => l.forEach((v, k) => (v.order = k)));
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const [a, b] of links) { (down.get(a) ?? down.set(a, []).get(a)!).push(b); (up.get(b) ?? up.set(b, []).get(b)!).push(a); }

  // 4. Порядок в слое: по среднему месту соседей, несколько проходов вниз и вверх
  const bary = (v: V, nb: Map<string, string[]>) => {
    const ns = nb.get(v.id) ?? [];
    return ns.length ? ns.reduce((s, id) => s + V.get(id)!.order, 0) / ns.length : v.order;
  };
  for (let it = 0; it < 6; it++) {
    const seq = it % 2 === 0 ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const l of seq) {
      const key = new Map(l.map((v) => [v.id, bary(v, it % 2 === 0 ? up : down)]));
      l.sort((p, q) => key.get(p.id)! - key.get(q.id)! || p.order - q.order);
      l.forEach((v, k) => (v.order = k));
    }
  }

  // 5. Координаты: слои сверху вниз; в слое — ближе к соседям, без наложений
  const GX = 44;
  // Вниз слои ближе (схема и так высокая), вправо — шире: там между слоями подписи стрелок
  const GY = right ? 64 : 46;
  // Между слоями — место под подписи стрелок: вправо — по их ширине, вниз — по высоте строки
  const gapAfter = layers.map((_l, r) => {
    const texts = dag.filter((e) => e.text && V.get(e.from)!.rank <= r && V.get(e.to)!.rank > r).map((e) => e.text.length * 13 * 0.56 + 18);
    if (!texts.length) return GY;
    return right ? Math.max(GY, Math.max(...texts) + 40) : GY + 16;
  });
  let y = 0;
  for (const [r, l] of layers.entries()) {
    const h = Math.max(...l.map((v) => v.h));
    l.forEach((v) => (v.y = y + h / 2));
    y += h + gapAfter[r];
    let x = 0;
    l.forEach((v) => { v.x = x + v.w / 2; x += v.w + GX; });
  }
  const place = (l: V[], nb: Map<string, string[]>) => {
    const want = l.map((v) => { const ns = nb.get(v.id) ?? []; return ns.length ? ns.reduce((s, id) => s + V.get(id)!.x, 0) / ns.length : v.x; });
    // Слева направо: не ближе соседа, но к желаемому месту
    l.forEach((v, k) => { v.x = k ? Math.max(want[k], l[k - 1].x + l[k - 1].w / 2 + GX + v.w / 2) : want[k]; });
    // Справа налево: сдвигаем обратно, если ушли правее желаемого, пока не упрёмся
    for (let k = l.length - 2; k >= 0; k--) {
      const lim = l[k + 1].x - l[k + 1].w / 2 - GX - l[k].w / 2;
      if (l[k].x > lim) l[k].x = lim;
      else if (l[k].x < want[k]) l[k].x = Math.min(want[k], lim);
    }
  };
  for (let it = 0; it < 4; it++) {
    for (const l of layers.slice(1)) place(l, up);
    for (const l of layers.slice(0, -1).reverse()) place(l, down);
  }
  const all = [...V.values()];
  const minX = Math.min(...all.map((v) => v.x - v.w / 2));
  all.forEach((v) => (v.x -= minX));
  let W = Math.max(...all.map((v) => v.x + v.w / 2));
  let H = y - gapAfter[layers.length - 1];

  // 6. Стрелки: от края узла через промежуточные точки к краю узла; подпись — посередине пути
  const nodeAt = (id: string) => V.get(id)!;
  const shapeOf = new Map(flow.nodes.map((n) => [n.id, n.shape]));
  const edge = (from: string, to: string, i: number) => {
    const chain = chains.get(i) ?? [from, to];
    let pts = chain.map((id) => [nodeAt(id).x, nodeAt(id).y] as [number, number]);
    pts[0] = border(nodeAt(chain[0]), shapeOf.get(chain[0])!, pts[1]);
    pts[pts.length - 1] = border(nodeAt(chain[chain.length - 1]), shapeOf.get(chain[chain.length - 1])!, pts[pts.length - 2]);
    if (back.has(i)) pts = pts.reverse();
    return pts;
  };
  const placedEdges: PlacedEdge[] = edges.map((e, i) => {
    if (e.from === e.to) {
      // Петля — справа от узла
      const v = nodeAt(e.from);
      const pts: [number, number][] = [[v.x + v.w / 2, v.y - 8], [v.x + v.w / 2 + 30, v.y - 18], [v.x + v.w / 2 + 30, v.y + 18], [v.x + v.w / 2, v.y + 8]];
      W = Math.max(W, v.x + v.w / 2 + 40);
      return { ...e, points: pts, label: e.text ? [v.x + v.w / 2 + 34, v.y] : null, back: false };
    }
    const pts = edge(e.from, e.to, i);
    return { ...e, points: pts, label: e.text ? mid(pts) : null, back: back.has(i) };
  });
  let nodes: PlacedNode[] = flow.nodes.map((n) => { const v = V.get(n.id)!; return { ...n, x: v.x, y: v.y, w: v.w, h: v.h }; });
  let outEdges = placedEdges;
  if (right) {
    const sw = (p: [number, number]): [number, number] => [p[1], p[0]];
    nodes = nodes.map((n) => ({ ...n, x: n.y, y: n.x, w: n.h, h: n.w }));
    outEdges = placedEdges.map((e) => ({ ...e, points: e.points.map(sw), label: e.label ? sw(e.label) : null }));
    [W, H] = [H, W];
  }
  return { nodes, edges: outEdges, w: Math.ceil(W), h: Math.ceil(H) };
}

/** Точка на краю узла по направлению к точке p: прямоугольник, ромб или эллипс */
function border(v: { x: number; y: number; w: number; h: number }, shape: Shape, p: [number, number]): [number, number] {
  const dx = p[0] - v.x;
  const dy = p[1] - v.y;
  if (!dx && !dy) return [v.x, v.y];
  const a = v.w / 2;
  const b = v.h / 2;
  let t: number;
  if (shape === 'diamond') t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else if (shape === 'circle' || shape === 'dot') t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  else t = Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
  return [v.x + dx * t, v.y + dy * t];
}

/** Середина ломаной по длине */
function mid(pts: [number, number][]): [number, number] {
  const seg = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]));
  let half = seg.reduce((s, x) => s + x, 0) / 2;
  for (let k = 0; k < seg.length; k++) {
    if (half <= seg[k]) { const f = seg[k] ? half / seg[k] : 0; return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f]; }
    half -= seg[k];
  }
  return pts[0];
}
