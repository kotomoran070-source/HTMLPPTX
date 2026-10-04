/**
 * Геометрия фигур PowerPoint → контуры SVG в пикселях фигуры (0…w, 0…h).
 * Стандартные фигуры (prstGeom) — самые ходовые из ~180, остальные — прямоугольник (с предупреждением).
 * Свои кривые (custGeom) — полностью: moveTo, lnTo, cubicBezTo, quadBezTo, arcTo, close; формулы gdLst.
 */
import { type El, attr, kids, num, one } from './xml';

export interface GeomPath {
  d: string;
  fill: boolean;
  stroke: boolean;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const ANG = 60000; // единицы углов DrawingML: 1/60000 градуса
const rad = (a: number) => (a / ANG) * (Math.PI / 180);

/** Значения регулировок фигуры (avLst): adj, adj1… */
export function adjusts(geom: El | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const gd of kids(one(geom, 'avLst'), 'gd')) {
    const m = /^val\s+(-?\d+(\.\d+)?)$/.exec(attr(gd, 'fmla') ?? '');
    if (m) out[attr(gd, 'name') ?? ''] = Number(m[1]);
  }
  return out;
}

/** Точка на эллипсе (rx, ry) с центром (cx, cy) под углом ang (единицы DrawingML, по часовой) */
const onEllipse = (cx: number, cy: number, rx: number, ry: number, ang: number): [number, number] => {
  // Угол «видимый», как в PowerPoint: для неравных осей точка — на луче под этим углом
  const t = rad(ang);
  const u = Math.atan2(Math.sin(t) * rx, Math.cos(t) * ry);
  return [cx + rx * Math.cos(u), cy + ry * Math.sin(u)];
};

function arcPath(cx: number, cy: number, rx: number, ry: number, st: number, sw: number, move: boolean): string {
  const [x1, y1] = onEllipse(cx, cy, rx, ry, st);
  const [x2, y2] = onEllipse(cx, cy, rx, ry, st + sw);
  const large = Math.abs(sw) > 180 * ANG ? 1 : 0;
  const sweep = sw > 0 ? 1 : 0;
  if (Math.abs(sw) >= 360 * ANG - 1) {
    const [xm, ym] = onEllipse(cx, cy, rx, ry, st + sw / 2);
    return `${move ? `M${f(x1)} ${f(y1)}` : `L${f(x1)} ${f(y1)}`} A${f(rx)} ${f(ry)} 0 0 ${sweep} ${f(xm)} ${f(ym)} A${f(rx)} ${f(ry)} 0 0 ${sweep} ${f(x2)} ${f(y2)}`;
  }
  return `${move ? `M${f(x1)} ${f(y1)}` : `L${f(x1)} ${f(y1)}`} A${f(rx)} ${f(ry)} 0 ${large} ${sweep} ${f(x2)} ${f(y2)}`;
}

