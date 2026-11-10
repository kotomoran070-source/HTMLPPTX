/**
 * Обратное преобразование: содержимое редактируемого элемента → строка с разметкой
 * (**жирный**, *курсив*, __подчёркнутый__, [ссылка](url), {#цвет|текст}, {mark|маркер}, «- » для пунктов списка).
 * Работает с тем, что создают браузеры при правке: b/strong, i/em, u, a, font, br, div/p.
 */
import { formatSpanAttrs, mergeSpanAttrs, parseSpanAttrs, SPAN_TOKEN, type SpanAttrs } from '../span-attrs';
import { listToken } from '../text-style';

/** Символы разметки в обычном тексте экранируются, чтобы не стать оформлением. */
export function escapeText(s: string): string {
  // Формулы {{price*2}} — как есть: звёздочка там умножение
  const parts = s.split(/(\{\{[^{}]*\}\})/);
  if (parts.length > 1) return parts.map((x, k) => (k % 2 ? x : escapeText(x))).join('');
  return s
    .replace(/\\/g, '\\\\')
    // {…|…}, похожее на оформление ({#2563EB|…}, {s:80|…}, {f:Inter|…}, {mark|…}), — буквальным текстом
    .replace(/\{(?=([^{}|\n]+)\|)/g, (m, a: string) => (/^mark$/i.test(a) || parseSpanAttrs(a) ? '\\{' : m))
    .replace(/\*/g, '\\*')
    .replace(/__/g, '\\_\\_')
    .replace(/\[([^\]]*)\]\(/g, '\\[$1\\](');
}

/** Метка пункта списка до финальной сборки строки */
const LI = '\u0001';
const GAP = '\u0002';
/** Вид маркера строки — между этими метками сразу после LI */
const TOK = '\u0003';

const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);

function wrap(mark: string, inner: string): string {
  if (!inner.trim()) return inner;
  // Пробелы по краям выносим наружу: «** жирный**» не распознаётся как оформление
  const lead = /^\s*/.exec(inner)![0];
  const tail = /\s*$/.exec(inner)![0];
  return `${lead}${mark}${inner.trim()}${mark}${tail}`;
}

/** Токен оформления (с -c и -f правки); группа — весь токен */
const SPAN_SPLIT = /(\{[^{}|\n]+\|[^{}]*\})/;

/**
 * Оформление части текста ({цвет s:размер f:шрифт|…}, span-attrs.ts) вокруг текста. Разметка не вкладывается:
 * уже оформленные внутри куски получают общее оформление (их цвет и шрифт главнее, размеры перемножаются)
 */
export function wrapColor(attrs: string, s: string): string {
  const outer = parseSpanAttrs(attrs, true);
  if (!outer) return s;
  return s.split(SPAN_SPLIT).map((part, i) => {
    if (i % 2 === 1) {
      const m = /^\{([^{}|\n]+)\|([^{}]*)\}$/.exec(part)!;
      const inner = parseSpanAttrs(m[1], true);
      return inner ? token(mergeSpanAttrs(outer, inner), m[2]) : part;
    }
    // Одни пробелы и знаки разметки (** вокруг вложенного куска) — без оформления
    if (!part.replace(/\*\*|__|\*/g, '').trim()) return part;
    const lead = /^\s*/.exec(part)![0];
    const tail = /\s*$/.exec(part)![0];
    return `${lead}${token(outer, part.trim())}${tail}`;
  }).join('');
}

const token = (o: SpanAttrs, inner: string) => {
  const a = formatSpanAttrs(o, true);
  return a ? `{${a}|${inner}}` : inner;
};

/** Метки правки (-c, -f) в готовой разметке не нужны: снаружи ничего не перекрывают */
function finalSpans(line: string): string {
  return line.replace(SPAN_TOKEN, (m, a: string, inner: string, at: number) => {
    if (at > 0 && line[at - 1] === '\\') return m;
    const o = parseSpanAttrs(a, true);
    if (!o) return m;
    const out = formatSpanAttrs(o);
    return out ? `{${out}|${inner}}` : inner;
  });
}

