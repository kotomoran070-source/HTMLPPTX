/**
 * Подсветка кода песочницы без библиотек: HTML с CSS и JavaScript внутри.
 * Цель — читаемость на проекторе, а не точный разбор: комментарии, строки, теги,
 * атрибуты и свойства, ключевые слова, числа.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ESC[c]);

const KEYWORDS = 'const|let|var|function|return|if|else|for|while|do|of|in|new|class|extends|this|true|false|null|undefined|import|from|export|async|await|break|continue|switch|case|default|try|catch|finally|throw|typeof|instanceof';

// Порядок важен: из совпадающих в одной точке берётся первое
const TOKEN = new RegExp([
  '(<!--[\\s\\S]*?(?:-->|$))',                       // 1 комментарий HTML
  '(\\/\\*[\\s\\S]*?(?:\\*\\/|$))',                  // 2 комментарий /* */
  '((?<![:\\w])\\/\\/[^\\n]*)',                       // 3 комментарий // (не адрес https://)
  '("(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`(?:\\\\.|[^`\\\\])*`?)', // 4 строка
  '(<\\/?[A-Za-z][\\w-]*|\\/?>)',                     // 5 тег
  '([A-Za-z_$][\\w$-]*(?=\\s*=\\s*["\'])|[A-Za-z-]+(?=\\s*:[^:]))', // 6 атрибут или свойство
  `\\b(${KEYWORDS})\\b`,                              // 7 ключевое слово
  '(#[0-9a-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|%|s|ms|deg|em|rem|vh|vw)?\\b)', // 8 число, цвет
].join('|'), 'g');

const CLS = ['', 'c', 'c', 'c', 's', 't', 'a', 'k', 'n'];

export function highlight(code: string): string {
  let out = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    if (!m[0]) continue;
    const k = m.findIndex((g, i) => i > 0 && g !== undefined);
    out += esc(code.slice(last, m.index)) + `<span class="sx-${CLS[k]}">${esc(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + esc(code.slice(last));
}
