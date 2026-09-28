import { statements } from '../engine/deck-css';
import type { Block, Deck } from '../types';

/**
 * «Мои шаблоны»: объекты, которые пользователь сам сохранил (правый щелчок → «Сохранить как шаблон»).
 * Шаблон несёт всё, что нужно для того же вида в другой презентации: объекты с анимацией появления,
 * нужные им стили и анимации из стилей презентации (deck.css), SVG-определения и картинки.
 * При импорте ничего не сохраняется само — только вручную.
 * Хранится в браузере; при переезде в облако меняется только load/store здесь.
 */

export interface Template {
  id: string;
  name: string;
  created: number;
  /** Размер группы объектов */
  w: number;
  h: number;
  /** Объекты с place относительно левого верхнего угла группы */
  items: Block[];
  /** Нужная часть стилей презентации: правила, анимации (@keyframes), переменные */
  css?: string;
  /** Нужные SVG-определения (символы, градиенты) */
  defs?: string;
  /** Файлы: адрес в данных объектов → содержимое (data: URL) */
  assets?: Record<string, string>;
  /** Картинка для галереи (data: URL) */
  preview?: string;
}

const KEY = 'htmlpptx-templates';

export function listTemplates(): Template[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function store(list: Template[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** false — не хватило места в хранилище браузера */
export function addTemplate(t: Template): boolean {
  return store([t, ...listTemplates()]);
}

export function removeTemplate(id: string): void {
  store(listTemplates().filter((t) => t.id !== id));
}

// ---------------- что нужно объектам из презентации ----------------

const ASSET = /(?:^|\/)assets\/[^"'\s)]+\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|glb|gltf|html?)(?:\?[^"'\s)]*)?$/i;

/** Все строки-адреса файлов презентации внутри объектов */
export function assetUrls(items: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (!v.startsWith('data:') && ASSET.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(items);
  return [...out];
}

/** Заменить адреса файлов (после копирования в другую презентацию) */
export function replaceUrls<T>(v: T, map: Map<string, string>): T {
  if (typeof v === 'string') return (map.get(v) ?? v) as T;
  if (Array.isArray(v)) return v.map((x) => replaceUrls(x, map)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replaceUrls(x, map)])) as T;
  return v;
}

const ROOT = /^\s*(:root|html|body)\b/i;

/**
 * Часть стилей презентации, которая нужна объектам: правила с их классами (и внутри @media),
 * @keyframes с упомянутыми именами, переменные, на которые есть ссылки. Остальное не берём,
 * чтобы шаблон не перекрасил чужую презентацию.
 */
export function pickCss(deckCss: unknown, items: Block[]): string {
  if (typeof deckCss !== 'string' || !deckCss.trim()) return '';
  const text = JSON.stringify(items);
  const classes = new Set<string>();
  for (const m of text.matchAll(/class=\\?"([^"\\]*)\\?"/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
  const all = statements(deckCss.replace(/\/\*[\s\S]*?\*\//g, ''));
  const usesClass = (sel: string) => [...sel.matchAll(/\.([\w-]+)/g)].some((m) => classes.has(m[1]));
  const kept: string[] = [];
  for (const st of all) {
    const brace = st.indexOf('{');
    if (brace < 0) continue;
    const head = st.slice(0, brace).trim();
    if (/^@(-webkit-)?keyframes|^@font-face|^@property/i.test(head)) continue;
    if (/^@(media|supports|container)/i.test(head)) {
      const inner = statements(st.slice(brace + 1, -1)).filter((r) => usesClass(r.slice(0, r.indexOf('{'))));
      if (inner.length) kept.push(`${head}{${inner.join('')}}`);
    } else if (!ROOT.test(head) && usesClass(head)) kept.push(st);
  }
  const used = kept.join('\n') + text;
  // Анимации и шрифты, на которые ссылаются взятые правила и сами объекты
  for (const st of all) {
    const head = st.slice(0, st.indexOf('{')).trim();
    const kf = /^@(?:-webkit-)?keyframes\s+([\w-]+)/i.exec(head);
    if (kf && new RegExp(`\\b${kf[1]}\\b`).test(used)) kept.push(st);
    const ff = /^@font-face/i.test(head) ? /font-family\s*:\s*["']?([^"';]+)/i.exec(st)?.[1] : null;
    if (ff && used.includes(ff.trim())) kept.push(st);
  }
  // Переменные презентации, на которые есть ссылки
  const vars = new Set([...kept.join('\n').concat(text).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const decls: string[] = [];
  for (const st of all) {
    if (!ROOT.test(st.slice(0, st.indexOf('{')))) continue;
    for (const m of st.slice(st.indexOf('{') + 1, -1).matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      if (vars.has(m[1])) decls.push(`${m[1]}:${m[2].trim()}`);
    }
  }
  if (decls.length) kept.unshift(`:root{${decls.join(';')}}`);
  return kept.join('\n');
}

/** SVG-определения (символ логотипа, градиенты), на которые ссылаются объекты */
export function pickDefs(deckDefs: unknown, items: Block[]): string {
  if (typeof deckDefs !== 'string' || !deckDefs.trim()) return '';
  const text = JSON.stringify(items);
  const ids = new Set([...text.matchAll(/(?:href=\\?"#|url\(#)([\w-]+)/g)].map((m) => m[1]));
  if (!ids.size) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg>${deckDefs}</svg>`;
  return [...tpl.content.firstElementChild!.children].filter((el) => ids.has(el.id)).map((el) => el.outerHTML).join('');
}

/** Добавить стили шаблона к стилям презентации: без повторов и без замены её переменных */
export function mergeCss(deckCss: unknown, add: string | undefined): string | undefined {
  const base = typeof deckCss === 'string' ? deckCss : '';
  if (!add?.trim()) return base || undefined;
  const have = new Set(statements(base).map((s) => s.replace(/\s+/g, ' ').trim()));
  const out: string[] = [];
  for (let st of statements(add)) {
    if (/^:root\{/.test(st)) {
      // Переменные, которые презентация уже задала, остаются её
      const decls = st.slice(6, -1).split(';').filter((d) => {
        const name = d.split(':')[0].trim();
        return name && !new RegExp(`${name}\\s*:`).test(base);
      });
      if (!decls.length) continue;
      st = `:root{${decls.join(';')}}`;
    }
    if (!have.has(st.replace(/\s+/g, ' ').trim())) out.push(st);
  }
  return out.length ? `${base}${base ? '\n' : ''}/* из шаблона */\n${out.join('\n')}` : base || undefined;
}

export function mergeDefs(deckDefs: unknown, add: string | undefined): string | undefined {
  const base = typeof deckDefs === 'string' ? deckDefs : '';
  if (!add?.trim()) return base || undefined;
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg>${add}</svg>`;
  const extra = [...tpl.content.firstElementChild!.children].filter((el) => !el.id || !base.includes(`id="${el.id}"`)).map((el) => el.outerHTML).join('');
  return base + extra || undefined;
}

// ---------------- мои эффекты появления ----------------

/**
 * Эффект появления, сохранённый вручную из импортированного объекта: только движение
 * (прозрачность, сдвиг, масштаб, поворот, размытие) — его можно дать любому объекту.
 */
export interface UserEffect {
  /** Он же имя @keyframes: ufx-… */
  id: string;
  name: string;
  /** @keyframes <id> { … } */
  css: string;
  ms: number;
  ease: string;
  created: number;
}

const FX_KEY = 'htmlpptx-effects';

export function listEffects(): UserEffect[] {
  try {
    const v = JSON.parse(localStorage.getItem(FX_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function addEffect(e: UserEffect): boolean {
  try {
    localStorage.setItem(FX_KEY, JSON.stringify([e, ...listEffects()]));
    return true;
  } catch {
    return false;
  }
}

export function removeEffect(id: string): void {
  try { localStorage.setItem(FX_KEY, JSON.stringify(listEffects().filter((e) => e.id !== id))); } catch { /* нет доступа */ }
}

/** Свойства, которые двигают сам объект: такая анимация переносится на любой */
const MOVABLE = /^(opacity|transform|translate|scale|rotate|filter|clip-path|-webkit-clip-path|offset|transform-origin|animation-timing-function)$/;

/**
 * Появление объекта на слайде, если его можно сохранить как эффект.
 * Ищется анимация у корня вёрстки и у элементов почти во весь объект; в редакторе
 * анимации выключены, поэтому на мгновение снимается класс правки (без перерисовки).
 */
export function findEntrance(root: HTMLElement): { keyframes: CSSKeyframesRule; ms: number; ease: string } | null {
  if (!root.offsetWidth) return null;
  // Сам объект и его части: берётся появление самой крупной части с переносимой анимацией
  const els = [root, ...[...root.querySelectorAll<HTMLElement>('*')].slice(0, 600)];
  const body = document.body;
  const editing = body.classList.contains('editing');
  if (editing) body.classList.remove('editing');
  const found: { name: string; ms: number; ease: string; area: number }[] = [];
  try {
    for (const el of els) {
      const cs = getComputedStyle(el);
      const name = cs.animationName.split(',')[0].trim();
      if (!name || name === 'none' || /^(fx-|tr-|enter$)/.test(name)) continue;
      if (cs.animationIterationCount.split(',')[0].trim() === 'infinite') continue;
      const r = el.getBoundingClientRect();
      const ms = parseFloat(cs.animationDuration) * (cs.animationDuration.includes('ms') ? 1 : 1000);
      found.push({ name, ms: Math.round(ms) || 600, ease: cs.animationTimingFunction.split(/,(?![^(]*\))/)[0].trim() || 'ease', area: r.width * r.height });
    }
  } finally {
    if (editing) body.classList.add('editing');
  }
  found.sort((a, b) => b.area - a.area);
  const seen = new Set<string>();
  for (const f of found) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    const rule = keyframesRule(f.name);
    if (!rule || !rule.cssRules.length) continue;
    // Только движение самого объекта: цвет, размеры, обводки линий — часть устройства блока
    const frames = [...rule.cssRules] as CSSKeyframeRule[];
    const movable = frames.every((kf) => [...Array(kf.style.length).keys()].every((i) => MOVABLE.test(kf.style[i])));
    // Нужен начальный кадр: анимация «только к концу» держится на исходном виде элемента и на другом не видна
    const hasStart = frames.some((kf) => /(^|,)\s*(0%|from)\s*(,|$)/.test(kf.keyText));
    if (movable && hasStart) return { keyframes: rule, ms: Math.max(100, Math.min(4000, f.ms)), ease: f.ease };
  }
  return null;
}

function keyframesRule(name: string): CSSKeyframesRule | null {
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of [...rules]) if (r instanceof CSSKeyframesRule && r.name === name) return r;
  }
  return null;
}

/** Эффект → в данные презентации: @keyframes в её стили и описание в deck.effects */
export function deckWithEffect(d: Deck, e: UserEffect): void {
  const x = d as Deck & { css?: string };
  const css = mergeCss(x.css, e.css);
  if (css) x.css = css;
  d.effects = { ...(d.effects ?? {}), [e.id]: { name: e.name, ms: e.ms, ease: e.ease } };
}

export function deckWithTemplate(d: Deck, t: Template): void {
  const x = d as Deck & { css?: string; defs?: string };
  const css = mergeCss(x.css, t.css);
  if (css) x.css = css;
  const defs = mergeDefs(x.defs, t.defs);
  if (defs) x.defs = defs;
}
