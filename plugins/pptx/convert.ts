/**
 * PPTX → презентация Slideria. Каждый слайд — свободный холст (template: canvas), объекты PowerPoint —
 * свободные объекты на тех же местах:
 *   текстовое поле → text; простая фигура (прямоугольник, скругление, овал) со сплошной заливкой → shape;
 *   линия со стрелкой → shape line/arrow; картинка → image (обрезка — по srcRect);
 *   градиенты, кривые, соединители, группы из одних фигур → html с SVG (точная копия);
 *   таблица → table; диаграмма → bars / line-chart; заметки — notes; фон — bg или картинка под всем.
 * Фигуры образца и макета без плейсхолдеров идут первыми и закреплены — как фон слайда.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { type ColorCtx, type Rgba, colorIn, css, hex } from './color';
import { type GeomPath, adjusts, customPaths, knownPreset, presetPaths } from './geom';
import { type El, Pkg, attr, bool, find, kid, kids, num, one, textOf } from './xml';
import { colorFamilies, lightness } from '../../src/engine/recolor';
import { fontFamilies } from '../../src/engine/fonts';
import { contrast } from '../../src/engine/accent';

type Obj = Record<string, unknown>;

export interface PptxResult {
  title: string;
  deck: Obj;
  /** Файлы для assets/: имя → содержимое */
  assets: Map<string, Buffer>;
  warnings: string[];
  slides: number;
}

interface Theme {
  scheme: Record<string, string>;
  major: string;
  minor: string;
  fills: El[];
  lines: El[];
  effects: El[];
  bgFills: El[];
}

interface Box { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }

/** Свойства текста одного уровня (после наследования) */
interface TP {
  sz?: number; b?: boolean; i?: boolean; u?: boolean; color?: Rgba | null; font?: string; algn?: string;
  lnPct?: number; lnPts?: number; bullet?: 'none' | 'char' | 'num'; buChar?: string; buClr?: Rgba | null; buFont?: string; cap?: boolean; spc?: number;
  spcBef?: number; spcAft?: number; marL?: number; indent?: number;
}

const EMU_PX = 9525; // 96 px на дюйм, как у экспорта в PPTX
const SLIDE_W = 1280, SLIDE_H = 720;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Перенос строк как в PowerPoint: жадный, без ровных строк заголовков (text-wrap: balance / pretty) */
const WRAP = 'text-wrap-style:auto !important';
/**
 * Одинарный интервал PowerPoint — по метрикам шрифта (подъём + спуск + зазор), а не 1,2 размера:
 * у Poppins строка заметно выше, у Arial — ниже. Неизвестный шрифт — 1,2
 */
