/**
 * Стили презентации (deck.css) — обычно из <style> импортированного HTML.
 * Действуют только внутри слайдов-холстов: всё оборачивается в .canvas-slide { … }
 * (вложенность CSS), поэтому .card из презентации не заденет интерфейс.
 *   :root, html, body → сам слайд (&): там объявляют свои переменные и шрифт;
 *   секция файла (<section class="slide dark">) — это и слайд движка, и корень вёрстки (.slide-root) в нём:
 *     «.slide .title», «.slide.dark .body», «.dark .body» → элементы всего слайда, и вёрстки, и свободных
 *     объектов (класс секции — у слайда, slide.class);
 *     «.slide { … }» → корень вёрстки (раскладка: grid, поля) и слайду — только цвет, шрифт и фон:
 *     положением, размером, видимостью и анимацией слайда движок управляет сам;
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

/** Прежнее прочтение: .slide — корень вёрстки (для селекторов, где секция не в начале: «.deck .slide .x») */
function legacy(s: string): string {
  return s
    .replace(/^(:root|html|body)(?![\w-])/i, '&')
    .replace(LEAD_STATE, '&:is(.on, .out) ')
    .replace(/(?:section)?\.slide((?:\.[\w-]+)*)(?![\w-])/g, (_, rest: string) => {
      const cls = rest.split('.').filter(Boolean);
      const state = cls.filter((c) => STATE.has(c));
      const own = cls.filter((c) => !STATE.has(c)).map((c) => `.${c}`).join('');
      return state.length ? `&:is(.on, .out) .slide-root${own}` : `.slide-root${own}`;
    });
}

/** Делит по разделителю верхнего уровня (не внутри скобок и строк) */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q = '';
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && !depth) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Селектор → простые части и комбинаторы перед ними («» у первой, « », «>», «+», «~») */
function compounds(sel: string): { comb: string; c: string }[] {
  const out: { comb: string; c: string }[] = [];
  let depth = 0;
  let q = '';
  let cur = '';
  let next = '';
  const push = () => {
    if (!cur) return;
    out.push({ comb: next, c: cur });
    cur = '';
    next = ' ';
  };
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += sel[++i] ?? '';
      else if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (!depth && /\s/.test(c)) { push(); continue; } else if (!depth && (c === '>' || c === '+' || c === '~')) {
      push();
      next = c;
      continue;
    }
    cur += c;
  }
  push();
  return out;
}
const join = (parts: { comb: string; c: string }[]) => parts.map((p, i) => (i ? (p.comb === ' ' ? ' ' : ` ${p.comb} `) : p.comb ? `${p.comb} ` : '') + p.c).join('');

/**
 * Часть селектора — сама секция-слайд: «.slide», «section.slide.dark», «.slide.active», «.slide:not(.dark)»
 * или только классы секций презентации («.dark»; classes — классы её слайдов, slide.class)
 */
