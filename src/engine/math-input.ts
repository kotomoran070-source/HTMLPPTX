/**
 * Формулы (блок math): исходник → LaTeX для Temml.
 *
 * Простая запись — «как пишешь», как линейный формат уравнений PowerPoint:
 *   x^2, a_1, x^(n+1), a_max      степени и индексы
 *   (a+b)/(c+d), 1/2x             дроби: числитель и знаменатель — соседние части без пробелов
 *   sqrt(x), cbrt(x), root(n, x)  корни; √x
 *   alpha, pi, Omega              греческие буквы
 *   sin, ln, lim_(x->0), sum_(i=1)^n, int_0^1   функции, суммы, интегралы
 *   >= <= != ~= +- -> => * ...    ≥ ≤ ≠ ≈ ± → ⇒ · …
 *   vec(a), bar(x), abs(x)        векторы, черта, модуль
 *   слова по-русски, "в кавычках"  обычным текстом: единицы, пояснения
 *   несколько строк               столбиком, выровнено по знаку «=»
 *   [[2ab]], ~~x~~                выделить цветом, зачеркнуть («сокращается»)
 * Есть «\» — значит, это LaTeX: исходник идёт как есть (выделить — \hl{…}, зачеркнуть — \cancel{…}).
 *
 * Живые числа: {{x}} и {{=m*a}} — значения по ползункам слайда, как в тексте.
 */
import { evalFormula, fmtVar, type Vars } from './formula';

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']);
/** Функции с готовой командой LaTeX */
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'ln', 'log', 'exp', 'lim', 'max', 'min', 'det', 'gcd', 'arg', 'sup', 'inf']);
/** Функции, как их пишут у нас: tg, ctg, lg… */
const NAMED = new Set(['tg', 'ctg', 'arctg', 'arcctg', 'lg', 'sh', 'ch', 'th', 'cth', 'sgn', 'const']);
/** Большие операторы: пределы — над и под знаком */
const BIG: Record<string, string> = { sum: '\\sum', prod: '\\prod', int: '\\int', iint: '\\iint', iiint: '\\iiint', oint: '\\oint' };
/** Слова-значки */
const WORDS: Record<string, string> = { infinity: '\\infty', infty: '\\infty', oo: '\\infty', degree: '^{\\circ}', deg: '^{\\circ}', partial: '\\partial', nabla: '\\nabla', forall: '\\forall', exists: '\\exists', emptyset: '\\varnothing' };
/** Над буквой: vec(a), bar(x), hat(y)… */
const ACCENTS: Record<string, [string, string]> = {
  vec: ['\\vec', '\\overrightarrow'], bar: ['\\bar', '\\overline'], hat: ['\\hat', '\\widehat'], tilde: ['\\tilde', '\\widetilde'], dot: ['\\dot', '\\dot'], ddot: ['\\ddot', '\\ddot'],
};
/** Знаки из нескольких символов: длинные — раньше */
const OPS: [string, string][] = [
  ['<=>', '\\Leftrightarrow'], ['...', '\\ldots'], ['>=', '\\ge'], ['<=', '\\le'], ['!=', '\\ne'], ['<>', '\\ne'], ['~=', '\\approx'],
  ['+-', '\\pm'], ['-+', '\\mp'], ['->', '\\to'], ['=>', '\\Rightarrow'], ['*', '\\cdot'], ['×', '\\times'], ['÷', '\\div'],
  ['≤', '\\le'], ['≥', '\\ge'], ['≠', '\\ne'], ['≈', '\\approx'], ['±', '\\pm'], ['→', '\\to'], ['⇒', '\\Rightarrow'], ['·', '\\cdot'], ['…', '\\ldots'],
  ['−', '-'], ['=', '='], ['+', '+'], ['-', '-'], ['<', '<'], ['>', '>'], [',', ','], [';', ';'], [':', ':'],
];
const CLOSE: Record<string, string> = { '(': ')', '[': ']' };

/** Знак «живого числа» в исходнике на время разбора: Unicode из личной области */
const LIVE0 = 0xE000;

