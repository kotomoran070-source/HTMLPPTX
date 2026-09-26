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

/**
 * Классы «слайд показан» у самодельных движков (артефакты, reveal.js): .slide.on, .slide.active.
 * Их роль у нас играет показанный слайд движка: «.slide.on .r» → «&.on .slide-root .r».
 */
const STATE = new Set(['on', 'active', 'current', 'present', 'visible', 'show', 'shown', 'is-active']);

function selectors(list: string): string {
  return list.split(',').map((s) => s.trim()
    .replace(/^(:root|html|body)(?![\w-])/i, '&')
    .replace(/(?:section)?\.slide((?:\.[\w-]+)*)(?![\w-])/g, (_, rest: string) => {
      const cls = rest.split('.').filter(Boolean);
      const state = cls.filter((c) => STATE.has(c));
      const own = cls.filter((c) => !STATE.has(c)).map((c) => `.${c}`).join('');
      return state.length ? `&.on .slide-root${own}` : `.slide-root${own}`;
    })).join(', ');
}

/** CSS презентации → CSS, действующий только внутри слайдов этой презентации (scope — селектор). */
export function scopeCss(css: string, scope = '.canvas-slide'): string {
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
  return `${top.join('\n')}\n${scope}{${inner.join('\n')}}`;
}

function rule(st: string): string {
  const brace = st.indexOf('{');
  if (brace < 0) return '';
  return `${selectors(st.slice(0, brace))}${st.slice(brace)}`;
}

/** Короткий отпечаток текста: метка слайдов и их стилей */
export function cssKey(css: string): string {
  let h = 5381;
  for (let i = 0; i < css.length; i++) h = ((h << 5) + h + css.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Подключает стили презентации к документу и возвращает метку для её слайдов
 * (data-css="…"). У каждой презентации свои стили: на странице выбора их несколько сразу.
 */
export function applyDeckCss(css: unknown): string | null {
  const text = typeof css === 'string' && css.trim() ? css : '';
  if (!text) return null;
  const key = cssKey(text);
  const id = `${ID}-${key}`;
  if (!document.getElementById(id)) {
    const el = document.createElement('style');
    el.id = id;
    el.textContent = scopeCss(text, `.canvas-slide[data-css="${key}"]`);
    document.head.appendChild(el);
  }
  return key;
}

/**
 * SVG-определения презентации (deck.defs): символы (<symbol id="lg"> — логотип) и градиенты,
 * на которые ссылаются слайды через <use href="#lg"> и url(#gA). Лежат один раз на странице,
 * вне слайдов: определения внутри скрытого слайда браузер не рисует.
 */
export function applyDeckDefs(defs: unknown): void {
  if (typeof defs !== 'string' || !defs.trim()) return;
  const id = `htmlpptx-defs-${cssKey(defs)}`;
  if (document.getElementById(id)) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg id="${id}" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${defs}</defs></svg>`;
  // Только определения: без скриптов и обработчиков
  tpl.content.querySelectorAll('script, foreignObject').forEach((x) => x.remove());
  tpl.content.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => /^on/i.test(a.name) && el.removeAttribute(a.name)));
  document.body.appendChild(tpl.content);
}
