/**
 * Формула для PowerPoint: MathML (как его рисует Temml) → OMML — уравнение Office, которое
 * правится в PowerPoint. Переводится то, что реально бывает на слайдах: буквы и числа, дроби,
 * степени и индексы, корни, суммы и интегралы, пределы, скобки, матрицы и системы, столбик
 * по «=», выделение цветом и зачёркивание. Встретилось другое — null: формула остаётся картинкой.
 */

/** Сколько нужно от элемента: подходит и DOM браузера, и xmldom в тестах */
export interface MEl {
  nodeType: number;
  localName?: string | null;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MEl>;
  getAttribute(name: string): string | null;
}

export interface OmmlOpts {
  /** Размер, пункты */
  pt: number;
  /** Цвет элемента (#RRGGBB без решётки); нет — цвет формулы по умолчанию */
  color?(el: MEl): string | undefined;
  lang?: string;
}

class Unsupported extends Error {}

const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋁', '⋀']);
/** Невидимые знаки MathML (применение функции, невидимое умножение) */
const INVISIBLE = /[\u2061-\u2064]/g;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const name = (e: MEl) => (e.localName ?? e.nodeName).replace(/^m:/, '').toLowerCase();
const kids = (e: MEl): MEl[] => Array.from(e.childNodes).filter((n) => n.nodeType === 1);
const text = (e: MEl) => (e.textContent ?? '').replace(INVISIBLE, '');

/** Курсив формул — буквами «математический курсив» Unicode, как пишет сам PowerPoint */
function mathItalic(s: string): string {
  return [...s].map((c) => {
    const k = c.codePointAt(0)!;
    if (c === 'h') return '\u210E';
    if (k >= 97 && k <= 122) return String.fromCodePoint(0x1D44E + k - 97);
    if (k >= 65 && k <= 90) return String.fromCodePoint(0x1D434 + k - 65);
    if (k >= 0x3B1 && k <= 0x3C9) return String.fromCodePoint(0x1D6FC + k - 0x3B1);
    return c;
  }).join('');
}

class Conv {
  constructor(private o: OmmlOpts) {}

  /** Кусок текста формулы; upright — прямо (числа, знаки, слова), иначе — курсив буквы */
  run(t: string, el: MEl, kind: 'italic' | 'plain' | 'text', aln = false): string {
    if (!t) return '';
    const italic = kind === 'italic';
    const color = this.o.color?.(el);
    const mrpr = kind === 'text' || aln ? `<m:rPr>${kind === 'text' ? '<m:sty m:val="p"/>' : ''}${aln ? '<m:aln/>' : ''}</m:rPr>` : '';
    const sz = Math.round(this.o.pt * 100);
    const rpr = `<a:rPr lang="${esc(this.o.lang ?? 'ru-RU')}" sz="${sz}"${italic ? ' i="1"' : ' i="0"'}>${color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : ''}<a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/><a:cs typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr>`;
    return `<m:r>${mrpr}${rpr}<m:t xml:space="preserve">${esc(italic ? mathItalic(t) : t)}</m:t></m:r>`;
  }

