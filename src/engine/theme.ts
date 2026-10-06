export type Theme = 'light' | 'dark';

const KEY = 'htmlpptx-theme';
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<(t: Theme) => void>();

/**
 * Приложение Slideria (desktop/preload.cjs): заголовок окна Windows — в тон теме.
 * Сообщаем только выбор человека: временные переключения (экспорт в светлой теме) окно не трогают
 */
function tellApp(): void {
  const a = root.getAttribute('data-theme');
  (window as { slideriaApp?: { theme(m: string): void } }).slideriaApp?.theme(a === 'light' || a === 'dark' ? a : 'system');
}

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  const attr = root.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return media.matches ? 'dark' : 'light';
}

/** Постоянный вид слайдов, которые сейчас рисуются (тема презентации с theme.mode) */
let forced: Theme | null = null;
/** Рисование слайдов с постоянным видом: вернёт прежнее значение, чтобы его восстановить */
export function forceTheme(t: Theme | null): Theme | null {
  const was = forced;
  forced = t;
  return was;
}

/** Тема для слайда: постоянная тема презентации или тема интерфейса */
export function slideTheme(el?: Element | null): Theme {
  const m = el?.closest('[data-mode]')?.getAttribute('data-mode');
  if (m === 'light' || m === 'dark') return m;
  return forced ?? currentTheme();
}

/** Явно выбранная тема запоминается; без выбора тема следует за системой. */
export function setTheme(theme: Theme, persist = true): void {
  root.setAttribute('data-theme', theme);
  if (persist) {
    try { localStorage.setItem(KEY, theme); } catch { /* приватный режим */ }
  }
  listeners.forEach((l) => l(theme));
  tellApp();
}

export function toggleTheme(): Theme {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Подписка на смену темы; возвращает отписку. */
export function onThemeChange(cb: (t: Theme) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Картинки со своим вариантом для тёмной темы (data-src-dark, см. themedSrc в marks.ts):
 * адрес выбирается при рендере, а при смене темы меняется на месте.
 */
export function applyThemeImages(scope: ParentNode = document): void {
  const ui = currentTheme();
  scope.querySelectorAll('[data-src-dark]').forEach((el) => {
    const attr = el instanceof HTMLImageElement ? 'src' : 'href';
    // Слайд с постоянным видом (тема презентации) — по нему, а не по теме интерфейса
    const m = el.closest('[data-mode]')?.getAttribute('data-mode');
    const dark = (m === 'light' || m === 'dark' ? m : ui) === 'dark';
    const v = el.getAttribute(dark ? 'data-src-dark' : 'data-src-light');
    if (v && el.getAttribute(attr) !== v) el.setAttribute(attr, v);
  });
}

export function initTheme(): void {
  const s = stored();
  if (s) root.setAttribute('data-theme', s);
  tellApp();
  media.addEventListener('change', () => {
    if (!root.hasAttribute('data-theme')) {
      applyThemeImages();
      listeners.forEach((l) => l(currentTheme()));
    }
  });
  // Тему меняют и в обход setTheme (экспорт в PowerPoint рисует слайды в светлой)
  new MutationObserver(() => applyThemeImages()).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}