function sectionOf(c: string, classes: ReadonlySet<string>): { own: string; state: boolean; explicit: boolean; tail: string } | null {
  const m = /^(?:section)?((?:\.[\w-]+)+)((?::[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*)$/i.exec(c);
  if (!m) return null;
  const cls = m[1].split('.').filter(Boolean);
  const explicit = cls.includes('slide');
  const rest = cls.filter((x) => x !== 'slide');
  const state = rest.some((x) => STATE.has(x));
  const own = rest.filter((x) => !STATE.has(x));
  if (!explicit && (!own.length || own.some((x) => !classes.has(x))) && !(state && !own.length)) return null;
  return { own: own.map((x) => `.${x}`).join(''), state, explicit, tail: m[2] };
}

/**
 * Один селектор из CSS презентации → как он действует внутри слайда (для правила, вложенного в слайд).
 * slide — селектор самого слайда движка, если правило про секцию («.slide { … }»): ему — только
 * безопасные свойства (paint)
 */
export function mapSelector(raw: string, classes: ReadonlySet<string> = new Set()): { sel: string; slide?: string } {
  // «body .slide .x» — то же, что «.slide .x»: body — это слайд
  const s = raw.trim().replace(/^(?::root|html|body)\s+(?=[^\s>+~])/i, '');
  const parts = compounds(s);
  const sec = parts.length && !parts[0].comb ? sectionOf(parts[0].c, classes) : null;
  if (!sec || (!sec.explicit && !sec.own && parts.length === 1)) return { sel: legacy(s) };
  const is = sec.state ? ':is(.on, .out)' : '';
  // Слайд движка (класс slide у него есть — специфичность та же, что у «.slide» в файле) и корень вёрстки в нём
  // (в презентациях, импортированных раньше, класс секции — только у корня вёрстки)
  const slide = `&${sec.explicit ? '.slide' : ''}${sec.own}${is}${sec.tail}`;
  const root = sec.explicit ? `${is ? `&${is} ` : '& '}.slide-root${sec.own}${sec.tail}` : sec.own ? `& ${sec.own}${sec.tail}` : slide;
  if (parts.length === 1) {
    // Правило про саму секцию: вёрстке — всё (как было), слайду — цвет, шрифт, фон
    return { sel: sec.explicit ? root.replace(/^& /, '') : legacy(s), slide };
  }
  if (!sec.own && !sec.tail && !sec.state && sec.explicit && parts[1].comb === ' ') return { sel: join([{ comb: '', c: '&.slide' }, ...parts.slice(1)]) };
  const comb = parts[1].comb;
  // Соседи секции («.slide + .slide») — как раньше: у слайдов движка своих соседей нет
  if (comb !== ' ' && comb !== '>') return { sel: legacy(s) };
  // Дети секции: дети корня вёрстки и сами свободные объекты (их элемент — внутри обёртки движка)
  const head = comb === '>' ? `:is(${root}, ${slide} > .free > .html-block > .html-inner)`
    : root === slide ? slide : `:is(${slide}, ${root})`;
  return { sel: join([{ comb: '', c: head }, ...parts.slice(1)]) };
}

/** Свойства правила самой секции, которые получает и слайд движка: наследуемое оформление и фон */
const PAINT = /^(--[\w-]+|color|background(-[\w-]+)?|font(-[\w-]+)?|line-height|letter-spacing|word-spacing|text-(align|transform|shadow|rendering|wrap|indent|decoration(-[\w-]+)?)|hyphens|white-space|direction|quotes|tab-size|accent-color|caret-color|color-scheme|-webkit-font-smoothing|-moz-osx-font-smoothing)$/i;

function paintOnly(body: string): string {
  const inner = body.trim().replace(/^\{|\}$/g, '');
  if (inner.includes('{')) return '';
  return splitTop(inner, ';').map((d) => d.trim()).filter((d) => {
    const i = d.indexOf(':');
    return i > 0 && PAINT.test(d.slice(0, i).trim());
  }).join(';');
}

/**
 * CSS презентации → CSS, действующий только внутри слайдов этой презентации (scope — селектор).
 * ns — стили вставленной из другой презентации вёрстки: только внутри блоков с этим классом.
 * classes — классы слайдов презентации (slide.class): «.dark .x» — элементы слайда с классом dark
 */
export function scopeCss(css: string, scope = '.canvas-slide', ns?: string, classes: ReadonlySet<string> = new Set()): string {
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
    const one = (r: string) => rule(r, ns, classes);
    if (head.startsWith('@')) inner.push(`${head}{${statements(st.slice(brace + 1, -1)).map(one).join('')}}`);
    else inner.push(one(st));
  }
  return `${top.join('\n')}\n${scope}{${inner.join('\n')}}`;
}

function rule(st: string, ns?: string, classes?: ReadonlySet<string>): string {
  const brace = st.indexOf('{');
  if (brace < 0) return '';
  const head = st.slice(0, brace);
  const body = st.slice(brace);
  if (ns) return `${nsSelectors(head, ns)}${body}`;
  const sels: string[] = [];
  const slides: string[] = [];
  for (const raw of splitTop(head, ',')) {
    if (!raw.trim()) continue;
    const m = mapSelector(raw, classes);
    sels.push(guard(m.sel));
    if (m.slide) slides.push(m.slide);
  }
  const paint = slides.length ? paintOnly(body) : '';
  return `${sels.join(', ')}${body}${paint ? `\n${slides.join(', ')}{${paint}}` : ''}`;
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
 * Классы секций, перенесённые на слайд (slide.class): только свои имена — не служебные классы слайда движка
 * (показан, уходит, переходы) и не состояния самодельных движков (.active)
 */
const RESERVED = new Set(['slide', 'canvas-slide', 'on', 'out', 'morph-ghost', 'door', 'door-l', 'door-r', ...STATE]);
export function slideClasses(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return [...new Set(v.split(/\s+/).filter((c) => /^[A-Za-z_][\w-]{0,40}$/.test(c) && !RESERVED.has(c)))].slice(0, 8);
}

/**
 * Подключает стили презентации к документу и возвращает метку для её слайдов
 * (data-css="…"). У каждой презентации свои стили: на странице выбора их несколько сразу.
 * classes — классы её слайдов (slide.class)
 */
export function applyDeckCss(css: unknown, classes: Iterable<string> = []): string | null {
  const text = typeof css === 'string' && css.trim() ? css : '';
  if (!text) return null;
  const set = new Set(classes);
  const key = cssKey(`${text}\n${[...set].sort().join(' ')}`);
  const id = `${ID}-${key}`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    el.textContent = scopeCss(text, `.canvas-slide[data-css="${key}"]`, undefined, set);
  }
  // Действующие стили — последними среди стилей презентаций: @keyframes и @font-face не привязаны к
  // слайдам, и при одинаковом имени побеждает последнее. Вернули прежний текст (Ctrl+Z, правка обратно) —
  // старый блок стилей уже есть, но лежит раньше новых: без переноса анимация оставалась от последней правки
  const all = document.head.querySelectorAll(`style[id^="${ID}-"]`);
  if (all[all.length - 1] !== el) document.head.appendChild(el);
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