/** Оформление части текста: наш span (data-c), <font color> после команды браузера или style. */
function colorOf(el: HTMLElement): string | null {
  const own = el.getAttribute('data-c');
  if (own) return own;
  const c = el.getAttribute('color') || el.style.color;
  if (!c) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('') : null;
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText((node.textContent ?? '').replace(/\u00a0/g, ' '));
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const inner = () => [...el.childNodes].map(walk).join('');
  const tag = el.tagName;
  if (tag === 'BR') return '\n';
  // Символ нулевой ширины держит пустой пункт в правке — в текст не идёт
  // Свой вид маркера у пункта (data-li) — «-[вид] » в начале строки
  if (el.classList.contains('md-li')) {
    const tok = el.dataset.li && listToken(el.dataset.li) ? `${TOK}${el.dataset.li}${TOK}` : '';
    return `\n${LI}${tok}${inner().replace(/\u200b/g, '').replace(/\n+/g, ' ').trim()}\n`;
  }
  // Промежуток у списка (пустая строка рядом с пунктами) — остаётся пустой строкой
  if (el.classList.contains('md-gap')) {
    // Напечатали прямо в промежутке — это уже строка текста
    const typed = inner().replace(/\u200b/g, '');
    return typed.trim() ? `\n${typed}\n` : GAP;
  }
  const style = el.getAttribute('style') ?? '';
  const bold = tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(style);
  const italic = tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(style);
  const under = tag === 'U' || /text-decoration[^;]*underline/.test(style);
  if (tag === 'A') {
    const href = el.getAttribute('href') ?? '';
    const text = inner();
    return href && text.trim() ? `[${text.trim()}](${href})` : text;
  }
  let s = inner();
  if (tag === 'MARK') return s.trim() ? `{mark|${s}}` : s;
  const color = tag === 'SPAN' || tag === 'FONT' ? colorOf(el) : null;
  if (color) s = wrapColor(color, s);
  if (under) s = wrap('__', s);
  if (italic) s = wrap('*', s);
  if (bold) s = wrap('**', s);
  if (BLOCK.has(tag)) s = `\n${s}\n`;
  return s;
}

export function toMarkup(el: HTMLElement): string {
  // Каждый промежуток (md-gap) — своя строка: после сборки он станет одной пустой строкой
  const raw = [...el.childNodes].map(walk).join('')
    .replace(/\n*(\u0002(?:\n*\u0002)*)\n*/g, (_m, run: string) => `\n${run.replace(/\n/g, '').split('').join('\n')}\n`);
  return raw
    // Пункты списка идут строка за строкой, без пустых строк между ними
    .replace(/\n{2,}(?=\u0001)/g, '\n')
    .replace(/(\u0001[^\n]*)\n{2,}/g, '$1\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    // Обычная строка, похожая на пункт списка, остаётся обычной строкой; промежуток — пустой строкой
    .map((line) => {
      if (line === GAP) return '';
      if (!line.startsWith(LI)) return line.replace(/^([-•])(\s|\[[^\]\n]+\]\s)/, '\\$1$2');
      const m = new RegExp(`^${LI}(?:${TOK}([^${TOK}]*)${TOK})?([\\s\\S]*)$`).exec(line)!;
      return m[1] ? `-[${m[1]}] ${m[2]}` : `- ${m[2]}`;
    })
    .map(finalSpans)
    .join('\n');
}

/**
 * Метки начала и конца выделения в тексте (частная область Юникода): по ним после toMarkup видно, каких строк
 * касается выделение, а после новой отрисовки — куда его вернуть
 */
export const SEL_A = '\uE000';
export const SEL_B = '\uE001';
/** Начало пункта: «- » или «-[вид] » */
const LI_RE = /^[-•](?:\[[^\]\n]+\])?\s+/;
const unmark = (l: string) => l.replace(/[\uE000\uE001]/g, '');