type Tok =
  | { t: 'num'; v: string }
  | { t: 'word'; v: string }
  | { t: 'text'; v: string }
  | { t: 'op'; v: string }
  | { t: 'sp' }
  | { t: 'ch'; v: string };

const isLatin = (c: string) => /[A-Za-z]/.test(c);
const isCyr = (c: string) => /[А-Яа-яЁё]/.test(c);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i++;
      out.push({ t: 'sp' });
      continue;
    }
    // Число; запятая между цифрами — десятичная: 9,8
    const num = /^\d+(?:[.,]\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: 'num', v: num[0].replace(',', '{,}') });
      i += num[0].length;
      continue;
    }
    if (isLatin(c)) {
      const w = /^[A-Za-z]+/.exec(src.slice(i))![0];
      out.push({ t: 'word', v: w });
      i += w.length;
      continue;
    }
    // Русские слова (и несколько подряд через пробел) — текстом
    if (isCyr(c)) {
      const w = /^[А-Яа-яЁё]+(?:[ .-][А-Яа-яЁё]+)*\.?/.exec(src.slice(i))![0];
      out.push({ t: 'text', v: w });
      i += w.length;
      continue;
    }
    if (c === '"' || c === '«') {
      const end = src.indexOf(c === '"' ? '"' : '»', i + 1);
      if (end > i) {
        out.push({ t: 'text', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // [[выделить]] и ~~зачеркнуть~~
    const pair = src.slice(i, i + 2);
    if (pair === '[[' || pair === ']]' || pair === '~~') {
      out.push({ t: 'ch', v: pair });
      i += 2;
      continue;
    }
    const op = OPS.find(([k]) => src.startsWith(k, i));
    if (op) {
      out.push({ t: 'op', v: op[1] });
      i += op[0].length;
      continue;
    }
    out.push({ t: 'ch', v: c });
    i++;
  }
  return out;
}

/** Текст внутри \text{}: служебные знаки LaTeX — экранированы */
export const texText = (s: string) => `\\text{${s.replace(/[\\{}$&#^_%~]/g, (m) => (m === '\\' ? '\\textbackslash ' : m === '^' || m === '~' ? `\\${m}{}` : `\\${m}`))}}`;

interface Atom { tex: string; inner?: string; text?: boolean }
type Item = { k: 'atom'; a: Atom } | { k: 'op'; tex: string } | { k: 'sp' } | { k: 'slash' };

class Parser {
  private i = 0;
  /** В строке был интеграл: dx дальше — дифференциал */
  private integral = false;
  constructor(private toks: Tok[]) {}

  private peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }

  /** Последовательность до закрывающей скобки (или конца) */
  seq(close?: string): string {
    const items: Item[] = [];
    while (this.i < this.toks.length) {
      const t = this.peek()!;
      if (close && t.t === 'ch' && t.v === close) break;
      if (t.t === 'sp') { this.i++; items.push({ k: 'sp' }); continue; }
      if (t.t === 'op') { this.i++; items.push({ k: 'op', tex: t.v }); continue; }
      if (t.t === 'ch' && t.v === '/') { this.i++; items.push({ k: 'slash' }); continue; }
      if (t.t === 'ch' && (t.v === ')' || t.v === ']')) { this.i++; items.push({ k: 'op', tex: t.v }); continue; }
      const a = this.atom();
      if (a) items.push({ k: 'atom', a });
    }
    return join(fractions(items));
  }

  /** Часть формулы со степенями и индексами */
  private atom(): Atom | null {
    let a = this.base();
    if (!a) return null;
    // Степень и индекс — сразу за основой, без пробела: x^2, a_1, x_1^2
    for (;;) {
      const t = this.peek();
      if (t?.t !== 'ch' || (t.v !== '^' && t.v !== '_')) break;
      this.i++;
      const arg = this.script(t.v === '_');
      a = { tex: `${a.tex}${t.v}{${arg}}` };
    }
    // Штрих и факториал
    while (this.peek()?.t === 'ch' && ["'", '!'].includes((this.peek() as { v: string }).v)) {
      a = { tex: a.tex + (this.peek() as { v: string }).v };
      this.i++;
    }
    return a;
  }

  /** То, что идёт в степень или индекс: (…) без скобок, число, слово, знак со следующей частью */
  private script(sub: boolean): string {
    const t = this.peek();
    if (!t) return '';
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '\\pm')) {
      this.i++;
      return t.v + this.script(sub);
    }
    if (t.t === 'word' && sub && t.v.length > 1 && !GREEK.has(t.v) && !WORDS[t.v]) {
      // Индекс-слово: a_max, v_нач — прямым шрифтом
      this.i++;
      return `\\mathrm{${t.v}}`;
    }
    if (t.t === 'word' && !GREEK.has(t.v) && !FUNCS.has(t.v) && !WORDS[t.v] && !BIG[t.v] && !ACCENTS[t.v] && !['sqrt', 'cbrt', 'root', 'abs'].includes(t.v) && t.v.length > 1) {
      // x^ab — в степени только первая буква, как в LaTeX
      this.toks.splice(this.i, 1, { t: 'word', v: t.v[0] }, { t: 'word', v: t.v.slice(1) });
    }
    // Только основа: у степени своих степеней не бывает, sum_(i=1)^n — индекс и степень суммы
    const a = this.base();
    return a ? (a.inner ?? a.tex) : '';
  }

  private group(open: string): string {
    this.i++;
    const inner = this.seq(CLOSE[open]);
    if (this.peek()?.t === 'ch' && (this.peek() as { v: string }).v === CLOSE[open]) this.i++;
    return inner;
  }

  /** Аргумент функции в скобках, или следующая часть без них */
  private arg(): string {
    const t = this.peek();
    if (t?.t === 'ch' && t.v === '(') return this.group('(');
    if (t?.t === 'sp') this.i++;
    const a = this.atom();
    return a ? (a.inner ?? a.tex) : '';
  }

  private base(): Atom | null {
    const t = this.peek()!;
    if (t.t === 'num') { this.i++; return { tex: t.v }; }
    if (t.t === 'text') { this.i++; return { tex: texText(t.v), text: true }; }
    if (t.t === 'ch') {
      if (t.v === '(' || t.v === '[') {
        const inner = this.group(t.v);
        const tall = /\\frac|\\sum|\\int|\\prod|\\sqrt/.test(inner);
        const [l, r] = t.v === '(' ? ['(', ')'] : ['[', ']'];
        return { tex: tall ? `\\left${l}${inner}\\right${r}` : `${l}${inner}${r}`, inner };
      }
      if (t.v === '[[' || t.v === '~~') {
        this.i++;
        const close = t.v === '[[' ? ']]' : '~~';
        const inner = this.seq(close);
        if (this.peek()?.t === 'ch' && (this.peek() as { v: string }).v === close) this.i++;
        return { tex: t.v === '[[' ? `\\hl{${inner}}` : `\\cancel{${inner}}` };
      }
      this.i++;
      if (t.v === '√') return { tex: `\\sqrt{${this.arg()}}` };
      if (t.v === '∛') return { tex: `\\sqrt[3]{${this.arg()}}` };
      if (t.v === '°') return { tex: '^{\\circ}' };
      if (t.v === '{' || t.v === '}') return { tex: `\\${t.v}` };
      if (t.v === '%' || t.v === '#' || t.v === '&' || t.v === '$') return { tex: `\\${t.v}` };
      if (t.v === '~') return { tex: '\\sim' };
      const code = t.v.charCodeAt(0);
      if (code >= LIVE0 && code < LIVE0 + 0x100) return { tex: t.v };
      return { tex: t.v };
    }
    if (t.t !== 'word') return null;
    this.i++;
    const w = t.v;
    if (w === 'sqrt') return { tex: `\\sqrt{${this.arg()}}` };
    if (w === 'cbrt') return { tex: `\\sqrt[3]{${this.arg()}}` };
    if (w === 'root') {
      // root(n, x) — корень n-й степени
      const inner = this.arg();
      const k = topComma(inner);
      return { tex: k < 0 ? `\\sqrt{${inner}}` : `\\sqrt[${inner.slice(0, k).trim()}]{${inner.slice(k + 1).trim()}}` };
    }
    if (w === 'abs') return { tex: `\\left|${this.arg()}\\right|` };
    if (ACCENTS[w]) {
      const inner = this.arg();
      const one = /^(\\[A-Za-z]+|[A-Za-z0-9])$/.test(inner.trim());
      return { tex: `${ACCENTS[w][one ? 0 : 1]}{${inner}}` };
    }
    if (GREEK.has(w)) return { tex: `\\${w} ` };
    if (FUNCS.has(w)) return { tex: `\\${w} ` };
    if (NAMED.has(w)) return { tex: `\\operatorname{${w}} ` };
    if (BIG[w]) {
      if (w.includes('int')) this.integral = true;
      return { tex: `${BIG[w]} ` };
    }
    // dx, dt после интеграла — с тонким отступом, как в учебнике
    if (this.integral && /^d[a-zA-Z]$/.test(w)) return { tex: `\\,${w}` };
    if (WORDS[w]) return { tex: WORDS[w] };
    // Слово целиком начинается с функции: sinx, lnx — функция и аргумент
    const fn = [...FUNCS, ...NAMED].filter((f) => f.length > 1 && w.startsWith(f) && w.length - f.length <= 2).sort((a, b) => b.length - a.length)[0];
    if (fn && !GREEK.has(w)) return { tex: `${FUNCS.has(fn) ? `\\${fn}` : `\\operatorname{${fn}}`} ${w.slice(fn.length)}` };
    // Буквы подряд — переменные (произведение), как в учебнике: 4ac
    return { tex: w };
  }
}

