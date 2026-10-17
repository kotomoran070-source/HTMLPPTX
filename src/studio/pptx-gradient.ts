/**
 * Градиенты в PPTX настоящими градиентами PowerPoint (a:gradFill), а не картинкой и не одним цветом.
 * pptxgenjs градиентов не умеет: фигура или кусок текста получают цвет-метку, а после сборки файла
 * (repair в pptx.ts) метка в XML заменяется градиентом со всеми точками, направлением и прозрачностью.
 */

/** Точка градиента: цвет RRGGBB, непрозрачность 0–1, место 0–1 */
export interface GradStop { hex: string; a: number; pos: number }
export interface CssGradient { radial: boolean; angle: number; stops: GradStop[] }

/** Запятые верхнего уровня: внутри rgb(…) и color(…) — не разделители */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Цвет из вычисленного стиля: rgb(), rgba() или color(srgb …) — с прозрачностью, и полностью прозрачный тоже */
function color(c: string): { hex: string; a: number } | null {
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(c);
  const m = srgb ? null : /^rgba?\(([^)]+)\)$/.exec(c);
  if (!srgb && !m) return null;
  const parts = (srgb ? srgb[1] : m![1]).split(/[\s,/]+/).filter(Boolean);
  const k = srgb ? 255 : 1;
  const [r, g, b] = parts.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v) * k))));
  if (![r, g, b].every(Number.isFinite)) return null;
  const raw = parts[3];
  const a = raw === undefined ? 1 : raw.endsWith('%') ? parseFloat(raw) / 100 : Number(raw);
  return { hex: [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), a: Number.isFinite(a) ? a : 1 };
}

const TO: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };

/**
 * Один линейный или круговой градиент из вычисленного background-image; несколько слоёв, узоры
 * (repeating-…), картинки и места не в процентах — null (такое остаётся картинкой)
 */
export function parseCssGradient(img: string): CssGradient | null {
  const s = img.trim();
  const layers = splitTop(s);
  if (layers.length !== 1) return null;
  const m = /^(linear|radial)-gradient\((.*)\)$/s.exec(s);
  if (!m) return null;
  const parts = splitTop(m[2]);
  let angle = 180;
  if (m[1] === 'linear') {
    const deg = /^(-?[\d.]+)deg$/.exec(parts[0]);
    if (deg) { angle = Number(deg[1]); parts.shift(); }
    else if (TO[parts[0]] !== undefined) { angle = TO[parts[0]]; parts.shift(); }
  } else if (!/^(rgb|color\()/.test(parts[0])) parts.shift();
  const raw: { hex: string; a: number; pos: number | null }[] = [];
  for (const p of parts) {
    const cm = /^((?:rgba?|color)\([^)]*\))\s*(.*)$/.exec(p);
    if (!cm) return null;
    const c = color(cm[1]);
    if (!c) return null;
    const pos = cm[2].split(/\s+/).filter(Boolean);
    if (pos.some((x) => !x.endsWith('%'))) return null;
    if (!pos.length) raw.push({ ...c, pos: null });
    for (const x of pos) raw.push({ ...c, pos: parseFloat(x) / 100 });
  }
  if (raw.length < 2) return null;
  // Без места — как в CSS: края 0 и 100 %, между известными — поровну
  if (raw[0].pos === null) raw[0].pos = 0;
  if (raw[raw.length - 1].pos === null) raw[raw.length - 1].pos = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].pos !== null) continue;
    let j = i;
    while (raw[j].pos === null) j++;
    const a = raw[i - 1].pos!;
    const b = raw[j].pos!;
    for (let k = i; k < j; k++) raw[k].pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  let last = 0;
  const stops = raw.map((x) => ({ hex: x.hex, a: x.a, pos: (last = Math.max(last, Math.min(1, Math.max(0, x.pos!)))) }));
  return { radial: m[1] === 'radial', angle: ((angle % 360) + 360) % 360, stops };
}

/**
 * Градиент PowerPoint: a:gradFill с точками (место в стотысячных), прозрачностью (с учётом opacity
 * элемента) и направлением: 0° у PowerPoint — слева направо, у CSS — снизу вверх
 */
export function gradFillXml(g: CssGradient, opacity = 1): string {
  const gs = g.stops.map((s) => {
    const a = Math.max(0, Math.min(1, s.a * opacity));
    return `<a:gs pos="${Math.round(s.pos * 100000)}"><a:srgbClr val="${s.hex}">${a < 0.999 ? `<a:alpha val="${Math.round(a * 100000)}"/>` : ''}</a:srgbClr></a:gs>`;
  }).join('');
  const dir = g.radial
    ? '<a:path path="circle"><a:fillToRect l="50000" t="40000" r="50000" b="60000"/></a:path>'
    : `<a:lin ang="${Math.round((((g.angle - 90) % 360) + 360) % 360) * 60000}" scaled="0"/>`;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst>${dir}</a:gradFill>`;
}

/** Цвета-метки этого экспорта → их градиенты */
export class GradientMarks {
  private map = new Map<string, string>();
  private n = 0;
  /** Метка для градиента: такой цвет pptxgenjs запишет вместо градиента */
  mark(xml: string): string {
    // Почти чёрный тёмно-синий: таких цветов в презентациях не бывает (01 7A00 … 01 FFFF)
    const hex = `01${(0x7A00 + this.n++).toString(16).toUpperCase()}`;
    this.map.set(hex, xml);
    return hex;
  }
  get size(): number { return this.map.size; }
  /** Заливки цветом-меткой в XML слайда → градиенты */
  swap(xml: string): string {
    if (!this.map.size) return xml;
    return xml.replace(/<a:solidFill><a:srgbClr val="(01[0-9A-F]{4})"(?:\/>|>(?:(?!<\/a:srgbClr>)[\s\S])*<\/a:srgbClr>)<\/a:solidFill>/g, (m, hex: string) => this.map.get(hex) ?? m);
  }
}
