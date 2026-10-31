/**
 * Геометрия фигур PowerPoint (DrawingML) → контуры SVG в пикселях фигуры (0…w, 0…h): формулы gdLst и контуры
 * pathLst — moveTo, lnTo, cubicBezTo, quadBezTo, arcTo, close. Общая для импорта PPTX (plugins/pptx) и фигур студии
 * (components/shape): элементы — из любого DOM (@xmldom/xmldom на сервере, DOMParser в браузере)
 */
type El = Element;

const kids = (el: El | null | undefined, name?: string): El[] => {
  const out: El[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as El).localName === name)) out.push(n as El);
  }
  return out;
};
const one = (el: El | null | undefined, ...names: string[]): El | null => {
  let cur: El | null | undefined = el;
  for (const n of names) cur = kids(cur, n)[0];
  return cur ?? null;
};
const attr = (el: El | null | undefined, name: string): string | null => (el && el.hasAttribute(name) ? el.getAttribute(name) : null);
const num = (el: El | null | undefined, name: string): number | null => {
  const v = attr(el, name);
  return v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
};

/**
 * Определения фигур в простом XML (только элементы с атрибутами, как в presets.ts) → элементы по имени фигуры.
 * Свой маленький разбор: в браузере и в Node одинаково, без DOMParser
 */
export function parsePresets(xml: string): Map<string, El> {
  interface N { localName: string; nodeType: 1; firstChild: N | null; nextSibling: N | null; parentNode: N | null; at: Record<string, string>; hasAttribute(n: string): boolean; getAttribute(n: string): string | null }
  const make = (localName: string, at: Record<string, string>, parentNode: N | null): N => ({
    localName, nodeType: 1, firstChild: null, nextSibling: null, parentNode, at,
    hasAttribute(n) { return n in this.at; }, getAttribute(n) { return this.at[n] ?? null; },
  });
  const root = make('#root', {}, null);
  const last = new Map<N, N>();
  let cur = root;
  for (const m of xml.matchAll(/<(\/?)([\w:]+)((?:\s+[\w:]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[1]) { cur = cur.parentNode ?? root; continue; }
    const at: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:]+)="([^"]*)"/g)) at[a[1]] = a[2];
    const el = make(m[2], at, cur);
    const prev = last.get(cur);
    if (prev) prev.nextSibling = el; else cur.firstChild = el;
    last.set(cur, el);
    if (!m[4]) cur = el;
  }
  const out = new Map<string, El>();
  for (const el of kids((root.firstChild ?? root) as unknown as El)) out.set(el.localName, el);
  return out;
}

export interface GeomPath {
  d: string;
  fill: boolean;
  stroke: boolean;
  /** Затенённая часть фигуры (изнанка изогнутой стрелки, бок куба): темнее или светлее заливки */
  shade?: 'darken' | 'darkenLess' | 'lighten' | 'lightenLess';
}

export const f = (n: number) => (Math.round(n * 100) / 100).toString();
export const ANG = 60000; // единицы углов DrawingML: 1/60000 градуса
export const rad = (a: number) => (a / ANG) * (Math.PI / 180);

/** Точка на эллипсе (rx, ry) с центром (cx, cy) под углом ang (единицы DrawingML, по часовой) */
export const onEllipse = (cx: number, cy: number, rx: number, ry: number, ang: number): [number, number] => {
  // Угол «видимый», как в PowerPoint: для неравных осей точка — на луче под этим углом
  const t = rad(ang);
  const u = Math.atan2(Math.sin(t) * rx, Math.cos(t) * ry);
  return [cx + rx * Math.cos(u), cy + ry * Math.sin(u)];
};