/** Первая запятая верхнего уровня (вне скобок) */
function topComma(s: string): number {
  let d = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') d--;
    else if (c === ',' && d === 0 && s[k - 1] !== '{') return k;
  }
  return -1;
}

/** a/b → дробь: числитель и знаменатель — соседние части без пробелов и знаков */
function fractions(items: Item[]): Item[] {
  // Пробелы вокруг «/» не разрывают дробь: «a / b»
  const xs = items.filter((it, k) => !(it.k === 'sp' && (items[k - 1]?.k === 'slash' || items[k + 1]?.k === 'slash')));
  const out: Item[] = [];
  for (let k = 0; k < xs.length; k++) {
    const it = xs[k];
    if (it.k !== 'slash') { out.push(it); continue; }
    let s = out.length;
    while (s > 0 && out[s - 1].k === 'atom') s--;
    const num = out.splice(s) as { k: 'atom'; a: Atom }[];
    let e = k + 1;
    while (e < xs.length && xs[e].k === 'atom') e++;
    const den = xs.slice(k + 1, e) as { k: 'atom'; a: Atom }[];
    if (!num.length || !den.length) {
      out.push(...num, { k: 'op', tex: '/' });
      continue;
    }
    const part = (as: { a: Atom }[]) => (as.length === 1 && as[0].a.inner !== undefined ? as[0].a.inner : as.map((x) => x.a.tex).join(''));
    out.push({ k: 'atom', a: { tex: `\\frac{${part(num)}}{${part(den)}}`, text: [...num, ...den].some((x) => x.a.text) } });
    k = e - 1;
  }
  return out;
}