/** Строки, которых касается выделение (метки SEL_A и SEL_B); меток нет — null */
function touchedLines(lines: string[]): number[] | null {
  let from = lines.findIndex((l) => l.includes(SEL_A));
  let to = lines.findIndex((l) => l.includes(SEL_B));
  if (from < 0 || to < 0) return null;
  if (to < from) [from, to] = [to, from];
  // Протянули до самого начала следующей строки — она не задета
  if (to > from && lines[to].replace(LI_RE, '').startsWith(SEL_B)) to--;
  const touched: number[] = [];
  for (let k = from; k <= to; k++) if (unmark(lines[k]).trim() || from === to) touched.push(k);
  return touched;
}

/** Строка без меток в начале: [метки, остальное] — метка перед «- » остаётся в начале текста строки */
const splitLead = (l: string): [string, string] => {
  const lead = /^[\uE000\uE001]*/.exec(l)![0];
  return [lead, l.slice(lead.length)];
};

/**
 * Вид маркера kind — строкам под выделением (меток нет — всем строкам); не пункты становятся пунктами.
 * fieldKind — вид всего поля: у строк без своего вида. Если после этого все пункты одного вида, он становится
 * видом поля (field), а свои виды у строк убираются; иначе field — null
 */
export function setListKindAt(markup: string, kind: string, fieldKind: string): { markup: string; field: string | null } {
  const lines = markup.split('\n');
  const touched = touchedLines(lines) ?? lines.map((_l, k) => k).filter((k) => unmark(lines[k]).trim());
  for (const k of touched) {
    const [lead, rest] = splitLead(lines[k]);
    lines[k] = `-${kind === fieldKind ? '' : `[${kind}]`} ${lead}${rest.replace(LI_RE, '')}`;
  }
  const kindOf = (l: string) => /^[-•]\[([^\]\n]+)\]/.exec(unmark(l))?.[1] ?? fieldKind;
  const items = lines.filter((l) => LI_RE.test(unmark(l)));
  if (kind === fieldKind || !items.every((l) => kindOf(l) === kind)) return { markup: lines.join('\n'), field: null };
  return { markup: lines.map((l) => (LI_RE.test(unmark(l)) ? l.replace(/^([-•])\[[^\]\n]+\]/, '$1') : l)).join('\n'), field: kind };
}

/**
 * Пункты списка — только у строк, которых касается выделение (с метками SEL_A и SEL_B), как в Word и PowerPoint:
 * все они уже пункты — снять, иначе — сделать пунктами. Без меток — все строки (toggleList)
 */
export function toggleListAt(markup: string): string {
  const lines = markup.split('\n');
  const touched = touchedLines(lines);
  if (!touched) return toggleList(markup);
  if (!touched.length) return markup;
  const all = touched.every((k) => LI_RE.test(unmark(lines[k])));
  for (const k of touched) {
    const [lead, rest] = splitLead(lines[k]);
    if (all) lines[k] = lead + rest.replace(LI_RE, '');
    else if (!LI_RE.test(rest)) lines[k] = `- ${lead}${rest}`;
  }
  return lines.join('\n');
}

/** Переключает оформление всех строк как пунктов списка. */
export function toggleList(markup: string): string {
  const lines = markup.split('\n').filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1));
  const all = lines.length > 0 && lines.every((l) => LI_RE.test(l) || !l.trim());
  return lines.map((l) => (all ? l.replace(LI_RE, '') : l.trim() && !LI_RE.test(l) ? `- ${l}` : l)).join('\n');
}

/** Текст без оформления: для «Сбросить оформление». */
export function plainMarkup(el: HTMLElement): string {
  return escapeText((el.innerText ?? el.textContent ?? '').replace(/\u00a0/g, ' ').trim());
}
