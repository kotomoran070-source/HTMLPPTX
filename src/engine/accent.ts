/**
 * Акцентный цвет презентации: theme.accent в deck.yaml.
 * Из одного цвета строятся все оттенки для светлой и тёмной темы.
 */
const ID = 'htmlpptx-accent';
/** Событие окна: акцентный цвет изменился (для «живых» вставок) */
export const ACCENT_EVENT = 'htmlpptx:accent';
export const HEX_RE = /^#[0-9a-f]{6}$/i;

type RGB = [number, number, number];

function parse(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Смешивает цвет a с цветом b: amount = доля b. */
function mix(a: string, b: string, amount: number): string {
  const x = parse(a);
  const y = parse(b);
  return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as RGB);
}

/** Стандартный акцент (как --ac в tokens.css): от него строится градиент, если задан только второй цвет */
export const DEFAULT_ACCENT = '#2563EB';

export function accentTokens(accent: string, accent2?: string | null): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {
    '--ac': hex(parse(accent)),
    '--ach': mix(accent, '#000000', 0.18),
    '--acs': mix(accent, '#FFFFFF', 0.92),
    '--acb': mix(accent, '#FFFFFF', 0.55),
  };
  const dark: Record<string, string> = {
    '--ac': mix(accent, '#FFFFFF', 0.12),
    '--ach': mix(accent, '#FFFFFF', 0.55),
    '--acs': mix(accent, '#0F172A', 0.75),
    '--acb': hex(parse(accent)),
  };
  // Второй цвет и градиент — явно: так они верны и там, где токены переопределены не на :root
  const two = accent2 && HEX_RE.test(accent2) ? accent2 : accent;
  light['--ac2'] = hex(parse(two));
  dark['--ac2'] = mix(two, '#FFFFFF', 0.12);
  for (const t of [light, dark]) t['--ac-g'] = `linear-gradient(135deg, ${t['--ac']}, ${t['--ac2']})`;
  return { light, dark };
}

const block = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

const PREVIEW_ID = 'htmlpptx-accent-preview';
const PREVIEW_ATTR = 'data-accent-preview';

/**
 * Показ цвета, пока тянут палитру: новые токены только у открытого слайда в stage — остальная
 * страница (миниатюры, лента) не пересчитывает стили на каждое движение. null — показ закончен.
 */
export function previewAccent(accent: string | null, stage?: HTMLElement, accent2?: string | null): void {
  let el = document.getElementById(PREVIEW_ID);
  if (!accent || !HEX_RE.test(accent)) {
    el?.remove();
    document.querySelectorAll(`[${PREVIEW_ATTR}]`).forEach((x) => x.removeAttribute(PREVIEW_ATTR));
    return;
  }
  stage?.setAttribute(PREVIEW_ATTR, '');
  if (!el) {
    el = document.createElement('style');
    el.id = PREVIEW_ID;
  }
  document.head.appendChild(el);
  const { light, dark } = accentTokens(accent, accent2);
  const sel = `[${PREVIEW_ATTR}] .slide.on`;
  el.textContent = `${sel}{${block(light)}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ${sel}{${block(dark)}}}`
    + `:root[data-theme="dark"] ${sel}{${block(dark)}}`;
}

/** Был тихий показ: следующее обычное применение оповестит вставки, даже если стиль уже тот же */
let quietShown = false;

/**
 * Применяет акцентный цвет (и второй цвет градиента); без цветов возвращает стандартную палитру.
 * quiet — только перекрасить (пока тянут палитру): вставки и холсты не перезапускаются.
 */
export function applyAccent(accent: unknown, accent2?: unknown, quiet = false): void {
  let el = document.getElementById(ID);
  const before = el?.textContent ?? '';
  const notify = (changed: boolean) => {
    if (quiet) quietShown = true;
    else if (changed || quietShown) {
      quietShown = false;
      dispatchEvent(new Event(ACCENT_EVENT));
    }
  };
  const a = typeof accent === 'string' && HEX_RE.test(accent) ? accent : null;
  const a2 = typeof accent2 === 'string' && HEX_RE.test(accent2) ? accent2 : null;
  if (!a && !a2) {
    el?.remove();
    notify(!!before);
    return;
  }
  const { light, dark } = accentTokens(a ?? DEFAULT_ACCENT, a2);
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
  }
  // Стиль всегда последним в <head>, чтобы перекрыть базовые токены
  document.head.appendChild(el);
  el.textContent = `:root{${block(light)}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${block(dark)}}}`
    + `:root[data-theme="dark"]{${block(dark)}}`;
  notify(el.textContent !== before);
}

/** Переливание градиента акцента: класс на <html>, анимация — в base.css */
export function applyAccentFlow(on: unknown): void {
  document.documentElement.classList.toggle('ac-flow', on === true);
}