function join(items: Item[]): string {
  let s = '';
  items.forEach((it, k) => {
    if (it.k === 'atom') s += it.a.tex;
    else if (it.k === 'op') s += ` ${it.tex} `;
    else if (it.k === 'sp') {
      // Пробел перед словом или после него виден: «117,6 Н», «5 мин»
      const a = items[k - 1];
      const b = items[k + 1];
      s += a?.k === 'atom' && b?.k === 'atom' && (a.a.text || b.a.text) ? '\\ ' : ' ';
    }
  });
  return s.replace(/\s+/g, ' ').trim();
}

/** Одна строка простой записи → LaTeX */
function lineTex(src: string): string {
  return new Parser(lex(src)).seq();
}

/** Первый «=» верхнего уровня строки LaTeX — точка выравнивания столбика */
function alignAt(tex: string): number {
  let d = 0;
  for (let k = 0; k < tex.length; k++) {
    const c = tex[k];
    if (c === '{') d++;
    else if (c === '}') d--;
    else if (c === '=' && d === 0) return k;
  }
  return -1;
}

/** Исходник формулы (простая запись или LaTeX) → LaTeX */
export function toTex(src: string): string {
  const s = src.trim();
  if (!s) return '';
  if (s.includes('\\')) return s;
  const lines = s.split(/\n+/).map((l) => l.trim()).filter(Boolean).map(lineTex);
  if (lines.length === 1) return lines[0];
  // Столбиком: строки с «=» — по знаку равенства, иначе — по центру
  if (lines.every((l) => alignAt(l) >= 0 || l.startsWith('='))) {
    return `\\begin{aligned}${lines.map((l) => { const k = alignAt(l); return `${l.slice(0, k)}&${l.slice(k)}`; }).join(' \\\\ ')}\\end{aligned}`;
  }
  return `\\begin{gathered}${lines.join(' \\\\ ')}\\end{gathered}`;
}

