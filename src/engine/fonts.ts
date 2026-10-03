import { cssKey } from './deck-css';

/**
 * Свои шрифты презентации: файлы в assets/ (deck.yaml → fonts: [{ name, src }]).
 * Подключаются через @font-face и едут вместе с собранным файлом — работают без интернета.
 * theme.font — шрифт всей презентации: им пишутся слайды этой презентации (и только они).
 */
export interface DeckFont {
  name: string;
  src: string;
}

/** Имя шрифта: буквы, цифры, пробел, дефис — без кавычек и скобок, чтобы не сломать CSS */
const NAME_RE = /^[\p{L}\p{N} _-]{1,60}$/u;
export const fontNameOk = (n: unknown): n is string => typeof n === 'string' && NAME_RE.test(n.trim());

/** CSS семейства: свой шрифт, а при его отсутствии — шрифт интерфейса */
export const fontStack = (name: string) => `"${name.trim()}", var(--font-base, system-ui, sans-serif)`;

export function deckFonts(fonts: unknown): DeckFont[] {
  if (!Array.isArray(fonts)) return [];
  return fonts.filter((f): f is DeckFont => !!f && fontNameOk((f as DeckFont).name) && typeof (f as DeckFont).src === 'string' && !!(f as DeckFont).src);
}

/** Шрифты общей библиотеки — для предпросмотра в списках (сами презентации берут свои копии) */
export function applyLibraryFonts(list: { name: string; url: string }[]): void {
  const id = 'htmlpptx-font-library';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = list.filter((f) => fontNameOk(f.name)).map((f) => `@font-face{font-family:"${f.name.trim()}";src:url("${f.url.replace(/["\\\n]/g, '')}");font-weight:100 900;font-display:swap}`).join('\n');
}

const FORMAT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/**
 * Подключает шрифты презентации и возвращает метку для её слайдов (data-fonts) — если задан
 * шрифт всей презентации. Начертания (толщины) берутся из файла: переменный шрифт — все сразу.
 */
export function applyDeckFonts(fonts: unknown, main: unknown): string | null {
  const list = deckFonts(fonts);
  const faces = list.map((f) => {
    const src = f.src.replace(/["\\\n]/g, '');
    const ext = (/\.(\w+)(?:\?|#|$)/.exec(src)?.[1] ?? /^data:font\/(\w+)/.exec(src)?.[1] ?? '').toLowerCase();
    const fmt = FORMAT[ext] ? ` format("${FORMAT[ext]}")` : '';
    return `@font-face{font-family:"${f.name.trim()}";src:url("${src}")${fmt};font-weight:100 900;font-style:normal;font-display:swap}`;
  }).join('\n');
  const font = fontNameOk(main) ? main.trim() : '';
  const text = faces + (font ? `\n.slide[data-fonts="K"]{--font:${fontStack(font)};font-family:var(--font)}` : '');
  if (!text.trim()) return null;
  const key = cssKey(text);
  const id = `htmlpptx-fonts-${key}`;
  if (!document.getElementById(id)) {
    const el = document.createElement('style');
    el.id = id;
    el.textContent = text.replace('data-fonts="K"', `data-fonts="${key}"`);
    document.head.appendChild(el);
  }
  return font ? key : null;
}