  /** Аргумент (m:e, m:num…): ряд элементов */
  seq(els: MEl[]): string {
    let out = '';
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const nary = this.naryOf(e);
      if (nary) {
        // Сумма или интеграл: под знак — следующая часть формулы
        const next = els[i + 1];
        out += this.nary(nary, next ? this.node(next) : '');
        if (next) i++;
        continue;
      }
      out += this.node(e);
    }
    return out;
  }

  /** Знак суммы или интеграла с пределами (или без) */
  private naryOf(e: MEl): { chr: string; sub?: MEl; sup?: MEl; under: boolean; el: MEl } | null {
    const n = name(e);
    // Temml заворачивает знак с пределами в отдельную группу
    if (n === 'mrow' && kids(e).length === 1) return this.naryOf(kids(e)[0]);
    if (n === 'mo' && NARY.has(text(e).trim())) return { chr: text(e).trim(), under: false, el: e };
    if (!['munderover', 'msubsup', 'munder', 'mover', 'msub', 'msup'].includes(n)) return null;
    const [base, a, b] = kids(e);
    if (!base || name(base) !== 'mo' || !NARY.has(text(base).trim())) return null;
    const under = n.startsWith('mu') || n === 'mover';
    const sub = n === 'mover' || n === 'msup' ? undefined : a;
    const sup = n === 'mover' || n === 'msup' ? a : n === 'munderover' || n === 'msubsup' ? b : undefined;
    return { chr: text(base).trim(), sub, sup, under, el: e };
  }

  private nary(n: { chr: string; sub?: MEl; sup?: MEl; under: boolean }, body: string): string {
    const pr = `<m:naryPr><m:chr m:val="${esc(n.chr)}"/><m:limLoc m:val="${n.under ? 'undOvr' : 'subSup'}"/>${n.sub ? '' : '<m:subHide m:val="1"/>'}${n.sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>`;
    return `<m:nary>${pr}<m:sub>${n.sub ? this.node(n.sub) : ''}</m:sub><m:sup>${n.sup ? this.node(n.sup) : ''}</m:sup><m:e>${body}</m:e></m:nary>`;
  }

  node(e: MEl): string {
    const n = name(e);
    const c = kids(e);
    switch (n) {
      case 'math':
      case 'semantics':
      case 'mstyle':
      case 'mpadded':
        return this.seq(c.filter((x) => name(x) !== 'annotation'));
      case 'mrow': {
        // Скобки вокруг части — растягиваемые скобки Office (m:d)
        const [first] = c;
        const last = c[c.length - 1];
        const fence = (x: MEl | undefined, form: string) => !!x && name(x) === 'mo' && x.getAttribute('fence') === 'true' && x.getAttribute('form') === form;
        if (c.length >= 2 && fence(first, 'prefix') && fence(last, 'postfix')) {
          return `<m:d><m:dPr><m:begChr m:val="${esc(text(first).trim())}"/><m:endChr m:val="${esc(text(last).trim())}"/></m:dPr><m:e>${this.seq(c.slice(1, -1))}</m:e></m:d>`;
        }
        // Пустая служебная часть (Temml рисует ею зачёркивание) — ничего
        if (!c.length && (e.getAttribute('class') ?? '').includes('tml-')) return '';
        return this.seq(c);
      }
      case 'mi': {
        const t = text(e);
        const plain = t.length > 1 || e.getAttribute('mathvariant') === 'normal';
        return this.run(t, e, plain ? 'text' : 'italic');
      }
      case 'mn':
        return this.run(text(e), e, 'plain');
      case 'mo':
        return this.run(text(e), e, 'plain');
      case 'mtext':
      case 'ms':
        return this.run(text(e), e, 'text');
      case 'mspace':
      case 'mphantom':
      case 'none':
      case 'mprescripts':
        return '';
      case 'mfrac':
        if (c.length !== 2 || e.getAttribute('linethickness') === '0' || e.getAttribute('linethickness') === '0px') throw new Unsupported(n);
        return `<m:f><m:num>${this.node(c[0])}</m:num><m:den>${this.node(c[1])}</m:den></m:f>`;
      case 'msup':
        return `<m:sSup><m:e>${this.node(c[0])}</m:e><m:sup>${this.node(c[1])}</m:sup></m:sSup>`;
      case 'msub':
        return `<m:sSub><m:e>${this.node(c[0])}</m:e><m:sub>${this.node(c[1])}</m:sub></m:sSub>`;
      case 'msubsup':
        return `<m:sSubSup><m:e>${this.node(c[0])}</m:e><m:sub>${this.node(c[1])}</m:sub><m:sup>${this.node(c[2])}</m:sup></m:sSubSup>`;
      case 'msqrt':
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${this.seq(c)}</m:e></m:rad>`;
      case 'mroot':
        return `<m:rad><m:deg>${this.node(c[1])}</m:deg><m:e>${this.node(c[0])}</m:e></m:rad>`;
      case 'munder':
        return `<m:limLow><m:e>${this.node(c[0])}</m:e><m:lim>${this.node(c[1])}</m:lim></m:limLow>`;
      case 'munderover':
        return `<m:limUpp><m:e><m:limLow><m:e>${this.node(c[0])}</m:e><m:lim>${this.node(c[1])}</m:lim></m:limLow></m:e><m:lim>${this.node(c[2])}</m:lim></m:limUpp>`;
      case 'mover': {
        const acc = c[1] && name(c[1]) === 'mo' ? text(c[1]).trim() : '';
        // Стрелка, черта, «крышка», тильда, точки над буквой
        const ACC: Record<string, string> = { '→': '\u20D7', '⃗': '\u20D7', '‾': '\u0305', '¯': '\u0305', '^': '\u0302', 'ˆ': '\u0302', '~': '\u0303', '˜': '\u0303', '˙': '\u0307', '¨': '\u0308', '.': '\u0307' };
        if (acc && ACC[acc]) return `<m:acc><m:accPr><m:chr m:val="${ACC[acc]}"/></m:accPr><m:e>${this.node(c[0])}</m:e></m:acc>`;
        return `<m:limUpp><m:e>${this.node(c[0])}</m:e><m:lim>${this.node(c[1])}</m:lim></m:limUpp>`;
      }
      case 'menclose': {
        const nt = e.getAttribute('notation') ?? '';
        const body = this.seq(c);
        if (/^top$/.test(nt)) return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${body}</m:e></m:bar>`;
        if (/strike/.test(nt)) {
          const s = nt.includes('down') ? '<m:strikeTLBR m:val="1"/>' : nt.includes('horizontal') ? '<m:strikeH m:val="1"/>' : '<m:strikeBLTR m:val="1"/>';
          return `<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"/><m:hideBot m:val="1"/><m:hideLeft m:val="1"/><m:hideRight m:val="1"/>${s}</m:borderBoxPr><m:e>${body}</m:e></m:borderBox>`;
        }
        if (/box/.test(nt)) return `<m:borderBox><m:e>${body}</m:e></m:borderBox>`;
        throw new Unsupported(`menclose ${nt}`);
      }
      case 'mtable':
        return this.table(e, c);
      default:
        throw new Unsupported(n);
    }
  }

  /** Таблица: в скобках и в несколько колонок — матрица; иначе — строки уравнения, по «=» */
  private table(e: MEl, rows: MEl[]): string {
    const cells = rows.filter((r) => name(r) === 'mtr').map((r) => kids(r).filter((x) => name(x) === 'mtd'));
    const cols = Math.max(0, ...cells.map((r) => r.length));
    const parent = (e as unknown as { parentNode?: MEl | null }).parentNode;
    const inFence = !!parent && name(parent) === 'mrow' && kids(parent).length > 1 && kids(parent).every((x) => x === e || name(x) === 'mo');
    if (inFence && cols > 1) {
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${cells.map((r) => `<m:mr>${r.map((td) => `<m:e>${this.seq(kids(td))}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
    }
    // Столбик: левая часть и правая (с «=») — одной строкой, выравнивание по первому знаку правой части
    return `<m:eqArr>${cells.map((r) => `<m:e>${r.map((td, k) => {
      const x = this.seq(kids(td));
      if (k === 0 || r.length < 2 || !x.startsWith('<m:r>')) return x;
      // Точка выравнивания — свойство первого куска правой части (после m:sty, если есть)
      return x.startsWith('<m:r><m:rPr>') ? x.replace('</m:rPr>', '<m:aln/></m:rPr>') : x.replace('<m:r>', '<m:r><m:rPr><m:aln/></m:rPr>');
    }).join('')}</m:e>`).join('')}</m:eqArr>`;
  }
}

/** MathML → содержимое m:oMath; null — есть то, чего PowerPoint от нас не получит (останется картинка) */
export function mathToOmml(math: MEl, o: OmmlOpts): string | null {
  try {
    const body = new Conv(o).node(math);
    return body ? `<m:oMath>${body}</m:oMath>` : null;
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}

/**
 * Готовая фигура-уравнение для слайда (p:sp с a14:m) вместо картинки: та же рамка xfrm.
 * PowerPoint 2010 и новее показывает уравнение, остальные программы — картинку из Fallback.
 */
export function equationShape(id: string, xfrm: string, omml: string, align: 'l' | 'ctr' | 'r', pic: string): string {
  const jc = align === 'l' ? 'left' : align === 'r' ? 'right' : 'center';
  const sp = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Формула ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>`
    + `<a:p><a:pPr algn="${align}"/><a14:m><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMathParaPr><m:jc m:val="${jc}"/></m:oMathParaPr>${omml}</m:oMathPara></a14:m><a:endParaRPr lang="ru-RU"/></a:p></p:txBody></p:sp>`;
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${sp}</mc:Choice><mc:Fallback>${pic}</mc:Fallback></mc:AlternateContent>`;
}