const LIVE_RE = /\{\{\s*=?\s*([^{}]+?)\s*\}\}/g;

/** Число из ползунков — в запись LaTeX: «117,6» → 117{,}6, «1 500» → 1\,500 */
export function texNumber(v: number): string {
  return fmtVar(v).replace(',', '{,}').replace(/[\u00a0\u202f ]/g, '\\,').replace('−', '-');
}

/**
 * Исходник формулы с живыми числами → LaTeX. {{…}} считается по переменным слайда;
 * не посчиталось (нет такого ползунка) — выражение остаётся видно в рамке.
 */
export function mathTex(src: string, vars: Vars = {}): string {
  const live: string[] = [];
  const marked = String(src ?? '').replace(LIVE_RE, (_m, e: string) => {
    const n = evalFormula(e, vars);
    live.push(n === null ? `\\boxed{${texText(e)}}` : `{${texNumber(n)}}`);
    return String.fromCharCode(LIVE0 + live.length - 1);
  });
  const tex = toTex(marked);
  return tex.replace(/[-]/g, (c) => live[c.charCodeAt(0) - LIVE0] ?? '');
}

/** Есть ли в исходнике живые числа */
export const hasLive = (src: unknown): boolean => typeof src === 'string' && /\{\{[^{}]+\}\}/.test(src);

/** Первый «=» строки вне скобок (не часть <=, >=, !=, =>) — где кончается левая часть */
function topEq(s: string): number {
  let d = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === '=' && d === 0 && !'<>!=~'.includes(s[k - 1] ?? '') && !'=>'.includes(s[k + 1] ?? '')) return k;
  }
  return -1;
}

/**
 * Шаги превращения: каждая строка исходника — формула целиком. Строка, которая начинается
 * с «=», продолжает первую: левая часть подставляется сама — (a+b)^2, «= a^2 + …».
 */
