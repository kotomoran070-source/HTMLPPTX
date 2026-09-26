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

export function accentTokens(accent: string): { light: Record<string, string>; dark: Record<string, string> } {
  return {
    light: {
      '--ac': hex(parse(accent)),
      '--ach': mix(accent, '#000000', 0.18),
      '--acs': mix(accent, '#FFFFFF', 0.92),
      '--acb': mix(accent, '#FFFFFF', 0.55),
    },
    dark: {
      '--ac': mix(accent, '#FFFFFF', 0.12),
      '--ach': mix(accent, '#FFFFFF', 0.55),
      '--acs': mix(accent, '#0F172A', 0.75),
      '--acb': hex(parse(accent)),
    },
  };
}

const block = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

/** Применяет акцентный цвет; без цвета возвращает стандартную палитру. */
export function applyAccent(accent: unknown): void {
  let el = document.getElementById(ID);
  const before = el?.textContent ?? '';
  if (typeof accent !== 'string' || !HEX_RE.test(accent)) {
    el?.remove();
    if (before) dispatchEvent(new Event(ACCENT_EVENT));
    return;
  }
  const { light, dark } = accentTokens(accent);
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
  }
  // Стиль всегда последним в <head>, чтобы перекрыть базовые токены
  document.head.appendChild(el);
  el.textContent = `:root{${block(light)}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${block(dark)}}}`
    + `:root[data-theme="dark"]{${block(dark)}}`;
  if (el.textContent !== before) dispatchEvent(new Event(ACCENT_EVENT));
}
