/**
 * Геометрия соединителя между двумя прямоугольниками (в пикселях слайда), без вёрстки.
 * Стороны выбираются по взаимному положению: дальше по горизонтали — справа налево, по вертикали — снизу
 * вверх. Прямая — от края к краю по линии центров, ломаная — под прямыми углами через середину,
 * кривая — плавно из сторон наружу
 */
export interface Box { x: number; y: number; w: number; h: number; /** Овал: прямая подходит к контуру, а не к рамке */ oval?: boolean }
export type Route = 'straight' | 'elbow' | 'curve';
export type Pt = [number, number];
export interface Geo {
  /** Опорные точки: ломаная — все изломы; кривая — начало, две управляющие и конец */
  pts: Pt[];
  route: Route;
  /** Середина пути — для подписи */
  mid: Pt;
  /** Рамка пути с запасом под наконечники и толщину */
  box: Box;
}

const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;

/** Точка на краю прямоугольника по направлению к точке p */
function edge(b: Box, p: Pt): Pt {
  const dx = p[0] - cx(b);
  const dy = p[1] - cy(b);
  if (!dx && !dy) return [cx(b), cy(b)];
  const t = b.oval ? 1 / Math.hypot(dx / (b.w / 2 || 1), dy / (b.h / 2 || 1)) : Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return [cx(b) + dx * t, cy(b) + dy * t];
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
const NORM: Record<Side, Pt> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
export const SIDES = Object.keys(NORM) as Side[];
/** Середина стороны прямоугольника */
const port = (b: Box, s: Side): Pt => (s === 'top' ? [cx(b), b.y] : s === 'bottom' ? [cx(b), b.y + b.h] : s === 'left' ? [b.x, cy(b)] : [b.x + b.w, cy(b)]);
/** Отступ ломаной от объектов, когда она обходит их с одной стороны */
const AROUND = 28;

/**
 * Путь от a к b. sides — стороны, от которой и к которой идёт линия (иначе — по взаимному положению):
 * одна и та же сторона у обоих — линия обходит их скобкой (обратная стрелка схемы)
 */
export function connect(a: Box, b: Box, route: Route = 'elbow', pad = 14, sides: { from?: Side; to?: Side } = {}): Geo {
  // Зазоры: положительный — прямоугольники разнесены по этой оси
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const horiz = gx >= gy;
  const right = cx(b) >= cx(a);
  const down = cy(b) >= cy(a);
  const s1: Side = sides.from ?? (horiz ? (right ? 'right' : 'left') : (down ? 'bottom' : 'top'));
  const s2: Side = sides.to ?? (horiz ? (right ? 'left' : 'right') : (down ? 'top' : 'bottom'));
  let pts: Pt[];
  if (route === 'straight' || (gx < 0 && gy < 0 && !sides.from && !sides.to)) {
    // Прямая: по линии центров, от края до края; наложенные объекты — тоже прямой
    pts = [edge(a, [cx(b), cy(b)]), edge(b, [cx(a), cy(a)])];
    route = 'straight';
  } else {
    const p1 = port(a, s1);
    const p2 = port(b, s2);
    const [n1, n2] = [NORM[s1], NORM[s2]];
    if (route === 'curve') {
      const k = Math.max(30, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2.4);
      pts = [p1, [p1[0] + n1[0] * k, p1[1] + n1[1] * k], [p2[0] + n2[0] * k, p2[1] + n2[1] * k], p2];
    } else {
      const h1 = n1[0] !== 0;
      const h2 = n2[0] !== 0;
      if (h1 !== h2) {
        // Из стороны и в перпендикулярную — один излом
        pts = [p1, h1 ? [p2[0], p1[1]] : [p1[0], p2[1]], p2];
      } else if (h1 ? n1[0] === n2[0] : n1[1] === n2[1]) {
        // Одна и та же сторона: скобкой снаружи обоих объектов
        const k = h1 ? 0 : 1;
        const far = n1[k] > 0 ? Math.max(p1[k], p2[k]) + AROUND : Math.min(p1[k], p2[k]) - AROUND;
        pts = h1 ? [p1, [far, p1[1]], [far, p2[1]], p2] : [p1, [p1[0], far], [p2[0], far], p2];
      } else if (h1 ? Math.abs(p1[1] - p2[1]) < 1 : Math.abs(p1[0] - p2[0]) < 1) {
        pts = [p1, p2];
      } else {
        // Ломаная: наружу из стороны, поворот посередине между объектами, внутрь к стороне
        const m = h1 ? (p1[0] + p2[0]) / 2 : (p1[1] + p2[1]) / 2;
        pts = h1 ? [p1, [m, p1[1]], [m, p2[1]], p2] : [p1, [p1[0], m], [p2[0], m], p2];
      }
    }
  }
  const mid = midOf(pts, route);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  return { pts, route, mid, box: { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 } };
}

/** Середина пути: у кривой — точка Безье при t = 0,5, у ломаной — по длине */
export function midOf(pts: Pt[], route: Route): Pt {
  if (route === 'curve' && pts.length === 4) {
    const [p0, p1, p2, p3] = pts;
    const f = (k: 0 | 1) => 0.125 * p0[k] + 0.375 * p1[k] + 0.375 * p2[k] + 0.125 * p3[k];
    return [f(0), f(1)];
  }
  const seg = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]));
  let half = seg.reduce((s, x) => s + x, 0) / 2;
  for (let k = 0; k < seg.length; k++) {
    if (half <= seg[k]) { const t = seg[k] ? half / seg[k] : 0; return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t]; }
    half -= seg[k];
  }
  return pts[0];
}

/** Путь SVG в координатах рамки: ломаная — со скруглёнными изломами */
export function pathD(g: Geo): string {
  const r = (v: number) => Math.round(v * 10) / 10;
  const P = g.pts.map(([x, y]) => [x - g.box.x, y - g.box.y] as Pt);
  if (g.route === 'curve' && P.length === 4) return `M${r(P[0][0])} ${r(P[0][1])}C${P.slice(1).map((p) => `${r(p[0])} ${r(p[1])}`).join(' ')}`;
  let d = `M${r(P[0][0])} ${r(P[0][1])}`;
  for (let k = 1; k < P.length; k++) {
    const q = P[k];
    if (k < P.length - 1) {
      // Скругление излома радиусом до 10 px (не больше половины соседних отрезков)
      const [p, s] = [P[k - 1], P[k + 1]];
      const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const l2 = Math.hypot(s[0] - q[0], s[1] - q[1]);
      const rad = Math.min(10, l1 / 2, l2 / 2);
      const a: Pt = [q[0] - ((q[0] - p[0]) / (l1 || 1)) * rad, q[1] - ((q[1] - p[1]) / (l1 || 1)) * rad];
      const b: Pt = [q[0] + ((s[0] - q[0]) / (l2 || 1)) * rad, q[1] + ((s[1] - q[1]) / (l2 || 1)) * rad];
      d += `L${r(a[0])} ${r(a[1])}Q${r(q[0])} ${r(q[1])} ${r(b[0])} ${r(b[1])}`;
    } else d += `L${r(q[0])} ${r(q[1])}`;
  }
  return d;
}
