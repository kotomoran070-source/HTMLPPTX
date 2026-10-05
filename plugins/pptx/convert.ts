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
import { type ColorCtx, type Rgba, colorIn, css, hex } from './color';
import { type GeomPath, PRESETS, adjusts, customPaths, presetPaths } from './geom';
import { type El, Pkg, attr, bool, find, kid, kids, num, one, textOf } from './xml';

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
  lnPct?: number; lnPts?: number; bullet?: 'none' | 'char' | 'num'; buChar?: string; cap?: boolean; spc?: number;
  spcBef?: number; spcAft?: number; marL?: number; indent?: number;
}

const EMU_PX = 9525; // 96 px на дюйм, как у экспорта в PPTX
const SLIDE_W = 1280, SLIDE_H = 720;
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function convertPptx(data: Buffer | Uint8Array, fileName = 'presentation.pptx'): Promise<PptxResult> {
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

  /** Картинка из архива → файл в assets/ (с обрезкой); null — формат не поддерживается */
  async function asset(part: string, crop: El | null): Promise<string | null> {
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
        const src = target ? await asset(target, kid(p.el, 'srcRect')) : null;
        if (src) free.push({ type: 'image', src, fit: 'cover', locked: true, place: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } });
      }
    }

    // ---------- объекты ----------
    /** Положение элемента (с учётом групп) в пикселях слайда */
    type Tf = (x: number, y: number) => [number, number];
    const baseTf: Tf = (x, y) => [ox + x * k, oy + y * k];
    const boxOf = (xfrm: El | null, tf: Tf, sx: number, sy: number): Box | null => {
      const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
      if (!off || !ext) return null;
      const [x, y] = tf(num(off, 'x') ?? 0, num(off, 'y') ?? 0);
      return { x, y, w: (num(ext, 'cx') ?? 0) * k * sx, h: (num(ext, 'cy') ?? 0) * k * sy, rot: (num(xfrm, 'rot') ?? 0) / 60000, flipH: bool(xfrm, 'flipH') === true, flipV: bool(xfrm, 'flipV') === true };
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
        if (prst && !PRESETS.has(prst)) warn(`Фигура «${prst}» заменена прямоугольником`);
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
      const body = paths.map((p) => `<path d="${p.d}" fill="${p.fill ? fillAttr : 'none'}" stroke="${p.stroke ? strokeAttr : 'none'}"${p.stroke && line ? ` stroke-width="${r1(line.w)}" stroke-linecap="${line.cap}" stroke-linejoin="round"${so}${dash}${mEnd ? ` marker-end="${mEnd}"` : ''}${mStart ? ` marker-start="${mStart}"` : ''}` : ''}/>`).join('');
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
        const endP = readRun(kid(p, 'endParaRPr'), theme, cc, pp);
        out.push({ runs, p: runs.length ? pp : { ...pp, sz: endP.sz ?? pp.sz }, lvl });
      }
      return out;
    }

    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*');
    const sameColor = (a?: Rgba | null, b?: Rgba | null) => (!a && !b) || (!!a && !!b && hex(a) === hex(b));

    /** Текст абзацев → разметка Slideria; базовые свойства — у самого длинного фрагмента */
    function markup(paras: Para[], base: TP): string {
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
          if (run.p.u && !base.u) core = `__${core}__`;
          if (run.p.color && !sameColor(run.p.color, base.color)) core = `{${hex(run.p.color)}|${core}}`;
          s += lead + core + trail;
        }
        const text = para.runs.length ? s : '';
        if (para.p.bullet === 'char' && text.trim()) lines.push(`${'  '.repeat(para.lvl)}- ${text}`);
        else if (para.p.bullet === 'num' && text.trim()) lines.push(`${++num1}. ${text}`);
        else lines.push(text);
      }
      return lines.join('\n').replace(/\n+$/, '');
    }

    /** Свойства, общие для текста: у самого длинного фрагмента */
    function dominant(paras: Para[]): TP {
      let best: TP | null = null, len = -1;
      for (const para of paras) for (const run of para.runs) if (run.text.trim().length > len) { len = run.text.trim().length; best = run.p; }
      return best ?? paras[0]?.p ?? {};
    }

    function textStyles(p: TP, scale: number): Obj {
      const st: Obj = {};
      if (p.sz) st.size = r1(p.sz * ptPx * scale);
      if (p.color) st.color = hex(p.color);
      st.weight = p.b ? 700 : 400;
      if (p.font) st.font = p.font;
      if (p.algn === 'ctr') st.align = 'center'; else if (p.algn === 'r') st.align = 'right'; else if (p.algn === 'just' || p.algn === 'dist') st.align = 'justify'; else st.align = 'left';
      const lead = p.lnPts && p.sz ? p.lnPts / p.sz : (p.lnPct ?? 1) * 1.2;
      st.leading = Math.round(lead * 100) / 100;
      if (p.cap) st.upper = true;
      if (p.spc && p.sz) st.spacing = Math.round((p.spc / p.sz) * 1000) / 1000;
      return st;
    }

    /** Текстовое поле → один или несколько text (разные размеры абзацев — стопкой) */
    function textObjects(paras: Para[], box: Box, bodyPr: El[], scale: number): Obj[] {
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
        const lead = d.lnPts && d.sz ? d.lnPts / d.sz : (d.lnPct ?? 1) * 1.2;
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
        if (alpha < 0.999) s.push(`opacity:${r1(alpha * 100) / 100}`);
        return s.join(';');
      };
      if (groups.length === 1) {
        const base = dominant(paras);
        const o: Obj = { type: 'text', text: markup(paras, base), styles: { text: textStyles(base, scale) }, place: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) } };
        const v = anchor === 'ctr' ? ';flex:none;margin-block:auto' : anchor === 'b' ? ';flex:none;margin-top:auto' : '';
        o.style = style(pad[0], pad[2]) + v;
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
        out.push({ type: 'text', text: markup(g, base), styles: { text: textStyles(base, scale) }, style: style(0, 0), place: { x: r1(box.x), y: r1(y), w: r1(box.w) }, ...(box.rot ? { angle: r1(box.rot) } : {}) });
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

    async function walk(tree: El, tf: Tf, sx: number, sy: number, from: 'slide' | 'layout' | 'master', locked: boolean, grpFill: Paint | null, part: string): Promise<void> {
      for (const el of kids(tree)) {
        const name = el.localName;
        if (name === 'AlternateContent') {
          // Новые возможности с запасным вариантом: берём запасной (Fallback)
          const fb = kid(el, 'Fallback') ?? kid(el, 'Choice');
          if (fb) await walk(fb, tf, sx, sy, from, locked, grpFill, part);
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
          if (num(gx, 'rot')) warn('Повёрнутые группы разобраны на объекты без поворота группы');
          if (vectorOnly(el)) {
            // Вся группа — одна картинка SVG
            const defs: string[] = [];
            const parts: { box: Box; el: El; fill: Paint | null; area?: Box }[] = [];
            const collect = (g: El, t: Tf, a: number, b: number, fill: Paint | null, area: Box | undefined) => {
              for (const c of kids(g)) {
                if (c.localName === 'sp' || c.localName === 'cxnSp') {
                  const bx = boxOf(one(c, 'spPr', 'xfrm'), t, a, b);
                  if (bx) parts.push({ box: bx, el: c, fill, area });
                } else if (c.localName === 'grpSp') {
                  const x2 = one(c, 'grpSpPr', 'xfrm');
                  const o2 = kid(x2, 'off'), e2 = kid(x2, 'ext'), co2 = kid(x2, 'chOff'), ce2 = kid(x2, 'chExt');
                  const s2x = (num(e2, 'cx') ?? 0) / (num(ce2, 'cx') || 1), s2y = (num(e2, 'cy') ?? 0) / (num(ce2, 'cy') || 1);
                  collect(c, (x, y) => t((num(o2, 'x') ?? 0) + (x - (num(co2, 'x') ?? 0)) * s2x, (num(o2, 'y') ?? 0) + (y - (num(co2, 'y') ?? 0)) * s2y), a * s2x, b * s2y, groupFill(c, fill), ownFill(c) ? boxOf(x2, t, a, b) ?? area : area);
                }
              }
            };
            collect(el, childTf, sx * gsx, sy * gsy, gf, boxOf(gx, tf, sx, sy) ?? undefined);
            if (!parts.length) continue;
            const minX = Math.min(...parts.map((p) => p.box.x)), minY = Math.min(...parts.map((p) => p.box.y));
            const maxX = Math.max(...parts.map((p) => p.box.x + p.box.w)), maxY = Math.max(...parts.map((p) => p.box.y + p.box.h));
            const body = parts.map((p) => shapeSvg(p.el, kid(p.el, 'spPr'), p.box, defs, p.fill, p.box.x - minX, p.box.y - minY, p.area)).join('');
            const o = svgObject(body, defs, { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, shadowFor(el, kid(el, 'grpSpPr')), 4);
            if (locked) o.locked = true;
            free.push(o);
          } else {
            await walk(el, childTf, sx * gsx, sy * gsy, from, locked, gf, part);
          }
          continue;
        }
        if (name === 'sp' || name === 'cxnSp') {
          const ph = phOf(el);
          // На образце и макете плейсхолдеры — заготовки: показываются только через слайд
          if (ph && from !== 'slide') continue;
          const chain = ph ? phChain(el, from) : [];
          const spPr = kid(el, 'spPr');
          const xfrm = kid(spPr, 'xfrm') ?? [...chain].reverse().map((c) => one(c, 'spPr', 'xfrm')).find(Boolean) ?? null;
          const box = boxOf(xfrm, tf, sx, sy);
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
            const src = target ? await asset(target, kid(fill.el, 'srcRect')) : null;
            if (src) {
              const radius = prst === 'ellipse' ? 'circle' : prst === 'roundRect' ? r1(Math.min(box.w, box.h) * ((adjusts(kid(spPr, 'prstGeom')).adj ?? 16667) / 100000)) : undefined;
              free.push(lockIt({ type: 'image', src, fit: 'cover', ...(radius !== undefined ? { radius } : {}), place: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) }, ...(box.rot ? { angle: r1(box.rot) } : {}) }));
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
                o.styles = { text: textStyles(base, scale) };
                const bp = (n: string) => { for (let i = bodyPrs.length - 1; i >= 0; i--) { const v = attr(bodyPrs[i], n); if (v !== null) return v; } return null; };
                const anchor = bp('anchor') ?? 't';
                o.valign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';
                const ins = (n: string, d: number) => r1((Number(bp(n) ?? d) || 0) * k);
                o.style = ['min-height:0', shadow ? `filter:${shadow}` : '', `padding:${ins('tIns', 45720)}px ${ins('rIns', 91440)}px ${ins('bIns', 45720)}px ${ins('lIns', 91440)}px`, 'overflow:visible'].filter(Boolean).join(';');
                free.push(lockIt(o));
              } else {
                free.push(lockIt(o));
                if (hasText) for (const t of textObjects(paras, box, bodyPrs, scale)) free.push(lockIt(t));
              }
            } else {
              const defs: string[] = [];
              free.push(lockIt(svgObject(shapeSvg(el, spPr, { ...box, x: 0, y: 0 }, defs, grpFill), defs, box, shadow, line ? Math.max(2, line.w) : 0)));
              if (hasText) for (const t of textObjects(paras, box, bodyPrs, scale)) free.push(lockIt(t));
            }
          } else if (hasText) {
            for (const t of textObjects(paras, box, bodyPrs, scale)) free.push(lockIt(t));
          }
          continue;
        }
        if (name === 'pic') {
          const ph = phOf(el);
          if (ph && from !== 'slide') continue;
          const chain = ph ? phChain(el, from) : [];
          const spPr = kid(el, 'spPr');
          const xfrm = kid(spPr, 'xfrm') ?? [...chain].reverse().map((c) => one(c, 'spPr', 'xfrm')).find(Boolean) ?? null;
          const box = boxOf(xfrm, tf, sx, sy);
          if (box && offSlide(box)) continue;
          if (find(el, 'videoFile') || find(el, 'audioFile') || find(el, 'media')) warn('Видео и звук не переносятся — на их месте обложка; добавьте файл в студии');
          const blipFill = kid(el, 'blipFill');
          const target = pkg.rel(part, attr(kid(blipFill, 'blip'), 'r:embed'));
          if (!box || !target) continue;
          const src = await asset(target, kid(blipFill, 'srcRect'));
          if (!src) continue;
          const prst = attr(kid(spPr, 'prstGeom'), 'prst');
          const radius = prst === 'ellipse' ? 'circle' : prst === 'roundRect' ? r1(Math.min(box.w, box.h) * ((adjusts(kid(spPr, 'prstGeom')).adj ?? 16667) / 100000)) : undefined;
          const line = lineFor(el, spPr);
          const o: Obj = { type: 'image', src, fit: 'cover', place: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) } };
          if (radius !== undefined) o.radius = radius;
          if (line?.c) { o.stroke = hex(line.c); o.width = r1(line.w); }
          if (box.rot) o.angle = r1(box.rot);
          const shadow = shadowFor(el, spPr);
          if (shadow) o.style = `filter:${shadow}`;
          if (locked) o.locked = true;
          free.push(o);
          continue;
        }
        if (name === 'graphicFrame') {
          const box = boxOf(kid(el, 'xfrm'), tf, sx, sy);
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
      const rowsEl = kids(tbl, 'tr');
      if (!rowsEl.length) return null;
      const tblPr = kid(tbl, 'tblPr');
      const styled = !!kid(tblPr, 'tableStyleId');
      type Cell = { paras: Para[]; p: TP; fill: Paint | null; line: Rgba | null };
      const cellOf = (tc: El): Cell => {
        const paras = paragraphs(kid(tc, 'txBody'), [], defLv, null, undefined);
        const tcPr = kid(tc, 'tcPr');
        const ln = ['lnB', 'lnR', 'lnT', 'lnL'].map((n) => kid(tcPr, n)).find((l) => l && kid(l, 'solidFill'));
        return { paras, p: dominant(paras), fill: paintOf(fillChild(tcPr), cc), line: ln ? colorIn(kid(ln, 'solidFill'), cc) : null };
      };
      const grid = rowsEl.map((tr) => kids(tr, 'tc').filter((tc) => bool(tc, 'hMerge') !== true && bool(tc, 'vMerge') !== true).map(cellOf));
      if (kids(tbl, 'tr').some((tr) => kids(tr, 'tc').some((tc) => num(tc, 'gridSpan') || num(tc, 'rowSpan')))) warn('Объединённые ячейки таблиц разделены');
      const solid = (c?: Cell) => (c?.fill?.kind === 'solid' ? c.fill.c : null);
      const lum = (c: Rgba | null) => (c ? 0.299 * c.r + 0.587 * c.g + 0.114 * c.b : 255);
      // Шапка: флажок firstRow или первая строка заметно темнее/другого цвета, чем вторая
      const h0 = solid(grid[0]?.[0]), b0 = solid(grid[1]?.[0]);
      const firstRow = bool(tblPr, 'firstRow') === true || (!!h0 && (!b0 || Math.abs(lum(h0) - lum(b0)) > 40));
      const head = firstRow ? grid[0] : null;
      const body = firstRow ? grid.slice(1) : grid;
      const sample = body[0]?.[0]?.p ?? head?.[0]?.p ?? {};
      const fill1 = solid(body[0]?.[0]), fill2 = solid(body[1]?.[0]);
      const line = grid.flat().find((c) => c.line)?.line ?? null;
      const colors: Record<string, string> = {};
      if (h0 && head) colors.head = hex(h0);
      if (head?.[0]?.p.color) colors.headText = hex(head[0].p.color);
      if (fill1) colors.fill = hex(fill1);
      // Полосы: вторая строка другого цвета (первая может быть и без заливки)
      if (fill2 && (!fill1 || hex(fill2) !== hex(fill1))) colors.band = hex(fill2);
      if (sample.color) colors.text = hex(sample.color);
      // Без стиля таблицы PowerPoint рисует тонкую сетку
      colors.line = line ? hex(line) : styled ? '#D9D9D9' : '#595959';
      // Цвет текста — общий для таблицы (colors.text / headText): фрагменты другого цвета («● готово»
      // зелёным) остаются разметкой {#цвет|…}, даже если в ячейке это единственный фрагмент
      // Жирность — тоже от общей строки таблицы: жирный столбец подписей остаётся **жирным**
      const md = (c: Cell, base: TP) => markup(c.paras, { ...c.p, color: base.color ?? c.p.color, b: base.b });
      // Ячейки таблицы рисуются обычным начертанием, шапка — жирным: остальное — разметкой **…**
      const bodyBase: TP = { ...sample, b: false };
      const headPx = head?.[0]?.p.sz ? head[0].p.sz * ptPx : 0;
      const rowH = (num(rowsEl[Math.min(1, rowsEl.length - 1)], 'h') ?? 0) * k;
      const fs = (sample.sz ?? 18) * ptPx;
      // Высота строки = текст + поля + линия под строкой (1 px)
      const py = rowH ? Math.max(2, (rowH - fs * 1.4 - 1) / 2) : 0;
      const headH = head ? (num(rowsEl[0], 'h') ?? 0) * k : 0;
      const thPy = headH && headPx ? Math.max(2, (headH - headPx * 1.4 - 1) / 2) : 0;
      // Вертикальные линии — только если они есть у ячеек (часто таблица разлинована лишь по строкам)
      const explicit = rowsEl.some((tr) => kids(tr, 'tc').some((tc) => ['lnL', 'lnR', 'lnT', 'lnB'].some((n) => !!kid(kid(tc, 'tcPr'), n))));
      const vertical = !explicit || rowsEl.some((tr) => kids(tr, 'tc').some((tc) => ['lnL', 'lnR'].some((n) => { const l = kid(kid(tc, 'tcPr'), n); return !!l && !!kid(l, 'solidFill') && (num(l, 'w') ?? 1) > 0; })));
      return {
        type: 'table',
        variant: 'boxed',
        ...(head ? { header: head.map((c) => md(c, { ...head[0].p, b: true })) } : { head: false, header: grid[0].map(() => '') }),
        rows: body.map((r) => r.map((c) => md(c, bodyBase))),
        widths: cols.map((w) => Math.round((w / cols.reduce((a, b) => a + b, 0)) * 1000) / 100),
        ...(sample.sz ? { size: r1(fs) } : {}),
        colors,
        style: `--py:${r1(py)}px;--px:${r1(9.6 * k * EMU_PX)}px${headPx && Math.abs(headPx - fs) > 0.5 ? `;--th-size:${r1(headPx)}px` : ''}${thPy && Math.abs(thPy - py) > 0.5 ? `;--th-py:${r1(thPy)}px` : ''}${styled || vertical ? '' : ';--td-vline:transparent'}${sample.font ? `;font-family:"${sample.font}",system-ui,sans-serif` : ''}`,
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
  if (deckTheme && deckCc) {
    const sch = (n: string) => deckCc!.scheme[deckCc!.map[n] ?? n];
    const acc = sch('accent1'), acc2 = sch('accent2');
    deck.theme = { ...(acc ? { accent: `#${acc.toUpperCase()}` } : {}), ...(acc2 ? { accent2: `#${acc2.toUpperCase()}` } : {}) };
  }
  deck.slides = slides;
  return { title, deck, assets, warnings: [...warnings], slides: slides.length };
}