export function stepLines(src: string): string[] {
  const lines = String(src ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const k = lines.length ? topEq(lines[0]) : -1;
  const lhs = k >= 0 ? lines[0].slice(0, k).trim() : lines[0];
  return lines.map((l, i) => (i > 0 && l.startsWith('=') && !l.startsWith('=>') ? `${lhs} ${l}` : l));
}

/** Функции, которые умеет расчёт (engine/formula.ts) */
const CALC_FN = new Set(['sin', 'cos', 'tan', 'tg', 'cot', 'ctg', 'arcsin', 'arccos', 'arctan', 'arctg', 'sinh', 'cosh', 'tanh', 'ln', 'lg', 'log', 'log10', 'exp', 'sqrt', 'cbrt', 'abs', 'sign', 'sgn', 'min', 'max', 'round', 'floor', 'ceil']);

/**
 * Формула-функция → выражение для графика: «y = a sin(2x) + 1» → «a*sin(2*x)+1», переменная x.
 * Простая запись: умножение без знака (2x, 4ac), функция без скобок (sin x), f(t) = … — переменная t,
 * живые числа {{a}} — как есть (их значения дают ползунки). known — имена ползунков слайда
 * (многобуквенные имена не разбираются на буквы). null — это не функция одной переменной.
 */
export function plotExpr(src: string, known: string[] = []): { expr: string; v: string } | null {
  let s = String(src ?? '').trim();
  if (!s || s.includes('\n') || s.includes('\\')) return null;
  s = s.replace(/\{\{\s*=?\s*([^{}]+?)\s*\}\}/g, '($1)').replace(/\[\[|\]\]|~~/g, '')
    .replace(/[·×]/g, '*').replace(/−/g, '-').replace(/÷/g, '/').replace(/√/g, 'sqrt').replace(/π/g, 'pi')
    .replace(/\|([^|]+)\|/g, 'abs($1)');
  const k = topEq(s);
  let lhs = '';
  let rhs = s;
  if (k >= 0) {
    lhs = s.slice(0, k).trim();
    rhs = s.slice(k + 1).trim();
    if (topEq(rhs) >= 0 || /[<>]/.test(lhs)) return null;
  }
  // Слева — имя функции: y, f(x), s(t)
  const fx = /^[A-Za-z]\w*\s*\(\s*([a-z])\s*\)$/.exec(lhs);
  if (lhs && !fx && !/^[A-Za-z](_\w+)?$/.test(lhs)) return null;

  const toks = [...rhs.matchAll(/\s*(?:(\d+(?:[.,]\d+)?)|([A-Za-z]+)|(\S))/g)].map((m) => (m[1] ? { t: 'num', v: m[1].replace(',', '.') } : m[2] ? { t: 'id', v: m[2] } : { t: 'op', v: m[3] }));
  // Слова: функция, число, ползунок — или буквы-переменные подряд (ac → a*c, sinx → sin x)
  const ids: { t: string; v: string }[] = [];
  for (const t of toks) {
    if (t.t !== 'id' || CALC_FN.has(t.v) || known.includes(t.v) || t.v === 'pi' || t.v.length === 1) { ids.push(t); continue; }
    const fn = [...CALC_FN].filter((f) => t.v.startsWith(f)).sort((a, b) => b.length - a.length)[0];
    const rest = fn ? t.v.slice(fn.length) : t.v;
    if (fn) ids.push({ t: 'id', v: fn });
    if (known.includes(rest)) ids.push({ t: 'id', v: rest });
    else for (const c of rest === 'pi' ? ['pi'] : rest) ids.push({ t: 'id', v: c });
  }

  let i = 0;
  const used = new Set<string>();
  const peek = () => ids[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const starts = () => !!peek() && (peek()!.t !== 'op' || peek()!.v === '(');
  const fail = (): never => { throw new Error('plot'); };
  const sum = (): string => {
    let out = term();
    while (isOp('+') || isOp('-')) { const op = ids[i++].v; out += op + term(); }
    return out;
  };
  const term = (): string => {
    let out = factor();
    for (;;) {
      if (isOp('*') || isOp('/')) { const op = ids[i++].v; out += op + factor(); }
      else if (starts()) out += '*' + factor();
      else return out;
    }
  };
  /** Аргумент функции без скобок: sin 2x — всё произведение без знаков */
  const implicit = (): string => {
    let out = factor();
    while (starts()) out += '*' + factor();
    return out;
  };
  const factor = (): string => {
    if (isOp('-')) { i++; return `(-${factor()})`; }
    if (isOp('+')) { i++; return factor(); }
    const a = atom();
    if (isOp('^')) { i++; return `${a}^${factor()}`; }
    return a;
  };
  const atom = (): string => {
    const t = ids[i++] ?? fail();
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') { const x = sum(); if (!isOp(')')) fail(); i++; return `(${x})`; }
    if (t.t !== 'id') return fail();
    if (CALC_FN.has(t.v)) {
      if (isOp('(')) {
        i++;
        const args = [sum()];
        while (isOp(',')) { i++; args.push(sum()); }
        if (!isOp(')')) fail();
        i++;
        return `${t.v}(${args.join(',')})`;
      }
      return `${t.v}(${implicit()})`;
    }
    if (t.v !== 'pi' && t.v !== 'e') used.add(t.v);
    return t.v;
  };
  let expr: string;
  try {
    expr = sum();
    if (i !== ids.length) return null;
  } catch {
    return null;
  }
  const v = fx?.[1] ?? (used.has('x') ? 'x' : used.has('t') ? 't' : '');
  if (!v || !used.has(v)) return null;
  return { expr, v };
}