const NATURAL_LH: Record<string, number> = {
  arial: 1.15, arimo: 1.15, 'liberation sans': 1.15, helvetica: 1.15, calibri: 1.22, carlito: 1.22, cambria: 1.17, caladea: 1.17,
  'times new roman': 1.15, tinos: 1.15, georgia: 1.14, verdana: 1.22, tahoma: 1.21, 'trebuchet ms': 1.16, 'segoe ui': 1.33,
  'century gothic': 1.23, poppins: 1.5, inter: 1.21, raleway: 1.17, montserrat: 1.22, roboto: 1.17, 'open sans': 1.36, lato: 1.2,
  'source sans pro': 1.26, nunito: 1.36, 'pt sans': 1.29, manrope: 1.37, oswald: 1.48, 'playfair display': 1.33, merriweather: 1.26,
  'noto sans': 1.36, 'work sans': 1.17, 'fira sans': 1.2, 'dm sans': 1.3, 'bebas neue': 1.2,
};
const WEIGHT_WORDS = /\s+(thin|extralight|extra light|light|regular|medium|semibold|semi bold|bold|extrabold|extra bold|black|heavy)$/i;
const naturalLh = (font?: string) => (font ? NATURAL_LH[font.trim().toLowerCase().replace(WEIGHT_WORDS, '')] ?? 1.2 : 1.2);
const hexRgba = (h: string): Rgba => { const n = parseInt(h.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; };

/** «Средний стиль 2» PowerPoint (тот, что у новой таблицы) — с акцентом темы или тёмный */
const BUILTIN_TABLE_STYLES: [string, string][] = [
  ['{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}', 'dk1'], ['{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', 'accent1'],
  ['{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}', 'accent2'], ['{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}', 'accent3'],
  ['{00A15C55-8517-42AA-B614-E9B94910E393}', 'accent4'], ['{7DF18680-E054-41AD-8BC1-D1AEF772440D}', 'accent5'],
  ['{93296810-A885-4BE3-A3E7-6D5BEEA58F35}', 'accent6'],
];
function mediumStyle2(c: string): string {
  const ln = (w: number) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln>`;
  const fill = (tint?: number) => `<a:fill><a:solidFill><a:schemeClr val="${c}">${tint ? `<a:tint val="${tint}"/>` : ''}</a:schemeClr></a:solidFill></a:fill>`;
  const strong = (bdr = '') => `<a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${bdr}</a:tcBdr>${fill()}</a:tcStyle>`;
  return `<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
    + `<a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((n) => `<a:${n}>${ln(12700)}</a:${n}>`).join('')}</a:tcBdr>${fill(20000)}</a:tcStyle></a:wholeTbl>`
    + `<a:band1H><a:tcStyle>${fill(40000)}</a:tcStyle></a:band1H><a:band1V><a:tcStyle>${fill(40000)}</a:tcStyle></a:band1V>`
    + `<a:lastCol>${strong()}</a:lastCol><a:firstCol>${strong()}</a:firstCol>`
    + `<a:lastRow>${strong(`<a:top>${ln(38100)}</a:top>`)}</a:lastRow><a:firstRow>${strong(`<a:bottom>${ln(38100)}</a:bottom>`)}</a:firstRow>`
    + `</a:tblStyle>`;
}

/**
 * adapt — «Под темы Slideria»: палитра и шрифты файла запоминаются (deck.origin), и тема из вкладки
 * «Дизайн» перекрашивает слайды. Без него — точная копия файла: цвета и шрифты записаны как есть
 */
export async function convertPptx(data: Buffer | Uint8Array, fileName = 'presentation.pptx', opts: { adapt?: boolean } = {}): Promise<PptxResult> {
  const pkg = await Pkg.open(data);
  const warnings = new Set<string>();
  const warn = (m: string) => warnings.add(m);

  const presPart = 'ppt/presentation.xml';
  const pres = pkg.xml(presPart);
  if (!pres) throw new Error('Это не презентация PowerPoint (.pptx): нет ppt/presentation.xml');
  const sz = one(pres, 'sldSz');
  const cx = num(sz, 'cx') ?? 12192000, cy = num(sz, 'cy') ?? 6858000;
  // Масштаб: слайд вписывается в 1280×720, другие пропорции — по центру
  const k = Math.min(SLIDE_W / (cx / EMU_PX), SLIDE_H / (cy / EMU_PX)) / EMU_PX;
  const ox = (SLIDE_W - cx * k) / 2, oy = (SLIDE_H - cy * k) / 2;
  const ptPx = 12700 * k; // 1 pt в пикселях слайда

  const assets = new Map<string, Buffer>();
  const assetByHash = new Map<string, string>();
  let assetN = 0;
  let sharp: Awaited<typeof import('sharp')>['default'] | null = null;
  try { sharp = (await import('sharp')).default; } catch { sharp = null; }

  /**
   * Картинка из архива → файл в assets/ (с обрезкой); null — формат не поддерживается.
   * aspect — пропорции рамки, в которую PowerPoint растягивает картинку (stretch): файл растягивается
   * так же, и на слайде (кадр «заполнить») ничего не обрезается
   */
  async function asset(part: string, crop: El | null, aspect?: number): Promise<string | null> {
    const raw = await pkg.bytes(part);
    if (!raw) return null;
    let buf: Buffer = raw;
    let ext = path.posix.extname(part).slice(1).toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (['emf', 'wmf', 'wdp', 'jxr'].includes(ext)) { warn(`Картинки ${ext.toUpperCase()} не поддерживаются браузером — пропущены`); return null; }
    if (ext === 'tif' || ext === 'tiff' || ext === 'bmp') {
      if (!sharp) return null;
      buf = await sharp(buf).png().toBuffer(); ext = 'png';
    }
    const l = num(crop, 'l') ?? 0, t = num(crop, 't') ?? 0, r = num(crop, 'r') ?? 0, b = num(crop, 'b') ?? 0;
    if ((l || t || r || b) && sharp && ext !== 'svg' && ext !== 'gif') {
      try {
        const meta = await sharp(buf).metadata();
        const W = meta.width ?? 0, H = meta.height ?? 0;
        const left = Math.max(0, Math.round((W * l) / 100000)), top = Math.max(0, Math.round((H * t) / 100000));
        const width = Math.max(1, Math.min(W - left, Math.round(W * (1 - (l + r) / 100000))));
        const height = Math.max(1, Math.min(H - top, Math.round(H * (1 - (t + b) / 100000))));
        if (width > 0 && height > 0 && (width < W || height < H)) buf = await sharp(buf).extract({ left, top, width, height }).toBuffer();
      } catch { /* обрезать не вышло — целиком */ }
    }
    if (aspect && Number.isFinite(aspect) && sharp && ext !== 'svg' && ext !== 'gif') {
      try {
        const meta = await sharp(buf).metadata();
        const W = meta.width ?? 0, H = meta.height ?? 0;
        // Растягивается одна сторона — без потери точек
        const [nw, nh] = aspect > W / H ? [Math.round(H * aspect), H] : [W, Math.round(W / aspect)];
        if (W && H && Math.abs(W / H / aspect - 1) > 0.01 && nw <= 10000 && nh <= 10000) buf = await sharp(buf).resize(nw, nh, { fit: 'fill' }).toBuffer();
      } catch { /* растянуть не вышло — как есть */ }
    }
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
    if (assetByHash.has(hash)) return assetByHash.get(hash)!;
    const name = `pptx-${++assetN}.${ext}`;
    assets.set(name, buf);
    assetByHash.set(hash, `./assets/${name}`);
    return `./assets/${name}`;
  }

  // ---------- образец, тема ----------
  const themeOf = (masterPart: string): Theme => {
    const tp = pkg.relByType(masterPart, 'theme');
    const th = tp ? pkg.xml(tp) : null;
    const scheme: Record<string, string> = {};
    for (const c of kids(find(th, 'clrScheme'))) {
      const v = kids(c)[0];
      if (!v) continue;
      scheme[c.localName] = v.localName === 'sysClr' ? (attr(v, 'lastClr') ?? '000000') : (attr(v, 'val') ?? '000000');
    }
    const fontScheme = find(th, 'fontScheme');
    const fmt = find(th, 'fmtScheme');
    return {
      scheme,
      major: attr(one(fontScheme, 'majorFont', 'latin'), 'typeface') ?? 'Calibri',
      minor: attr(one(fontScheme, 'minorFont', 'latin'), 'typeface') ?? 'Calibri',
      fills: kids(one(fmt, 'fillStyleLst')),
      lines: kids(one(fmt, 'lnStyleLst')),
      effects: kids(one(fmt, 'effectStyleLst')),
      bgFills: kids(one(fmt, 'bgFillStyleLst')),
    };
  };

  const clrMapOf = (el: El | null): Record<string, string> => {
    const m: Record<string, string> = {};
    if (!el) return m;
    for (let i = 0; i < el.attributes.length; i++) m[el.attributes[i].name] = el.attributes[i].value;
    return m;
  };

  // ---------- стили текста ----------
  function readLevel(lvl: El | null, theme: Theme, cc: ColorCtx, base: TP): TP {
    if (!lvl) return base;
    const out: TP = { ...base };
    const algn = attr(lvl, 'algn'); if (algn) out.algn = algn;
    const marL = num(lvl, 'marL'); if (marL !== null) out.marL = marL;
    const ind = num(lvl, 'indent'); if (ind !== null) out.indent = ind;
    const lp = one(lvl, 'lnSpc', 'spcPct'), lpt = one(lvl, 'lnSpc', 'spcPts');
    if (lp) { out.lnPct = (num(lp, 'val') ?? 100000) / 100000; out.lnPts = undefined; }
    if (lpt) { out.lnPts = (num(lpt, 'val') ?? 0) / 100; out.lnPct = undefined; }
    const sb = one(lvl, 'spcBef', 'spcPts'); if (sb) out.spcBef = (num(sb, 'val') ?? 0) / 100;
    const sa = one(lvl, 'spcAft', 'spcPts'); if (sa) out.spcAft = (num(sa, 'val') ?? 0) / 100;
    if (kid(lvl, 'buNone')) out.bullet = 'none';
    if (kid(lvl, 'buChar')) { out.bullet = 'char'; out.buChar = attr(kid(lvl, 'buChar'), 'char') ?? '•'; }
    if (kid(lvl, 'buClr')) out.buClr = colorIn(kid(lvl, 'buClr'), cc);
    if (kid(lvl, 'buClrTx')) out.buClr = null;
    if (kid(lvl, 'buFont')) out.buFont = attr(kid(lvl, 'buFont'), 'typeface') ?? undefined;
    if (kid(lvl, 'buAutoNum')) out.bullet = 'num';
    return readRun(kid(lvl, 'defRPr'), theme, cc, out);
  }

  function fontName(tf: string | null, theme: Theme): string | undefined {
    if (!tf) return undefined;
    if (tf.startsWith('+mj')) return theme.major;
    if (tf.startsWith('+mn')) return theme.minor;
    return tf;
  }

  function readRun(rp: El | null, theme: Theme, cc: ColorCtx, base: TP): TP {
    if (!rp) return base;
    const out: TP = { ...base };
    const s = num(rp, 'sz'); if (s !== null) out.sz = s / 100;
    const b = bool(rp, 'b'); if (b !== null) out.b = b;
    const i = bool(rp, 'i'); if (i !== null) out.i = i;
    const u = attr(rp, 'u'); if (u !== null) out.u = u !== 'none';
    const cap = attr(rp, 'cap'); if (cap !== null) out.cap = cap === 'all';
    const spc = num(rp, 'spc'); if (spc !== null) out.spc = spc / 100;
    const fill = kid(rp, 'solidFill');
    if (fill) out.color = colorIn(fill, cc);
    else if (kid(rp, 'gradFill')) out.color = colorIn(one(rp, 'gradFill', 'gsLst', 'gs'), cc);
    const f = fontName(attr(kid(rp, 'latin'), 'typeface'), theme) ?? fontName(attr(kid(rp, 'cs'), 'typeface'), theme);
    if (f) out.font = f;
    return out;
  }

  /** Уровни 1…9 из списка стилей (lstStyle, titleStyle, bodyStyle…) поверх base */
  function levels(list: El | null, theme: Theme, cc: ColorCtx, base: TP[]): TP[] {
    return base.map((b, i) => readLevel(kid(list, `lvl${i + 1}pPr`) ?? (i === 0 ? kid(list, 'defPPr') : null), theme, cc, b));
  }

  // ---------- заливка, линия, тень ----------
  type Paint = { kind: 'none' } | { kind: 'solid'; c: Rgba } | { kind: 'grad'; stops: { pos: number; c: Rgba }[]; ang: number; radial: boolean } | { kind: 'blip'; el: El };

  function paintOf(fillEl: El | null, cc: ColorCtx): Paint | null {
    if (!fillEl) return null;
    switch (fillEl.localName) {
      case 'noFill': return { kind: 'none' };
      case 'solidFill': { const c = colorIn(fillEl, cc); return c ? { kind: 'solid', c } : { kind: 'none' }; }
      case 'gradFill': {
        const stops = kids(one(fillEl, 'gsLst'), 'gs').map((g) => ({ pos: (num(g, 'pos') ?? 0) / 100000, c: colorIn(g, cc) ?? { r: 0, g: 0, b: 0, a: 1 } })).sort((a, b) => a.pos - b.pos);
        if (!stops.length) return { kind: 'none' };
        const lin = kid(fillEl, 'lin');
        return { kind: 'grad', stops, ang: (num(lin, 'ang') ?? 5400000) / 60000, radial: !!kid(fillEl, 'path') };
      }
      case 'blipFill': return { kind: 'blip', el: fillEl };
      case 'pattFill': { const c = colorIn(kid(fillEl, 'fgClr'), cc); return c ? { kind: 'solid', c } : { kind: 'none' }; }
      default: return null;
    }
  }
  const FILL_NAMES = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
  const fillChild = (el: El | null) => kids(el).find((c) => FILL_NAMES.includes(c.localName)) ?? null;

  interface Line { c: Rgba | null; grad?: Paint; w: number; dash: string | null; head: string | null; tail: string | null; headW: string; tailW: string; cap: string }

  // ---------- геометрия → SVG ----------
  let gradN = 0;
  /** bbox — рамка, по которой растягивается градиент (x, y — её начало в координатах фигуры) */
  function svgPaint(p: Paint | null, defs: string[], bbox: { x?: number; y?: number; w: number; h: number }): string {
    if (!p || p.kind === 'none') return 'none';
    if (p.kind === 'solid') return p.c.a < 0.999 ? `${hex(p.c)}" fill-opacity="${r1(p.c.a * 100) / 100}` : hex(p.c);
    if (p.kind === 'grad') {
      const id = `g${++gradN}${crypto.randomBytes(2).toString('hex')}`;
      const stops = p.stops.map((s) => `<stop offset="${r1(s.pos * 100)}%" stop-color="${hex(s.c)}"${s.c.a < 0.999 ? ` stop-opacity="${r1(s.c.a * 100) / 100}"` : ''}/>`).join('');
      if (p.radial) defs.push(`<radialGradient id="${id}" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`);
      else {
        // Угол DrawingML: 0° — слева направо, 90° — сверху вниз (по часовой); учитываем пропорции фигуры
        const a = (p.ang * Math.PI) / 180;
        const dx = Math.cos(a) * bbox.w, dy = Math.sin(a) * bbox.h;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const half = (Math.abs(ux) * bbox.w + Math.abs(uy) * bbox.h) / 2;
        const cxp = (bbox.x ?? 0) + bbox.w / 2, cyp = (bbox.y ?? 0) + bbox.h / 2;
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r1(cxp - ux * half)}" y1="${r1(cyp - uy * half)}" x2="${r1(cxp + ux * half)}" y2="${r1(cyp + uy * half)}">${stops}</linearGradient>`);
      }
      return `url(#${id})`;
    }
    return 'none';
  }

  const ARROW: Record<string, string> = {
    triangle: 'M0 0 L10 5 L0 10 Z', arrow: 'M0 0 L10 5 L0 10', stealth: 'M0 0 L10 5 L0 10 L3 5 Z', diamond: 'M0 5 L5 0 L10 5 L5 10 Z', oval: 'M0 5 A5 5 0 1 1 10 5 A5 5 0 1 1 0 5 Z',
  };
  function marker(type: string | null, size: string, color: string, defs: string[], start: boolean, w: number): string {
    if (!type || type === 'none' || !ARROW[type]) return '';
    const id = `m${++gradN}${crypto.randomBytes(2).toString('hex')}`;
    const s = (size === 'sm' ? 2 : size === 'lg' ? 5 : 3) * Math.max(1, w) ;
    const open = type === 'arrow';
    defs.push(`<marker id="${id}" viewBox="-1 -1 12 12" refX="${type === 'oval' || type === 'diamond' ? 5 : 9}" refY="5" markerUnits="userSpaceOnUse" markerWidth="${r1(s * 1.2)}" markerHeight="${r1(s * 1.2)}" orient="${start ? 'auto-start-reverse' : 'auto'}">`
      + `<path d="${ARROW[type]}" fill="${open ? 'none' : color}" stroke="${color}" stroke-width="${open ? 1.6 : 0.5}" stroke-linejoin="round"/></marker>`);
    return `url(#${id})`;
  }

  // ---------- стили таблиц ----------
  // Свои стили файла (ppt/tableStyles.xml) и встроенные в PowerPoint «Средний стиль 2» — их файл лишь называет
  const tableStyles = new Map<string, El>();
  for (const st of kids(pkg.xml('ppt/tableStyles.xml'), 'tblStyle')) tableStyles.set((attr(st, 'styleId') ?? '').toUpperCase(), st);
  for (const [id, scheme] of BUILTIN_TABLE_STYLES) {
    if (!tableStyles.has(id)) tableStyles.set(id, new DOMParser().parseFromString(mediumStyle2(scheme), 'text/xml').documentElement as unknown as El);
  }

  // ---------- слайд ----------
  const presRels = pkg.rels(presPart);
  const slideParts = kids(one(pres, 'sldIdLst'), 'sldId').map((s) => presRels.get(attr(s, 'r:id') ?? attr(s, 'id') ?? '')?.target).filter((t): t is string => !!t && pkg.has(t));
  // Связь в sldId — атрибут r:id; запасной путь — порядок slideN.xml
  if (!slideParts.length) {
    for (let i = 1; pkg.has(`ppt/slides/slide${i}.xml`); i++) slideParts.push(`ppt/slides/slide${i}.xml`);
  }

  const defaultText = one(pres, 'defaultTextStyle');
  const slides: Obj[] = [];
  let firstTitle = '';
  let deckTheme: Theme | null = null;
  let deckCc: ColorCtx | null = null;
  /** Образец каждого слайда: акценты темы файла — по слайдам главного (первого) образца */
  const slideMasters: (string | null)[] = [];

  for (let si = 0; si < slideParts.length; si++) {
    const sp = slideParts[si];
    const slide = pkg.xml(sp);
    if (!slide) continue;
    const layoutPart = pkg.relByType(sp, 'slideLayout');
    const layout = layoutPart ? pkg.xml(layoutPart) : null;
    const masterPart = layoutPart ? pkg.relByType(layoutPart, 'slideMaster') : null;
    const master = masterPart ? pkg.xml(masterPart) : null;
    const theme = masterPart ? themeOf(masterPart) : { scheme: {}, major: 'Calibri', minor: 'Calibri', fills: [], lines: [], effects: [], bgFills: [] };
    const map = { ...clrMapOf(one(master, 'clrMap')), ...clrMapOf(one(layout, 'clrMapOvr', 'overrideClrMapping')), ...clrMapOf(one(slide, 'clrMapOvr', 'overrideClrMapping')) };
    const cc: ColorCtx = { scheme: theme.scheme, map };
    deckTheme ??= theme; deckCc ??= cc;
    const slideNo = si + 1;

    // Базовые уровни: defaultTextStyle презентации и стили образца
    const empty: TP[] = Array.from({ length: 9 }, () => ({}));
    const defLv = levels(defaultText, theme, cc, empty);
    const txStyles = one(master, 'txStyles');
    const cat = {
      title: levels(kid(txStyles, 'titleStyle'), theme, cc, defLv),
      body: levels(kid(txStyles, 'bodyStyle'), theme, cc, defLv),
      other: levels(kid(txStyles, 'otherStyle'), theme, cc, defLv),
    };

    // Плейсхолдеры макета и образца: по idx и по типу
    const phOf = (el: El) => one(el, 'nvSpPr', 'nvPr', 'ph') ?? one(el, 'nvPicPr', 'nvPr', 'ph') ?? one(el, 'nvGraphicFramePr', 'nvPr', 'ph');
    const phList = (root: El | null) => (root ? Array.from(root.getElementsByTagNameNS('*', 'sp')).filter((e) => phOf(e as El)) as El[] : []);
    const layoutPh = phList(layout), masterPh = phList(master);
    const typeOf = (ph: El) => attr(ph, 'type') ?? 'body';
    const sameType = (a: string, b: string) => a === b || ((a === 'title' || a === 'ctrTitle') && (b === 'title' || b === 'ctrTitle')) || ((a === 'body' || a === 'subTitle' || a === 'obj') && (b === 'body' || b === 'subTitle' || b === 'obj'));
    const findPh = (list: El[], ph: El, byIdx: boolean) => {
      const idx = attr(ph, 'idx'), type = typeOf(ph);
      return (byIdx && idx !== null ? list.find((e) => attr(phOf(e)!, 'idx') === idx) : undefined)
        ?? list.find((e) => typeOf(phOf(e)!) === type) ?? list.find((e) => sameType(typeOf(phOf(e)!), type)) ?? null;
    };
    /** Цепочка наследования плейсхолдера: [образец, макет] (без самого элемента) */
    const phChain = (el: El, from: 'slide' | 'layout' | 'master'): El[] => {
      const ph = phOf(el);
      if (!ph || from === 'master') return [];
      const lay = from === 'slide' ? findPh(layoutPh, ph, true) : null;
      const mas = findPh(masterPh, ph, false);
      return [mas, lay].filter((e): e is El => !!e);
    };

    const free: Obj[] = [];
    const ctx = { cc, theme, part: sp };

    // ---------- фон ----------
    const bgEl = one(slide, 'cSld', 'bg') ?? one(layout, 'cSld', 'bg') ?? one(master, 'cSld', 'bg');
    const bgPart = one(slide, 'cSld', 'bg') ? sp : one(layout, 'cSld', 'bg') ? layoutPart! : masterPart!;
    let bg: string | undefined;
    if (bgEl) {
      let fillEl = fillChild(one(bgEl, 'bgPr'));
      let bcc = cc;
      const ref = kid(bgEl, 'bgRef');
      if (!fillEl && ref) {
        const idx = num(ref, 'idx') ?? 0;
        const list = idx >= 1001 ? theme.bgFills : theme.fills;
        fillEl = list[(idx >= 1001 ? idx - 1001 : idx - 1)] ?? null;
        bcc = { ...cc, ph: colorIn(ref, cc) };
      }
      const p = paintOf(fillEl, bcc);
      if (p?.kind === 'solid') bg = hex(p.c);
      else if (p?.kind === 'grad') {
        const stops = p.stops.map((s) => `${css(s.c)} ${r1(s.pos * 100)}%`).join(', ');
        bg = p.radial ? `radial-gradient(circle, ${stops})` : `linear-gradient(${r1(p.ang + 90)}deg, ${stops})`;
      } else if (p?.kind === 'blip') {
        const target = pkg.rel(bgPart, attr(kid(p.el, 'blip'), 'r:embed'));
        const src = target ? await asset(target, kid(p.el, 'srcRect'), kid(p.el, 'stretch') ? SLIDE_W / SLIDE_H : undefined) : null;
        if (src) free.push({ type: 'image', src, fit: 'cover', radius: 0, ...blipAlpha(kid(p.el, 'blip')), locked: true, place: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } });
      }
    }

    // ---------- объекты ----------
    /** Положение элемента (с учётом групп) в пикселях слайда */
    type Tf = (x: number, y: number) => [number, number];
    const baseTf: Tf = (x, y) => [ox + x * k, oy + y * k];
    const boxOf = (xfrm: El | null, tf: Tf, sx: number, sy: number): Box | null => {
      const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
      if (!off || !ext) return null;
      const rot = (num(xfrm, 'rot') ?? 0) / 60000;
      const [x0, y0, cw, ch] = [num(off, 'x') ?? 0, num(off, 'y') ?? 0, num(ext, 'cx') ?? 0, num(ext, 'cy') ?? 0];
      // Фигура, повёрнутая на четверть оборота, в растянутой группе тянется по своей видимой рамке:
      // ширина — растяжением группы по высоте и наоборот (так считает PowerPoint); центр — на своём месте
      const q = ((rot % 180) + 180) % 180;
      const [ssx, ssy] = q >= 45 && q < 135 ? [sy, sx] : [sx, sy];
      const [cx, cy] = tf(x0 + cw / 2, y0 + ch / 2);
      const w = cw * k * ssx, h = ch * k * ssy;
      return { x: cx - w / 2, y: cy - h / 2, w, h, rot, flipH: bool(xfrm, 'flipH') === true, flipV: bool(xfrm, 'flipV') === true };
    };

    const styleRef = (el: El, name: string) => one(el, 'style', name);
    /** Целиком за краем слайда (с учётом поворота — по описанному кругу) */
    const offSlide = (b: Box) => {
      const r = b.rot ? Math.hypot(b.w, b.h) / 2 : 0;
      const cx2 = b.x + b.w / 2, cy2 = b.y + b.h / 2;
      const hw = b.rot ? r : b.w / 2, hh = b.rot ? r : b.h / 2;
      return cx2 + hw <= 0 || cx2 - hw >= SLIDE_W || cy2 + hh <= 0 || cy2 - hh >= SLIDE_H;
    };

    function fillFor(el: El, spPr: El | null, grpFill: Paint | null): Paint | null {
      const fc = fillChild(spPr);
      if (fc?.localName === 'grpFill') return grpFill;
      if (fc) return paintOf(fc, cc);
      const ref = styleRef(el, 'fillRef');
      const idx = num(ref, 'idx') ?? 0;
      if (!ref || idx === 0) return null;
      const list = idx >= 1001 ? theme.bgFills : theme.fills;
      return paintOf(list[idx >= 1001 ? idx - 1001 : idx - 1] ?? null, { ...cc, ph: colorIn(ref, cc) });
    }

    function lineFor(el: El, spPr: El | null): Line | null {
      const ln = kid(spPr, 'ln');
      const ref = styleRef(el, 'lnRef');
      const refIdx = num(ref, 'idx') ?? 0;
      const themeLn = ref && refIdx > 0 ? theme.lines[refIdx - 1] ?? null : null;
      const refCc = { ...cc, ph: colorIn(ref, cc) };
      const lnFill = fillChild(ln);
      let paint: Paint | null = lnFill ? paintOf(lnFill, cc) : themeLn ? paintOf(fillChild(themeLn), refCc) : null;
      if (!paint || paint.kind === 'none' || paint.kind === 'blip') return null;
      const wEmu = num(ln, 'w') ?? num(themeLn, 'w') ?? 9525;
      const dash = attr(kid(ln, 'prstDash'), 'val') ?? attr(kid(themeLn, 'prstDash'), 'val');
      const head = kid(ln, 'headEnd') ?? kid(themeLn, 'headEnd'), tail = kid(ln, 'tailEnd') ?? kid(themeLn, 'tailEnd');
      return {
        c: paint.kind === 'solid' ? paint.c : paint.kind === 'grad' ? paint.stops[0].c : null,
        grad: paint.kind === 'grad' ? paint : undefined,
        w: Math.max(0.5, wEmu * k), dash: dash && dash !== 'solid' ? dash : null,
        head: attr(head, 'type'), tail: attr(tail, 'type'), headW: attr(head, 'w') ?? 'med', tailW: attr(tail, 'w') ?? 'med',
        cap: attr(ln, 'cap') === 'rnd' ? 'round' : 'butt',
      };
    }

    function shadowFor(el: El, spPr: El | null): string | null {
      let eff = one(spPr, 'effectLst');
      let ecc = cc;
      if (!eff) {
        const ref = styleRef(el, 'effectRef');
        const idx = num(ref, 'idx') ?? 0;
        if (ref && idx > 0) { eff = one(theme.effects[idx - 1] ?? null, 'effectLst'); ecc = { ...cc, ph: colorIn(ref, cc) }; }
      }
      const sh = kid(eff, 'outerShdw');
      if (!sh) return null;
      const c = colorIn(sh, ecc) ?? { r: 0, g: 0, b: 0, a: 0.35 };
      const dist = (num(sh, 'dist') ?? 0) * k, dir = ((num(sh, 'dir') ?? 0) / 60000) * (Math.PI / 180), blur = (num(sh, 'blurRad') ?? 0) * k;
      return `drop-shadow(${r1(Math.cos(dir) * dist)}px ${r1(Math.sin(dir) * dist)}px ${r1(blur / 2)}px ${css(c)})`;
    }

    /** Геометрия фигуры в SVG-элементах (в координатах рамки) */
    function shapeSvg(el: El, spPr: El | null, box: Box, defs: string[], grpFill: Paint | null, dx = 0, dy = 0, grpBox?: { x: number; y: number; w: number; h: number }): string {
      const prst = attr(kid(spPr, 'prstGeom'), 'prst');
      const cust = kid(spPr, 'custGeom');
      let paths: GeomPath[];
      if (cust) paths = customPaths(cust, box.w, box.h);
      else {
        if (prst && !knownPreset(prst)) warn(`Фигура «${prst}» заменена прямоугольником`);
        paths = presetPaths(prst ?? 'rect', box.w, box.h, adjusts(kid(spPr, 'prstGeom')));
      }
      const fill = fillFor(el, spPr, grpFill);
      const line = lineFor(el, spPr);
      // Заливка группы (grpFill) — один градиент на всю группу, а не на каждую фигуру
      const fromGroup = fillChild(spPr)?.localName === 'grpFill' && grpBox && !box.rot && !box.flipH && !box.flipV;
      const area = fromGroup ? { x: grpBox!.x - box.x, y: grpBox!.y - box.y, w: grpBox!.w, h: grpBox!.h } : { w: box.w, h: box.h };
      const fillAttr = fill && fill.kind !== 'blip' ? svgPaint(fill, defs, area) : 'none';
      const strokeAttr = line ? (line.grad ? svgPaint(line.grad, defs, box) : line.c ? hex(line.c) : 'none') : 'none';
      const so = line?.c && line.c.a < 0.999 ? ` stroke-opacity="${r1(line.c.a * 100) / 100}"` : '';
      const dash = line?.dash ? ` stroke-dasharray="${line.dash.includes('dot') && !line.dash.includes('Dash') ? `${r1(line.w)} ${r1(line.w * 2)}` : `${r1(line.w * 4)} ${r1(line.w * 3)}`}"` : '';
      const mEnd = line ? marker(line.tail, line.tailW, strokeAttr, defs, false, line.w) : '';
      const mStart = line ? marker(line.head, line.headW, strokeAttr, defs, true, line.w) : '';
      const tf: string[] = [];
      if (dx || dy) tf.push(`translate(${r1(dx)} ${r1(dy)})`);
      if (box.rot) tf.push(`rotate(${r1(box.rot)} ${r1(box.w / 2)} ${r1(box.h / 2)})`);
      if (box.flipH || box.flipV) tf.push(`translate(${box.flipH ? r1(box.w) : 0} ${box.flipV ? r1(box.h) : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})`);
      // Затенённые части (изнанка изогнутой стрелки, бок куба) — заливка с тенью или светом поверх
      const SHADE = { darken: ['#000', 0.4], darkenLess: ['#000', 0.2], lighten: ['#FFF', 0.4], lightenLess: ['#FFF', 0.2] } as const;
      // Сначала заливки всех контуров, потом линии: внутренние линии фигуры не закрываются её заливкой
      const fills = paths.filter((p) => p.fill && fillAttr !== 'none').map((p) => `<path d="${p.d}" fill="${fillAttr}" stroke="none"/>`
        + (p.shade ? `<path d="${p.d}" fill="${SHADE[p.shade][0]}" fill-opacity="${SHADE[p.shade][1]}" stroke="none"/>` : ''));
      const strokes = line && strokeAttr !== 'none' ? paths.filter((p) => p.stroke).map((p) => `<path d="${p.d}" fill="none" stroke="${strokeAttr}" stroke-width="${r1(line.w)}" stroke-linecap="${line.cap}" stroke-linejoin="round"${so}${dash}${mEnd ? ` marker-end="${mEnd}"` : ''}${mStart ? ` marker-start="${mStart}"` : ''}/>`) : [];
      const body = [...fills, ...strokes].join('');
      return tf.length ? `<g transform="${tf.join(' ')}">${body}</g>` : body;
    }

    /** Фигура или группа → html с SVG на своём месте */
    function svgObject(content: string, defs: string[], box: { x: number; y: number; w: number; h: number }, shadow: string | null, pad = 0): Obj {
      const W = Math.max(1, box.w + pad * 2), H = Math.max(1, box.h + pad * 2);
      return {
        type: 'html',
        html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(-pad)} ${r1(-pad)} ${r1(W)} ${r1(H)}" width="100%" height="100%" preserveAspectRatio="none" style="display:block;overflow:visible${shadow ? `;filter:${shadow}` : ''}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${content}</svg>`,
        place: { x: r1(box.x - pad), y: r1(box.y - pad), w: r1(W), h: r1(H) },
      };
    }

    // ---------- текст ----------
    interface Para { runs: { text: string; p: TP }[]; p: TP; lvl: number }

    function paragraphs(txBody: El | null, chainLists: El[], catLv: TP[], fontRefColor: Rgba | null, fontRefFont: string | undefined): Para[] {
      if (!txBody) return [];
      let lv = catLv.map((t) => ({ ...t, ...(fontRefColor ? { color: fontRefColor } : {}), ...(fontRefFont ? { font: fontRefFont } : {}) }));
      for (const l of chainLists) lv = levels(l, theme, cc, lv);
      lv = levels(kid(txBody, 'lstStyle'), theme, cc, lv);
      const out: Para[] = [];
      for (const p of kids(txBody, 'p')) {
        const pPr = kid(p, 'pPr');
        const lvl = Math.min(8, num(pPr, 'lvl') ?? 0);
        const pp = readLevel(pPr, theme, cc, lv[lvl]);
        const runs: Para['runs'] = [];
        for (const r of kids(p)) {
          if (r.localName === 'r') runs.push({ text: textOf(r), p: readRun(kid(r, 'rPr'), theme, cc, pp) });
          else if (r.localName === 'br') runs.push({ text: '\n', p: readRun(kid(r, 'rPr'), theme, cc, pp) });
          else if (r.localName === 'fld') {
            const t = attr(r, 'type') === 'slidenum' ? String(slideNo) : textOf(r);
            runs.push({ text: t, p: readRun(kid(r, 'rPr'), theme, cc, pp) });
          }
        }
        // Пустые фрагменты PowerPoint отбрасывает: строку без букв задаёт конец абзаца
        const endP = readRun(kid(p, 'endParaRPr'), theme, cc, pp);
        out.push({ runs, p: runs.some((r) => r.text) ? pp : { ...pp, sz: endP.sz ?? pp.sz }, lvl });
      }
      return out;
    }

    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*');
    const sameColor = (a?: Rgba | null, b?: Rgba | null) => (!a && !b) || (!!a && !!b && hex(a) === hex(b));

    /** Текст абзацев → разметка Slideria; базовые свойства — у самого длинного фрагмента */
    function markup(paras: Para[], base: TP, gapAfter: (p: Para) => boolean = () => false): string {
      const lines: string[] = [];
      let num1 = 0;
      for (const para of paras) {
        let s = '';
        for (const run of para.runs) {
          if (run.text === '\n') { s += '\n'; continue; }
          let t = esc(run.text);
          if (run.p.cap && !base.cap) t = t.toUpperCase();
          const lead = /^\s*/.exec(t)![0], trail = /\s*$/.exec(t)![0];
          let core = t.slice(lead.length, t.length - trail.length);
          if (!core) { s += t; continue; }
          if (run.p.b && !base.b) core = `**${core}**`;
          if (run.p.i) core = `*${core}*`;
          // Подчёркивание — только разметкой (у оформления текста его нет)
          if (run.p.u) core = `__${core}__`;
          // Свой цвет и свой размер фрагмента (в % от размера абзаца): {#цвет|…}, {s:80|…}, {#цвет s:80|…}
          const col = run.p.color && !sameColor(run.p.color, base.color) ? hex(run.p.color) : '';
          const pct = run.p.sz && base.sz && Math.abs(run.p.sz / base.sz - 1) > 0.03 ? Math.round((run.p.sz / base.sz) * 100) : 0;
          if (pct >= 20 && pct <= 400) core = `{${col ? `${col} ` : ''}s:${pct}|${core}}`;
          else if (col) core = `{${col}|${core}}`;
          s += lead + core + trail;
        }
        const text = para.runs.length ? s : '';
        // Пункт списка (любого уровня: вложенных уровней у текста Slideria нет)
        if (para.p.bullet === 'char' && text.trim()) lines.push(`- ${text.trim()}`);
        else if (para.p.bullet === 'num' && text.trim()) lines.push(`${++num1}. ${text}`);
        else lines.push(text);
        // Отступ после абзаца — пустой строкой (её высота — gap у оформления текста)
        if (gapAfter(para) && para !== paras[paras.length - 1]) lines.push('');
      }
      return lines.join('\n').replace(/\n+$/, '');
    }

    /** Свойства, общие для текста: у самого длинного фрагмента */
    function dominant(paras: Para[]): TP {
      let best: TP | null = null, len = 0;
      for (const para of paras) for (const run of para.runs) if (run.text.trim().length > len) { len = run.text.trim().length; best = run.p; }
      return best ?? paras[0]?.p ?? {};
    }

    /** scale и red — автоподгонка PowerPoint: доля размера шрифта и на сколько сжат межстрочный интервал */
    function textStyles(p: TP, scale: number, red = 0): Obj {
      const st: Obj = {};
      if (p.sz) st.size = r1(p.sz * ptPx * scale);
      if (p.color) st.color = hex(p.color);
      st.weight = p.b ? 700 : 400;
      if (p.font) st.font = p.font;
      if (p.algn === 'ctr') st.align = 'center'; else if (p.algn === 'r') st.align = 'right'; else if (p.algn === 'just' || p.algn === 'dist') st.align = 'justify'; else st.align = 'left';
      const lead = p.lnPts && p.sz ? p.lnPts / p.sz : Math.max(0.5, (p.lnPct ?? 1) - red) * naturalLh(p.font);
      st.leading = Math.round(lead * 100) / 100;
      if (p.cap) st.upper = true;
      if (p.spc && p.sz) st.spacing = Math.round((p.spc / p.sz) * 1000) / 1000;
      return st;
    }

    /**
     * Маркер списка как в файле: свой символ (кроме значков шрифтов Wingdings / Symbol — у них точка)
     * и цвет маркера, а без него — цвет текста, а не акцентный
     */
    function listStyle(paras: Para[], base: TP): Obj {
      const li = paras.find((q) => q.p.bullet === 'char' && q.runs.some((r) => r.text.trim()));
      if (!li) return {};
      const st: Obj = {};
      const ch = (li.p.buChar ?? '•').trim();
      if (ch && !/^[•●∙·]$/.test(ch) && !/wingdings|symbol|webdings/i.test(li.p.buFont ?? '') && [...ch].length <= 2) st.list = ch;
      const c = li.p.buClr ?? dominant([li]).color ?? base.color;
      if (c) st.listColor = hex(c);
      return st;
    }

    /** Текстовое поле → один или несколько text (разные размеры абзацев — стопкой) */
    function textObjects(paras: Para[], box: Box, bodyPr: El[], scale: number, red = 0): Obj[] {
      const visible = paras.filter((p) => p.runs.some((r) => r.text.trim()));
      if (!visible.length) return [];
      const bp = (name: string) => { for (let i = bodyPr.length - 1; i >= 0; i--) { const v = attr(bodyPr[i], name); if (v !== null) return v; } return null; };
      const ins = (name: string, def: number) => (Number(bp(name) ?? def) || 0) * k;
      const pad = [ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720), ins('lIns', 91440)];
      const anchor = bp('anchor') ?? 't';
      const nowrap = bp('wrap') === 'none';
      const vert = bp('vert');
      // Вертикальный текст: поле поворачивается на 90° (vert270 — на −90°), ширина и высота меняются местами
      const turn = vert === 'vert' || vert === 'eaVert' || vert === 'wordArtVertRtl' ? 90 : vert === 'vert270' ? -90 : 0;
      if (vert === 'wordArtVert' || vert === 'mongolianVert') warn('Текст столбиком (буква под буквой) показан повёрнутым');
      if (turn || vert === 'wordArtVert' || vert === 'mongolianVert') {
        const cxb = box.x + box.w / 2, cyb = box.y + box.h / 2;
        box = { ...box, x: cxb - box.h / 2, y: cyb - box.w / 2, w: box.h, h: box.w, rot: (box.rot ?? 0) + (turn || 90) };
      }
      // Группы абзацев одного размера: каждая — свой объект, по очереди сверху вниз
      const groups: Para[][] = [];
      for (const p of paras) {
        const last = groups[groups.length - 1];
        const sz = dominant([p]).sz ?? 18;
        if (last && Math.abs((dominant(last).sz ?? 18) - sz) <= sz * 0.12) last.push(p);
        else groups.push([p]);
      }
      const innerW = Math.max(10, box.w - pad[1] - pad[3]);
      const est = (g: Para[]) => g.reduce((acc, p) => {
        const d = dominant([p]);
        const size = (d.sz ?? 18) * ptPx * scale;
        const lead = d.lnPts && d.sz ? d.lnPts / d.sz : Math.max(0.5, (d.lnPct ?? 1) - red) * naturalLh(d.font);
        const chars = p.runs.map((r) => r.text).join('').length;
        const lines = nowrap ? 1 : Math.max(1, Math.ceil((chars * size * 0.52) / innerW));
        return acc + lines * size * lead + ((d.spcBef ?? 0) + (d.spcAft ?? 0)) * ptPx;
      }, 0);
      const out: Obj[] = [];
      // Прозрачный цвет текста (alpha): у стиля текста цвет без прозрачности — переносим в opacity поля
      const alpha = dominant(paras).color?.a ?? 1;
      const style = (top: number, bottom: number) => {
        const s = [`padding:${r1(top)}px ${r1(pad[1])}px ${r1(bottom)}px ${r1(pad[3])}px`];
        s.push(nowrap ? 'white-space:pre' : 'white-space:pre-wrap');
        // Перенос как в PowerPoint — по максимуму в строку, без выравнивания строк Slideria
        s.push(WRAP);
        if (alpha < 0.999) s.push(`opacity:${r1(alpha * 100) / 100}`);
        return s.join(';');
      };
      // Отступ перед первым абзацем и после последнего — если файл просит (spcFirstLastPara, так пишет Google Slides)
      if (bp('spcFirstLastPara') === '1' || bp('spcFirstLastPara') === 'true') {
        pad[0] += (visible[0].p.spcBef ?? 0) * ptPx;
        pad[2] += (visible[visible.length - 1].p.spcAft ?? 0) * ptPx;
      }
      // Отступы между абзацами (spcBef / spcAft): где они есть — пустая строка высотой в отступ.
      // Если в тексте есть свои пустые абзацы — как раньше (их высота — строка)
      const spacing = (g: Para[]) => {
        const has = (q: Para) => q.runs.some((r) => r.text.trim());
        const real = g.filter(has);
        // Пустой абзац среди текста (не в самом конце) — свой интервал, отступы не трогаем
        if (real.length < 2 || g.slice(0, g.map(has).lastIndexOf(true)).some((q) => !has(q))) return null;
        const gaps = real.slice(0, -1).map((q, i) => ((q.p.spcAft ?? 0) + (real[i + 1].p.spcBef ?? 0)) * ptPx * scale);
        const on = gaps.filter((x) => x > 1);
        if (!on.length) return null;
        const px = r1(on.sort((a, b) => a - b)[Math.floor(on.length / 2)]);
        const after = new Set(real.slice(0, -1).filter((_q, i) => gaps[i] > 1));
        return { px, after: (q: Para) => after.has(q) };
      };
      if (groups.length === 1) {
        const base = dominant(paras);
        const sp = spacing(paras);
        const o: Obj = { type: 'text', text: markup(paras, base, sp?.after), styles: { text: { ...textStyles(base, scale, red), ...listStyle(paras, base), ...(sp ? { gap: sp.px } : {}) } }, place: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) } };
        // По середине и по низу — рамкой (valign): лишний текст уходит вверх, как в PowerPoint
        if (anchor === 'ctr' || anchor === 'b') o.valign = anchor === 'ctr' ? 'middle' : 'bottom';
        o.style = style(pad[0], pad[2]);
        if (box.rot) o.angle = r1(box.rot);
        out.push(o);
        return out;
      }
      const heights = groups.map(est);
      const total = heights.reduce((a, b) => a + b, 0);
      let y = box.y + pad[0];
      if (anchor === 'ctr') y = box.y + (box.h - total) / 2;
      else if (anchor === 'b') y = box.y + box.h - pad[2] - total;
      groups.forEach((g, i) => {
        const base = dominant(g);
        // Стопка без текста (пустые абзацы своего размера) — только место, без объекта
        if (!g.some((q) => q.runs.some((r) => r.text.trim()))) { y += heights[i]; return; }
        const sp = spacing(g);
        out.push({ type: 'text', text: markup(g, base, sp?.after), styles: { text: { ...textStyles(base, scale, red), ...listStyle(g, base), ...(sp ? { gap: sp.px } : {}) } }, style: style(0, 0), place: { x: r1(box.x), y: r1(y), w: r1(box.w) }, ...(box.rot ? { angle: r1(box.rot) } : {}) });
        y += heights[i];
      });
      return out;
    }

    // ---------- обход дерева ----------
    const SIMPLE: Record<string, string> = { rect: 'rect', roundRect: 'round', ellipse: 'ellipse', flowChartProcess: 'rect', flowChartAlternateProcess: 'round', flowChartConnector: 'ellipse' };

    /** Заливка группы для фигур с grpFill: своя или (grpFill / нет) — родительской группы */
    const ownFill = (g: El) => { const fc = fillChild(kid(g, 'grpSpPr')); return !!fc && fc.localName !== 'grpFill'; };
    const groupFill = (g: El, parent: Paint | null): Paint | null => (ownFill(g) ? paintOf(fillChild(kid(g, 'grpSpPr')), cc) : parent);

    /** Только фигуры без текста и картинок — такую группу можно нарисовать одной SVG */
    const vectorOnly = (el: El): boolean => kids(el).every((c) => {
      if (c.localName === 'nvGrpSpPr' || c.localName === 'grpSpPr') return true;
      if (c.localName === 'cxnSp') return true;
      // Тень у отдельной фигуры в общей SVG не нарисовать — такую группу разбираем на объекты
      if (c.localName === 'sp') return !textOf(kid(c, 'txBody')).trim() && fillChild(kid(c, 'spPr'))?.localName !== 'blipFill' && !shadowFor(c, kid(c, 'spPr'));
      if (c.localName === 'grpSp') return vectorOnly(c);
      return false;
    });

    /** Свойства фигуры заготовки (placeholder) с наследованием: своё, иначе у макета, иначе у образца */
    function inheritSpPr(own: El | null, chain: El[]): El | null {
      if (!chain.length) return own;
      const up = [...chain].reverse().map((c) => kid(c, 'spPr')).filter((x): x is El => !!x);
      const has = (x: El | null, k: 'fill' | 'ln' | 'geom') => (k === 'fill' ? !!fillChild(x) : k === 'ln' ? !!kid(x, 'ln') : !!(kid(x, 'prstGeom') || kid(x, 'custGeom')));
      const need = (['fill', 'ln', 'geom'] as const).filter((k) => !has(own, k) && up.some((u) => has(u, k)));
      if (!need.length) return own;
      const doc = (own ?? up[0]).ownerDocument;
      const out = (own ? own.cloneNode(true) : doc.createElementNS(up[0].namespaceURI, up[0].nodeName)) as El;
      for (const k of need) {
        const src = up.find((u) => has(u, k))!;
        const node = k === 'fill' ? fillChild(src) : k === 'ln' ? kid(src, 'ln') : kid(src, 'prstGeom') ?? kid(src, 'custGeom');
        if (node) out.appendChild(node.cloneNode(true));
      }
      return out;
    }

    /** Отражение и поворот группы g: рамка объекта внутри неё — на её место на слайде */
    const groupMove = (g: Box | null) => (b: Box): Box => {
      if (!g || (!g.rot && !g.flipH && !g.flipV)) return b;
      const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2;
      let cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      let { rot, flipH, flipV } = b;
      if (g.flipH) { cx = 2 * gcx - cx; flipH = !flipH; rot = -rot; }
      if (g.flipV) { cy = 2 * gcy - cy; flipV = !flipV; rot = -rot; }
      if (g.rot) {
        const a = (g.rot * Math.PI) / 180, dx = cx - gcx, dy = cy - gcy;
        cx = gcx + dx * Math.cos(a) - dy * Math.sin(a);
        cy = gcy + dx * Math.sin(a) + dy * Math.cos(a);
        rot += g.rot;
      }
      return { ...b, x: cx - b.w / 2, y: cy - b.h / 2, rot: ((rot % 360) + 360) % 360, flipH, flipV };
    };
    const same = (b: Box) => b;

    /** post — повороты и отражения групп, в которые вложен объект (снаружи внутрь) */
    async function walk(tree: El, tf: Tf, sx: number, sy: number, from: 'slide' | 'layout' | 'master', locked: boolean, grpFill: Paint | null, part: string, post: (b: Box) => Box = same): Promise<void> {
      const at = (xfrm: El | null) => { const b = boxOf(xfrm, tf, sx, sy); return b && post(b); };
      for (const el of kids(tree)) {
        const name = el.localName;
        if (name === 'AlternateContent') {
          // Новые возможности с запасным вариантом: берём запасной (Fallback)
          const fb = kid(el, 'Fallback') ?? kid(el, 'Choice');
          if (fb) await walk(fb, tf, sx, sy, from, locked, grpFill, part, post);
          continue;
        }
        if (name === 'grpSp') {
          const gx = one(el, 'grpSpPr', 'xfrm');
          const off = kid(gx, 'off'), ext = kid(gx, 'ext'), chOff = kid(gx, 'chOff'), chExt = kid(gx, 'chExt');
          const gsx = (num(chExt, 'cx') || 1) ? (num(ext, 'cx') ?? 0) / (num(chExt, 'cx') || 1) : 1;
          const gsy = (num(chExt, 'cy') || 1) ? (num(ext, 'cy') ?? 0) / (num(chExt, 'cy') || 1) : 1;
          const [ofx, ofy] = [num(off, 'x') ?? 0, num(off, 'y') ?? 0], [cfx, cfy] = [num(chOff, 'x') ?? 0, num(chOff, 'y') ?? 0];
          const childTf: Tf = (x, y) => tf(ofx + (x - cfx) * gsx, ofy + (y - cfy) * gsy);
          const gf = groupFill(el, grpFill);
          // Поворот и отражение группы — её объектам: их места и углы считаются вокруг центра группы
          const inner = (b: Box) => post(groupMove(boxOf(gx, tf, sx, sy))(b));
          if (vectorOnly(el)) {
            // Вся группа — одна картинка SVG
            const defs: string[] = [];
            const parts: { box: Box; el: El; fill: Paint | null; area?: Box }[] = [];
            const collect = (g: El, t: Tf, a: number, b: number, fill: Paint | null, area: Box | undefined, mv: (b: Box) => Box) => {
              for (const c of kids(g)) {
                if (c.localName === 'sp' || c.localName === 'cxnSp') {
                  const bx = boxOf(one(c, 'spPr', 'xfrm'), t, a, b);
                  if (bx) parts.push({ box: mv(bx), el: c, fill, area });
                } else if (c.localName === 'grpSp') {
                  const x2 = one(c, 'grpSpPr', 'xfrm');
                  const o2 = kid(x2, 'off'), e2 = kid(x2, 'ext'), co2 = kid(x2, 'chOff'), ce2 = kid(x2, 'chExt');
                  const s2x = (num(e2, 'cx') ?? 0) / (num(ce2, 'cx') || 1), s2y = (num(e2, 'cy') ?? 0) / (num(ce2, 'cy') || 1);
                  const own = boxOf(x2, t, a, b);
                  collect(c, (x, y) => t((num(o2, 'x') ?? 0) + (x - (num(co2, 'x') ?? 0)) * s2x, (num(o2, 'y') ?? 0) + (y - (num(co2, 'y') ?? 0)) * s2y), a * s2x, b * s2y, groupFill(c, fill), ownFill(c) ? own ?? area : area, (q) => mv(groupMove(own)(q)));
                }
              }
            };
            collect(el, childTf, sx * gsx, sy * gsy, gf, boxOf(gx, tf, sx, sy) ?? undefined, inner);
            if (!parts.length) continue;
            const minX = Math.min(...parts.map((p) => p.box.x)), minY = Math.min(...parts.map((p) => p.box.y));
            const maxX = Math.max(...parts.map((p) => p.box.x + p.box.w)), maxY = Math.max(...parts.map((p) => p.box.y + p.box.h));
            const body = parts.map((p) => shapeSvg(p.el, kid(p.el, 'spPr'), p.box, defs, p.fill, p.box.x - minX, p.box.y - minY, p.area)).join('');
            const o = svgObject(body, defs, { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, shadowFor(el, kid(el, 'grpSpPr')), 4);
            if (locked) o.locked = true;
            free.push(o);
          } else {
            await walk(el, childTf, sx * gsx, sy * gsy, from, locked, gf, part, inner);
          }
          continue;
        }
        if (name === 'sp' || name === 'cxnSp') {
          const ph = phOf(el);
          // На образце и макете плейсхолдеры — заготовки: показываются только через слайд
          if (ph && from !== 'slide') continue;
          const chain = ph ? phChain(el, from) : [];
          // Заготовка без своей заливки, контура или формы — берёт их у макета, затем у образца
          const spPr = inheritSpPr(kid(el, 'spPr'), chain);
          const xfrm = kid(spPr, 'xfrm') ?? [...chain].reverse().map((c) => one(c, 'spPr', 'xfrm')).find(Boolean) ?? null;
          const box = at(xfrm);
          if (!box || offSlide(box)) continue;
          const txBody = kid(el, 'txBody');
          const warp = attr(find(txBody, 'prstTxWarp'), 'prst');
          if (warp && warp !== 'textNoShape') warn('Фигурный текст (WordArt: по дуге, волной) показан обычной строкой');
          const phType = ph ? typeOf(ph) : '';
          // Дата, колонтитул и номер слайда из макета без текста на слайде — не показываем
          const catLv = !ph ? defLv : phType === 'title' || phType === 'ctrTitle' ? cat.title : ['body', 'subTitle', 'obj'].includes(phType) || (ph && !attr(ph, 'type')) ? cat.body : cat.other;
          const fontRef = styleRef(el, 'fontRef');
          const fontRefColor = fontRef ? colorIn(fontRef, cc) : null;
          const fontRefFont = fontRef ? (attr(fontRef, 'idx') === 'major' ? theme.major : attr(fontRef, 'idx') === 'minor' ? theme.minor : undefined) : undefined;
          const autofit = one(txBody, 'bodyPr', 'normAutofit');
          const scale = autofit ? (num(autofit, 'fontScale') ?? 100000) / 100000 : 1;
          const red = autofit ? (num(autofit, 'lnSpcReduction') ?? 0) / 100000 : 0;
          const paras = paragraphs(txBody, chain.map((c) => one(c, 'txBody', 'lstStyle')).filter((e): e is El => !!e), catLv, fontRefColor, fontRefFont);
          const hasText = paras.some((p) => p.runs.some((r) => r.text.trim()));
          if (ph && phType === 'title' && hasText && !firstTitle) firstTitle = paras.map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim();

          const fill = fillFor(el, spPr, grpFill);
          const line = lineFor(el, spPr);
          const shadow = shadowFor(el, spPr);
          const prst = attr(kid(spPr, 'prstGeom'), 'prst') ?? (kid(spPr, 'custGeom') ? 'custom' : 'rect');
          const visibleFill = fill && fill.kind !== 'none';
          const isLine = prst === 'line' || prst === 'straightConnector1' || name === 'cxnSp';
          const bodyPrs = [...chain.map((c) => one(c, 'txBody', 'bodyPr')), one(txBody, 'bodyPr')].filter((e): e is El => !!e);
          const lockIt = (o: Obj) => { if (locked) o.locked = true; return o; };

          // Картинка внутри фигуры (заливка рисунком)
          if (fill?.kind === 'blip') {
            const target = pkg.rel(part, attr(kid(fill.el, 'blip'), 'r:embed'));
            const src = target ? await asset(target, kid(fill.el, 'srcRect'), kid(fill.el, 'stretch') && box.h ? box.w / box.h : undefined) : null;
            if (src) {
              const radius = prst === 'ellipse' ? 'oval' : prst === 'roundRect' ? r1(Math.min(box.w, box.h) * ((adjusts(kid(spPr, 'prstGeom')).adj ?? 16667) / 100000)) : undefined;
              free.push(lockIt({ type: 'image', src, fit: 'cover', radius: radius ?? 0, ...blipAlpha(kid(fill.el, 'blip')), place: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) }, ...(box.rot ? { angle: r1(box.rot) } : {}) }));
            }
          } else if (isLine && line && !hasText) {
            // Линия: прямая — нашей линией или стрелкой, иначе SVG
            const straight = prst === 'line' || prst === 'straightConnector1';
            const oneHead = (line.tail && line.tail !== 'none') !== (line.head && line.head !== 'none');
            const simpleHead = !line.head || line.head === 'none' || line.head === 'triangle' || line.head === 'arrow';
            const simpleTail = !line.tail || line.tail === 'none' || line.tail === 'triangle' || line.tail === 'arrow';
            if (straight && !line.grad && line.c && simpleHead && simpleTail && (oneHead || (!line.tail || line.tail === 'none') && (!line.head || line.head === 'none'))) {
              let x1 = box.x, y1 = box.y, x2 = box.x + box.w, y2 = box.y + box.h;
              if (box.flipH) [x1, x2] = [x2, x1];
              if (box.flipV) [y1, y2] = [y2, y1];
              if (box.rot) {
                const cxm = box.x + box.w / 2, cym = box.y + box.h / 2, a = (box.rot * Math.PI) / 180;
                const rot = (x: number, y: number): [number, number] => [cxm + (x - cxm) * Math.cos(a) - (y - cym) * Math.sin(a), cym + (x - cxm) * Math.sin(a) + (y - cym) * Math.cos(a)];
                [x1, y1] = rot(x1, y1); [x2, y2] = rot(x2, y2);
              }
              // Стрелка нашей фигуры — на конце; если наконечник у начала — меняем концы местами
              if (line.head && line.head !== 'none') { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
              const len = Math.hypot(x2 - x1, y2 - y1);
              const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
              const hh = Math.max(12, line.w * 4);
              const arrow = oneHead;
              free.push(lockIt({
                type: 'shape', kind: arrow ? 'arrow' : 'line', stroke: hex(line.c), width: r1(line.w),
                ...(line.dash ? { dash: line.dash.includes('dot') && !line.dash.includes('Dash') ? 'dot' : 'dash' } : {}),
                ...(line.c.a < 0.999 ? { opacity: Math.max(0.1, r1(line.c.a * 100) / 100) } : {}),
                ...(Math.abs(ang) > 0.05 ? { angle: r1(ang) } : {}),
                place: { x: r1((x1 + x2) / 2 - len / 2), y: r1((y1 + y2) / 2 - hh / 2), w: r1(Math.max(1, len)), h: r1(hh) },
              }));
            } else {
              const defs: string[] = [];
              free.push(lockIt(svgObject(shapeSvg(el, spPr, { ...box, x: 0, y: 0 }, defs, grpFill), defs, box, shadow, Math.max(6, line.w * 4))));
            }
          } else if (visibleFill || line) {
            // Фигура: простая и сплошная — наша фигура (с текстом внутри), иначе SVG и текст поверх
            const kind = SIMPLE[prst];
            const solid = !fill || fill.kind === 'none' || fill.kind === 'solid';
            const solidLine = !line || (!line.grad && !!line.c && !line.head && !line.tail);
            if (kind && solid && solidLine && !box.flipH && !box.flipV) {
              const o: Obj = { type: 'shape', kind };
              o.fill = fill?.kind === 'solid' ? hex(fill.c) : 'none';
              if (fill?.kind === 'solid' && fill.c.a < 0.999) o.opacity = Math.max(0.1, r1(fill.c.a * 100) / 100);
              if (line?.c) { o.stroke = hex(line.c); o.width = r1(line.w); if (line.dash) o.dash = line.dash.includes('dot') && !line.dash.includes('Dash') ? 'dot' : 'dash'; } else o.width = 0;
              if (kind === 'round') o.radius = r1(Math.min(box.w, box.h) * ((adjusts(kid(spPr, 'prstGeom')).adj ?? 16667) / 100000));
              o.style = ['min-height:0', 'padding:0', shadow ? `filter:${shadow}` : ''].filter(Boolean).join(';');
              if (box.rot) o.angle = r1(box.rot);
              o.place = { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) };
              // Однородный текст — внутри фигуры; сложный — отдельным объектом поверх
              const groupsSame = hasText && new Set(paras.filter((p) => p.runs.length).map((p) => Math.round(dominant([p]).sz ?? 18))).size <= 1;
              if (hasText && groupsSame) {
                const base = dominant(paras);
                o.text = markup(paras, base);
                o.styles = { text: textStyles(base, scale, red) };
                const bp = (n: string) => { for (let i = bodyPrs.length - 1; i >= 0; i--) { const v = attr(bodyPrs[i], n); if (v !== null) return v; } return null; };
                const anchor = bp('anchor') ?? 't';
                o.valign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';
                const ins = (n: string, d: number) => r1((Number(bp(n) ?? d) || 0) * k);
                o.style = ['min-height:0', shadow ? `filter:${shadow}` : '', `padding:${ins('tIns', 45720)}px ${ins('rIns', 91440)}px ${ins('bIns', 45720)}px ${ins('lIns', 91440)}px`, 'overflow:visible', WRAP].filter(Boolean).join(';');
                free.push(lockIt(o));
              } else {
                free.push(lockIt(o));
                if (hasText) for (const t of textObjects(paras, box, bodyPrs, scale, red)) free.push(lockIt(t));
              }
            } else {
              const defs: string[] = [];
              free.push(lockIt(svgObject(shapeSvg(el, spPr, { ...box, x: 0, y: 0 }, defs, grpFill), defs, box, shadow, line ? Math.max(2, line.w) : 0)));
              if (hasText) for (const t of textObjects(paras, box, bodyPrs, scale, red)) free.push(lockIt(t));
            }
          } else if (hasText) {
            for (const t of textObjects(paras, box, bodyPrs, scale, red)) free.push(lockIt(t));
          }
          continue;
        }
        if (name === 'pic') {
          const ph = phOf(el);
          if (ph && from !== 'slide') continue;
          const chain = ph ? phChain(el, from) : [];
          const spPr = kid(el, 'spPr');
          const xfrm = kid(spPr, 'xfrm') ?? [...chain].reverse().map((c) => one(c, 'spPr', 'xfrm')).find(Boolean) ?? null;
          const box = at(xfrm);
          if (box && offSlide(box)) continue;
          if (find(el, 'videoFile') || find(el, 'audioFile') || find(el, 'media')) warn('Видео и звук не переносятся — на их месте обложка; добавьте файл в студии');
          const blipFill = kid(el, 'blipFill');
          const target = pkg.rel(part, attr(kid(blipFill, 'blip'), 'r:embed'));
          if (!box || !target) continue;
          const src = await asset(target, kid(blipFill, 'srcRect'), kid(blipFill, 'stretch') && box.h ? box.w / box.h : undefined);
          if (!src) continue;
          const prst = attr(kid(spPr, 'prstGeom'), 'prst');
          const radius = prst === 'ellipse' ? 'oval' : prst === 'roundRect' ? r1(Math.min(box.w, box.h) * ((adjusts(kid(spPr, 'prstGeom')).adj ?? 16667) / 100000)) : undefined;
          const line = lineFor(el, spPr);
          // Углы — как в файле: у картинки PowerPoint они прямые, а не скруглены темой
          const o: Obj = { type: 'image', src, fit: 'cover', radius: radius ?? 0, ...blipAlpha(kid(blipFill, 'blip')), place: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) } };
          if (line?.c) { o.stroke = hex(line.c); o.width = r1(line.w); }
          if (box.rot) o.angle = r1(box.rot);
          const shadow = shadowFor(el, spPr);
          // Отражение — до поворота (поворот у рамки объекта), как в PowerPoint
          const flip = box.flipH || box.flipV ? `transform:scale(${box.flipH ? -1 : 1},${box.flipV ? -1 : 1})` : '';
          const st = [shadow ? `filter:${shadow}` : '', flip].filter(Boolean).join(';');
          if (st) o.style = st;
          if (locked) o.locked = true;
          free.push(o);
          continue;
        }
        if (name === 'graphicFrame') {
          const box = at(kid(el, 'xfrm'));
          if (!box) continue;
          const tbl = find(el, 'tbl');
          if (tbl) { const o = tableObject(tbl, box); if (o) free.push(o); continue; }
          const chartRef = find(el, 'chart');
          if (chartRef) { const o = chartObject(pkg.rel(part, attr(chartRef, 'r:id')), box); if (o) free.push(o); continue; }
          warn('Объекты SmartArt, OLE и другие встроенные пропущены');
          continue;
        }
      }
    }

    function tableObject(tbl: El, box: Box): Obj | null {
      const cols = kids(one(tbl, 'tblGrid'), 'gridCol').map((g) => num(g, 'w') ?? 1);
      // Ширина таблицы — сумма столбцов (как у PowerPoint); размер рамки в файле бывает условным
      const gridW = cols.reduce((a, b) => a + b, 0) * k;
      if (gridW > 1) box = { ...box, w: gridW };
      const rowsEl = kids(tbl, 'tr');
      if (!rowsEl.length) return null;
      const nR = rowsEl.length, nC = cols.length;
      const tblPr = kid(tbl, 'tblPr');
      const flag = (n: string) => bool(tblPr, n) === true;
      const [fRow, lRow, fCol, lCol, bRow, bCol] = ['firstRow', 'lastRow', 'firstCol', 'lastCol', 'bandRow', 'bandCol'].map(flag);
      const style = tableStyles.get((textOf(kid(tblPr, 'tableStyleId')) || kid(tblPr, 'tableStyleId')?.textContent || '').trim().toUpperCase()) ?? null;

      // Части стиля для ячейки — от общей к частной: вся таблица, полосы, крайние столбцы и строки, углы
      const partsAt = (r: number, c: number): El[] => {
        const names = ['wholeTbl'];
        if (bCol) { const i = c - (fCol ? 1 : 0); if (i >= 0 && !(lCol && c === nC - 1)) names.push(i % 2 ? 'band2V' : 'band1V'); }
        if (bRow) { const i = r - (fRow ? 1 : 0); if (i >= 0 && !(lRow && r === nR - 1)) names.push(i % 2 ? 'band2H' : 'band1H'); }
        if (lCol && c === nC - 1) names.push('lastCol');
        if (fCol && c === 0) names.push('firstCol');
        if (lRow && r === nR - 1) names.push('lastRow');
        if (fRow && r === 0) names.push('firstRow');
        if (fRow && fCol && r === 0 && c === 0) names.push('nwCell');
        if (fRow && lCol && r === 0 && c === nC - 1) names.push('neCell');
        if (lRow && fCol && r === nR - 1 && c === 0) names.push('swCell');
        if (lRow && lCol && r === nR - 1 && c === nC - 1) names.push('seCell');
        return names.map((n) => kid(style, n)).filter((e): e is El => !!e);
      };
      const lnColor = (ln: El | null): { c: Rgba | null; w: number } | undefined => {
        if (!ln) return undefined;
        if (kid(ln, 'noFill')) return { c: null, w: 0 };
        const fc = colorIn(kid(ln, 'solidFill'), cc);
        return fc ? { c: fc, w: (num(ln, 'w') ?? 12700) * k } : undefined;
      };

      type Side = { c: Rgba | null; w: number } | undefined;
      type Cell = { paras: Para[]; p: TP; fill: string; sides: Side[]; algn: string; anchor: string; mar: number[]; len: number };
      const cellOf = (tc: El, r: number, c: number): Cell => {
        const parts = partsAt(r, c);
        // Текст по стилю: жирность, курсив, цвет, шрифт
        const base: TP = {};
        let fill: Paint | null | undefined;
        const sides: Side[] = [undefined, undefined, undefined, undefined]; // слева, справа, сверху, снизу
        for (const part of parts) {
          const tx = kid(part, 'tcTxStyle');
          if (tx) {
            const b = attr(tx, 'b'), i = attr(tx, 'i');
            if (b) base.b = b === 'on';
            if (i) base.i = i === 'on';
            const col = colorIn(tx, cc);
            if (col) base.color = col;
            const fr = kid(tx, 'fontRef');
            const face = attr(one(tx, 'font', 'latin'), 'typeface') ?? (fr ? (attr(fr, 'idx') === 'major' ? theme.major : theme.minor) : null);
            if (face) base.font = fontName(face, theme) ?? face;
          }
          const ts = kid(part, 'tcStyle');
          const fe = kid(ts, 'fill');
          if (fe) fill = paintOf(fillChild(fe), cc);
          const bdr = kid(ts, 'tcBdr');
          if (bdr) {
            const whole = part.localName === 'wholeTbl';
            const rowPart = /Row$|H$/.test(part.localName), colPart = /Col$|V$/.test(part.localName);
            const at = (n: string) => lnColor(kid(kid(bdr, n), 'ln'));
            const pick = (outer: boolean, edge: string, inside: string) => (outer ? at(edge) : at(inside));
            const L = whole || rowPart ? pick(c === 0, 'left', 'insideV') : at('left');
            const R = whole || rowPart ? pick(c === nC - 1, 'right', 'insideV') : at('right');
            const T = whole || colPart ? pick(r === 0, 'top', 'insideH') : at('top');
            const B = whole || colPart ? pick(r === nR - 1, 'bottom', 'insideH') : at('bottom');
            [L, R, T, B].forEach((v, n) => { if (v !== undefined) sides[n] = v; });
          }
        }
        const tcPr = kid(tc, 'tcPr');
        // Своё у ячейки сильнее стиля: заливка и линии
        const own = fillChild(tcPr);
        if (own) fill = paintOf(own, cc);
        ['lnL', 'lnR', 'lnT', 'lnB'].forEach((n, i) => { const v = lnColor(kid(tcPr, n)); if (v !== undefined) sides[i] = v; });
        const lv = defLv.map((l) => ({ ...l, ...(base.b !== undefined ? { b: base.b } : {}), ...(base.i !== undefined ? { i: base.i } : {}), ...(base.color ? { color: base.color } : {}), ...(base.font ? { font: base.font } : {}) }));
        const paras = paragraphs(kid(tc, 'txBody'), [], lv, null, undefined);
        const mar = [num(tcPr, 'marL') ?? 91440, num(tcPr, 'marR') ?? 91440, num(tcPr, 'marT') ?? 45720, num(tcPr, 'marB') ?? 45720].map((v) => v * k);
        return {
          paras, p: dominant(paras), sides, mar,
          fill: fill?.kind === 'solid' ? hex(fill.c) : 'none',
          algn: paras[0]?.p.algn ?? 'l',
          anchor: attr(tcPr, 'anchor') ?? 't',
          len: paras.reduce((a, q) => a + q.runs.reduce((b, x) => b + x.text.trim().length, 0), 0),
        };
      };
      // Все ячейки сетки (закрытые объединением — тоже), объединения — отдельно: [строка, столбец, строк, столбцов]
      const grid = rowsEl.map((tr, r) => kids(tr, 'tc').map((tc, c) => cellOf(tc, r, c)));
      const spans: number[][] = [];
      rowsEl.forEach((tr, r) => kids(tr, 'tc').forEach((tc, c) => {
        const rs = num(tc, 'rowSpan') ?? 1;
        const cs = num(tc, 'gridSpan') ?? 1;
        if (bool(tc, 'hMerge') !== true && bool(tc, 'vMerge') !== true && (rs > 1 || cs > 1)) spans.push([r, c, rs, cs]);
      }));
      // Самое частое значение (по весу)
      const mode = <T>(items: [T, number][]): T | undefined => {
        const m = new Map<string, [T, number]>();
        for (const [v, w] of items) { const key = JSON.stringify(v); const e = m.get(key); m.set(key, [v, (e?.[1] ?? 0) + w]); }
        return [...m.values()].sort((a, b) => b[1] - a[1])[0]?.[0];
      };
      const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
      // Шапка: флажок firstRow или первая строка заметно другого цвета, чем вторая
      const h0 = grid[0]?.[0]?.fill, b0 = grid[1]?.[0]?.fill;
      const firstRow = fRow || (!!h0 && h0 !== 'none' && (!b0 || b0 === 'none' || Math.abs(lum(h0) - lum(b0)) > 40));
      const head = firstRow ? grid[0] : null;
      const body = firstRow ? grid.slice(1) : grid;
      const bodyCells = body.flat();
      // Вес ячейки в «самом частом»: ячейки с текстом решают, пустые — только если текста нет вовсе
      const w = (c: Cell) => (c.len ? c.len * 1000 : 1);
      const px = (sz?: number) => (sz ? r1(sz * ptPx) : 0);

      // Таблица в целом — по самым частым значениям; отличия — у столбцов и ячеек
      const colors: Record<string, string> = {};
      const fillAll = mode(bodyCells.map((c) => [c.fill, 1] as [string, number])) ?? 'none';
      if (fillAll !== 'none') colors.fill = fillAll;
      const headFillAll = head ? mode(head.map((c) => [c.fill, 1] as [string, number])) ?? 'none' : 'none';
      if (head && headFillAll !== 'none') colors.head = headFillAll;
      const textColor = mode(bodyCells.filter((c) => c.p.color).map((c) => [hex(c.p.color!), w(c)] as [string, number]));
      if (textColor) colors.text = textColor;
      const headColor = head ? mode(head.filter((c) => c.p.color).map((c) => [hex(c.p.color!), w(c)] as [string, number])) : undefined;
      if (headColor) colors.headText = headColor;
      const fills = body.map((row) => row.map((c) => (c.fill !== fillAll ? c.fill : null)));
      const headFills = head?.map((c) => (c.fill !== headFillAll ? c.fill : null));
      // Линии: самый частый цвет и толщина видимых; без вертикальных — только горизонтальные
      const sides = grid.flat().flatMap((c) => c.sides);
      const seen = sides.filter((x): x is { c: Rgba; w: number } => !!x?.c && x.w > 0);
      const lineColor = mode(seen.map((x) => [hex(x.c), 1] as [string, number]));
      const lineW = mode(seen.map((x) => [r1(x.w), 1] as [number, number]));
      if (lineColor) colors.line = lineColor;
      const vertical = grid.flat().some((c) => [c.sides[0], c.sides[1]].some((x) => !!x?.c && x.w > 0));

      // Текст: размер и шрифт таблицы, жирность шапки; столбцы, где они другие, — в columns
      const sizeOf = (c: Cell) => c.p.sz ?? c.paras[0]?.p.sz;
      const size = mode(bodyCells.filter(sizeOf).map((c) => [px(sizeOf(c)), w(c)] as [number, number])) ?? 0;
      const font = mode(bodyCells.filter((c) => c.p.font).map((c) => [c.p.font!, w(c)] as [string, number]));
      const columns = Array.from({ length: nC }, (_x, ci) => {
        const list = body.map((row) => row[ci]).filter(Boolean);
        const cs = mode(list.filter(sizeOf).map((c) => [px(sizeOf(c)), w(c)] as [number, number]));
        const cf = mode(list.filter((c) => c.p.font).map((c) => [c.p.font!, w(c)] as [string, number]));
        // Жирный столбец — только если жирные все его ячейки с текстом (снять жирность разметкой нельзя)
        const texts = list.filter((c) => c.len);
        const cb = texts.length > 0 && texts.every((c) => !!c.p.b);
        const o: Obj = {};
        if (cs && Math.abs(cs - size) > 0.5) o.size = cs;
        if (cf && cf !== font) o.font = cf;
        if (cb) o.weight = 700;
        return Object.keys(o).length ? o : null;
      });
      const headSize = head ? mode(head.filter(sizeOf).map((c) => [px(sizeOf(c)), w(c)] as [number, number])) : 0;
      // Шапка обычным начертанием — если в ней нет жирных ячеек; иначе жирная (как у таблиц Slideria)
      const headBold = head ? head.some((c) => c.len && c.p.b) || !head.some((c) => c.len) : true;
      const headFont = head ? mode(head.filter((c) => c.p.font).map((c) => [c.p.font!, w(c)] as [string, number])) : undefined;
      // Выравнивание по столбцам и по вертикали, поля ячеек
      const align = Array.from({ length: nC }, (_x, ci) => {
        const a = mode(body.map((row) => row[ci]).filter(Boolean).map((c) => [c.algn, w(c)] as [string, number])) ?? 'l';
        return a === 'ctr' ? 'center' : a === 'r' ? 'right' : 'left';
      });
      const anchor = mode(grid.flat().map((c) => [c.anchor, 1] as [string, number])) ?? 't';
      const mar = mode(grid.flat().map((c) => [c.mar.map(r1), 1] as [number[], number])) ?? [12.8, 12.8, 6.4, 6.4];
      // Высоты строк — как в файле, но не ниже текста ячеек (у пустой строка тоже есть: по размеру
      // конца абзаца, пустые фрагменты не в счёт) — так строку считает PowerPoint
      const lineH = (c: Cell) => c.paras.reduce((a, q) => a + Math.max(q.p.sz ?? 18, ...q.runs.filter((x) => x.text).map((x) => x.p.sz ?? 18)) * ptPx * naturalLh(q.p.font ?? c.p.font), 0) + c.mar[2] + c.mar[3];
      const hs = rowsEl.map((tr, r) => r1(Math.max((num(tr, 'h') ?? 0) * k, ...grid[r].map(lineH))));

      // Текст ячеек: общий цвет и жирность — у таблицы и столбца, отличия — разметкой (**…**, {#цвет|…})
      const md = (c: Cell, base: TP) => markup(c.paras, { ...c.p, color: base.color ?? c.p.color, b: base.b });
      const bodyBase = (ci: number): TP => ({ color: textColor ? hexRgba(textColor) : undefined, b: !!columns[ci]?.weight });
      const headBase: TP = { color: headColor ? hexRgba(headColor) : undefined, b: headBold };
      const off = head ? 1 : 0;
      const css = [
        `--py:${r1((mar[2] + mar[3]) / 2)}px`, `--px:${r1((mar[0] + mar[1]) / 2)}px`, `--tbl-lh:${naturalLh(font)}`,
        lineW && lineW !== 1 ? `--td-lw:${lineW}px` : '',
        lineColor && !vertical ? '--td-vline:transparent' : '',
        headSize && Math.abs(headSize - size) > 0.5 ? `--th-size:${headSize}px` : '',
        head && !headBold ? '--th-fw:400' : '',
        headFont && headFont !== font ? `--th-font:${fontFamilies(headFont).replace(/"/g, "'")},system-ui,sans-serif` : '',
        font ? `font-family:${fontFamilies(font)},system-ui,sans-serif` : '',
      ].filter(Boolean).join(';');
      return {
        type: 'table',
        variant: 'boxed',
        ...(head ? { header: head.map((c) => md(c, headBase)) } : { head: false, header: grid[0].map(() => '') }),
        rows: body.map((r) => r.map((c, ci) => md(c, bodyBase(ci)))),
        ...(fills.some((r) => r.some(Boolean)) ? { fills } : {}),
        ...(headFills?.some(Boolean) ? { headFills } : {}),
        // Объединения: строки — без шапки (шапка — -1, только по ширине)
        ...(() => {
          const merges = spans.map(([r, c, rs, cs]) => [r - off, c, rs, cs]).filter(([r, , rs]) => r >= 0 || rs === 1);
          if (merges.length < spans.length) warn('Объединение шапки со строками таблицы разделено');
          return merges.length ? { merges } : {};
        })(),
        widths: cols.map((cw) => Math.round((cw / cols.reduce((a, b) => a + b, 0)) * 1000) / 100),
        align,
        ...(anchor === 'ctr' ? {} : { valign: anchor === 'b' ? 'bottom' : 'top' }),
        ...(columns.some(Boolean) ? { columns } : {}),
        ...(head && hs[0] ? { headHeight: hs[0] } : {}),
        ...(hs.slice(off).some(Boolean) ? { heights: hs.slice(off) } : {}),
        ...(size ? { size } : {}),
        colors,
        style: css,
        place: { x: r1(box.x), y: r1(box.y), w: r1(box.w) },
      };
    }

    function chartObject(chartPart: string | null, box: Box): Obj | null {
      const ch = chartPart ? pkg.xml(chartPart) : null;
      if (!ch) return null;
      const plot = find(ch, 'plotArea');
      const kind = kids(plot).find((c) => /Chart$/.test(c.localName));
      const ser = kid(kind, 'ser');
      if (!kind || !ser) return null;
      const pts = (el: El | null) => kids(find(el, 'numCache') ?? find(el, 'strCache'), 'pt').map((p) => textOf(kid(p, 'v')) || (kid(p, 'v')?.textContent ?? ''));
      const values = pts(kid(ser, 'val')).map(Number).filter(Number.isFinite);
      const labels = pts(kid(ser, 'cat'));
      if (!values.length) return null;
      const place = { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) };
      if (kind.localName === 'lineChart' || kind.localName === 'areaChart' || kind.localName === 'scatterChart') {
        return { type: 'line-chart', values, ...(labels.length ? { start: labels[0], end: labels[labels.length - 1] } : {}), scale: 1, place };
      }
      if (kind.localName !== 'barChart' && kind.localName !== 'bar3DChart') warn(`Диаграмма «${kind.localName}» показана столбцами`);
      // Несколько рядов друг на друге (накопление или перекрытие 100 %) — суммой; ряд с одним
      // значением поверх основного — выделенный столбец (так пишет экспорт Slideria)
      const series = kids(kind, 'ser').map((x) => pts(kid(x, 'val')).map(Number));
      const grouping = attr(kid(kind, 'grouping'), 'val');
      const overlaid = series.length > 1 && (grouping === 'stacked' || grouping === 'percentStacked' || num(kid(kind, 'overlap'), 'val') === 100);
      let highlight: number | false = false;
      let sum = values;
      if (overlaid) {
        sum = values.map((_, i) => series.reduce((a, r) => a + (Number.isFinite(r[i]) ? r[i] : 0), 0));
        const extra = series.slice(1).flatMap((r) => r.map((v, i) => (v ? i : -1))).filter((i) => i >= 0);
        if (series.length === 2 && extra.length === 1) highlight = extra[0];
      }
      return { type: 'bars', values: sum, ...(labels.length ? { labels } : {}), highlight, height: Math.max(80, r1(box.h - 40)), place };
    }

    // Образец → макет → слайд (showMasterSp="0" скрывает фигуры уровнем выше)
    const showMaster = bool(slide, 'showMasterSp') !== false && bool(layout, 'showMasterSp') !== false;
    if (master && masterPart && showMaster) await walk(one(master, 'cSld', 'spTree')!, baseTf, 1, 1, 'master', true, null, masterPart);
    if (layout && layoutPart && bool(slide, 'showMasterSp') !== false) await walk(one(layout, 'cSld', 'spTree')!, baseTf, 1, 1, 'layout', true, null, layoutPart);
    await walk(one(slide, 'cSld', 'spTree')!, baseTf, 1, 1, 'slide', false, null, sp);
    void ctx;

    // Заметки докладчика
    let notes = '';
    const notesPart = pkg.relByType(sp, 'notesSlide');
    const notesXml = notesPart ? pkg.xml(notesPart) : null;
    if (notesXml) {
      for (const s of Array.from(notesXml.getElementsByTagNameNS('*', 'sp')) as El[]) {
        const ph = phOf(s);
        if (ph && typeOf(ph) === 'body') notes = kids(kid(s, 'txBody'), 'p').map((p) => textOf(p)).join('\n').trim();
      }
    }

    if (find(one(slide, 'timing'), 'par')) warn('Анимации PowerPoint не переносятся — появление объектов задаётся в студии, вкладка «Анимация»');
    const tr = one(slide, 'transition');
    const trKind = kids(tr).find((c) => c.localName !== 'extLst')?.localName;
    const transition = trKind === 'fade' ? 'fade' : trKind === 'push' || trKind === 'cover' || trKind === 'pull' ? 'push' : trKind === 'zoom' ? 'zoom' : undefined;
    const label = (() => {
      for (const s of Array.from(slide.getElementsByTagNameNS('*', 'sp')) as El[]) {
        const ph = phOf(s);
        if (ph && (typeOf(ph) === 'title' || typeOf(ph) === 'ctrTitle')) { const t = textOf(kid(s, 'txBody')).trim(); if (t) return t.slice(0, 80); }
      }
      return `Слайд ${slideNo}`;
    })();
    const o: Obj = { id: `s${slideNo}`, template: 'canvas', label };
    if (bool(slide, 'show') === false) o.label = `${label} (скрытый в PowerPoint)`;
    if (bg) o.bg = bg;
    if (transition) o.transition = transition;
    o.free = free;
    if (notes) o.notes = notes;
    slides.push(o);
    slideMasters.push(masterPart);
  }

  // Заголовок: свойства файла → первый заголовок → имя файла
  const core = pkg.xml('docProps/core.xml');
  const coreTitle = core ? textOf(find(core, 'title')) || (find(core, 'title')?.textContent ?? '') : '';
  // Название из свойств файла, если это не заглушка PowerPoint; иначе — имя файла или первый заголовок
  const generic = /^(PowerPoint Presentation|Презентация PowerPoint|Presentation\d*|Презентация\d*)$/i.test(coreTitle.trim());
  const fromFile = path.basename(fileName).replace(/\.pptx$/i, '');
  const title = (!generic && coreTitle.trim()) || (fromFile && fromFile !== 'presentation' ? fromFile : '') || firstTitle || 'Презентация';
  // Язык — самый частый у фрагментов текста (lang="en-US" → en)
  const langs = new Map<string, number>();
  for (const part of slideParts) {
    for (const r of Array.from(pkg.xml(part)?.getElementsByTagNameNS('*', 'rPr') ?? [])) {
      const l = (attr(r as El, 'lang') ?? '').split('-')[0].toLowerCase();
      if (/^[a-z]{2,3}$/.test(l)) langs.set(l, (langs.get(l) ?? 0) + 1);
    }
  }
  const lang = [...langs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ru';
  const deck: Obj = { title, lang };
  const sch = (n: string) => (deckCc ? deckCc.scheme[deckCc.map[n] ?? n] : undefined);
  if (opts.adapt) {
    // Картинка фоном на весь слайд — только для темы «Как в файле» (fileBg); под ней цвет её тона,
    // и другая тема перекрашивает слайд целиком, как слайд со сплошным фоном
    for (const s of slides) {
      const first = (s.free as Obj[] | undefined)?.[0];
      const buf = fullImage(first) && typeof first!.src === 'string' ? assets.get(first!.src.replace('./assets/', '')) : undefined;
      if (!buf || !sharp) continue;
      try {
        const st = await sharp(buf).flatten({ background: isHex6(s.bg) ? s.bg : '#FFFFFF' }).stats();
        s.bg = `#${st.channels.slice(0, 3).map((c) => Math.round(c.mean).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
        first!.fileBg = true;
      } catch { /* тон не посчитать — слайд остаётся в цветах файла */ }
    }
    // Узоры образца и макета (полупрозрачные или крупные картинки) — тоже фон файла; логотипы остаются
    for (const s of slides) {
      for (const o of (s.free as Obj[] | undefined) ?? []) {
        const pl = o.place as { w: number; h: number } | undefined;
        if (o.type === 'image' && o.locked === true && pl && (Number(o.opacity ?? 1) < 1 || pl.w * pl.h >= SLIDE_W * SLIDE_H * 0.25)) o.fileBg = true;
      }
    }
    Object.assign(deck, fileTheme(slides, sch, slideMasters.map((m) => m === slideMasters[0])));
  }
  else {
    // Как в файле: только акценты темы файла — для кнопок показа и того, что добавят в студии
    const acc = sch('accent1'), acc2 = sch('accent2');
    if (acc || acc2) deck.theme = { ...(acc ? { accent: `#${acc.toUpperCase()}` } : {}), ...(acc2 ? { accent2: `#${acc2.toUpperCase()}` } : {}) };
  }
  deck.slides = slides;
  return { title, deck, assets, warnings: [...warnings], slides: slides.length };
}

const HEX_ALL = /#[0-9A-F]{6}\b/g;
/** Прозрачность картинки (alphaModFix у blip) → opacity объекта */
const blipAlpha = (blip: El | null): Obj => {
  const a = num(kid(blip, 'alphaModFix'), 'amt') ?? 100000;
  return a < 99500 ? { opacity: Math.max(0.05, Math.round(a / 1000) / 100) } : {};
};
/** Закреплённая картинка на весь слайд — фон из файла */
const fullImage = (o: Obj | undefined) => {
  const pl = o?.place as { x: number; y: number; w: number; h: number } | undefined;
  return o?.type === 'image' && o.locked === true && !!pl && pl.x <= 1 && pl.y <= 1 && pl.w >= SLIDE_W - 2 && pl.h >= SLIDE_H - 2;
};
const isHex6 = (v: unknown): v is string => typeof v === 'string' && /^#[0-9A-F]{6}$/i.test(v);

/**
 * Тема «Как в файле» и палитра файла (deck.origin): по ней цвета слайдов следуют за темой,
 * которую выберут во вкладке «Дизайн». Шрифты заголовков и текста файла становятся шрифтами темы —
 * у текста они больше не записываются, и другая тема меняет их на свои
 */
function fileTheme(slides: Obj[], sch: (n: string) => string | undefined, main: boolean[]): Obj {
  const up = (h: string | undefined, def: string) => `#${(h && /^[0-9A-F]{6}$/i.test(h) ? h : def).toUpperCase()}`;
  // Фон и текст файла — какие на слайдах на самом деле (схема темы бывает не про них: у шаблонов
  // Google Slides bg1 светлый, а слайды тёмные): самый частый фон основного образца и самый
  // частый цвет текста, если он читается на этом фоне
  const top1 = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  const bgs = new Map<string, number>();
  slides.forEach((s, i) => { if (main[i]) { const b = isHex6(s.bg) ? s.bg.toUpperCase() : up(sch('bg1'), 'FFFFFF'); bgs.set(b, (bgs.get(b) ?? 0) + 1); } });
  const bg = top1(bgs) ?? up(sch('bg1'), 'FFFFFF');
  const txs = new Map<string, number>();
  slides.forEach((s, i) => {
    if (!main[i]) return;
    for (const o of (s.free as Obj[] | undefined) ?? []) {
      const c = (o.styles as { text?: { color?: unknown } } | undefined)?.text?.color;
      if (isHex6(c) && typeof o.text === 'string') txs.set(c.toUpperCase(), (txs.get(c.toUpperCase()) ?? 0) + o.text.length);
    }
  });
  const txTop = top1(txs);
  const txScheme = up(sch('tx1'), '000000');
  const tx = txTop && contrast(txTop, bg) >= 3 ? txTop : contrast(txScheme, bg) >= 3 ? txScheme : (contrast('#FFFFFF', bg) > contrast('#000000', bg) ? '#FFFFFF' : '#000000');
  // Фон слайда, совпадающий с фоном темы, — от темы (у другой темы — её фон с узором)
  for (const s of slides) if (isHex6(s.bg) && s.bg.toUpperCase() === bg) delete s.bg;
  // Слайд с картинкой фоном, тон которой не посчитать: текст подобран к картинке — цвета как в файле
  for (const s of slides) {
    const first = (s.free as Obj[] | undefined)?.[0];
    if (fullImage(first) && first!.fileBg !== true) s.recolor = false;
  }
  // Цвета слайдов по частоте — на скольких слайдах встречаются (набор иконок в конце шаблона
  // с сотнями фигур не перевешивает оформление); семейства цветных — акценты
  // Слайды других образцов (приложения шаблона в своём стиле) дают только запасные акценты
  const counts = new Map<string, number>();
  slides.forEach((s, i) => {
    if (s.recolor === false) return;
    for (const h of new Set(JSON.stringify(s).match(HEX_ALL) ?? [])) counts.set(h, (counts.get(h) ?? 0) + (main[i] ? 1000 : 1));
  });
  const accents = colorFamilies(counts);
  const acc1 = accents[0] ?? up(sch('accent1'), '2563EB');
  // Шрифты: заголовков — у крупного текста (от 28 px), текста — у остального; по объёму текста
  type St = { size?: number; font?: string };
  const styled: { st: St; len: number }[] = [];
  const tables: Obj[] = [];
  slides.forEach((s, i) => {
    for (const o of (s.free as Obj[] | undefined) ?? []) {
      const st = (o.styles as { text?: St } | undefined)?.text;
      if (st && typeof o.text === 'string') styled.push({ st, len: o.text.length * (main[i] ? 1000 : 1) });
      if (o.type === 'table') tables.push(o);
    }
  });
  const top = (big: boolean) => {
    const m = new Map<string, number>();
    for (const { st, len } of styled) if (st.font && (Number(st.size) >= 28) === big) m.set(st.font, (m.get(st.font) ?? 0) + len);
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const body = top(false);
  const head = top(true) ?? body;
  // «Poppins ExtraBold» при шрифте заголовков Poppins — тот же шрифт с насыщенностью 800
  const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
  for (const { st } of styled) {
    const role = Number(st.size) >= 28 ? head : body;
    if (!st.font || !role) continue;
    const w = st.font.startsWith(`${role} `) ? WEIGHTS[st.font.slice(role.length + 1).replace(/[\s-]/g, '').toLowerCase()] : undefined;
    if (st.font === role) delete st.font;
    else if (w) {
      delete st.font;
      (st as { weight?: number }).weight = w;
    }
  }
  if (body) {
    for (const t of tables) {
      if (typeof t.style === 'string') t.style = t.style.replace(`;font-family:${fontFamilies(body)},system-ui,sans-serif`, '');
    }
  }
  const mode = lightness(bg) >= 0.6 ? 'light' : 'dark';
  const theme: Obj = {
    accent: acc1,
    ...(accents[1] ? { accent2: accents[1] } : {}),
    mode,
    [mode]: { bg, tx },
    ...(body ? { font: body } : {}),
    ...(head && head !== body ? { head } : {}),
    bg: 'plain',
  };
  const colors = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  return {
    theme: { preset: 'file', ...structuredClone(theme) },
    ...(colors.length ? { origin: { bg, tx, ...(accents.length ? { accents } : {}), colors, theme } } : {}),
  };
}