const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z`;

/** Известна ли стандартная фигура (иначе — прямоугольник и предупреждение) */
export const PRESETS = new Set([
  'rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
  'homePlate', 'chevron', 'plus', 'star4', 'star5', 'star6', 'upArrow', 'downArrow', 'leftArrow', 'rightArrow', 'leftRightArrow',
  'line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'curvedConnector3', 'arc', 'pie', 'chord', 'blockArc', 'donut',
  'round1Rect', 'round2SameRect', 'round2DiagRect', 'snip1Rect', 'snip2SameRect', 'frame', 'leftBracket', 'rightBracket',
  'leftBrace', 'rightBrace', 'wedgeRectCallout', 'wedgeRoundRectCallout', 'wedgeEllipseCallout', 'flowChartProcess',
  'flowChartAlternateProcess', 'flowChartDecision', 'flowChartTerminator', 'flowChartConnector', 'teardrop', 'heart', 'can', 'cube',
  'textNoShape',
]);

/** Контуры стандартной фигуры */
export function presetPaths(prst: string, w: number, h: number, a: Record<string, number>): GeomPath[] {
  const ss = Math.min(w, h);
  const adj = (name: string, def: number) => (a[name] ?? (name === 'adj1' ? a.adj : undefined) ?? def);
  const P = (d: string, fill = true, stroke = true): GeomPath => ({ d, fill, stroke });
  const rect = P(`M0 0 H${f(w)} V${f(h)} H0 Z`);
  switch (prst) {
    case 'rect': case 'flowChartProcess': case 'textNoShape': return [rect];
    case 'roundRect': case 'flowChartAlternateProcess': {
      const r = Math.min(ss / 2, (ss * adj('adj', 16667)) / 100000);
      return [P(`M${f(r)} 0 H${f(w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V${f(h - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)} H${f(r)} A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)} V${f(r)} A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`)];
    }
    case 'flowChartTerminator': { const r = h / 2; return [P(`M${f(r)} 0 H${f(w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)} H${f(r)} A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`)]; }
    case 'ellipse': case 'flowChartConnector':
      return [P(`M0 ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w)} ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 1 0 ${f(h / 2)} Z`)];
    case 'triangle': { const x = (w * adj('adj', 50000)) / 100000; return [P(poly([[x, 0], [w, h], [0, h]]))]; }
    case 'rtTriangle': return [P(poly([[0, 0], [w, h], [0, h]]))];
    case 'diamond': case 'flowChartDecision': return [P(poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))];
    case 'parallelogram': { const x = Math.min(w, (ss * adj('adj', 25000)) / 100000); return [P(poly([[x, 0], [w, 0], [w - x, h], [0, h]]))]; }
    case 'trapezoid': { const x = Math.min(w / 2, (ss * adj('adj', 25000)) / 100000); return [P(poly([[x, 0], [w - x, 0], [w, h], [0, h]]))]; }
    case 'pentagon': return [P(poly([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]]))];
    case 'hexagon': { const x = Math.min(w / 2, (ss * adj('adj', 25000)) / 100000); return [P(poly([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]))]; }
    case 'octagon': { const x = (ss * adj('adj', 29289)) / 100000; return [P(poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]))]; }
    case 'homePlate': { const x = w - Math.min(w, (ss * adj('adj', 50000)) / 100000); return [P(poly([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]))]; }
    case 'chevron': { const x = Math.min(w, (ss * adj('adj', 50000)) / 100000); return [P(poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]))]; }
    case 'plus': { const x = (ss * adj('adj', 25000)) / 100000; return [P(poly([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]))]; }
    case 'star4': case 'star5': case 'star6': {
      const n = Number(prst.slice(4));
      const inner = n === 4 ? (adj('adj', 12500) / 50000) : n === 5 ? (adj('adj', 19098) / 50000) : (adj('adj', 28868) / 50000);
      const pts: [number, number][] = [];
      for (let i = 0; i < n * 2; i++) {
        const t = -Math.PI / 2 + (i * Math.PI) / n;
        const k = i % 2 ? inner : 1;
        pts.push([w / 2 + (w / 2) * k * Math.cos(t), h / 2 + (h / 2) * k * Math.sin(t)]);
      }
      return [P(poly(pts))];
    }
    case 'rightArrow': case 'leftArrow': case 'upArrow': case 'downArrow': {
      const horiz = prst === 'rightArrow' || prst === 'leftArrow';
      const L = horiz ? w : h, T = horiz ? h : w;
      const sh = (T * adj('adj1', 50000)) / 100000;
      const hd = Math.min(L, (ss * adj('adj2', 50000)) / 100000);
      // Стрелка вправо в координатах (вдоль, поперёк), затем поворот в нужную сторону
      const base: [number, number][] = [[0, (T - sh) / 2], [L - hd, (T - sh) / 2], [L - hd, 0], [L, T / 2], [L - hd, T], [L - hd, (T + sh) / 2], [0, (T + sh) / 2]];
      const map = (p: [number, number]): [number, number] => prst === 'rightArrow' ? p : prst === 'leftArrow' ? [w - p[0], p[1]] : prst === 'downArrow' ? [p[1], p[0]] : [p[1], h - p[0]];
      return [P(poly(base.map(map)))];
    }
    case 'leftRightArrow': {
      const sh = (h * adj('adj1', 50000)) / 100000, hd = Math.min(w / 2, (ss * adj('adj2', 50000)) / 100000);
      return [P(poly([[0, h / 2], [hd, 0], [hd, (h - sh) / 2], [w - hd, (h - sh) / 2], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, (h + sh) / 2], [hd, (h + sh) / 2], [hd, h]]))];
    }
    case 'line': case 'straightConnector1': return [P(`M0 0 L${f(w)} ${f(h)}`, false)];
    case 'bentConnector2': return [P(`M0 0 H${f(w)} V${f(h)}`, false)];
    case 'bentConnector3': { const x = (w * adj('adj1', 50000)) / 100000; return [P(`M0 0 H${f(x)} V${f(h)} H${f(w)}`, false)]; }
    case 'curvedConnector3': { const x = (w * adj('adj1', 50000)) / 100000; return [P(`M0 0 C${f(x)} 0 ${f(x)} ${f(h)} ${f(w)} ${f(h)}`, false)]; }
    case 'arc': {
      const st = adj('adj1', 16200000), en = adj('adj2', 0);
      let sw = en - st; if (sw <= 0) sw += 360 * ANG;
      const arc = arcPath(w / 2, h / 2, w / 2, h / 2, st, sw, true);
      return [P(`${arc} L${f(w / 2)} ${f(h / 2)} Z`, true, false), P(arc, false, true)];
    }
    case 'pie': case 'chord': {
      const st = adj('adj1', prst === 'pie' ? 0 : 2700000), en = adj('adj2', prst === 'pie' ? 16200000 : 16200000);
      let sw = en - st; if (sw <= 0) sw += 360 * ANG;
      const arc = arcPath(w / 2, h / 2, w / 2, h / 2, st, sw, true);
      return [P(prst === 'pie' ? `${arc} L${f(w / 2)} ${f(h / 2)} Z` : `${arc} Z`)];
    }
    case 'blockArc': {
      const st = adj('adj1', 10800000), en = adj('adj2', 0), th = (ss * adj('adj3', 25000)) / 100000;
      let sw = en - st; if (sw <= 0) sw += 360 * ANG;
      const outer = arcPath(w / 2, h / 2, w / 2, h / 2, st, sw, true);
      const [ix, iy] = onEllipse(w / 2, h / 2, w / 2 - th, h / 2 - th, st + sw);
      const [ex, ey] = onEllipse(w / 2, h / 2, w / 2 - th, h / 2 - th, st);
      return [P(`${outer} L${f(ix)} ${f(iy)} A${f(w / 2 - th)} ${f(h / 2 - th)} 0 ${Math.abs(sw) > 180 * ANG ? 1 : 0} 0 ${f(ex)} ${f(ey)} Z`)];
    }
    case 'donut': {
      const t = (ss * adj('adj', 25000)) / 100000;
      const o = `M0 ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w)} ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 1 0 ${f(h / 2)} Z`;
      const i = `M${f(t)} ${f(h / 2)} A${f(w / 2 - t)} ${f(h / 2 - t)} 0 1 0 ${f(w - t)} ${f(h / 2)} A${f(w / 2 - t)} ${f(h / 2 - t)} 0 1 0 ${f(t)} ${f(h / 2)} Z`;
      return [P(`${o} ${i}`)];
    }
    case 'frame': {
      const t = (ss * adj('adj1', 12500)) / 100000;
      return [P(`M0 0 H${f(w)} V${f(h)} H0 Z M${f(t)} ${f(t)} V${f(h - t)} H${f(w - t)} V${f(t)} Z`)];
    }
    case 'round1Rect': case 'round2SameRect': case 'round2DiagRect': case 'snip1Rect': case 'snip2SameRect': {
      const r1 = Math.min(ss / 2, (ss * adj('adj1', 16667)) / 100000);
      const r2 = Math.min(ss / 2, (ss * adj('adj2', prst === 'round2DiagRect' ? 0 : 0)) / 100000);
      // Радиусы углов: левый верхний, правый верхний, правый нижний, левый нижний
      const [tl, tr, br, bl] = prst === 'round1Rect' || prst === 'snip1Rect' ? [0, r1, 0, 0] : prst === 'round2SameRect' || prst === 'snip2SameRect' ? [r1, r1, r2, r2] : [r1, r2, r1, r2];
      const snip = prst.startsWith('snip');
      const c = (r: number, x: number, y: number) => (r ? (snip ? `L${f(x)} ${f(y)}` : `A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y)}`) : '');
      return [P(`M${f(tl)} 0 H${f(w - tr)} ${c(tr, w, tr)} V${f(h - br)} ${c(br, w - br, h)} H${f(bl)} ${c(bl, 0, h - bl)} V${f(tl)} ${c(tl, tl, 0)} Z`)];
    }
    case 'leftBracket': case 'rightBracket': {
      const r = Math.min(h / 2, (ss * adj('adj', 8333)) / 100000);
      const d = prst === 'rightBracket'
        ? `M0 0 A${f(w)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V${f(h - r)} A${f(w)} ${f(r)} 0 0 1 0 ${f(h)}`
        : `M${f(w)} 0 A${f(w)} ${f(r)} 0 0 0 0 ${f(r)} V${f(h - r)} A${f(w)} ${f(r)} 0 0 0 ${f(w)} ${f(h)}`;
      return [P(d, false)];
    }
    case 'leftBrace': case 'rightBrace': {
      const q = h / 4;
      const d = prst === 'rightBrace'
        ? `M0 0 Q${f(w / 2)} 0 ${f(w / 2)} ${f(q)} V${f(h / 2 - q / 2)} Q${f(w / 2)} ${f(h / 2)} ${f(w)} ${f(h / 2)} Q${f(w / 2)} ${f(h / 2)} ${f(w / 2)} ${f(h / 2 + q / 2)} V${f(h - q)} Q${f(w / 2)} ${f(h)} 0 ${f(h)}`
        : `M${f(w)} 0 Q${f(w / 2)} 0 ${f(w / 2)} ${f(q)} V${f(h / 2 - q / 2)} Q${f(w / 2)} ${f(h / 2)} 0 ${f(h / 2)} Q${f(w / 2)} ${f(h / 2)} ${f(w / 2)} ${f(h / 2 + q / 2)} V${f(h - q)} Q${f(w / 2)} ${f(h)} ${f(w)} ${f(h)}`;
      return [P(d, false)];
    }
    case 'wedgeRectCallout': case 'wedgeRoundRectCallout': case 'wedgeEllipseCallout': {
      // Хвост — к точке (adj1, adj2) от центра в долях размера
      const tx = w / 2 + (w * adj('adj1', -20833)) / 100000, ty = h / 2 + (h * adj('adj2', 62500)) / 100000;
      const body = prst === 'wedgeEllipseCallout' ? presetPaths('ellipse', w, h, {})[0].d
        : prst === 'wedgeRoundRectCallout' ? presetPaths('roundRect', w, h, { adj: adj('adj3', 16667) })[0].d : rect.d;
      // Основание хвоста — на ближайшей к точке стороне
      const bx = Math.min(w * 0.85, Math.max(w * 0.15, tx)), by = Math.min(h * 0.85, Math.max(h * 0.15, ty));
      const tail = ty > h ? poly([[bx - w * 0.08, h - 1], [tx, ty], [bx + w * 0.08, h - 1]])
        : ty < 0 ? poly([[bx - w * 0.08, 1], [tx, ty], [bx + w * 0.08, 1]])
          : tx < 0 ? poly([[1, by - h * 0.1], [tx, ty], [1, by + h * 0.1]]) : poly([[w - 1, by - h * 0.1], [tx, ty], [w - 1, by + h * 0.1]]);
      return [P(`${body} ${tail}`)];
    }
    case 'teardrop': return [P(`M0 ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w / 2)} 0 H${f(w)} V${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 1 0 ${f(h / 2)} Z`)];
    case 'heart': return [P(`M${f(w / 2)} ${f(h * 0.25)} C${f(w / 2)} 0 0 0 0 ${f(h * 0.3)} C0 ${f(h * 0.6)} ${f(w / 2)} ${f(h * 0.8)} ${f(w / 2)} ${f(h)} C${f(w / 2)} ${f(h * 0.8)} ${f(w)} ${f(h * 0.6)} ${f(w)} ${f(h * 0.3)} C${f(w)} 0 ${f(w / 2)} 0 ${f(w / 2)} ${f(h * 0.25)} Z`)];
    case 'can': { const e = (ss * adj('adj', 25000)) / 200000; return [P(`M0 ${f(e)} A${f(w / 2)} ${f(e)} 0 0 1 ${f(w)} ${f(e)} V${f(h - e)} A${f(w / 2)} ${f(e)} 0 0 1 0 ${f(h - e)} Z`), P(`M0 ${f(e)} A${f(w / 2)} ${f(e)} 0 0 0 ${f(w)} ${f(e)}`, false)]; }
    case 'cube': { const d = (ss * adj('adj', 25000)) / 100000; return [P(poly([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]])), P(`M0 ${f(d)} H${f(w - d)} L${f(w)} 0 M${f(w - d)} ${f(d)} V${f(h)}`, false)]; }
    default: return [rect];
  }
}

/** Формулы gdLst (custGeom): умножение-деление, сложение-вычитание, val, min, max, pin, sin, cos и др. */
function evalGuides(geom: El, w: number, h: number): Map<string, number> {
  const v = new Map<string, number>([['w', w], ['h', h], ['l', 0], ['t', 0], ['r', w], ['b', h], ['wd2', w / 2], ['hd2', h / 2], ['ss', Math.min(w, h)], ['ls', Math.max(w, h)], ['hc', w / 2], ['vc', h / 2], ['cd2', 10800000], ['cd4', 5400000], ['3cd4', 16200000]]);
  const get = (s: string) => (v.has(s) ? v.get(s)! : Number(s) || 0);
  for (const gd of [...kids(one(geom, 'avLst'), 'gd'), ...kids(one(geom, 'gdLst'), 'gd')]) {
    const [op, ...args] = (attr(gd, 'fmla') ?? '').trim().split(/\s+/);
    const [x, y, z] = args.map(get);
    let r = 0;
    switch (op) {
      case 'val': r = x; break;
      case '*/': r = (x * y) / (z || 1); break;
      case '+-': r = x + y - z; break;
      case '+/': r = (x + y) / (z || 1); break;
      case '?:': r = x > 0 ? y : z; break;
      case 'abs': r = Math.abs(x); break;
      case 'max': r = Math.max(x, y); break;
      case 'min': r = Math.min(x, y); break;
      case 'mod': r = Math.sqrt(x * x + y * y + z * z); break;
      case 'pin': r = y < x ? x : y > z ? z : y; break;
      case 'sqrt': r = Math.sqrt(x); break;
      case 'sin': r = x * Math.sin(rad(y)); break;
      case 'cos': r = x * Math.cos(rad(y)); break;
      case 'tan': r = x * Math.tan(rad(y)); break;
      case 'at2': r = (Math.atan2(y, x) * 180 / Math.PI) * ANG; break;
      case 'cat2': r = x * Math.cos(Math.atan2(z, y)); break;
      case 'sat2': r = x * Math.sin(Math.atan2(z, y)); break;
      default: r = 0;
    }
    v.set(attr(gd, 'name') ?? '', r);
  }
  return v;
}

/** Контуры своей кривой (custGeom), масштаб — к размеру фигуры */
export function customPaths(geom: El, w: number, h: number): GeomPath[] {
  const guides = evalGuides(geom, w, h);
  const val = (s: string | null) => (s === null ? 0 : guides.has(s) ? guides.get(s)! : Number(s) || 0);
  const out: GeomPath[] = [];
  for (const p of kids(one(geom, 'pathLst'), 'path')) {
    const pw = num(p, 'w') || w, ph = num(p, 'h') || h;
    const sx = w / pw, sy = h / ph;
    const X = (pt: El) => val(attr(pt, 'x')) * sx, Y = (pt: El) => val(attr(pt, 'y')) * sy;
    let d = '';
    let cx = 0, cy = 0;
    for (const c of kids(p)) {
      const pts = kids(c, 'pt');
      switch (c.localName) {
        case 'moveTo': cx = X(pts[0]); cy = Y(pts[0]); d += `M${f(cx)} ${f(cy)} `; break;
        case 'lnTo': cx = X(pts[0]); cy = Y(pts[0]); d += `L${f(cx)} ${f(cy)} `; break;
        case 'cubicBezTo': d += `C${pts.map((q) => `${f(X(q))} ${f(Y(q))}`).join(' ')} `; cx = X(pts[2]); cy = Y(pts[2]); break;
        case 'quadBezTo': d += `Q${pts.map((q) => `${f(X(q))} ${f(Y(q))}`).join(' ')} `; cx = X(pts[1]); cy = Y(pts[1]); break;
        case 'arcTo': {
          const rx = val(attr(c, 'wR')) * sx, ry = val(attr(c, 'hR')) * sy;
          const st = val(attr(c, 'stAng')), sw = val(attr(c, 'swAng'));
          // Центр — так, чтобы текущая точка лежала на эллипсе под углом stAng
          const t0 = rad(st), u0 = Math.atan2(Math.sin(t0) * rx, Math.cos(t0) * ry);
          const ccx = cx - rx * Math.cos(u0), ccy = cy - ry * Math.sin(u0);
          const seg = arcPath(ccx, ccy, rx, ry, st, sw, false).replace(/^L[^A]*/, '');
          const t1 = rad(st + sw), u1 = Math.atan2(Math.sin(t1) * rx, Math.cos(t1) * ry);
          cx = ccx + rx * Math.cos(u1); cy = ccy + ry * Math.sin(u1);
          d += `${seg} `;
          break;
        }
        case 'close': d += 'Z '; break;
        default: break;
      }
    }
    out.push({ d: d.trim(), fill: attr(p, 'fill') !== 'none', stroke: attr(p, 'stroke') !== '0' && attr(p, 'stroke') !== 'false' });
  }
  return out;
}