export function arcPath(cx: number, cy: number, rx: number, ry: number, st: number, sw: number, move: boolean): string {
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

export const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z`;

/** Формулы gdLst (custGeom): умножение-деление, сложение-вычитание, val, min, max, pin, sin, cos и др. */
function evalGuides(geom: El, w: number, h: number, over: Record<string, number> = {}): Map<string, number> {
  const ss = Math.min(w, h);
  const v = new Map<string, number>([['w', w], ['h', h], ['l', 0], ['t', 0], ['r', w], ['b', h], ['ss', ss], ['ls', Math.max(w, h)], ['hc', w / 2], ['vc', h / 2],
    ['cd2', 10800000], ['cd4', 5400000], ['cd8', 2700000], ['3cd4', 16200000], ['3cd8', 8100000], ['5cd8', 13500000], ['7cd8', 18900000]]);
  // Доли сторон: wd2 … wd32, hd2 … hd32, ssd2 … ssd32
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) { v.set(`wd${n}`, w / n); v.set(`hd${n}`, h / n); v.set(`ssd${n}`, ss / n); }
  const get = (s: string) => (v.has(s) ? v.get(s)! : Number(s) || 0);
  for (const gd of [...kids(one(geom, 'avLst'), 'gd'), ...kids(one(geom, 'gdLst'), 'gd')]) {
    const name = attr(gd, 'name') ?? '';
    // Регулировка фигуры из файла сильнее значения по умолчанию (adj и adj1 — одно и то же у фигур с одной ручкой)
    const own = over[name] ?? (name === 'adj' ? over.adj1 : name === 'adj1' ? over.adj : undefined);
    if (own !== undefined && gd.parentNode && (gd.parentNode as El).localName === 'avLst') { v.set(name, own); continue; }
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
    v.set(name, r);
  }
  return v;
}

/** Контуры своей кривой (custGeom), масштаб — к размеру фигуры */
export function customPaths(geom: El, w: number, h: number, over: Record<string, number> = {}): GeomPath[] {
  const guides = evalGuides(geom, w, h, over);
  const val = (s: string | null) => (s === null ? 0 : guides.has(s) ? guides.get(s)! : Number(s) || 0);
  const out: GeomPath[] = [];
  for (const p of kids(one(geom, 'pathLst'), 'path')) {
    // Своя сетка контура (w, h) — к размеру фигуры; без неё — уже в размере (и у линии нулевой ширины)
    const pw = num(p, 'w'), ph = num(p, 'h');
    const sx = pw ? w / pw : 1, sy = ph ? h / ph : 1;
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
    const fl = attr(p, 'fill');
    out.push({
      d: d.trim(), fill: fl !== 'none', stroke: attr(p, 'stroke') !== '0' && attr(p, 'stroke') !== 'false',
      ...(fl === 'darken' || fl === 'darkenLess' || fl === 'lighten' || fl === 'lightenLess' ? { shade: fl } : {}),
    });
  }
  return out;
}

/**
 * Жёлтая ручка фигуры (ahLst): где стоит в пикселях фигуры и какие регулировки двигает — по осям (ahXY) или
 * по радиусу и углу от центра (ahPolar). Пределы — уже посчитанные числа
 */
export interface GeomHandle {
  x: number;
  y: number;
  refs: { name: string; min: number; max: number }[];
}

export function geomHandles(geom: El, w: number, h: number, over: Record<string, number> = {}): GeomHandle[] {
  const guides = evalGuides(geom, w, h, over);
  const val = (s: string | null, d = 0) => (s === null ? d : guides.has(s) ? guides.get(s)! : Number.isFinite(Number(s)) ? Number(s) : d);
  return kids(one(geom, 'ahLst')).map((ah) => {
    const pos = one(ah, 'pos');
    const refs: GeomHandle['refs'] = [];
    for (const [ref, mn, mx] of ah.localName === 'ahPolar' ? [['gdRefR', 'minR', 'maxR'], ['gdRefAng', 'minAng', 'maxAng']] : [['gdRefX', 'minX', 'maxX'], ['gdRefY', 'minY', 'maxY']]) {
      const name = attr(ah, ref);
      if (name) refs.push({ name, min: val(attr(ah, mn), -2147483647), max: val(attr(ah, mx), 2147483647) });
    }
    return { x: val(attr(pos, 'x')), y: val(attr(pos, 'y')), refs };
  });
}

/**
 * Ручку k потянули в точку (px, py) пикселей фигуры: регулировки, при которых ручка ближе всего к ней. Положение
 * ручки — формулы от регулировок, обратных формул нет: каждая регулировка подбирается по очереди перебором с уточнением
 */
export function geomAdjust(geom: El, w: number, h: number, over: Record<string, number>, k: number, px: number, py: number): Record<string, number> {
  const cur = { ...over };
  const base = evalGuides(geom, w, h, cur);
  const hd = geomHandles(geom, w, h, cur)[k];
  if (!hd) return cur;
  // Значение регулировки по умолчанию — из avLst
  for (const r of hd.refs) if (cur[r.name] === undefined && base.has(r.name)) cur[r.name] = base.get(r.name)!;
  const miss = (v: Record<string, number>) => {
    const a = geomHandles(geom, w, h, v)[k];
    return a ? (a.x - px) ** 2 + (a.y - py) ** 2 : Infinity;
  };
  for (let round = 0; round < 2; round++) {
    for (const r of hd.refs) {
      // Пределы «без ограничений» (±2³¹) — в разумных рамках: от −2 до 2 размеров фигуры в единицах регулировки
      const lo = Math.max(r.min, -200000);
      const hi = Math.min(r.max, 200000);
      let best = cur[r.name] ?? 0;
      let bestMiss = miss(cur);
      let step = (hi - lo) / 40;
      let from = lo;
      let to = hi;
      for (let pass = 0; pass < 4 && step > 1; pass++) {
        for (let v = from; v <= to + 1e-6; v += step) {
          const m = miss({ ...cur, [r.name]: v });
          if (m < bestMiss) { bestMiss = m; best = v; }
        }
        from = Math.max(lo, best - step);
        to = Math.min(hi, best + step);
        step /= 8;
      }
      cur[r.name] = Math.round(best);
    }
  }
  return cur;
}
