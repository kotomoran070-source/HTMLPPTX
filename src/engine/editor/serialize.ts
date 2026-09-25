/**
 * Обратное преобразование: содержимое редактируемого элемента → строка с разметкой
 * (**жирный**, *курсив*, __подчёркнутый__, [ссылка](url), «- » для пунктов списка).
 * Работает с тем, что создают браузеры при правке: b/strong, i/em, u, a, br, div/p.
 */

/** Символы разметки в обычном тексте экранируются, чтобы не стать оформлением. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/__/g, '\\_\\_')
    .replace(/\[([^\]]*)\]\(/g, '\\[$1\\](');
}

/** Метка пункта списка до финальной сборки строки */
const LI = '\u0001';

const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);

function wrap(mark: string, inner: string): string {
  if (!inner.trim()) return inner;
  // Пробелы по краям выносим наружу: «** жирный**» не распознаётся как оформление
  const lead = /^\s*/.exec(inner)![0];
  const tail = /\s*$/.exec(inner)![0];
  return `${lead}${mark}${inner.trim()}${mark}${tail}`;
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText((node.textContent ?? '').replace(/\u00a0/g, ' '));
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const inner = () => [...el.childNodes].map(walk).join('');
  const tag = el.tagName;
  if (tag === 'BR') return '\n';
  if (el.classList.contains('md-li')) return `\n${LI}${inner().replace(/\n+/g, ' ').trim()}\n`;
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
  if (under) s = wrap('__', s);
  if (italic) s = wrap('*', s);
  if (bold) s = wrap('**', s);
  if (BLOCK.has(tag)) s = `\n${s}\n`;
  return s;
}

export function toMarkup(el: HTMLElement): string {
  const raw = [...el.childNodes].map(walk).join('');
  return raw
    // Пункты списка идут строка за строкой, без пустых строк между ними
    .replace(/\n{2,}(?=\u0001)/g, '\n')
    .replace(/(\u0001[^\n]*)\n{2,}/g, '$1\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    // Обычная строка, похожая на пункт списка, остаётся обычной строкой
    .map((line) => (line.startsWith(LI) ? `- ${line.slice(1)}` : line.replace(/^([-•])(\s)/, '\\$1$2')))
    .join('\n');
}

/** Переключает оформление всех строк как пунктов списка. */
export function toggleList(markup: string): string {
  const lines = markup.split('\n').filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1));
  const all = lines.length > 0 && lines.every((l) => /^[-•]\s+/.test(l) || !l.trim());
  return lines.map((l) => (all ? l.replace(/^[-•]\s+/, '') : l.trim() && !/^[-•]\s+/.test(l) ? `- ${l}` : l)).join('\n');
}

/** Текст без оформления: для «Сбросить оформление». */
export function plainMarkup(el: HTMLElement): string {
  return escapeText((el.innerText ?? el.textContent ?? '').replace(/\u00a0/g, ' ').trim());
}
