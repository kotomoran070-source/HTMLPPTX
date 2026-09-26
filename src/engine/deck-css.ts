/**
 * Стили презентации (deck.css) — обычно из <style> импортированного HTML.
 * Действуют только внутри слайдов-холстов: всё оборачивается в .canvas-slide { … }
 * (вложенность CSS), поэтому .card из презентации не заденет интерфейс.
 *   :root, html, body → сам слайд (&): там объявляют свои переменные и шрифт;
 *   .slide → .slide-root: корень вёрстки слайда;
 *   @keyframes, @font-face, @property — остаются на верхнем уровне.
 */
const ID = 'htmlpptx-deck-css';
const TOP = /^@(-webkit-)?(keyframes|font-face|property|counter-style|font-feature-values)\b/i;

/** Верхнеуровневые правила: учитывает строки, комментарии и вложенные скобки. */
function statements(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === '\\') i++;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (!depth) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    } else if (c === ';' && !depth) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = css.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

function selectors(list: string): string {
  return list.split(',').map((s) => s.trim()
    .replace(/^(:root|html|body)(?![\w-])/i, '&')
    .replace(/\.slide(?![\w-])/g, '.slide-root')).join(', ');
}

/** CSS презентации → CSS, действующий только внутри слайдов. */
export function scopeCss(css: string): string {
  const top: string[] = [];
  const inner: string[] = [];
  for (const st of statements(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    if (/^@(import|charset|namespace)\b/i.test(st)) continue;
    if (TOP.test(st)) {
      top.push(st);
      continue;
    }
    const brace = st.indexOf('{');
    if (brace < 0) continue;
    const head = st.slice(0, brace).trim();
    // @media / @supports / @container: селекторы внутри тоже переписываем
    if (head.startsWith('@')) inner.push(`${head}{${statements(st.slice(brace + 1, -1)).map(rule).join('')}}`);
    else inner.push(rule(st));
  }
  return `${top.join('\n')}\n.canvas-slide{${inner.join('\n')}}`;
}

function rule(st: string): string {
  const brace = st.indexOf('{');
  if (brace < 0) return '';
  return `${selectors(st.slice(0, brace))}${st.slice(brace)}`;
}

let applied: string | null = null;

/** Подключает стили презентации к документу (или убирает их). */
export function applyDeckCss(css: unknown): void {
  const text = typeof css === 'string' && css.trim() ? css : '';
  if (text === applied) return;
  applied = text;
  let el = document.getElementById(ID);
  if (!text) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
    document.head.appendChild(el);
  }
  el.textContent = scopeCss(text);
}
