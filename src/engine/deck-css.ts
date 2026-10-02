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
export function statements(css: string): string[] {
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
 * Их роль у нас играет показанный слайд движка: «.slide.on .r» → «&:is(.on, .out) .slide-root .r»
 * (.out — слайд, который уходит во время перехода: он остаётся видимым).
 */
const STATE = new Set(['on', 'active', 'current', 'present', 'visible', 'show', 'shown', 'is-active']);
/**
 * Короткая запись того же: «.active .fade» — элементы внутри показанного слайда
 * (класс состояния в начале селектора, без .slide). Ставится показанному слайду движка
 */
const LEAD_STATE = new RegExp(`^(?:\\.(?:${[...STATE].join('|')}))+\\s+(?=[^\\s>+~])`);

/**
 * Встроенные блоки движка (график, карточка, чипы…) на холсте не должны получать стили
 * импортированной вёрстки с теми же именами классов (.bars, .card): к селектору
 * добавляется «не внутри встроенного блока». Вёрстка импорта — блоки html/embed/live — как была.
 */
const NATIVE = '[data-type]:not([data-type="html"]):not([data-type="embed"]):not([data-type="live"])';
// Обёртка свободного объекта (.free, .fx, .auto-h — классы движка) стилям импорта не отдаётся:
// иначе правило импорта «.fx { padding }» сдвигает объект, как только у него появляется анимация,
// и он прыгает при группировке. Вёрстка внутри обёртки получает стили импорта как раньше.
// Части разобранного встроенного шаблона (.tpl-part) — со стилями самого шаблона, не импорта
// Вёрстка, вставленная из другой презентации (.xp-scoped), живёт со своими стилями (deck.scoped)
const GUARD = `:not(:where(${NATIVE}, ${NATIVE} *, .slide > .free, .tpl-part, .tpl-part *, .xp-scoped, .xp-scoped *))`;

function guard(sel: string): string {
  // Сам слайд (&, &.on) — не блок
  if (/^&[\w.:-]*$/.test(sel)) return sel;
  // Псевдоэлемент в конце: условие ставится перед ним
  const m = /(::?(?:before|after|first-line|first-letter|placeholder|marker|selection|backdrop|file-selector-button)(?:\([^)]*\))?)$/i.exec(sel);
  return m ? `${sel.slice(0, m.index)}${GUARD}${m[1]}` : `${sel}${GUARD}`;
}

/**
 * Стили вёрстки из другой презентации: только внутри её блоков (класс ns на блоке).
 * :root, html, body → сам блок (переменные и шрифт наследуются внутрь); .slide → .slide-root внутри блока.
 */
function nsSelectors(list: string, ns: string): string {
  return list.split(',').map((raw) => {
    const s = raw.trim();
    if (!s) return s;
    const root = /^(:root|html|body)(?![\w-])/i.exec(s);
    if (root) return `.${ns}${s.slice(root[0].length)}`;
    if (LEAD_STATE.test(s)) return `&:is(.on, .out) .${ns} ${s.replace(LEAD_STATE, '')}`;
    if (/(?:section)?\.slide(?![\w-])/.test(s)) {
      return s.replace(/(?:section)?\.slide((?:\.[\w-]+)*)(?![\w-])/g, (_, rest: string) => {
        const cls = rest.split('.').filter(Boolean);
        const state = cls.some((c) => STATE.has(c));
        const own = cls.filter((c) => !STATE.has(c)).map((c) => `.${c}`).join('');
        return state ? `&:is(.on, .out) .${ns} .slide-root${own}` : `.${ns} .slide-root${own}`;
      });
    }
    return `.${ns} ${s}`;
  }).join(', ');
}

function selectors(list: string): string {
  return list.split(',').map((s) => guard(s.trim()
    .replace(/^(:root|html|body)(?![\w-])/i, '&')
    .replace(LEAD_STATE, '&:is(.on, .out) ')
    .replace(/(?:section)?\.slide((?:\.[\w-]+)*)(?![\w-])/g, (_, rest: string) => {
      const cls = rest.split('.').filter(Boolean);
      const state = cls.filter((c) => STATE.has(c));
      const own = cls.filter((c) => !STATE.has(c)).map((c) => `.${c}`).join('');
      return state.length ? `&:is(.on, .out) .slide-root${own}` : `.slide-root${own}`;
    }))).join(', ');
}

/**
 * CSS презентации → CSS, действующий только внутри слайдов этой презентации (scope — селектор).
 * ns — стили вставленной из другой презентации вёрстки: только внутри блоков с этим классом.
 */
export function scopeCss(css: string, scope = '.canvas-slide', ns?: string): string {
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
    const one = (r: string) => rule(r, ns);
    if (head.startsWith('@')) inner.push(`${head}{${statements(st.slice(brace + 1, -1)).map(one).join('')}}`);
    else inner.push(one(st));
  }
  return `${top.join('\n')}\n${scope}{${inner.join('\n')}}`;
}

function rule(st: string, ns?: string): string {
  const brace = st.indexOf('{');
  if (brace < 0) return '';
  const head = st.slice(0, brace);
  return `${ns ? nsSelectors(head, ns) : selectors(head)}${st.slice(brace)}`;
}

/** Имя пространства стилей вставленной вёрстки: xp-… */
export const NS_RE = /^xp-[a-z0-9]{3,12}$/;

/**
 * Стили вёрстки, вставленной из других презентаций (deck.scoped: пространство → CSS).
 * Действуют на любых слайдах, но только внутри блоков своего пространства.
 */
export function applyScopedCss(scoped: unknown): void {
  if (!scoped || typeof scoped !== 'object') return;
  for (const [ns, css] of Object.entries(scoped as Record<string, unknown>)) {
    if (!NS_RE.test(ns) || typeof css !== 'string' || !css.trim()) continue;
    const id = `htmlpptx-scoped-${ns}-${cssKey(css)}`;
    if (document.getElementById(id)) continue;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = scopeCss(css, '.slide', ns);
    document.head.appendChild(el);
  }
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
