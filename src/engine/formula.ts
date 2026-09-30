/**
 * Связи элементов слайда: ползунки задают переменные, остальные блоки их используют.
 *
 *   - строка «=x*1.3» в любом поле блока — число по формуле (значения графика, проценты…);
 *   - «{{x}}» или «{{=x*2}}» внутри текста — подставленное значение.
 *
 * Формулы считаются без eval: числа, переменные, + − * / ^ %, скобки и функции
 * round, min, max, abs, sqrt, floor, ceil, log10, ln, exp. Не получилось посчитать — поле остаётся как было.
 */

export type Vars = Record<string, number>;

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  round: (x, d = 0) => { const k = 10 ** Math.max(0, Math.min(6, Math.round(d))); return Math.round(x * k) / k; },
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil,
  log10: Math.log10, ln: Math.log, exp: Math.exp,
};

function lex(src: string): Tok[] | null {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:[.,]\d+)?)|([A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*)|([-+*/^%(),]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return null;
    i = re.lastIndex;
    if (m[1]) out.push({ t: 'num', v: Number(m[1].replace(',', '.')) });
    else if (m[2]) out.push({ t: 'id', v: m[2] });
    else out.push({ t: 'op', v: m[3] });
  }
  return out;
}

/** Значение формулы или null, если в ней ошибка или нет нужной переменной */
export function evalFormula(src: string, vars: Vars): number | null {
  const toks = lex(src);
  if (!toks || !toks.length) return null;
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const fail = () => { throw new Error('formula'); };
  const primary = (): number => {
    const k = toks[i++];
    if (!k) return fail();
    if (k.t === 'num') return k.v;
    if (k.t === 'op' && k.v === '(') { const v = sum(); if (!isOp(')')) fail(); i++; return v; }
    if (k.t === 'op' && k.v === '-') return -power();
    if (k.t === 'op' && k.v === '+') return power();
    if (k.t === 'id') {
      const f = FUNCS[k.v.toLowerCase()];
      if (f && isOp('(')) {
        i++;
        const args: number[] = [];
        if (!isOp(')')) { args.push(sum()); while (isOp(',')) { i++; args.push(sum()); } }
        if (!isOp(')')) fail();
        i++;
        return f(...args);
      }
      if (!(k.v in vars)) return fail();
      return vars[k.v];
    }
    return fail();
  };
  const power = (): number => { const b = primary(); if (isOp('^')) { i++; return b ** power(); } return b; };
  const product = (): number => {
    let v = power();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = toks[i++].v;
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (isOp('+') || isOp('-')) { const op = toks[i++].v; const r = product(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  try {
    const v = sum();
    if (i !== toks.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** Число для текста: по-русски, до двух знаков после запятой */
export function fmtVar(v: number): string {
  // Минус — типографский: «−129,5», а не дефис
  return v.toLocaleString('ru-RU', { maximumFractionDigits: digits(v) }).replace(/^-/, '−');
}

const digits = (v: number) => (Math.abs(v) < 10 ? 2 : Math.abs(v) < 1000 ? 1 : 0);

/** Число из формулы — с той же точностью, что и в тексте: подписи графиков без «330,7949» */
const tidy = (v: number) => { const k = 10 ** digits(v); return Math.round(v * k) / k; };

const TEXT_RE = /\{\{\s*=?\s*([^{}]+?)\s*\}\}/g;

/**
 * Есть ли формулы в собственных полях блока (тогда блок перерисовывается при движении ползунка).
 * Вложенные блоки не в счёт: они пересчитываются сами, а группа с ползунком внутри остаётся как есть.
 */
export function hasFormula(v: unknown, top = true): boolean {
  if (typeof v === 'string') return (v.startsWith('=') && v.length > 1) || v.includes('{{');
  if (Array.isArray(v)) return v.some((x) => hasFormula(x, false));
  if (v && typeof v === 'object') {
    if (!top && typeof (v as { type?: unknown }).type === 'string') return false;
    return Object.entries(v).some(([k, x]) => k !== 'styles' && hasFormula(x, false));
  }
  return false;
}

/**
 * Копия данных с посчитанными формулами (пути для правки копии задаёт рендер).
 * В вёрстке (поле html) числа без пробелов и с точкой: их подставляют в атрибуты SVG и CSS.
 */
export function resolve<T>(v: T, vars: Vars, plain = false): T {
  if (typeof v === 'string') {
    if (v.startsWith('=') && v.length > 1) {
      const n = evalFormula(v.slice(1), vars);
      return (n === null ? v : tidy(n)) as unknown as T;
    }
    if (v.includes('{{')) return v.replace(TEXT_RE, (m, e: string) => { const n = evalFormula(e, vars); return n === null ? m : plain ? String(tidy(n)) : fmtVar(n); }) as unknown as T;
    return v;
  }
  if (Array.isArray(v)) {
    return v.map((x) => resolve(x, vars, plain)) as unknown as T;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = k === 'styles' ? x : resolve(x, vars, plain || k === 'html');
    return out as T;
  }
  return v;
}

/**
 * Промежуточные величины слайда (slide.vars): «имя: =формула» по порядку, каждая видит
 * ползунки и предыдущие. Так длинные расчёты пишутся один раз, а блоки ссылаются на имя.
 */
export function deriveVars(defs: unknown, vars: Vars): Vars {
  if (!defs || typeof defs !== 'object' || Array.isArray(defs)) return vars;
  const out = { ...vars };
  for (const [k, x] of Object.entries(defs as Record<string, unknown>)) {
    if (!/^[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*$/.test(k)) continue;
    const n = typeof x === 'number' ? x : typeof x === 'string' ? evalFormula(x.replace(/^=/, ''), out) : null;
    if (n !== null && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

const num = (v: unknown, d: number) => (v !== '' && v !== null && Number.isFinite(Number(v)) ? Number(v) : d);

export interface ControlProps { min?: unknown; max?: unknown; step?: unknown; value?: unknown; steps?: unknown; labels?: unknown }

export interface ControlRange {
  /** Границы, шаг и положение самого ползунка */
  min: number; max: number; step: number; pos: number;
  /** Значение переменной (для steps — выбранный вариант) */
  value: number;
  /** Положение ползунка → значение переменной и обратно */
  varOf(pos: number): number;
  posOf(v: number): number;
  /** Подпись значения: из labels или само число */
  label(pos: number): string | null;
}

/**
 * Ползунок (блок control) с проверкой. Обычный — min…max с шагом; со steps — выбор из списка
 * (полоса 125 / 250 / 500 кГц), ползунок щёлкает по вариантам, labels — их подписи («4/5»).
 */
export function controlRange(p: ControlProps): ControlRange {
  const steps = Array.isArray(p.steps) ? p.steps.map(Number).filter(Number.isFinite) : [];
  const labels = Array.isArray(p.labels) ? p.labels.map((x) => String(x ?? '')) : [];
  if (steps.length >= 2) {
    const posOf = (v: number) => steps.reduce((best, s, k) => (Math.abs(s - v) < Math.abs(steps[best] - v) ? k : best), 0);
    const pos = posOf(num(p.value, steps[0]));
    return {
      min: 0, max: steps.length - 1, step: 1, pos, value: steps[pos],
      varOf: (x) => steps[Math.max(0, Math.min(steps.length - 1, Math.round(x)))],
      posOf,
      label: (x) => labels[Math.round(x)] || null,
    };
  }
  const min = num(p.min, 0);
  const max = Math.max(min + 1e-9, num(p.max, 100));
  const step = Math.max(1e-6, num(p.step, 1));
  const value = Math.max(min, Math.min(max, num(p.value, min)));
  return { min, max, step, pos: value, value, varOf: (x) => x, posOf: (v) => v, label: () => null };
}
